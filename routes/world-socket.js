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
const jwt = require('jsonwebtoken');
const User = require('../models/user');

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
const CHAT_INTERVAL_MS = 1000;
const POSITION_BOUND = 1000;          // sanity clamp; world is < 300u square in practice
// NOTE: no per-pair rate cap — pooled ICE candidates fire back-to-back in
// the same millisecond, and a dropped trickle candidate is never
// retransmitted, so any per-pair interval breaks handshakes. The
// per-socket sliding-window budget below is the spam guard.
const VOICE_SIGNAL_BUDGET = 50;          // signals
const VOICE_SIGNAL_BUDGET_WINDOW_MS = 1000;
const VOICE_SIGNAL_MAX_BYTES = 8192;  // SDP fragments + ICE candidates are tiny

module.exports = (io) => {
  // Handshake auth — reject connections without a valid JWT.
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('No token'));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (!payload || !payload.id) return next(new Error('Invalid token payload'));
      socket.data.userId = payload.id;
      next();
    } catch (e) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    // Client must emit 'world:join' before broadcasting anything else.
    socket.on('world:join', (raw) => {
      const username  = String((raw && raw.username) || 'Anon').slice(0, MAX_USERNAME);
      const character = (raw && raw.character) || null;

      socket.join('world');
      const player = {
        socketId: socket.id,
        userId:   socket.data.userId,
        username,
        character,
        x: 0, y: 0, z: 0, yaw: 0,
        walking: false,
        lastChat: 0
      };
      worldPlayers.set(socket.id, player);

      // Bootstrap the new client with everyone else's current state.
      const others = [...worldPlayers.values()].filter(p => p.socketId !== socket.id);
      socket.emit('world:snapshot', { players: others });

      // Tell everyone else about the new arrival.
      socket.to('world').emit('world:joined', { ...player });
    });

    socket.on('world:pos', (raw) => {
      const p = worldPlayers.get(socket.id);
      if (!p) return;
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
      socket.to('world').emit('world:pos', {
        id: socket.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, walking: p.walking
      });
    });

    socket.on('world:chat', (raw) => {
      const p = worldPlayers.get(socket.id);
      if (!p) return;
      const msg = String((raw && raw.text) || '').trim().slice(0, MAX_CHAT_LEN);
      if (!msg) return;
      if (Date.now() - p.lastChat < CHAT_INTERVAL_MS) return;
      p.lastChat = Date.now();
      // Broadcast to everyone in the room INCLUDING the sender so the
      // local UI can show the bubble via the same code path as remote
      // bubbles (single source of truth for rendering).
      io.to('world').emit('world:chat', {
        id: socket.id, username: p.username, text: msg
      });
    });

    socket.on('world:emote', (raw) => {
      const p = worldPlayers.get(socket.id);
      if (!p) return;
      const kind = raw && raw.kind;
      if (kind !== 'wave') return;
      socket.to('world').emit('world:emote', { id: socket.id, kind });
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
      const username = String((raw && raw.username) || 'Anon').slice(0, MAX_USERNAME);
      const character = (raw && raw.character) || null;

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

      const others = [...homePlayers.values()]
        .filter(p => p.ownerId === ownerId && p.socketId !== socket.id);
      socket.emit('home:snapshot', { players: others });
      socket.to('home:' + ownerId).emit('home:joined', { ...player });
    });

    socket.on('home:pos', (raw) => {
      const p = homePlayers.get(socket.id);
      if (!p) return;
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
