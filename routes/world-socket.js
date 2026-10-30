/************************************************
 * WORLD SOCKET — Socket.IO handlers for /world
 *
 * Real-time presence + chat + emotes for the walkable universe map.
 * In-memory only; no persistence (World / Project chat is ephemeral by
 * design). The one exception is whispers: every whisper is also written to
 * the Message collection so it shows up in the /messages inbox, and a
 * whisper to a player who is NOT in the world right now is stored for
 * them instead of failing (see handleWhisper).
 *
 * Auth: JWT in socket.handshake.auth.token — same secret as the HTTP
 * auth middleware. Rejected sockets never reach the connection handler.
 *
 * Channel: every connected client joins the 'world' room. Server fans
 * position broadcasts to room peers (excluding sender). Chat fans to
 * everyone in the room (including sender, so the local UI can confirm
 * the message went through).
 ************************************************/
const auth = require('../middleware/auth');
const User = require('../models/user');
const AdminConfig = require('../models/AdminConfig');
const NpcLogic = require('../js/world-npc-logic');
const ChatLogic = require('../js/world-chat-logic');
const Stay = require('../js/world-stay-logic');
const Project = require('../models/Project');
const ProjectStay = require('../models/ProjectStay');
const Message = require('../models/Message');
const Friend = require('../models/Friend');
const { friendFilter } = require('../server/friendship');
const MessagingLogic = require('../js/messaging-logic');
const { PUNCH_COOLDOWN_MS, KNOCKDOWN, punchCheck, stoneSlot, STONE_RING, WORLD_GRID } = require('../js/playground3d-physics');
const RoadRouter = require('../js/road-router');
const PG3DScene = require('../js/playground3d-scene');
const NetLogic = require('../js/world-net-logic');
const contentLoader = require('../server/contentLoader');
// Scene Guess minigame — the live games; hooked in below (attach, register,
// zone changes, retired / reconnecting sockets, punch + snap immunity).
// Every island minigame (Scene Guess, Quote Guess) behind one interface.
const IslandGames = require('../server/island-games');
// The client sends its character on join and the server re-broadcasts it to
// every other joiner, so it is reduced to the known slots, each an in-range
// integer (server/character.js — the same ranges the profile PUT enforces).
// Stops a hostile client parking a large blob that gets fanned to everyone,
// and keeps junk out of other clients' rig builder.
const { sanitizeCharacter } = require('../server/character');
const Username = require('../server/username');
const RateStore = require('../server/rate-store');
const DmPolicy = require('../server/dm-policy');
const { clientIp, homeEjections, parseTrustProxy } = require('../server/socket-guard');

// Per-USER token buckets (js/world-net-logic.js RATES) for the events that
// hit the DB or fan out to a whole room without a floor of their own. Keyed
// by the verified user id, not the socket, so a reconnect (fresh socket)
// does not refill them — the old per-socket buckets did. The stores are
// built after the constants below (server/rate-store.js).
function rateOk(socket, key) {
  return userRl.allow(socket.data.userId || socket.id, key, Date.now());
}

// Copy a sanitized position packet (NetLogic.sanitizePos) onto a player
// record. Walking, jumping or taking a seat ends a looping emote — peers end
// it locally from the same packet; this keeps late joiners' snapshots right.
function applyPos(p, s) {
  p.x = s.x; p.y = s.y; p.z = s.z; p.yaw = s.yaw;
  p.walking = s.walking; p.backward = s.backward; p.pose = s.pose; p.mv = s.mv;
  if (p.emote && (s.walking || s.pose || (s.mv & NetLogic.MV.AIR))) p.emote = null;
}

// The position fan-out for world:pos / home:pos.
function posRelay(id, p) {
  return { id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, walking: p.walking, backward: p.backward, pose: p.pose, mv: p.mv || 0 };
}

// world:emote / home:emote. `kind` is an EMOTES id or 'stop'. A start needs a
// token (and no seat); 'stop' is only relayed when a loop is actually running.
// Returns the payload to relay, or null to drop it.
function emoteRelay(socket, p, raw) {
  const kind = raw && raw.kind;
  if (kind === 'stop') {
    if (!p.emote) return null;
    p.emote = null;
    return { id: socket.id, kind: 'stop' };
  }
  if (!NetLogic.isEmoteKind(kind) || p.pose) return null;
  if (!rateOk(socket, 'emote')) return null;
  p.emote = NetLogic.isLoopingEmote(kind) ? kind : null;
  return { id: socket.id, kind };
}

// socketId → { socketId, userId, username, character, x, z, yaw, walking, lastChat }
const worldPlayers = new Map();

// socketId → { socketId, userId, username, character, ownerId, x, y, z, yaw, walking, lastChat }
// `ownerId` is the user id of the home being visited — the per-home room
// is keyed `home:<ownerId>`. A socket can simultaneously be in worldPlayers
// and homePlayers; the two maps are independent.
const homePlayers = new Map();

// Voice-chat mesh membership (WebRTC P2P). Independent of position presence:
// a socket can be in worldPlayers/homePlayers without being voice-enabled.
// voiceWorld holds socketIds that opted into voice in /world; a socket's
// actual PEERS are members in the SAME ZONE — the same project island or the
// same road segment (ChatLogic.zoneKey: the scope Project chat uses too) —
// capped to the VOICE_CAP nearest (ChatLogic.selectVoiceLinks). The live
// links are voiceLinks (symmetric), kept in step by reconcileWorldVoice.
// On open ground (neither island nor road) a voice socket has no peers.
// voiceHomes maps ownerId → Set<socketId> for per-home voice meshes (room-wide).
const voiceWorld = new Set();
const voiceHomes = new Map();
const voiceLinks = new Map();   // socketId → Set<socketId>: the /world mesh edges right now
const VOICE_REBALANCE_MS = 2000;

function worldVoicePeers(sid) {
  const s = voiceLinks.get(sid);
  return s ? [...s] : [];
}

// Bring the /world voice mesh in line with who is where: every voice member
// links to its nearest same-zone members (≤ VOICE_CAP each). Emits only the
// deltas — peer-left for dropped links first (a client always destroys
// before it dials), then peer-joined to BOTH ends of each new link.
// `announcer` (a socket that just announced) gets its links as one
// voice:peers reply instead of peer-joined (that reply confirms the
// announce). Called on announce / leave / zone change / disconnect and on a
// slow timer (people move around within a zone).
function reconcileWorldVoice(io, announcer) {
  const entries = [];
  for (const sid of voiceWorld) {
    const p = worldPlayers.get(sid);
    if (p) entries.push({ id: sid, zone: ChatLogic.zoneKey(p), x: p.x, z: p.z });
  }
  const want = ChatLogic.selectVoiceLinks(entries, ChatLogic.C.VOICE_CAP, voiceLinks);
  const has = (m, a, b) => { const s = m.get(a); return !!s && s.has(b); };
  for (const [a, set] of voiceLinks) {
    for (const b of set) {
      if (a < b && !has(want, a, b)) {
        io.to(a).emit('voice:peer-left', { id: b });
        io.to(b).emit('voice:peer-left', { id: a });
      }
    }
  }
  for (const [a, set] of want) {
    for (const b of set) {
      if (a < b && !has(voiceLinks, a, b)) {
        if (a !== announcer) io.to(a).emit('voice:peer-joined', { id: b });
        if (b !== announcer) io.to(b).emit('voice:peer-joined', { id: a });
      }
    }
  }
  voiceLinks.clear();
  for (const [a, set] of want) if (set.size) voiceLinks.set(a, set);
  if (announcer) io.to(announcer).emit('voice:peers', { scope: 'world', peers: worldVoicePeers(announcer) });
}

// Drop socket `sid` from a home's voice mesh and tell the rest of the room.
// Called whenever a socket leaves a home (leave, switch, retired duplicate
// tab, disconnect) so dead ids never pile up in voiceHomes.
function leaveHomeVoice(io, sid, ownerId) {
  const set = voiceHomes.get(ownerId);
  if (!set || !set.delete(sid)) return;
  io.to('home:' + ownerId).except(sid).emit('voice:peer-left', { id: sid });
  if (set.size === 0) voiceHomes.delete(ownerId);
  const s = io.sockets.sockets.get(sid);
  if (s && s.data.voiceScope === 'home') s.data.voiceScope = null;
}

// ── Island stay accounting (keeper of each project house) ──
// Every world player carries `stay` (js/world-stay-logic.js) while standing
// on an island; it is touched by every accepted action and drained into
// pendingCredits on island exit / disconnect / the periodic flush, which then
// $inc's ProjectStay in one bulkWrite. The top ProjectStay row per project is
// that house's keeper (routes/world.js). `_io` is captured at startup so the
// HTTP route can broadcast a saved house to the room without a require cycle.
let _io = null;
const pendingCredits = new Map();      // "userId|projectId" → ms
let _flushing = null;                  // in-flight flush promise (PUT awaits it)
let _stayTimer = null;                 // the periodic flush; cleared by shutdownStays()

