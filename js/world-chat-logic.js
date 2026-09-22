/************************************************
 * WORLD CHAT LOGIC — pure, dependency-free helpers
 *
 * The rules behind /world's chat channels:
 *   world   — everyone in the room
 *   project — only players standing on the same project island
 *   whisper — one named player (plus an echo to the sender)
 * Only World chat has a cooldown; Project and Whisper send freely.
 *
 * Shared by BOTH ends of the wire:
 *   routes/world-socket.js — authoritative validation + "which island is
 *                            this player on" from their broadcast position
 *   js/home-socket.js      — the same cooldown / parsing on the client, so
 *                            the countdown and /w command match the server
 *
 * Pure: every function takes `now` explicitly, so test/world-chat.test.js
 * can drive time by hand.
 *
 * UMD-ish: attaches to window.WorldChatLogic in the browser, exports via
 * module.exports under Node (same pattern as world-npc-logic.js).
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WorldChatLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const CHANNELS = ['world', 'project', 'whisper'];
  const C = {
    COOLDOWN_MS: 10000,
    MAX_LEN: 200,
    // Mirrors Playground3D's WORLD constants: a node sits at grid × SCALE and
    // its walkable apron is (PLATFORM_W + APRON_MARGIN) = 16 units square.
    GRID_SCALE: 18,
    ZONE_HALF: 8
  };

  // Id of the project whose apron contains (x, z), or null when the point is
  // on a road / open ground. `grid` is [{ id, gridX, gridY }]. Aprons never
  // overlap (18u spacing vs 16u square), so the first hit is the only hit.
  function projectAt(x, z, grid) {
    if (!Array.isArray(grid) || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    for (const p of grid) {
      if (!p || typeof p.gridX !== 'number' || typeof p.gridY !== 'number') continue;
      if (Math.abs(x - p.gridX * C.GRID_SCALE) <= C.ZONE_HALF &&
          Math.abs(z - p.gridY * C.GRID_SCALE) <= C.ZONE_HALF) return p.id;
    }
    return null;
  }

  // Socket ids of the OTHER players standing on selfId's island. `players` is
  // the server's socketId → player Map (each with a `projectId`); `members`
  // (optional Set) restricts the result — e.g. to voice-enabled sockets — but
  // is deliberately NOT applied to selfId, so leave/eviction paths can call
  // this after removing themselves. Off-island or unknown self → [].
  function islandPeers(selfId, players, members) {
    if (!players || typeof players.get !== 'function') return [];
    const me = players.get(selfId);
    if (!me || !me.projectId) return [];
    const out = [];
    for (const [sid, p] of players) {
      if (sid === selfId || !p || p.projectId !== me.projectId) continue;
      if (members && !members.has(sid)) continue;
      out.push(sid);
    }
    return out;
  }

  // Only the room-wide World channel is rate limited — Project reaches a
  // handful of players and Whisper reaches one, so neither needs it.
  function hasCooldown(channel) {
    return channel === 'world';
  }

  // ms until this sender may chat on World again (0 = now).
  function cooldownLeft(lastChat, now) {
    if (!lastChat) return 0;
    return Math.max(0, C.COOLDOWN_MS - (now - lastChat));
  }

  // Normalize a raw client payload. Returns { ok, channel, text, to } or
  // { ok:false, error }. Does NOT check the cooldown or resolve the whisper
  // target — those need server state.
  function normalizeMessage(raw) {
    const channel = CHANNELS.includes(raw && raw.channel) ? raw.channel : 'world';
    const text = String((raw && raw.text) || '').trim().slice(0, C.MAX_LEN);
    if (!text) return { ok: false, error: 'empty' };
    const to = channel === 'whisper' ? String((raw && raw.to) || '').trim().slice(0, 40) : null;
    if (channel === 'whisper' && !to) return { ok: false, error: 'no-target' };
    return { ok: true, channel, text, to };
  }

  // "/w name message" (also /whisper, /msg) → { to, text }; anything else → null.
  function parseWhisperCommand(input) {
    const m = /^\/(?:w|whisper|msg)\s+(\S+)\s+([\s\S]+)$/i.exec(String(input || '').trim());
    return m ? { to: m[1], text: m[2].trim() } : null;
  }

  // Case-insensitive username match.
  function sameName(a, b) {
    return String(a || '').toLowerCase() === String(b || '').toLowerCase();
  }

  // Friendly text for a rejected send.
  function errorText(err, info) {
    switch (err) {
      case 'cooldown':   return `Slow down — you can chat in World again in ${Math.ceil(((info && info.retryInMs) || 0) / 1000)}s.`;
      case 'no-project': return 'You’re not on a project island — walk onto one to use Project chat.';
      case 'not-found':  return `${(info && info.to) || 'That player'} isn’t in the world right now.`;
      case 'self':       return 'You can’t whisper to yourself.';
      case 'no-target':  return 'Pick someone to whisper to.';
      case 'empty':      return 'Type a message first.';
      default:           return 'Message not sent.';
    }
  }

  return { CHANNELS, C, projectAt, islandPeers, hasCooldown, cooldownLeft, normalizeMessage, parseWhisperCommand, sameName, errorText };
});
