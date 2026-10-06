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
const { PUNCH_COOLDOWN_MS, KNOCKDOWN, punchCheck, stoneSlot, STONE_RING } = require('../js/playground3d-physics');
const NetLogic = require('../js/world-net-logic');
const contentLoader = require('../server/contentLoader');
// Scene Guess minigame — the live games; hooked in below (attach, register,
// zone changes, retired / reconnecting sockets, punch + snap immunity).
const SceneGuess = require('../server/scene-guess').instance();
// The client sends its character on join and the server re-broadcasts it to
// every other joiner, so it is reduced to the known slots, each an in-range
// integer (server/character.js — the same ranges the profile PUT enforces).
// Stops a hostile client parking a large blob that gets fanned to everyone,
// and keeps junk out of other clients' rig builder.
const { sanitizeCharacter } = require('../server/character');

// Per-socket token buckets (js/world-net-logic.js RATES) for the events that
// hit the DB or fan out to a whole room without a floor of their own.
function rateOk(socket, key) {
  const store = socket.data.rl || (socket.data.rl = {});
  return NetLogic.allow(store, key, Date.now());
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
// actual PEERS are the members standing on the SAME project island
// (ChatLogic.islandPeers over worldPlayers[].projectId) — the same scope as
// Project chat — so off-island (roads) a voice-enabled socket has no peers.
// voiceHomes maps ownerId → Set<socketId> for per-home voice meshes (room-wide).
const voiceWorld = new Set();
const voiceHomes = new Map();

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

function queueCredit(userId, projectId, ms) {
  if (!userId || !projectId || !(ms > 0)) return;
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
// Credit every live stay, then write the whole pending map. On a DB error the
// credits stay queued for the next flush (at most one interval is at risk).
function flushStays() {
  if (_flushing) return _flushing;
  const now = Date.now();
  for (const p of worldPlayers.values()) drainStay(p, now);
  if (!pendingCredits.size) return Promise.resolve();
  const ops = [];
  for (const [key, ms] of pendingCredits) {
    const i = key.indexOf('|');
    ops.push({ updateOne: {
      filter: { userId: key.slice(0, i), projectId: key.slice(i + 1) },
      update: { $inc: { ms } },
      upsert: true
    } });
  }
  pendingCredits.clear();
  _flushing = ProjectStay.bulkWrite(ops, { ordered: false })
    .catch(() => {
      for (const op of ops) queueCredit(op.updateOne.filter.userId, op.updateOne.filter.projectId, op.updateOne.update.$inc.ms);
    })
    .finally(() => { _flushing = null; });
  return _flushing;
}

const MAX_USERNAME = 40;
const MAX_CHAT_LEN = 200;

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

// Whisper branch of 'world:chat'. Online target → live delivery exactly as
// before, plus a best-effort Message row (readAt set: they saw it). Offline
// target → look the username up in Mongo; a real user gets the message stored
// (readAt null → counts as unread in their inbox) and the sender an echo
// flagged `offline`; an unknown name is still 'not-found'.
async function handleWhisper(io, socket, p, m, out, reply) {
  let target = null;
  for (const other of worldPlayers.values()) {
    if (ChatLogic.sameName(other.username, m.to)) { target = other; break; }
  }
  if (target) {
    if (target.userId === p.userId) return reply({ ok: false, error: 'self' });
    out.to = target.username;
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
    user = await User.findOne({ username: { $regex: '^' + escapeRegex(m.to) + '$', $options: 'i' } })
      .select('_id username').lean();
  } catch (err) {
    console.error('[whisper] lookup failed:', err && err.message);
    return reply({ ok: false, error: 'not-sent' });
  }
  if (!user) return reply({ ok: false, error: 'not-found', to: m.to });
  if (String(user._id) === String(p.userId)) return reply({ ok: false, error: 'self' });
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
function projectGrid() {
  if (Date.now() - _projectGridAt >= PROJECT_GRID_TTL_MS && !_projectGridRefreshing) {
    _projectGridRefreshing = true;
    Project.find({}).select('id gridX gridY').lean()
      .then((docs) => { _projectGrid = docs || []; _projectGridAt = Date.now(); })
      .catch(() => { /* keep last known grid */ })
      .finally(() => { _projectGridRefreshing = false; });
  }
  return _projectGrid;
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
  const stayTimer = setInterval(() => { flushStays(); }, Stay.C.FLUSH_INTERVAL_MS);
  if (stayTimer.unref) stayTimer.unref();

  // Handshake auth — verify the JWT AND enforce the same ban / tokenVersion
  // checks the HTTP layer does (validateToken). Without this, a banned or
  // force-logged-out user keeps full realtime chat/voice/presence until their
  // JWT expires. Also resolves the authoritative username so the client can't
  // spoof a display name.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      const result = await auth.validateToken(token);
      if (!result.ok) return next(new Error(result.error || 'Unauthorized'));
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
      .finally(() => { d.watchedLoading = false; d.watchedAt = Date.now(); });
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

  SceneGuess.attach(io, { players: worldPlayers, rateOk, touchStay, zoneOf });

  io.on('connection', (socket) => {
    SceneGuess.register(socket);

    // Client must emit 'world:join' before broadcasting anything else.
    socket.on('world:join', (raw) => {
      // Each join hits the DB (watched list) and fans out to the whole room.
      // A real client joins once per socket (a reconnect is a new socket).
      if (!rateOk(socket, 'join')) return;
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
        lastChat: 0,
        projectId: null,    // island the player stands on (Project chat / voice scope)
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
            const peers = ChatLogic.islandPeers(sid, worldPlayers, voiceWorld);
            voiceWorld.delete(sid);
            for (const pid of peers) {
              io.to(pid).emit('voice:peer-left', { id: sid });
              io.to(sid).emit('voice:peer-left', { id: pid });
            }
            const old = io.sockets.sockets.get(sid);
            if (old && old.data) old.data.voiceScope = null;
          }
          SceneGuess.retire(sid);   // its game seat waits for this new socket (resume below)
          worldPlayers.delete(sid);
          // …and out of the room, or the retired tab keeps receiving
          // everyone's positions and chat.
          io.in(sid).socketsLeave('world');
          io.to('world').emit('world:left', { id: sid });
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
      SceneGuess.resume(socket);
    });

    socket.on('world:pos', (raw) => {
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
      const zone = zoneOf(socket, p);
      if (zone !== p.projectId) {
        const prevZone = p.projectId;
        // Voice: peers are computed from projectId, so snapshot the OLD
        // island's peers before mutating it. Both sides tear down, then the
        // mover gets a fresh snapshot of the new island and its residents get
        // a peer-joined. Per-socket emit order is preserved by Socket.IO, so
        // the client always destroys before it dials.
        const inVoice = voiceWorld.has(socket.id);
        const oldPeers = inVoice ? islandVoicePeers() : [];
        drainStay(p, nowPos);
        p.stay = zone ? Stay.enter(zone, nowPos) : null;
        p.projectId = zone;
        socket.emit('world:zone', { projectId: zone });
        // After the zone so the client knows its island before the game shows.
        SceneGuess.onZone(socket, p, prevZone, zone);
        if (inVoice) {
          for (const id of oldPeers) {
            io.to(id).emit('voice:peer-left', { id: socket.id });
            socket.emit('voice:peer-left', { id });
          }
          if (zone) {
            const newPeers = islandVoicePeers();
            socket.emit('voice:peers', { scope: 'world', peers: newPeers });
            for (const id of newPeers) io.to(id).emit('voice:peer-joined', { id: socket.id });
          }
        }
      } else {
        touchStay(p, nowPos);
      }
      socket.to('world').emit('world:pos', posRelay(socket.id, p));
    });

    // Chat, split into channels: 'world' (everyone), 'project' (players on
    // the sender's island) and 'whisper' (one named player). Only 'world' has
    // the 10s cooldown. `ack` (optional) reports the real outcome so the
    // client only clears the box / shows the bubble / starts its countdown
    // for a message that actually went out — a rejected send costs nothing.
    socket.on('world:chat', (raw, ack) => {
      const reply = (typeof ack === 'function') ? ack : () => {};
      const p = worldPlayers.get(socket.id);
      if (!p) return reply({ ok: false, error: 'not-joined' });
      const m = ChatLogic.normalizeMessage(raw);
      if (!m.ok) return reply(m);
      const now = Date.now();
      // Spam floor on every channel (same as the /messages DM route). Project
      // and whisper have no 10s cooldown, but a script must not be able to
      // flood an island or someone's inbox.
      if (now - (p.lastAnyChat || 0) < MessagingLogic.C.SEND_FLOOR_MS) {
        return reply({ ok: false, error: 'cooldown', retryInMs: MessagingLogic.C.SEND_FLOOR_MS - (now - (p.lastAnyChat || 0)) });
      }
      const limited = ChatLogic.hasCooldown(m.channel);
      if (limited) {
        const retryInMs = ChatLogic.cooldownLeft(p.lastChat, now);
        if (retryInMs > 0) return reply({ ok: false, error: 'cooldown', retryInMs });
      }

      // An accepted message counts as island activity (people chatting stand
      // still) — rejected sends above never reach this line.
      touchStay(p, now);
      p.lastAnyChat = now;
      // Sender always gets its own copy (so its log shows what went out).
      const out = { channel: m.channel, id: socket.id, username: p.username, text: m.text };
      if (m.channel === 'world') {
        io.to('world').emit('world:chat', out);
      } else if (m.channel === 'project') {
        if (!p.projectId) return reply({ ok: false, error: 'no-project' });
        out.projectId = p.projectId;
        for (const [sid, other] of worldPlayers) {
          if (other.projectId === p.projectId) io.to(sid).emit('world:chat', out);
        }
      } else {
        // Whisper has no cooldown, so nothing below this branch applies —
        // handleWhisper owns the ack (it may need a Mongo round-trip).
        return handleWhisper(io, socket, p, m, out, reply);
      }
      if (!limited) return reply({ ok: true, cooldownMs: 0 });
      p.lastChat = now;
      reply({ ok: true, cooldownMs: ChatLogic.C.COOLDOWN_MS });
    });

    socket.on('world:emote', (raw) => {
      const p = worldPlayers.get(socket.id);
      if (!p) return;
      const out = emoteRelay(socket, p, raw);
      if (!out) return;
      touchStay(p);
      socket.to('world').emit('world:emote', out);
    });

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
    socket.on('world:punch', (raw, ack) => {
      const reply = (typeof ack === 'function') ? ack : () => {};
      const p = worldPlayers.get(socket.id);
      if (!p) return reply({ ok: false, reason: 'not-joined' });
      const now = Date.now();
      if (now - (p.lastPunch || 0) < PUNCH_INTERVAL_MS) return reply({ ok: false, reason: 'cooldown' });
      p.lastPunch = now;
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
        if (SceneGuess.isPlaying(target)) {
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
    });

    // A hero swings at ITS TARGET — requested by the target's own client (the
    // only one that knows where it really stands), gated by a per-hero
    // cooldown. Broadcast to everyone including the sender, which knocks
    // itself down on the echo, the same way world:punch works.
    socket.on('world:npc-punch', (raw) => {
      const me = worldPlayers.get(socket.id);
      if (!me) return;
      const npc = raw && raw.npc;
      if (typeof npc !== 'string' || !NPC_IDS.has(npc)) return;
      if (SceneGuess.isPlaying(socket.id)) return;   // heroes leave Scene Guess players alone too
      const now = Date.now();
      // Still down / getting up from the last hit — the hero waits its turn
      // (same immunity as player punches, so heroes can't chain-stun either).
      if (me.downAt && now - me.downAt < KNOCKDOWN.IMMUNE_MS) return;
      if (!NpcLogic.canNpcSwing(worldNpcs[npc], socket.id, now)) return;
      worldNpcs[npc] = Object.assign({}, worldNpcs[npc], { lastSwingAt: now });
      me.downAt = now;
      me.emote = null;
      io.to('world').emit('world:npc-punch', { npc, target: socket.id });
    });

    // Claim a FREE stone the client reached on foot. Authoritative: only the
    // first grab wins; losers reconcile from the world:stone-update broadcast.
    // The grabber must be standing near that stone's ring slot (by the
    // position it broadcasts) — a script can no longer sweep all six from
    // anywhere. A refused grab gets the true state back so its optimistic
    // hide undoes itself.
    socket.on('world:stone-grab', (raw) => {
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
    });

    // Snap — only valid while holding all six. Dusts a random ~50% of the
    // OTHER players (they fade + respawn at spawn client-side), then all six
    // stones scatter free for a fresh round. Lifetime snap count persists.
    socket.on('world:snap', () => {
      if (!stonesEventEnabled()) return;      // event off — snapping disabled
      const p = worldPlayers.get(socket.id);
      if (!p) return;
      const now = Date.now();
      if (now - (p.lastSnap || 0) < SNAP_INTERVAL_MS) return;
      if (stonesHeldBy(socket.id).length < STONE_IDS.length) return;   // authority
      p.lastSnap = now;
      touchStay(p, now);

      // Scene Guess players are never dusted: the respawn teleports them off
      // their island, which would drop them from the game.
      const others = [...worldPlayers.keys()].filter(id => id !== socket.id && !SceneGuess.isPlaying(id));
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
    });

    // ── home:* events ──
    //
    // One per-home room keyed by the owner's user id. Clients send the
    // owner's USERNAME (it's what the URL exposes) and the server
    // resolves it to an id so the visitor doesn't need the owner's id.
    // Shape mirrors world:* so the client uses the same handlers.

    socket.on('home:join', async (raw) => {
      // One or two DB lookups per join — rate-limited like world:join.
      if (!rateOk(socket, 'join')) return;
      // typeof guard: String() on a crafted object throws and crashes the process.
      const ownerUsername = (typeof raw?.ownerUsername === 'string' ? raw.ownerUsername : '').slice(0, MAX_USERNAME);
      if (!ownerUsername) return;
      // The lookups below are async: if the socket disconnects (quick reload /
      // navigate-away) or leaves / re-joins while they run, the disconnect
      // handler has nothing to remove yet, and adding the player afterwards
      // left a frozen ghost avatar in that home. Every await re-checks.
      const seq = socket.data.homeJoinSeq = (socket.data.homeJoinSeq || 0) + 1;
      const stale = () => !socket.connected || socket.data.homeJoinSeq !== seq;
      let owner;
      try {
        owner = await User.findOne({ username: ownerUsername })
          .select('_id').lean();
      } catch (_) { return; }
      if (!owner || stale()) return;

      // Only the owner and their accepted friends may enter — same rule as
      // GET /api/friends/by-username. Without it any logged-in user could
      // join, chat and (via voice) see the IPs of everyone inside.
      if (String(owner._id) !== String(socket.data.userId)) {
        try {
          const ok = await Friend.exists(friendFilter(socket.data.userId, owner._id));
          if (!ok) return;
        } catch (_) { return; }
        if (stale()) return;
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
        emote: null,
        lastChat: 0
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
        }
      }

      const others = [...homePlayers.values()]
        .filter(p => p.ownerId === ownerId && p.socketId !== socket.id)
        .map(NetLogic.publicPlayer);
      socket.emit('home:snapshot', { players: others });
      socket.to('home:' + ownerId).emit('home:joined', NetLogic.publicPlayer(player));
    });

    socket.on('home:pos', (raw) => {
      const p = homePlayers.get(socket.id);
      if (!p) return;
      const nowPos = Date.now();
      if (nowPos - (socket.data.lastPos || 0) < POS_MIN_INTERVAL_MS) return;
      socket.data.lastPos = nowPos;
      const s = NetLogic.sanitizePos(raw);
      if (!s) return;
      applyPos(p, s);
      socket.to('home:' + p.ownerId).emit('home:pos', posRelay(socket.id, p));
    });

    socket.on('home:chat', (raw) => {
      const p = homePlayers.get(socket.id);
      if (!p) return;
      const msg = (typeof raw?.text === 'string' ? raw.text : '').trim().slice(0, MAX_CHAT_LEN);
      if (!msg) return;
      if (Date.now() - p.lastChat < CHAT_INTERVAL_MS) return;
      p.lastChat = Date.now();
      io.to('home:' + p.ownerId).emit('home:chat', {
        id: socket.id, username: p.username, text: msg
      });
    });

    socket.on('home:emote', (raw) => {
      const p = homePlayers.get(socket.id);
      if (!p) return;
      const out = emoteRelay(socket, p, raw);
      if (!out) return;
      socket.to('home:' + p.ownerId).emit('home:emote', out);
    });

    socket.on('home:leave', () => {
      // Also cancels a home:join still waiting on the DB (see home:join).
      socket.data.homeJoinSeq = (socket.data.homeJoinSeq || 0) + 1;
      const p = homePlayers.get(socket.id);
      if (!p) return;
      homePlayers.delete(socket.id);
      leaveHomeVoice(io, socket.id, p.ownerId);
      socket.leave('home:' + p.ownerId);
      socket.to('home:' + p.ownerId).emit('home:left', { id: socket.id });
    });

    // ── voice:* events ──
    //
    // WebRTC signaling relay. The server never touches media — it only
    // forwards SDP offer/answer/ICE between in-voice peers in the same
    // scope. Each signal is validated to be a single-target relay within
    // the sender's scope (no cross-scope leaks, no broadcasts).
    //
    // /world scope is the sender's ISLAND (same membership as Project chat):
    // voice-enabled sockets standing on the same project island. Off-island
    // there are no peers. Island changes are handled in world:pos above.
    // /home scope is the whole home room, unchanged.
    //
    // socket.data.voiceSignalLog tracks the per-sender signaling budget.

    function islandVoicePeers() {
      return ChatLogic.islandPeers(socket.id, worldPlayers, voiceWorld);
    }

    function voicePeersInSameRoom(scope) {
      if (scope === 'world') {
        return voiceWorld.has(socket.id) ? islandVoicePeers() : [];
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

    function emitVoicePeerEvent(scope, event, payload) {
      if (scope === 'world') {
        // Targeted, not room-wide: a room-wide peer-joined would make every
        // voice client in the town dial the newcomer regardless of island.
        for (const id of islandVoicePeers()) io.to(id).emit(event, payload);
      } else if (scope === 'home') {
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
    socket.on('voice:announce', (raw) => {
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
      const peers = voicePeersInSameRoom(scope);
      socket.emit('voice:peers', { scope, peers });
      if (!already) emitVoicePeerEvent(scope, 'voice:peer-joined', { id: socket.id });
    });

    socket.on('voice:leave', () => {
      const scope = socket.data.voiceScope;
      if (!scope) return;
      let removed = false;
      if (scope === 'world') {
        removed = voiceWorld.delete(socket.id);
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
    });

    socket.on('voice:signal', (raw) => {
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
    });

    socket.on('disconnect', () => {
      // A home:join still awaiting the DB must not add us after this.
      socket.data.homeJoinSeq = (socket.data.homeJoinSeq || 0) + 1;
      if (worldPlayers.has(socket.id)) {
        drainStay(worldPlayers.get(socket.id));   // banked on the next flush
        worldPlayers.delete(socket.id);
        socket.to('world').emit('world:left', { id: socket.id });
        freeStonesOf(socket.id);   // drop any stones this player was carrying
        releaseNpcTarget(socket.id);
      }
      SceneGuess.socketGone(socket.id);   // their game seat waits RECONNECT_GRACE_MS
      const home = homePlayers.get(socket.id);
      if (home) {
        homePlayers.delete(socket.id);
        socket.to('home:' + home.ownerId).emit('home:left', { id: socket.id });
      }
      // Voice mesh cleanup. The world player record is already gone, so the
      // island peers can't be computed here; a room-wide peer-left is safe
      // because clients ignore peer-left for ids they never dialled.
      if (voiceWorld.delete(socket.id)) {
        socket.to('world').emit('voice:peer-left', { id: socket.id });
      }
      if (home) leaveHomeVoice(io, socket.id, home.ownerId);
    });
  });
};

// For routes/world.js: push a keeper's saved house to everyone in /world, and
// force a stay flush so a just-crowned keeper is recognised immediately.
module.exports.broadcastWorld = (event, payload) => { if (_io) _io.to('world').emit(event, payload); };
// Everyone in one user's home (the owner + visiting friends).
module.exports.broadcastHome = (ownerId, event, payload) => { if (_io) _io.to('home:' + String(ownerId)).emit(event, payload); };
module.exports.flushStays = flushStays;
// For routes/messages.js (via server/messages.js): live-deliver an inbox
// message to the recipient's Whisper tab when they're in /world.
module.exports.deliverWhisper = deliverWhisper;