// Users an admin just deleted (id string → expiry timer). Deleting a user
// disconnects their live sockets AFTER their ProjectStay rows are gone, and
// the disconnect handler drains the stay into pendingCredits — the next
// flush's upsert would then re-create the rows (and maybe a keeper). So
// queueCredit and flushStays skip these ids. Ten minutes is plenty: the
// sockets are gone and the handshake rejects a deleted user from then on.
const deletedUsers = new Map();
const DELETED_USER_TTL_MS = 10 * 60 * 1000;

function queueCredit(userId, projectId, ms) {
  if (!userId || !projectId || !(ms > 0)) return;
  if (deletedUsers.has(String(userId))) return;
  const key = `${userId}|${projectId}`;
  pendingCredits.set(key, (pendingCredits.get(key) || 0) + ms);
}
function touchStay(p, now) {
  if (p && p.stay) Stay.touch(p.stay, now || Date.now());
}
function drainStay(p, now) {
  if (!p || !p.stay) return;
  queueCredit(p.userId, p.stay.projectId, Stay.drain(p.stay, now || Date.now()));
}
// Which ops of a failed `ordered: false` bulkWrite did NOT land (RT-08).
// The driver's MongoBulkWriteError carries `result` plus `writeErrors`
// ([WriteError], `.index` = position in the ops sent): every other op was
// applied, so re-queueing all of them double-counted those. Mongoose drops
// ops that fail its own casting before sending and then maps outcomes back
// to OUR indexes in `err.mongoose.results` (a WriteError, null = applied, or
// the cast Error — permanent, never retried). No `result` at all (network
// error, timeout): nothing is known to have landed, so all of them.
function unappliedOps(ops, err) {
  if (!err || !err.result) return ops;
  const results = err.mongoose && Array.isArray(err.mongoose.results) ? err.mongoose.results : null;
  if (results) return ops.filter((_, i) => results[i] && !(results[i] instanceof Error));
  const failed = new Set((err.writeErrors || [])
    .map(e => (e && Number.isInteger(e.index) ? e.index : e && e.err && e.err.index)));
  return ops.filter((_, i) => failed.has(i));
}

// Credit every live stay, then write the whole pending map. On a DB error the
// credits that didn't land stay queued for the next flush (at most one
// interval is at risk).
function flushStays() {
  if (_flushing) return _flushing;
  const now = Date.now();
  for (const p of worldPlayers.values()) drainStay(p, now);
  if (!pendingCredits.size) return Promise.resolve();
  const ops = [];
  for (const [key, ms] of pendingCredits) {
    const i = key.indexOf('|');
    if (deletedUsers.has(key.slice(0, i))) continue;
    ops.push({ updateOne: {
      filter: { userId: key.slice(0, i), projectId: key.slice(i + 1) },
      update: { $inc: { ms } },
      upsert: true
    } });
  }
  pendingCredits.clear();
  if (!ops.length) return Promise.resolve();
  _flushing = ProjectStay.bulkWrite(ops, { ordered: false })
    .catch((err) => {
      const retry = unappliedOps(ops, err);
      // Dead-letter note: these credits wait in memory for the next flush
      // (lost on a crash before it). queueCredit still skips deleted users.
      console.error(`[stays] flush failed (${err && err.message}): re-queued ${retry.length} of ${ops.length} credit(s)`);
      for (const op of retry) queueCredit(op.updateOne.filter.userId, op.updateOne.filter.projectId, op.updateOne.update.$inc.ms);
    })
    .finally(() => { _flushing = null; });
  return _flushing;
}

const MAX_USERNAME = 40;
const MAX_CHAT_LEN = 200;

// Push a whisper-shaped chat line to every live /world socket of `userId`
// (normally one). Used by the HTTP /api/messages route so a message sent
// from the inbox page lands in the recipient's Whisper tab if they happen to
// be standing in the world. Returns how many sockets received it.
function deliverWhisper(userId, out) {
  if (!_io) return 0;
  const id = String(userId);
  let n = 0;
  for (const p of worldPlayers.values()) {
    if (String(p.userId) === id) { _io.to(p.socketId).emit('world:chat', out); n++; }
  }
  return n;
}

// Every socket.on handler is registered through this: a sync throw or a
// rejected promise (async handlers, handleWhisper's Mongo round-trip) is
// logged as `[ws] <name> failed` instead of reaching the process-level
// unhandledRejection logger. Never throws; arguments (incl. the ack) pass
// through untouched. `name` is the event with '.' for ':' so the socket
// contract test doesn't read it as an emitted event.
function guard(name, fn) {
  const fail = (e) => console.error(`[ws] ${name} failed:`, e);
  return function guarded(...args) {
    try {
      const r = fn.apply(this, args);
      if (r && typeof r.catch === 'function') r.catch(fail);
    } catch (e) {
      fail(e);
    }
  };
}

// Whisper branch of 'world:chat'. Online target → live delivery exactly as
// before, plus a best-effort Message row (readAt set: they saw it). Offline
// target → look the username up in Mongo; a real user gets the message stored
// (readAt null → counts as unread in their inbox) and the sender an echo
// flagged `offline`; an unknown name is still 'not-found'.
// `onSent` runs only for a whisper that went out (marks the chat floor).
async function handleWhisper(io, socket, p, m, out, reply, onSent = () => {}) {
  let target = null;
  for (const other of worldPlayers.values()) {
    if (ChatLogic.sameName(other.username, m.to)) { target = other; break; }
  }
  if (target) {
    if (target.userId === p.userId) return reply({ ok: false, error: 'self' });
    // Same budget as the inbox (server/dm-policy.js): floor, burst, and a
    // daily cap per recipient for non-friends.
    const d = await DmPolicy.check(p.userId, target.userId).catch(() => ({ ok: false, error: 'not-sent' }));
    if (!d.ok) return reply(d);
    out.to = target.username;
    onSent();
    io.to(target.socketId).emit('world:chat', out);
    socket.emit('world:chat', out);
    Message.create({
      sender: p.userId, recipient: target.userId,
      pairKey: MessagingLogic.pairKey(p.userId, target.userId),
      kind: 'whisper', text: m.text, readAt: new Date()
    }).catch(err => console.error('[whisper] persist failed:', err && err.message));
    return reply({ ok: true, cooldownMs: 0 });
  }

  let user = null;
  try {
    // Indexed case-insensitive lookup (server/username.js).
    user = await Username.findByUsername(m.to, '_id username');
  } catch (err) {
    console.error('[whisper] lookup failed:', err && err.message);
    return reply({ ok: false, error: 'not-sent' });
  }
  if (!user) return reply({ ok: false, error: 'not-found', to: m.to });
  if (String(user._id) === String(p.userId)) return reply({ ok: false, error: 'self' });
  const d = await DmPolicy.check(p.userId, user._id).catch(() => ({ ok: false, error: 'not-sent' }));
  if (!d.ok) return reply(d);
  try {
    await Message.create({
      sender: p.userId, recipient: user._id,
      pairKey: MessagingLogic.pairKey(p.userId, user._id),
      kind: 'whisper', text: m.text, readAt: null
    });
  } catch (err) {
    console.error('[whisper] store failed:', err && err.message);
    return reply({ ok: false, error: 'not-sent' });
  }
  out.to = user.username;
  out.offline = true;
  onSent();
  socket.emit('world:chat', out);
  reply({ ok: true, cooldownMs: 0, offline: true, to: user.username });
}
// /home chat keeps its 1s floor; /world chat uses ChatLogic.C.COOLDOWN_MS
// (10s, shared across the world / project / whisper channels).
const CHAT_INTERVAL_MS = 1000;
// Floor between relayed punches per socket — the client cooldown, less slack
// for network jitter so an honest punch sent right at 1s is never dropped.
const PUNCH_INTERVAL_MS = PUNCH_COOLDOWN_MS - 150;
// Where a joiner is standing, from the join payload — so peers see them
// appear where they are, not at (0,0) until their first position update.
// Position packets (and this) go through js/world-net-logic.js, which wraps
// yaw into (-π, π]: an unwrapped 1e300 used to hang every peer's angle math.
const joinPos = NetLogic.joinPos;
// Knockdown / punch reach, validated here against the positions the players
// themselves broadcast (PG3DPhysics.punchCheck). Mirrors the engine's PUNCH.RANGE.
const PUNCH_RANGE = 1.4;
// Stolen-stone grabs must happen near the stone's ring slot. Slack covers a
// position packet (~100 ms) plus latency at sprint speed.
const STONE_GRAB_SLACK = 1.5;
const START_NODE_ID = 'ironman1';     // js/config.js CONFIG.START_NODE_ID
// Per-socket floor between accepted position updates. The client broadcasts at
// ~100ms (POS_INTERVAL_MS), so legitimate traffic never trips this — it only
// caps a hostile/scripted client that would otherwise fan thousands of pos
// packets/sec to the whole room (CPU + every peer's downlink). pos was the only
// hot fan-out path without a server-side guard (chat/voice already have one).
const POS_MIN_INTERVAL_MS = 40;       // ~25 updates/sec ceiling per socket
// NOTE: no per-pair rate cap — pooled ICE candidates fire back-to-back in
// the same millisecond, and a dropped trickle candidate is never
// retransmitted, so any per-pair interval breaks handshakes. The
// per-socket sliding-window budget below is the spam guard.
const VOICE_SIGNAL_BUDGET = 50;          // signals
const VOICE_SIGNAL_BUDGET_WINDOW_MS = 1000;
const VOICE_SIGNAL_MAX_BYTES = 8192;  // SDP fragments + ICE candidates are tiny

