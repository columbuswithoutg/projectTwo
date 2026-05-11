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

// socketId → { socketId, userId, username, character, x, z, yaw, walking, lastChat }
const worldPlayers = new Map();

const MAX_USERNAME = 40;
const MAX_CHAT_LEN = 200;
const CHAT_INTERVAL_MS = 1000;
const POSITION_BOUND = 1000;          // sanity clamp; world is < 300u square in practice

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
        x: 0, z: 0, yaw: 0,
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
      p.yaw = (typeof raw.yaw === 'number' && Number.isFinite(raw.yaw)) ? raw.yaw : 0;
      p.walking = !!raw.walking;
      socket.to('world').emit('world:pos', {
        id: socket.id, x: p.x, z: p.z, yaw: p.yaw, walking: p.walking
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

    socket.on('disconnect', () => {
      if (!worldPlayers.has(socket.id)) return;
      worldPlayers.delete(socket.id);
      socket.to('world').emit('world:left', { id: socket.id });
    });
  });
};
