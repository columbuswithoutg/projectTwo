/************************************************
 * WORLD SOCKET — Socket.IO handlers for /world
 *
 * Real-time presence + chat + emotes for the walkable universe map.
 * In-memory only; no persistence (chat is ephemeral by design).
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
const Project = require('../models/Project');
const { PUNCH_COOLDOWN_MS } = require('../js/playground3d-physics');

// Whitelisted homeCharacter slots (mirrors models/user.js homeCharacter). The
// client sends its character on join and the server re-broadcasts it verbatim
// to every other joiner, so we coerce it to this set of small integers — both
// to stop a hostile client parking a large blob that gets fanned to everyone,
// and so a junk payload can't reach other clients' rig builder.
const CHARACTER_KEYS = new Set([
  'skin', 'hairStyle', 'hairColor', 'shirtColor', 'pantsColor', 'eyeColor', 'eyeShape',
  'facialHairStyle', 'facialHairColor', 'glasses', 'hat', 'shoeColor', 'build', 'gear',
  'shirtStyle', 'pantsStyle', 'shoeStyle', 'outerwear', 'outerwearColor', 'suit', 'suitColor',
  'gloves', 'belt', 'mask', 'accessoryColor', 'gender', 'shirtColor2', 'pantsColor2',
  'outerwearColor2', 'shoeColor2', 'helmet', 'helmetColor', 'prop', 'propColor', 'emblem', 'emblemColor'
]);

function sanitizeCharacter(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const k of CHARACTER_KEYS) {
    const v = raw[k];
    // Only finite numbers; clamp to a generous index range. The renderers
    // default/ignore unknown indices, so this can't break rendering — it just
    // bounds size and type.
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = Math.max(0, Math.min(99, Math.floor(v)));
    }
  }
  return out;
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
// voiceWorld holds socketIds that opted into voice in the world room.
// voiceHomes maps ownerId → Set<socketId> for per-home voice meshes.
const voiceWorld = new Set();
const voiceHomes = new Map();

const MAX_USERNAME = 40;
const MAX_CHAT_LEN = 200;
// /home chat keeps its 1s floor; /world chat uses ChatLogic.C.COOLDOWN_MS
// (10s, shared across the world / project / whisper channels).
const CHAT_INTERVAL_MS = 1000;
// Floor between relayed punches per socket — the client cooldown, less slack
// for network jitter so an honest punch sent right at 1s is never dropped.
const PUNCH_INTERVAL_MS = PUNCH_COOLDOWN_MS - 150;
const POSITION_BOUND = 1000;          // sanity clamp; world is < 300u square in practice
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
  stonesEventEnabled();   // prime the cached event flag at startup
  projectGrid();          // prime the island grid for Project chat

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

  io.on('connection', (socket) => {
    // Client must emit 'world:join' before broadcasting anything else.
    socket.on('world:join', (raw) => {
      // Username comes from the verified token, NOT the client payload, so a
      // user can't join as someone else in chat/nametag.
      const username  = String(socket.data.username || 'Anon').slice(0, MAX_USERNAME);
      const character = sanitizeCharacter(raw && raw.character);

      socket.join('world');
      const player = {
        socketId: socket.id,
        userId:   socket.data.userId,
        username,
        character,
        x: 0, y: 0, z: 0, yaw: 0,
        walking: false,
        lastChat: 0,
        projectId: null     // island the player stands on (Project chat scope)
      };
      worldPlayers.set(socket.id, player);

      // Single live presence per user. A refresh or a second tab opens a new
      // socket; without this the same user lingers as duplicate/ghost avatars
      // for everyone else. Drop any OLDER socket belonging to this user (we
      // don't disconnect it — that would ping-pong two real tabs — we just
      // retire its avatar from the room).
      for (const [sid, other] of worldPlayers) {
        if (sid !== socket.id && other.userId === socket.data.userId) {
          worldPlayers.delete(sid);
          io.to('world').emit('world:left', { id: sid });
          freeStonesOf(sid);   // don't strand this user's stones on the retired socket
          releaseNpcTarget(sid);
        }
      }

      // Bootstrap the new client with everyone else's current state.
      const others = [...worldPlayers.values()].filter(p => p.socketId !== socket.id);
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
      socket.to('world').emit('world:joined', { ...player });
    });

    socket.on('world:pos', (raw) => {
      const p = worldPlayers.get(socket.id);
      if (!p) return;
      const nowPos = Date.now();
      if (nowPos - (socket.data.lastPos || 0) < POS_MIN_INTERVAL_MS) return;
      socket.data.lastPos = nowPos;
      if (!raw || typeof raw.x !== 'number' || typeof raw.z !== 'number') return;
      if (!Number.isFinite(raw.x) || !Number.isFinite(raw.z)) return;
      if (Math.abs(raw.x) > POSITION_BOUND || Math.abs(raw.z) > POSITION_BOUND) return;
      p.x = raw.x;
      p.z = raw.z;
      // y is optional (jump height) — clamp to a sane range so a hacked
      // client can't fling its character to the moon for everyone else.
      const rawY = (typeof raw.y === 'number' && Number.isFinite(raw.y)) ? raw.y : 0;
      p.y = Math.max(-2, Math.min(10, rawY));
      p.yaw = (typeof raw.yaw === 'number' && Number.isFinite(raw.yaw)) ? raw.yaw : 0;
      p.walking = !!raw.walking;
      // Track which project island they're on; tell the client when it
      // changes so its Project chat tab can relabel / enable itself.
      const zone = ChatLogic.projectAt(p.x, p.z, projectGrid());
      if (zone !== p.projectId) {
        p.projectId = zone;
        socket.emit('world:zone', { projectId: zone });
      }
      socket.to('world').emit('world:pos', {
        id: socket.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, walking: p.walking
      });
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
      const limited = ChatLogic.hasCooldown(m.channel);
      if (limited) {
        const retryInMs = ChatLogic.cooldownLeft(p.lastChat, now);
        if (retryInMs > 0) return reply({ ok: false, error: 'cooldown', retryInMs });
      }

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
        let target = null;
        for (const other of worldPlayers.values()) {
          if (ChatLogic.sameName(other.username, m.to)) { target = other; break; }
        }
        if (!target) return reply({ ok: false, error: 'not-found', to: m.to });
        if (target.userId === p.userId) return reply({ ok: false, error: 'self' });
        out.to = target.username;
        io.to(target.socketId).emit('world:chat', out);
        socket.emit('world:chat', out);
      }
      if (!limited) return reply({ ok: true, cooldownMs: 0 });
      p.lastChat = now;
      reply({ ok: true, cooldownMs: ChatLogic.C.COOLDOWN_MS });
    });

    socket.on('world:emote', (raw) => {
      const p = worldPlayers.get(socket.id);
      if (!p) return;
      const kind = raw && raw.kind;
      if (kind !== 'wave') return;
      socket.to('world').emit('world:emote', { id: socket.id, kind });
    });

    // Punch relay. Same per-user cooldown pattern as chat. `target` must be
    // null (a whiffed swing everyone still sees) or a current world player's
    // socket id — the victim's client knocks itself down on receipt; the
    // sender already animated the hit optimistically. `npc` (exclusive with
    // `target`) names a hero the swing reached: HP comes off here and the
    // result is broadcast to everyone, sender included.
    socket.on('world:punch', (raw) => {
      const p = worldPlayers.get(socket.id);
      if (!p) return;
      const now = Date.now();
      if (now - (p.lastPunch || 0) < PUNCH_INTERVAL_MS) return;
      p.lastPunch = now;
      let target = raw && raw.target;
      if (target != null && (typeof target !== 'string' || !worldPlayers.has(target))) return;
      let npc = raw && raw.npc;
      if (npc != null && (typeof npc !== 'string' || !NPC_IDS.has(npc))) return;
      if (target && npc) return;
      socket.to('world').emit('world:punch', { id: socket.id, target: target || null });
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
      if (!worldPlayers.has(socket.id)) return;
      const npc = raw && raw.npc;
      if (typeof npc !== 'string' || !NPC_IDS.has(npc)) return;
      const now = Date.now();
      if (!NpcLogic.canNpcSwing(worldNpcs[npc], socket.id, now)) return;
      worldNpcs[npc] = Object.assign({}, worldNpcs[npc], { lastSwingAt: now });
      io.to('world').emit('world:npc-punch', { npc, target: socket.id });
    });

    // Claim a FREE stone the client reached on foot. Authoritative: only the
    // first grab wins; losers reconcile from the world:stone-update broadcast.
    socket.on('world:stone-grab', (raw) => {
      if (!stonesEventEnabled()) return;      // event off — no stones to grab
      if (!worldPlayers.has(socket.id)) return;
      const stone = raw && raw.stone;
      if (typeof stone !== 'string' || !STONE_IDS.includes(stone)) return;
      if (worldStones[stone].holder !== null) return;   // already taken
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

      const others = [...worldPlayers.keys()].filter(id => id !== socket.id);
      // Unbiased random half via a partial Fisher–Yates shuffle.
      for (let i = others.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = others[i]; others[i] = others[j]; others[j] = t;
      }
      const victims = others.slice(0, Math.ceil(others.length / 2));
      io.to('world').emit('world:snapped', { by: socket.id, victims });

      for (const id of STONE_IDS) worldStones[id].holder = null;
      io.to('world').emit('world:stones', { stones: stonesSnapshot() });

      User.findByIdAndUpdate(socket.data.userId, { $inc: { stoneSnaps: 1 } }).catch(() => {});
    });

    // ── home:* events ──
    //
    // One per-home room keyed by the owner's user id. Clients send the
    // owner's USERNAME (it's what the URL exposes) and the server
    // resolves it to an id so the visitor doesn't need the owner's id.
    // Shape mirrors world:* so the client uses the same handlers.

    socket.on('home:join', async (raw) => {
      const ownerUsername = String((raw && raw.ownerUsername) || '').slice(0, MAX_USERNAME);
      if (!ownerUsername) return;
      let owner;
      try {
        owner = await User.findOne({ username: ownerUsername })
          .select('_id').lean();
      } catch (_) { return; }
      if (!owner) return;

      const ownerId  = String(owner._id);
      const username = String(socket.data.username || 'Anon').slice(0, MAX_USERNAME);
      const character = sanitizeCharacter(raw && raw.character);

      // Idempotent — if this socket already joined the same home, just
      // re-send the snapshot. If it joined a different home, leave the
      // old room first.
      const prev = homePlayers.get(socket.id);
      if (prev && prev.ownerId !== ownerId) {
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
        x: 0, y: 0, z: 0, yaw: 0,
        walking: false,
        lastChat: 0
      };
      homePlayers.set(socket.id, player);

      // Single live presence per user within this home room (refresh / second
      // tab). Retire any older socket of the same user in the same room.
      for (const [sid, other] of homePlayers) {
        if (sid !== socket.id && other.userId === socket.data.userId && other.ownerId === ownerId) {
          homePlayers.delete(sid);
          io.to('home:' + ownerId).emit('home:left', { id: sid });
        }
      }

      const others = [...homePlayers.values()]
        .filter(p => p.ownerId === ownerId && p.socketId !== socket.id);
      socket.emit('home:snapshot', { players: others });
      socket.to('home:' + ownerId).emit('home:joined', { ...player });
    });

    socket.on('home:pos', (raw) => {
      const p = homePlayers.get(socket.id);
      if (!p) return;
      const nowPos = Date.now();
      if (nowPos - (socket.data.lastPos || 0) < POS_MIN_INTERVAL_MS) return;
      socket.data.lastPos = nowPos;
      if (!raw || typeof raw.x !== 'number' || typeof raw.z !== 'number') return;
      if (!Number.isFinite(raw.x) || !Number.isFinite(raw.z)) return;
      if (Math.abs(raw.x) > POSITION_BOUND || Math.abs(raw.z) > POSITION_BOUND) return;
      p.x = raw.x;
      p.z = raw.z;
      const rawY = (typeof raw.y === 'number' && Number.isFinite(raw.y)) ? raw.y : 0;
      p.y = Math.max(-2, Math.min(10, rawY));
      p.yaw = (typeof raw.yaw === 'number' && Number.isFinite(raw.yaw)) ? raw.yaw : 0;
      p.walking = !!raw.walking;
      socket.to('home:' + p.ownerId).emit('home:pos', {
        id: socket.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, walking: p.walking
      });
    });

    socket.on('home:chat', (raw) => {
      const p = homePlayers.get(socket.id);
      if (!p) return;
      const msg = String((raw && raw.text) || '').trim().slice(0, MAX_CHAT_LEN);
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
      const kind = raw && raw.kind;
      if (kind !== 'wave') return;
      socket.to('home:' + p.ownerId).emit('home:emote', { id: socket.id, kind });
    });

    socket.on('home:leave', () => {
      const p = homePlayers.get(socket.id);
      if (!p) return;
      homePlayers.delete(socket.id);
      socket.leave('home:' + p.ownerId);
      socket.to('home:' + p.ownerId).emit('home:left', { id: socket.id });
    });

    // ── voice:* events ──
    //
    // WebRTC signaling relay. The server never touches media — it only
    // forwards SDP offer/answer/ICE between in-voice peers in the same
    // room. Each signal is validated to be a single-target relay within
    // the sender's room (no cross-room leaks, no broadcasts).
    //
    // socket.data.lastVoiceSignal tracks the per-sender signaling cadence.

    function voicePeersInSameRoom(scope) {
      if (scope === 'world') {
        return voiceWorld.has(socket.id)
          ? [...voiceWorld].filter(id => id !== socket.id)
          : [];
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
        socket.to('world').emit(event, payload);
      } else if (scope === 'home') {
        const home = homePlayers.get(socket.id);
        if (home) socket.to('home:' + home.ownerId).emit(event, payload);
      }
    }

    // Idempotent — a duplicate announce still gets the voice:peers reply
    // and re-broadcasts voice:peer-joined. Clients re-announce after a
    // socket reconnect (and retry until the reply arrives), and remote
    // peers treat a repeated peer-joined as "that peer restarted" and
    // rebuild their connection to it.
    socket.on('voice:announce', (raw) => {
      const scope = raw && raw.scope;
      if (scope === 'world') {
        if (!worldPlayers.has(socket.id)) return;
        voiceWorld.add(socket.id);
      } else if (scope === 'home') {
        const home = homePlayers.get(socket.id);
        if (!home) return;
        let set = voiceHomes.get(home.ownerId);
        if (!set) { set = new Set(); voiceHomes.set(home.ownerId, set); }
        set.add(socket.id);
      } else {
        return;
      }
      socket.data.voiceScope = scope;
      const peers = voicePeersInSameRoom(scope);
      socket.emit('voice:peers', { scope, peers });
      emitVoicePeerEvent(scope, 'voice:peer-joined', { id: socket.id });
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
      if (worldPlayers.has(socket.id)) {
        worldPlayers.delete(socket.id);
        socket.to('world').emit('world:left', { id: socket.id });
        freeStonesOf(socket.id);   // drop any stones this player was carrying
        releaseNpcTarget(socket.id);
      }
      const home = homePlayers.get(socket.id);
      if (home) {
        homePlayers.delete(socket.id);
        socket.to('home:' + home.ownerId).emit('home:left', { id: socket.id });
      }
      // Voice mesh cleanup — broadcast peer-left to surviving voice peers.
      if (voiceWorld.delete(socket.id)) {
        socket.to('world').emit('voice:peer-left', { id: socket.id });
      }
      if (home) {
        const set = voiceHomes.get(home.ownerId);
        if (set && set.delete(socket.id)) {
          socket.to('home:' + home.ownerId).emit('voice:peer-left', { id: socket.id });
          if (set.size === 0) voiceHomes.delete(home.ownerId);
        }
      }
    });
  });
};