// ── Shared Infinity Stones (single 'world' room) ──
// One of each of the six stones. holder = socketId | null (null = free /
// on the ground). Ephemeral in-memory like worldPlayers — resets on server
// restart, and a holder's stones drop free when they leave (freeStonesOf).
// The server is authoritative over ownership; clients render from the
// broadcasts. It never needs world coordinates — free stones are placed at
// fixed ring slots client-side, held stones orbit their holder.
const STONE_IDS = ['space', 'mind', 'reality', 'power', 'time', 'soul'];
const SNAP_INTERVAL_MS = 3000;          // floor between snaps per socket
// Leaderboard credit rules (the snap itself still plays out): a snap with
// nobody else in the world scores nothing, and a round must have lasted
// MIN_SCORED_ROUND_MS since the stones last scattered. Otherwise one player
// alone could grab-and-snap ~20 times a minute to farm /api/friends/stones.
const MIN_SCORED_ROUND_MS = 60 * 1000;
let stonesRoundStartedAt = Date.now();
const worldStones = Object.create(null);
for (const id of STONE_IDS) worldStones[id] = { holder: null };

function stonesSnapshot() {
  const out = {};
  for (const id of STONE_IDS) out[id] = worldStones[id].holder;
  return out;
}

// Admin on/off switch for the whole Infinity Stone event (flags.worldEventStonesEnabled
// in AdminConfig). Synchronous cached read — returns the last known value and
// kicks a background refresh when stale, so the hot socket handlers never await.
// Defaults off (opt-in event) until the first DB read resolves. Toggling it in
// the admin panel takes effect within STONES_FLAG_TTL_MS for new grabs/snaps/joins.
const STONES_FLAG_TTL_MS = 15000;
let _stonesFlag = AdminConfig.defaults().flags.worldEventStonesEnabled;
let _stonesFlagAt = 0;
let _stonesFlagRefreshing = false;
function stonesEventEnabled() {
  if (Date.now() - _stonesFlagAt >= STONES_FLAG_TTL_MS && !_stonesFlagRefreshing) {
    _stonesFlagRefreshing = true;
    AdminConfig.findOne({}).select('flags.worldEventStonesEnabled').lean()
      .then((doc) => {
        const def = AdminConfig.defaults().flags.worldEventStonesEnabled;
        _stonesFlag = (doc && doc.flags && typeof doc.flags.worldEventStonesEnabled === 'boolean')
          ? doc.flags.worldEventStonesEnabled : def;
        _stonesFlagAt = Date.now();
      })
      .catch(() => { /* keep last known value */ })
      .finally(() => { _stonesFlagRefreshing = false; });
  }
  return _stonesFlag;
}
function stonesHeldBy(socketId) {
  return STONE_IDS.filter(id => worldStones[id].holder === socketId);
}

// ── Project grid (for Project chat) ──
// The server has no world geometry, but every project island sits at a fixed
// grid cell, so "which island is this player on" falls straight out of their
// broadcast position (ChatLogic.projectAt). Same cached-read shape as the
// stones flag: synchronous, refreshes in the background when stale.
const PROJECT_GRID_TTL_MS = 60000;
let _projectGrid = [];
let _projectGridAt = 0;
let _projectGridRefreshing = false;
let _projectGridGen = 0;   // bumped by invalidateProjectGrid()
function projectGrid() {
  if (Date.now() - _projectGridAt >= PROJECT_GRID_TTL_MS && !_projectGridRefreshing) {
    _projectGridRefreshing = true;
    const gen = _projectGridGen;
    Project.find({}).select('id title gridX gridY prerequisites').lean()
      // A read that started before an invalidate is still newer than what we
      // had, but isn't stamped fresh: the next call reads again.
      .then((docs) => { _projectGrid = docs || []; if (gen === _projectGridGen) _projectGridAt = Date.now(); })
      .catch(() => { /* keep last known grid */ })
      .finally(() => { _projectGridRefreshing = false; });
  }
  return _projectGrid;
}
// After an admin project write (routes/admin.js): re-read on the next use.
function invalidateProjectGrid() { _projectGridGen++; _projectGridAt = 0; }

// ── Road geometry (for road zones: voice + Project chat on a road) ──
// The same rook-style roads the client walks on: RoadRouter over the grid,
// laid out with PG3DScene.roadView and the engine's WORLD constants (the
// ones ChatLogic mirrors — drift-tested). Rebuilt only when the grid's
// layout actually changes (routing takes ~80 ms), i.e. after a refresh that
// brought new ids / cells / prerequisites (invalidateProjectGrid → refresh).
const ROAD_VIEW = PG3DScene.roadView({
  SCALE: WORLD_GRID.SCALE, PLATFORM_W: WORLD_GRID.PLATFORM_W, APRON_MARGIN: WORLD_GRID.APRON_MARGIN,
  ROAD_W: ChatLogic.C.ROAD_W, DOORWAY_WIDTH: ChatLogic.C.DOORWAY_WIDTH
});
let _roads = { grid: null, sig: '', rects: [], byKey: new Map(), titles: new Map() };
function roadGeometry() {
  const grid = projectGrid();
  if (_roads.grid === grid) return _roads;
  const sig = (grid || []).map(p => p && `${p.id}:${p.gridX},${p.gridY}:${(p.prerequisites || []).join(',')}`).join('|');
  const titles = new Map((grid || []).filter(p => p && p.id).map(p => [p.id, p.title || p.id]));
  if (sig === _roads.sig) { _roads = { ..._roads, grid, titles }; return _roads; }
  let built = { rects: [], byKey: new Map() };
  try { built = ChatLogic.buildRoads(grid, RoadRouter, ROAD_VIEW); } catch (e) { console.error('[ws] road routing failed:', e); }
  _roads = { grid, sig, rects: built.rects, byKey: built.byKey, titles };
  return _roads;
}
// What world:zone shows for a zone: the island title or "Road: A → B".
function zoneLabel(projectId, roadKey) {
  const g = roadGeometry();
  if (projectId) return g.titles.get(projectId) || projectId;
  if (roadKey) return ChatLogic.roadLabel(g.byKey.get(roadKey), (id) => g.titles.get(id));
  return '';
}

// Centre of the Infinity Stone ring: the START island (Iron Man 1) for every
// player — the client places the free stones around the same point. Falls
// back to the bundled projects.js grid when the DB has no projects yet;
// null when neither knows the node (the grab check then can't run).
function stoneRingCenter() {
  const find = (list) => (list || []).find(p => p && p.id === START_NODE_ID && typeof p.gridX === 'number' && typeof p.gridY === 'number');
  let n = find(projectGrid());
  if (!n) { try { n = find(contentLoader.get('projects')); } catch (_) { n = null; } }
  return n ? { x: n.gridX * ChatLogic.C.GRID_SCALE, z: n.gridY * ChatLogic.C.GRID_SCALE } : null;
}

// ── Avengers NPC fights (single 'world' room) ──
// The six hero NPCs patrol client-side from a shared clock (no server
// simulation), but their HIT POINTS, knock-outs and "who they're angry at"
// live here so every player sees the same fight and can gang up. Rules are
// the pure reducers in js/world-npc-logic.js (shared with the client).
// Ephemeral like worldStones — a restart heals everyone.
//
// Trust: the server has no world geometry, so the ATTACKING client asserts
// "my punch reached hero X" — exactly like today's player-vs-player punch —
// and the hero's TARGET client asserts "the hero reached me" for its swings.
// Guards: the per-socket punch floor, a per-hero swing cooldown, KO'd heroes
// ignore hits, and every HP / KO / aggro transition happens only here.
const worldNpcs = NpcLogic.initialNpcState();
const NPC_IDS = new Set(NpcLogic.NPC_IDS);

// Rate state keyed by user id (buckets + the chat / punch / snap floors that
// used to live on the per-join player record) and by client IP (handshake
// floods). Bounded LRU maps, swept once a minute (timers set up in attach).
const userRl = new RateStore({
  rates: NetLogic.RATES, maxKeys: 10000,
  floorMaxMs: Math.max(ChatLogic.C.COOLDOWN_MS, SNAP_INTERVAL_MS, PUNCH_INTERVAL_MS, CHAT_INTERVAL_MS)
});
const ipRl = new RateStore({ rates: NetLogic.RATES, maxKeys: 20000 });
// Floor names on userRl: 'anyChat' (every /world channel), 'worldChat' (the
// 10 s World cooldown), 'homeChat', 'punch', 'snap'.
function floorLeft(socket, name, ms, now) { return userRl.floorLeft(socket.data.userId || socket.id, name, ms, now); }
function markFloor(socket, name, now) { userRl.mark(socket.data.userId || socket.id, name, now); }

function npcUpdatePayload(id, event, by) {
  const n = worldNpcs[id];
  return {
    npc: id, hp: n.hp, maxHp: n.maxHp, target: n.target, stopAt: n.stopAt, pathOffsetMs: n.pathOffsetMs || 0,
    koUntil: n.koUntil, getupUntil: n.getupUntil || 0, aggroUntil: n.aggroUntil,
    event, by: by || null, serverTime: Date.now()
  };
}

module.exports = (io) => {
  _io = io;
  stonesEventEnabled();   // prime the cached event flag at startup
  projectGrid();          // prime the island grid for Project chat
  // Persist island stays once a minute; unref'd so it never keeps the
  // process alive on its own.
  _stayTimer = setInterval(() => { flushStays(); }, Stay.C.FLUSH_INTERVAL_MS);
  if (_stayTimer.unref) _stayTimer.unref();
  const rlTimer = setInterval(() => { const t = Date.now(); userRl.sweep(t); ipRl.sweep(t); }, 60 * 1000);
  if (rlTimer.unref) rlTimer.unref();
  // Re-pick each voice player's nearest peers as people move within a zone.
  const voiceTimer = setInterval(() => { if (voiceWorld.size || voiceLinks.size) reconcileWorldVoice(io); }, VOICE_REBALANCE_MS);
  if (voiceTimer.unref) voiceTimer.unref();
  const trustHops = parseTrustProxy(process.env.TRUST_PROXY);

  // Handshake auth — verify the JWT AND enforce the same ban / tokenVersion
  // checks the HTTP layer does (validateToken). Without this, a banned or
  // force-logged-out user keeps full realtime chat/voice/presence until their
  // JWT expires. Also resolves the authoritative username so the client can't
  // spoof a display name.
  io.use(async (socket, next) => {
    try {
      const now = Date.now();
      // Connection floods: per client IP BEFORE any JWT or DB work (same hop
      // count as Express's trust proxy), then per user after the token is
      // verified. socket.io does not retry a rejected handshake on its own —
      // the client (js/home-socket.js) schedules one retry on this message.
      const ip = clientIp(socket.handshake.headers['x-forwarded-for'], socket.handshake.address, trustHops);
      if (!ipRl.allow(ip, 'handshakeIp', now)) return next(new Error('Too many connections'));
      const token = socket.handshake.auth && socket.handshake.auth.token;
      const result = await auth.validateToken(token);
      if (!result.ok) return next(new Error(result.error || 'Unauthorized'));
      if (!userRl.allow(String(result.payload.id), 'handshakeUser', now)) return next(new Error('Too many connections'));
      socket.data.userId = String(result.payload.id);
      socket.data.username = result.username || null;
      next();
    } catch (e) {
      next(new Error('Invalid token'));
    }
  });

  // When a user is banned / force-logged-out, the auth cache is invalidated;
  // hook that to also drop their LIVE sockets (the handshake only runs at
  // connect, so an active socket would otherwise survive until JWT expiry).
  // The client then auto-reconnects, the handshake rejects, and it surfaces
  // the suspension toast.
  auth.onInvalidate = (userId) => {
    for (const [, s] of io.sockets.sockets) {
      if (s.data && String(s.data.userId) === String(userId)) {
        try { s.disconnect(true); } catch (_) {}
      }
    }
  };

  // Free every stone a leaving/evicted socket was holding, broadcasting each
  // drop so a rejoin or second tab can't strand a stone on a dead socket.
  function freeStonesOf(socketId) {
    for (const id of STONE_IDS) {
      if (worldStones[id].holder === socketId) {
        worldStones[id].holder = null;
        io.to('world').emit('world:stone-update', { stone: id, holder: null });
      }
    }
  }

  // A hero's target left — it stops squaring up and walks back to its patrol.
  function releaseNpcTarget(socketId) {
    for (const id of NpcLogic.NPC_IDS) {
      const r = NpcLogic.releaseTarget(worldNpcs[id], socketId, Date.now());
      if (!r.changed) continue;
      worldNpcs[id] = r.npc;
      io.to('world').emit('world:npc-update', npcUpdatePayload(id, 'target-left'));
    }
  }

  // One timer for get-ups, cooling off and healing — runs only while someone
  // is hurt, angry or out cold, so an idle world costs nothing.
  let npcTicker = null;
  function ensureNpcTicker() {
    if (npcTicker) return;
    npcTicker = setInterval(() => {
      const now = Date.now();
      for (const id of NpcLogic.NPC_IDS) {
        const r = NpcLogic.tickNpc(worldNpcs[id], now);
        if (!r.events.length) continue;
        worldNpcs[id] = r.npc;
        for (const ev of r.events) io.to('world').emit('world:npc-update', npcUpdatePayload(id, ev));
      }
      if (NpcLogic.allIdle(worldNpcs, now)) { clearInterval(npcTicker); npcTicker = null; }
    }, NpcLogic.C.TICK_MS);
  }

  // The user's watched project ids, kept on socket.data (never broadcast).
  // Islands only exist client-side for watched projects, so standing on an
  // unwatched one means a forged position — it earns no stay credit (the
  // keeper race), no Project chat and no island voice. Reloaded at most every
  // WATCHED_REFRESH_MS so a title finished mid-session unlocks its island
  // without letting a zone-spamming client hammer the DB.
  const WATCHED_REFRESH_MS = 15000;
  function refreshWatched(socket, force = false) {
    const d = socket.data;
    if (d.watchedLoading || (!force && d.watchedAt && Date.now() - d.watchedAt < WATCHED_REFRESH_MS)) return;
    d.watchedLoading = true;
    User.findById(d.userId).select('watchedProjects.projectId').lean()
      .then(u => { d.watched = new Set(((u && u.watchedProjects) || []).map(e => e.projectId)); })
      .catch(() => {})
      .finally(() => {
        d.watchedLoading = false; d.watchedAt = Date.now();
        // Re-derive the island now the list is in (see applyZone): the
        // client only resends its position when it moves, so a player who
        // joined (or whose island just unlocked) while standing still would
        // otherwise never get their world:zone.
        // Guarded like the socket handlers: a throw here would otherwise
        // surface as an unhandled rejection of this .finally() chain.
        if (typeof d.onWatched === 'function') {
          try { d.onWatched(); } catch (e) { console.error('[ws] onWatched failed:', e); }
        }
      });
  }

  // The island a player stands on by their last broadcast position, or null.
  // Only islands they've watched count — mirrors _isProjectUnlocked in
  // js/playground3d.js: a user with nothing watched yet spawns on the start
  // island (Iron Man).
  function zoneOf(socket, p) {
    const island = ChatLogic.projectAt(p.x, p.z, projectGrid());
    const watched = socket.data.watched;
    const allowed = !!watched && (watched.has(island) || (watched.size === 0 && island === 'ironman1'));
    if (island && !allowed) refreshWatched(socket);
    return island && allowed ? island : null;
  }

  // The road segment a player stands on (off-island), or null. Only roads
  // whose BOTH end islands the user has watched count — the client only
  // builds a road once both ends are unlocked. `prevKey` keeps them on the
  // road they were on through a crossing (ChatLogic.roadAt hysteresis).
  function roadOf(socket, p, prevKey) {
    const g = roadGeometry();
    const key = ChatLogic.roadAt(p.x, p.z, g.rects, prevKey);
    if (!key) return null;
    const road = g.byKey.get(key);
    const watched = socket.data.watched;
    const ok = !!road && !!watched && watched.has(road.fromId) && watched.has(road.toId);
    if (!ok) refreshWatched(socket);
    return ok ? key : null;
  }

  IslandGames.attach(io, { players: worldPlayers, rateOk, touchStay, zoneOf });

  io.on('connection', (socket) => {
    IslandGames.register(socket);

    // Client must emit 'world:join' before broadcasting anything else.
    socket.on('world:join', guard('world.join', (raw) => {
      // Each join hits the DB (watched list) and fans out to the whole room.
      // A real client joins once per socket (a reconnect is a new socket).
      // A bare return here left the client connected to an empty world (no
      // snapshot, nobody sees it, chat says not-joined). Tell it when to try
      // again; js/home-socket.js re-sends the join after retryInMs.
      if (!rateOk(socket, 'join')) {
        return socket.emit('world:join-refused', { reason: 'slow-down', retryInMs: NetLogic.refillMs('join') });
      }
      // Username comes from the verified token, NOT the client payload, so a
      // user can't join as someone else in chat/nametag.
      const username  = String(socket.data.username || 'Anon').slice(0, MAX_USERNAME);
      const character = sanitizeCharacter(raw && raw.character);

      socket.join('world');
      refreshWatched(socket, true);
      const player = {
        socketId: socket.id,
        userId:   socket.data.userId,
        username,
        character,
        ...joinPos(raw), y: 0,
        walking: false,
        pose: null,         // 'sit' | 'lie' while on a chair / bed — in the snapshot so late joiners see it
        mv: 0,              // movement flags (NetLogic.MV) from the last position packet
        emote: null,        // looping emote in progress — in the snapshot so late joiners see it
        downAt: 0,          // when their last accepted knockdown landed (punch immunity)
        projectId: null,    // island the player stands on (Project chat / voice scope)
        roadKey: null,      // …or the road segment (RoadRouter key) when off-island
        stay: null          // js/world-stay-logic record while on an island
      };
      worldPlayers.set(socket.id, player);

      // Single live presence per user. A refresh or a second tab opens a new
      // socket; without this the same user lingers as duplicate/ghost avatars
      // for everyone else. Drop any OLDER socket belonging to this user (we
      // don't disconnect it — that would ping-pong two real tabs — we just
      // retire its avatar from the room).
      for (const [sid, other] of worldPlayers) {
        if (sid !== socket.id && other.userId === socket.data.userId) {
          drainStay(other);    // bank the retired socket's island time
          // Retire it from the voice mesh too, or its island peers would keep
          // a dead RTCPeerConnection open until it finally disconnects.
          if (voiceWorld.has(sid)) {
            voiceWorld.delete(sid);
            reconcileWorldVoice(io);   // peer-left both ways for its links
            const old = io.sockets.sockets.get(sid);
            if (old && old.data) old.data.voiceScope = null;
          }
          IslandGames.retire(sid);   // its game seat waits for this new socket (resume below)
          worldPlayers.delete(sid);
          // …and out of the room, or the retired tab keeps receiving
          // everyone's positions and chat.
          io.in(sid).socketsLeave('world');
          io.to('world').emit('world:left', { id: sid });
          // Tell that tab, or it sits there frozen: peers stop moving, its
          // chat fails and nobody can see it. It leaves /world (never
          // rejoins), so two open tabs can't keep retiring each other.
          io.to(sid).emit('world:kicked', { reason: 'elsewhere' });
          freeStonesOf(sid);   // don't strand this user's stones on the retired socket
          releaseNpcTarget(sid);
        }
      }

      // Bootstrap the new client with everyone else's current state — the
      // public fields only (no user ids, chat timing or stay accounting).
      const others = [...worldPlayers.values()].filter(p => p.socketId !== socket.id).map(NetLogic.publicPlayer);
      // serverTime lets clients derive a shared clock. The roaming NPCs are
      // simulated locally on every client from that clock, so without a common
      // time base each user would see the same hero in a different spot.
      socket.emit('world:snapshot', { players: others, serverTime: Date.now() });
      // Hero HP / KO / aggro — sent after the snapshot so the client's clock
      // skew is set before it converts these server-time deadlines.
      socket.emit('world:npcs', { npcs: NpcLogic.snapshot(worldNpcs), serverTime: Date.now() });
      // Current shared-stone ownership so the joiner renders held/free correctly.
      // Only while the event is on — off, we send nothing so the client never
      // materializes the stone ring (its HUD is hidden client-side too).
      if (stonesEventEnabled()) socket.emit('world:stones', { stones: stonesSnapshot() });

      // Tell everyone else about the new arrival.
      socket.to('world').emit('world:joined', NetLogic.publicPlayer(player));
      // Back on a new socket mid-game (reload / reconnect / new tab)? Retake the seat.
      IslandGames.resume(socket);
    }));

    socket.on('world:pos', guard('world.pos', (raw) => {
      const p = worldPlayers.get(socket.id);
      if (!p) return;
      const nowPos = Date.now();
      if (nowPos - (socket.data.lastPos || 0) < POS_MIN_INTERVAL_MS) return;
      socket.data.lastPos = nowPos;
      // Bounds x/z, clamps y (so a hacked client can't fling its character to
      // the moon for everyone else), wraps yaw, whitelists pose + move flags.
      const s = NetLogic.sanitizePos(raw);
      if (!s) return;
      applyPos(p, s);
      // Track which project island they're on; tell the client when it
      // changes so its Project chat tab can relabel / enable itself. The
      // island is also the voice scope and the stay-credit bucket.
      // Only islands the user has watched count (see zoneOf / refreshWatched).
      if (!applyZone(p, nowPos)) touchStay(p, nowPos);
      socket.to('world').emit('world:pos', posRelay(socket.id, p));
    }));

    // Re-derive the zone `p` stands in (island, else road segment, else
    // none) and, once it has held for ZONE_DWELL_MS, apply it: stay credit,
    // world:zone, the island games and the voice mesh. Shared by world:pos
    // and the watched-list load (onWatched below), so a zone found without a
    // move behaves exactly like walking into it. Idempotent: a load that
    // lands after a move already set the zone sends nothing. A pending
    // change re-checks itself on a timer (a player who stops in the new zone
    // sends no more positions). Returns true when the zone changed.
    function applyZone(p, now) {
      const d = socket.data;
      const island = zoneOf(socket, p);
      const road = island ? null : roadOf(socket, p, d.roadCand || p.roadKey || null);
      d.roadCand = road;
      const cand = island ? 'p:' + island : road ? 'r:' + road : null;
      const prev = d.zoneDwell || {};
      const step = ChatLogic.dwellStep({ zone: ChatLogic.zoneKey(p), pending: prev.pending, since: prev.since }, cand, now);
      d.zoneDwell = step;
      if (d.zoneTimer) { clearTimeout(d.zoneTimer); d.zoneTimer = null; }
      if (!step.changed) {
        if (step.waitMs > 0) {
          d.zoneTimer = setTimeout(guard('world.zoneDwell', () => {
            d.zoneTimer = null;
            const q = socket.connected && worldPlayers.get(socket.id);
            if (q) applyZone(q, Date.now());
          }), step.waitMs + 10);
        }
        return false;
      }
      const prevIsland = p.projectId;
      if (island !== prevIsland) {
        drainStay(p, now);
        p.stay = island ? Stay.enter(island, now) : null;
      }
      p.projectId = island;
      p.roadKey = road;
      socket.emit('world:zone', { projectId: island, roadKey: road, label: zoneLabel(island, road) });
      // After the zone so the client knows its island before the game shows.
      if (island !== prevIsland) IslandGames.onZone(socket, p, prevIsland, island);
      // Voice: drop the old zone's links, link up in the new one (deltas;
      // the client destroys before it dials — see reconcileWorldVoice).
      if (voiceWorld.has(socket.id)) reconcileWorldVoice(io);
      return true;
    }

    // The join's watched-list read (refreshWatched) is async and usually
    // lands AFTER the client's first position packet, which then found no
    // island (zoneOf needs the list). Re-run the zone check against where
    // the player stands now (joinPos until they move). Skipped when the
    // socket left /world (or disconnected) before the read came back: the
    // record is gone from worldPlayers then.
    socket.data.onWatched = () => {
      if (!socket.connected) return;
      const p = worldPlayers.get(socket.id);
      if (p) applyZone(p, Date.now());
    };

    // Chat, split into channels: 'world' (everyone), 'project' (players on
    // the sender's island) and 'whisper' (one named player). Only 'world' has
    // the 10s cooldown. `ack` (optional) reports the real outcome so the
    // client only clears the box / shows the bubble / starts its countdown
    // for a message that actually went out — a rejected send costs nothing.
    socket.on('world:chat', guard('world.chat', (raw, ack) => {
      const reply = (typeof ack === 'function') ? ack : () => {};
      const p = worldPlayers.get(socket.id);
      if (!p) return reply({ ok: false, error: 'not-joined' });
      const m = ChatLogic.normalizeMessage(raw);
      if (!m.ok) return reply(m);
      const now = Date.now();
      // Spam floor on every channel (same as the /messages DM route). Project
      // and whisper have no 10s cooldown, but a script must not be able to
      // flood an island or someone's inbox. Floors are per USER (userRl), so
      // reconnecting does not reset them.
      const anyLeft = floorLeft(socket, 'anyChat', MessagingLogic.C.SEND_FLOOR_MS, now);
      if (anyLeft > 0) return reply({ ok: false, error: 'cooldown', retryInMs: anyLeft });
      const limited = ChatLogic.hasCooldown(m.channel);
      if (limited) {
        const retryInMs = floorLeft(socket, 'worldChat', ChatLogic.C.COOLDOWN_MS, now);
        if (retryInMs > 0) return reply({ ok: false, error: 'cooldown', retryInMs });
      }

      // An accepted message counts as island activity (people chatting stand
      // still) and spends the anyChat floor. Only sends that go out call
      // this: the rejections above, 'no-project' below and a whisper that
      // handleWhisper refuses (not-found, self, DM policy) cost nothing (RT-10).
      const accept = () => { touchStay(p, now); markFloor(socket, 'anyChat', now); };
      // Sender always gets its own copy (so its log shows what went out).
      const out = { channel: m.channel, id: socket.id, username: p.username, text: m.text };
      if (m.channel === 'world') {
        accept();
        io.to('world').emit('world:chat', out);
      } else if (m.channel === 'project') {
        // Project chat = the sender's zone: their island, or the road
        // segment they're on (ChatLogic.zoneKey — the voice scope too).
        const zone = ChatLogic.zoneKey(p);
        if (!zone) return reply({ ok: false, error: 'no-project' });
        accept();
        out.projectId = p.projectId || null;
        if (p.roadKey && !p.projectId) out.roadKey = p.roadKey;
        for (const [sid, other] of worldPlayers) {
          if (ChatLogic.zoneKey(other) === zone) io.to(sid).emit('world:chat', out);
        }
      } else {
        // Whisper has no cooldown, so nothing below this branch applies —
        // handleWhisper owns the ack (it may need a Mongo round-trip) and
        // calls accept() only once the whisper is actually sent.
        return handleWhisper(io, socket, p, m, out, reply, accept);
      }
      if (!limited) return reply({ ok: true, cooldownMs: 0 });
      markFloor(socket, 'worldChat', now);
      reply({ ok: true, cooldownMs: ChatLogic.C.COOLDOWN_MS });
    }));

    socket.on('world:emote', guard('world.emote', (raw) => {
      const p = worldPlayers.get(socket.id);
      if (!p) return;
      const out = emoteRelay(socket, p, raw);
      if (!out) return;
      touchStay(p);
      socket.to('world').emit('world:emote', out);
    }));

    // Punch relay. Same per-user cooldown pattern as chat. `target` must be
    // null (a whiffed swing everyone still sees) or a current world player's
    // socket id — the victim's client knocks itself down on receipt; the
    // sender already animated the hit optimistically. `npc` (exclusive with
    // `target`) names a hero the swing reached: HP comes off here and the
    // result is broadcast to everyone, sender included.
    //
    // A player hit is checked against the positions both players broadcast
    // (PG3DPhysics.punchCheck): out of reach, a victim still down / getting up
    // (KNOCKDOWN.IMMUNE_MS), or an attacker who is down themselves is relayed
    // as a whiff, and the ack tells the attacker's client to undo its
    // optimistic knockdown. Without this one modified client could stun-lock
    // anyone, anywhere on the map.
    socket.on('world:punch', guard('world.punch', (raw, ack) => {
      const reply = (typeof ack === 'function') ? ack : () => {};
      const p = worldPlayers.get(socket.id);
      if (!p) return reply({ ok: false, reason: 'not-joined' });
      const now = Date.now();
      if (floorLeft(socket, 'punch', PUNCH_INTERVAL_MS, now) > 0) return reply({ ok: false, reason: 'cooldown' });
      markFloor(socket, 'punch', now);
      let target = raw && raw.target;
      if (target != null && (typeof target !== 'string' || !worldPlayers.has(target))) return reply({ ok: false, reason: 'bad-target' });
      let npc = raw && raw.npc;
      if (npc != null && (typeof npc !== 'string' || !NPC_IDS.has(npc))) return reply({ ok: false, reason: 'bad-target' });
      if (target && npc) return reply({ ok: false, reason: 'bad-target' });
      if (target === socket.id) return reply({ ok: false, reason: 'bad-target' });
      if (p.downAt && now - p.downAt < KNOCKDOWN.DOWN_MS + KNOCKDOWN.GETUP_MS) {
        return reply({ ok: false, reason: 'attacker-down' });
      }
      touchStay(p, now);
      if (target) {
        const victim = worldPlayers.get(target);
        // Mid Scene Guess the player can't move or dodge — a knockdown (or a
        // shove off the island, which would drop them from the game) is griefing.
        if (IslandGames.isPlaying(target)) {
          socket.to('world').emit('world:punch', { id: socket.id, target: null });
          return reply({ ok: false, reason: 'busy' });
        }
        const verdict = punchCheck({ now, attacker: p, victim, range: PUNCH_RANGE });
        if (verdict !== 'ok') {
          socket.to('world').emit('world:punch', { id: socket.id, target: null });
          return reply({ ok: false, reason: verdict });
        }
        victim.downAt = now;
        victim.emote = null;
      }
      socket.to('world').emit('world:punch', { id: socket.id, target: target || null });
      reply({ ok: true });
      if (npc) {
        const r = NpcLogic.applyHit(worldNpcs[npc], socket.id, now);
        if (r.event) {
          worldNpcs[npc] = r.npc;
          io.to('world').emit('world:npc-update', npcUpdatePayload(npc, r.event, socket.id));
          ensureNpcTicker();
        }
      }
      // Steal ONE stone from the victim if they're carrying any. Punch/knockdown
      // stays a general mechanic; only the stone theft is gated by the event.
      if (target && stonesEventEnabled()) {
        const held = stonesHeldBy(target);
        if (held.length) {
          const stone = held[0];
          worldStones[stone].holder = socket.id;
          io.to('world').emit('world:stone-update', { stone, holder: socket.id });
        }
      }
    }));

    // A hero swings at ITS TARGET — requested by the target's own client (the
    // only one that knows where it really stands), gated by a per-hero
    // cooldown. Broadcast to everyone including the sender, which knocks
    // itself down on the echo, the same way world:punch works.
    socket.on('world:npc-punch', guard('world.npc-punch', (raw) => {
      const me = worldPlayers.get(socket.id);
      if (!me) return;
      const npc = raw && raw.npc;
      if (typeof npc !== 'string' || !NPC_IDS.has(npc)) return;
      if (IslandGames.isPlaying(socket.id)) return;   // heroes leave island-game players alone too
      const now = Date.now();
      // Still down / getting up from the last hit — the hero waits its turn
      // (same immunity as player punches, so heroes can't chain-stun either).
      if (me.downAt && now - me.downAt < KNOCKDOWN.IMMUNE_MS) return;
      if (!NpcLogic.canNpcSwing(worldNpcs[npc], socket.id, now)) return;
      worldNpcs[npc] = Object.assign({}, worldNpcs[npc], { lastSwingAt: now });
      me.downAt = now;
      me.emote = null;
      io.to('world').emit('world:npc-punch', { npc, target: socket.id });
    }));

    // Claim a FREE stone the client reached on foot. Authoritative: only the
    // first grab wins; losers reconcile from the world:stone-update broadcast.
    // The grabber must be standing near that stone's ring slot (by the
    // position it broadcasts) — a script can no longer sweep all six from
    // anywhere. A refused grab gets the true state back so its optimistic
    // hide undoes itself.
    socket.on('world:stone-grab', guard('world.stone-grab', (raw) => {
      if (!stonesEventEnabled()) return;      // event off — no stones to grab
      const p = worldPlayers.get(socket.id);
      if (!p) return;
      const stone = raw && raw.stone;
      if (typeof stone !== 'string' || !STONE_IDS.includes(stone)) return;
      const resync = () => socket.emit('world:stones', { stones: stonesSnapshot() });
      if (!rateOk(socket, 'stoneGrab')) return resync();
      if (worldStones[stone].holder !== null) return resync();   // already taken
      const center = stoneRingCenter();
      if (center) {
        const slot = stoneSlot(center.x, center.z, STONE_IDS.indexOf(stone));
        const reach = STONE_RING.PICKUP_R + STONE_GRAB_SLACK;
        const dx = p.x - slot.x, dz = p.z - slot.z;
        if (dx * dx + dz * dz > reach * reach) return resync();
      }
      touchStay(p);
      worldStones[stone].holder = socket.id;
      io.to('world').emit('world:stone-update', { stone, holder: socket.id });
    }));

    // Snap — only valid while holding all six. Dusts a random ~50% of the
    // OTHER players (they fade + respawn at spawn client-side), then all six
    // stones scatter free for a fresh round. Lifetime snap count persists.
    socket.on('world:snap', guard('world.snap', () => {
      if (!stonesEventEnabled()) return;      // event off — snapping disabled
      const p = worldPlayers.get(socket.id);
      if (!p) return;
      const now = Date.now();
      if (floorLeft(socket, 'snap', SNAP_INTERVAL_MS, now) > 0) return;
      if (stonesHeldBy(socket.id).length < STONE_IDS.length) return;   // authority
      markFloor(socket, 'snap', now);
      touchStay(p, now);

      // Scene Guess players are never dusted: the respawn teleports them off
      // their island, which would drop them from the game.
      const others = [...worldPlayers.keys()].filter(id => id !== socket.id && !IslandGames.isPlaying(id));
      // Unbiased random half via a partial Fisher–Yates shuffle.
      for (let i = others.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = others[i]; others[i] = others[j]; others[j] = t;
      }
      const victims = others.slice(0, Math.ceil(others.length / 2));
      const scored = others.length > 0 && now - stonesRoundStartedAt >= MIN_SCORED_ROUND_MS;
      const unscoredReason = scored ? null : (others.length ? 'quick' : 'alone');
      stonesRoundStartedAt = now;
      io.to('world').emit('world:snapped', { by: socket.id, victims, scored, unscoredReason });

      for (const id of STONE_IDS) worldStones[id].holder = null;
      io.to('world').emit('world:stones', { stones: stonesSnapshot() });

      if (scored) User.findByIdAndUpdate(socket.data.userId, { $inc: { stoneSnaps: 1 } }).catch(() => {});
    }));

    // ── home:* events ──
    //
    // One per-home room keyed by the owner's user id. Clients send the
    // owner's USERNAME (it's what the URL exposes) and the server
    // resolves it to an id so the visitor doesn't need the owner's id.
    // Shape mirrors world:* so the client uses the same handlers.

    socket.on('home:join', guard('home.join', async (raw) => {
      // One or two DB lookups per join — rate-limited like world:join (its
      // own bucket: the user-keyed `join` bucket is shared by every tab).
      // Every refusal below is answered with home:join-refused; a bare return
      // left the client in an empty home with no hint why. 'slow-down' and
      // 'error' are retried by js/home-socket.js, the others are final. A
      // stale() join (socket gone or superseded) stays silent: nobody waits on it.
      const refuse = (reason, retryInMs) => {
        socket.emit('home:join-refused', retryInMs ? { reason, retryInMs } : { reason });
      };
      if (!rateOk(socket, 'homeJoin')) return refuse('slow-down', NetLogic.refillMs('homeJoin'));
      // typeof guard: String() on a crafted object throws and crashes the process.
      const ownerUsername = (typeof raw?.ownerUsername === 'string' ? raw.ownerUsername : '').slice(0, MAX_USERNAME);
      if (!ownerUsername) return refuse('bad-request');
      // The lookups below are async: if the socket disconnects (quick reload /
      // navigate-away) or leaves / re-joins while they run, the disconnect
      // handler has nothing to remove yet, and adding the player afterwards
      // left a frozen ghost avatar in that home. Every await re-checks.
      const seq = socket.data.homeJoinSeq = (socket.data.homeJoinSeq || 0) + 1;
      const stale = () => !socket.connected || socket.data.homeJoinSeq !== seq;
      let owner;
      try {
        // Case-insensitive, like GET /api/friends/by-username: /friend/Bob/home
        // renders the page, so the join must find the same owner.
        owner = await Username.findByUsername(ownerUsername, '_id');
      } catch (_) { if (!stale()) refuse('error', 3000); return; }
      if (stale()) return;
      if (!owner) return refuse('not-found');

      // Only the owner and their accepted friends may enter — same rule as
      // GET /api/friends/by-username. Without it any logged-in user could
      // join, chat and (via voice) see the IPs of everyone inside.
      if (String(owner._id) !== String(socket.data.userId)) {
        try {
          const ok = await Friend.exists(friendFilter(socket.data.userId, owner._id));
          if (stale()) return;
          if (!ok) return refuse('not-friends');
        } catch (_) { if (!stale()) refuse('error', 3000); return; }
      }

      const ownerId  = String(owner._id);
      const username = String(socket.data.username || 'Anon').slice(0, MAX_USERNAME);
      const character = sanitizeCharacter(raw && raw.character);

      // Idempotent — if this socket already joined the same home, just
      // re-send the snapshot. If it joined a different home, leave the
      // old room first.
      const prev = homePlayers.get(socket.id);
      if (prev && prev.ownerId !== ownerId) {
        leaveHomeVoice(io, socket.id, prev.ownerId);
        socket.leave('home:' + prev.ownerId);
        socket.to('home:' + prev.ownerId).emit('home:left', { id: socket.id });
        homePlayers.delete(socket.id);
      }

      socket.join('home:' + ownerId);
      const player = {
        socketId: socket.id,
        userId:   socket.data.userId,
        username,
        character,
        ownerId,
        ...joinPos(raw), y: 0,
        walking: false,
        pose: null,
        mv: 0,
        emote: null
      };
      homePlayers.set(socket.id, player);

      // Single live presence per user within this home room (refresh / second
      // tab). Retire any older socket of the same user in the same room.
      for (const [sid, other] of homePlayers) {
        if (sid !== socket.id && other.userId === socket.data.userId && other.ownerId === ownerId) {
          homePlayers.delete(sid);
          leaveHomeVoice(io, sid, ownerId);
          // Pull the retired socket out of the room too, or it keeps
          // receiving the home's chat / positions.
          io.in(sid).socketsLeave('home:' + ownerId);
          io.to('home:' + ownerId).emit('home:left', { id: sid });
          io.to(sid).emit('home:kicked', { reason: 'elsewhere' });   // same as /world above
        }
      }

      const others = [...homePlayers.values()]
        .filter(p => p.ownerId === ownerId && p.socketId !== socket.id)
        .map(NetLogic.publicPlayer);
      socket.emit('home:snapshot', { players: others });
      socket.to('home:' + ownerId).emit('home:joined', NetLogic.publicPlayer(player));
    }));

    socket.on('home:pos', guard('home.pos', (raw) => {
      const p = homePlayers.get(socket.id);
      if (!p) return;
      const nowPos = Date.now();
      if (nowPos - (socket.data.lastPos || 0) < POS_MIN_INTERVAL_MS) return;
      socket.data.lastPos = nowPos;
      const s = NetLogic.sanitizePos(raw);
      if (!s) return;
      applyPos(p, s);
      socket.to('home:' + p.ownerId).emit('home:pos', posRelay(socket.id, p));
    }));

    // `ack` (optional) reports the outcome, like world:chat: a message inside
    // the 1 s floor used to vanish while the sender's box cleared and their
    // own bubble showed, so they never knew it wasn't sent.
    socket.on('home:chat', guard('home.chat', (raw, ack) => {
      const reply = (typeof ack === 'function') ? ack : () => {};
      const p = homePlayers.get(socket.id);
      if (!p) return reply({ ok: false, error: 'not-joined' });
      const msg = (typeof raw?.text === 'string' ? raw.text : '').trim().slice(0, MAX_CHAT_LEN);
      if (!msg) return reply({ ok: false, error: 'empty' });
      const nowChat = Date.now();
      const retryInMs = floorLeft(socket, 'homeChat', CHAT_INTERVAL_MS, nowChat);
      if (retryInMs > 0) return reply({ ok: false, error: 'cooldown', retryInMs });
      markFloor(socket, 'homeChat', nowChat);
      io.to('home:' + p.ownerId).emit('home:chat', {
        id: socket.id, username: p.username, text: msg
      });
      reply({ ok: true });
    }));

    socket.on('home:emote', guard('home.emote', (raw) => {
      const p = homePlayers.get(socket.id);
      if (!p) return;
      const out = emoteRelay(socket, p, raw);
      if (!out) return;
      socket.to('home:' + p.ownerId).emit('home:emote', out);
    }));

    socket.on('home:leave', guard('home.leave', () => {
      // Also cancels a home:join still waiting on the DB (see home:join).
      socket.data.homeJoinSeq = (socket.data.homeJoinSeq || 0) + 1;
      const p = homePlayers.get(socket.id);
      if (!p) return;
      homePlayers.delete(socket.id);
      leaveHomeVoice(io, socket.id, p.ownerId);
      socket.leave('home:' + p.ownerId);
      socket.to('home:' + p.ownerId).emit('home:left', { id: socket.id });
    }));

    // ── voice:* events ──
    //
    // WebRTC signaling relay. The server never touches media — it only
    // forwards SDP offer/answer/ICE between in-voice peers in the same
    // scope. Each signal is validated to be a single-target relay within
    // the sender's scope (no cross-scope leaks, no broadcasts).
    //
    // /world scope is the sender's ZONE (same membership as Project chat):
    // voice-enabled sockets on the same island or the same road segment,
    // capped to the nearest VOICE_CAP (voiceLinks, kept by
    // reconcileWorldVoice). On open ground there are no peers. Zone changes
    // are handled in applyZone above.
    // /home scope is the whole home room, unchanged.
    //
    // socket.data.voiceSignalLog tracks the per-sender signaling budget.

    function voicePeersInSameRoom(scope) {
      if (scope === 'world') {
        // The relay gate: only a current mesh link may carry signals.
        return voiceWorld.has(socket.id) ? worldVoicePeers(socket.id) : [];
      }
      if (scope === 'home') {
        const home = homePlayers.get(socket.id);
        if (!home) return [];
        const set = voiceHomes.get(home.ownerId);
        if (!set || !set.has(socket.id)) return [];
        return [...set].filter(id => id !== socket.id);
      }
      return [];
    }

    // /home only — /world membership changes go through reconcileWorldVoice.
    function emitVoicePeerEvent(scope, event, payload) {
      if (scope === 'home') {
        const home = homePlayers.get(socket.id);
        if (home) socket.to('home:' + home.ownerId).emit(event, payload);
      }
    }

    // Idempotent — a duplicate announce still gets the voice:peers reply.
    // Clients announce once per voice session and after a socket reconnect
    // (a NEW socket id, so never a duplicate), and retry until the reply
    // arrives. Only the FIRST announce of a membership tells the peers:
    // remote peers treat a repeated peer-joined as "that peer restarted" and
    // rebuild their WebRTC connection, so re-broadcasting on every retry (or
    // on a scripted flood) made a whole island tear its calls down.
    socket.on('voice:announce', guard('voice.announce', (raw) => {
      if (!rateOk(socket, 'announce')) return;
      const scope = raw && raw.scope;
      let already = false;
      if (scope === 'world') {
        if (!worldPlayers.has(socket.id)) return;
        already = voiceWorld.has(socket.id);
        voiceWorld.add(socket.id);
      } else if (scope === 'home') {
        const home = homePlayers.get(socket.id);
        if (!home) return;
        let set = voiceHomes.get(home.ownerId);
        if (!set) { set = new Set(); voiceHomes.set(home.ownerId, set); }
        already = set.has(socket.id);
        set.add(socket.id);
      } else {
        return;
      }
      socket.data.voiceScope = scope;
      if (scope === 'world') {
        // voice:peers back to us; peer-joined only for NEW links, so a
        // repeated announce never makes anyone rebuild a call.
        reconcileWorldVoice(io, socket.id);
        return;
      }
      const peers = voicePeersInSameRoom(scope);
      socket.emit('voice:peers', { scope, peers });
      if (!already) emitVoicePeerEvent(scope, 'voice:peer-joined', { id: socket.id });
    }));

    socket.on('voice:leave', guard('voice.leave', () => {
      const scope = socket.data.voiceScope;
      if (!scope) return;
      let removed = false;
      if (scope === 'world') {
        if (voiceWorld.delete(socket.id)) reconcileWorldVoice(io);   // peer-left both ways
      } else if (scope === 'home') {
        const home = homePlayers.get(socket.id);
        if (home) {
          const set = voiceHomes.get(home.ownerId);
          if (set) {
            removed = set.delete(socket.id);
            if (set.size === 0) voiceHomes.delete(home.ownerId);
          }
        }
      }
      if (removed) emitVoicePeerEvent(scope, 'voice:peer-left', { id: socket.id });
      socket.data.voiceScope = null;
    }));

    socket.on('voice:signal', guard('voice.signal', (raw) => {
      const scope = socket.data.voiceScope;
      if (!scope) return;
      if (!raw || typeof raw.to !== 'string') return;
      const kind = raw.kind;
      if (kind !== 'offer' && kind !== 'answer' && kind !== 'ice') return;
      if (!raw.data || typeof raw.data !== 'object') return;
      try {
        // Cheap size guard against accidentally huge payloads.
        const size = JSON.stringify(raw.data).length;
        if (size > VOICE_SIGNAL_MAX_BYTES) return;
      } catch (_) { return; }

      // Per-socket budget (sliding 1s window) — the spam guard.
      const now = Date.now();
      const log = socket.data.voiceSignalLog = socket.data.voiceSignalLog || [];
      const cutoff = now - VOICE_SIGNAL_BUDGET_WINDOW_MS;
      while (log.length && log[0] < cutoff) log.shift();
      if (log.length >= VOICE_SIGNAL_BUDGET) return;
      log.push(now);

      // Same-room validation: target must be a voice peer in the same room.
      const peers = voicePeersInSameRoom(scope);
      if (!peers.includes(raw.to)) return;

      io.to(raw.to).emit('voice:signal', {
        from: socket.id,
        kind,
        data: raw.data
      });
    }));

    socket.on('disconnect', guard('disconnect', () => {
      // A home:join still awaiting the DB must not add us after this.
      socket.data.homeJoinSeq = (socket.data.homeJoinSeq || 0) + 1;
      if (worldPlayers.has(socket.id)) {
        drainStay(worldPlayers.get(socket.id));   // banked on the next flush
        worldPlayers.delete(socket.id);
        socket.to('world').emit('world:left', { id: socket.id });
        freeStonesOf(socket.id);   // drop any stones this player was carrying
        releaseNpcTarget(socket.id);
      }
      IslandGames.socketGone(socket.id);   // their game seat waits RECONNECT_GRACE_MS
      const home = homePlayers.get(socket.id);
      if (home) {
        homePlayers.delete(socket.id);
        socket.to('home:' + home.ownerId).emit('home:left', { id: socket.id });
      }
      // Voice mesh cleanup: its current links (voiceLinks) get peer-left.
      if (socket.data.zoneTimer) { clearTimeout(socket.data.zoneTimer); socket.data.zoneTimer = null; }
      if (voiceWorld.delete(socket.id) || voiceLinks.has(socket.id)) reconcileWorldVoice(io);
      if (home) leaveHomeVoice(io, socket.id, home.ownerId);
    }));
  });
};

// For routes/world.js: push a keeper's saved house to everyone in /world, and
// force a stay flush so a just-crowned keeper is recognised immediately.
module.exports.broadcastWorld = (event, payload) => { if (_io) _io.to('world').emit(event, payload); };
// Everyone in one user's home (the owner + visiting friends).
module.exports.broadcastHome = (ownerId, event, payload) => { if (_io) _io.to('home:' + String(ownerId)).emit(event, payload); };
module.exports.flushStays = flushStays;
module.exports.unappliedOps = unappliedOps;
module.exports.invalidateProjectGrid = invalidateProjectGrid;
// For the admin user delete (routes/admin.js): stop crediting `userId` —
// mark them deleted (queueCredit / flushStays skip them), drop their queued
// credit and end their live stays. Resolves once a flush already in flight
// has landed, so the caller's ProjectStay delete runs after it, not before.
module.exports.dropCreditsFor = (userId) => {
  const id = String(userId || '');
  if (!id) return Promise.resolve();
  if (!deletedUsers.has(id)) {
    const t = setTimeout(() => deletedUsers.delete(id), DELETED_USER_TTL_MS);
    if (t.unref) t.unref();
    deletedUsers.set(id, t);
  }
  const prefix = id + '|';
  for (const key of [...pendingCredits.keys()]) {
    if (key.startsWith(prefix)) pendingCredits.delete(key);
  }
  for (const p of worldPlayers.values()) {
    if (String(p.userId) === id) p.stay = null;
  }
  return Promise.resolve(_flushing);
};
// For server.js graceful shutdown: stop the periodic flush, then bank every
// live stay and write the pending map one last time (await the result).
// A flush already in flight is waited out first — flushStays() would just
// hand back that promise, and anything queued since would never be written.
module.exports.shutdownStays = () => {
  if (_stayTimer) clearInterval(_stayTimer);
  _stayTimer = null;
  return Promise.resolve(_flushing).then(() => flushStays());
};
// For routes/messages.js (via server/messages.js): live-deliver an inbox
// message to the recipient's Whisper tab when they're in /world.
module.exports.deliverWhisper = deliverWhisper;
// For routes/friends.js: when a and b stop being friends, any socket of one
// standing in the other's home leaves at once (room, voice mesh, player
// record) and is told why — the friendship check only ever ran on join.
module.exports.ejectFromHome = (a, b) => {
  if (!_io) return 0;
  const list = homeEjections(homePlayers, a, b);
  for (const { sid, ownerId } of list) {
    homePlayers.delete(sid);
    leaveHomeVoice(_io, sid, ownerId);
    _io.in(sid).socketsLeave('home:' + ownerId);
    _io.to('home:' + ownerId).emit('home:left', { id: sid });
    _io.to(sid).emit('home:kicked', { reason: 'unfriended' });
    const s = _io.sockets.sockets.get(sid);
    if (s && s.data) s.data.homeJoinSeq = (s.data.homeJoinSeq || 0) + 1;   // cancels a join still awaiting the DB
  }
  return list.length;
};
// Exported for test/world-socket-guard.test.js.
module.exports.guard = guard;
