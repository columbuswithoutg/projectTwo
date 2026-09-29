/************************************************
 * WORLD NET LOGIC — pure helpers shared by the socket server
 * (routes/world-socket.js) and the browser (js/home-socket.js,
 * js/playground3d.js).
 *
 * Everything a position / emote / snapshot packet goes through lives here
 * so both ends agree on the shape and the server can unit-test its
 * validation: movement flags, position sanitising, the emote whitelist, the
 * public player record, and per-socket token-bucket rate limits.
 *
 * UMD-ish like js/playground3d-physics.js (which it depends on for angle
 * wrapping — load it first in the browser chunk).
 ************************************************/
(function (root, factory) {
  const P = (typeof module !== 'undefined' && module.exports)
    ? require('./playground3d-physics.js')
    : (root && root.PG3DPhysics);
  const api = factory(P);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WorldNetLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function (P) {

  // ── Movement flags (the `mv` field of world:pos / home:pos) ──
  // A small bitfield so peers can animate crouch / sprint / jumps without a
  // protocol per state. Old clients omit it (treated as 0).
  const MV = Object.freeze({ CROUCH: 1, SPRINT: 2, AIR: 4, DOUBLE: 8, FALLING: 16 });
  const MV_MAX = 31;

  function packMove(s) {
    if (!s) return 0;
    return (s.crouch ? MV.CROUCH : 0) | (s.sprint ? MV.SPRINT : 0) | (s.air ? MV.AIR : 0)
      | (s.double ? MV.DOUBLE : 0) | (s.falling ? MV.FALLING : 0);
  }

  function unpackMove(mv) {
    const m = sanitizeMove(mv, null);
    return {
      crouch: !!(m & MV.CROUCH), sprint: !!(m & MV.SPRINT), air: !!(m & MV.AIR),
      double: !!(m & MV.DOUBLE), falling: !!(m & MV.FALLING)
    };
  }

  // Coerce to a consistent flag set: out of range → 0; seated/lying → 0;
  // crouching can't sprint; the jump bits only exist while airborne.
  function sanitizeMove(mv, pose) {
    if (typeof mv !== 'number' || !Number.isInteger(mv) || mv < 0 || mv > MV_MAX) return 0;
    if (pose) return 0;
    let m = mv;
    if (m & MV.CROUCH) m &= ~MV.SPRINT;
    if (!(m & MV.AIR)) m &= ~(MV.DOUBLE | MV.FALLING);
    return m;
  }

  // ── Position packets ──
  const POSITION_BOUND = 1000;          // sanity clamp; the world is < 300u square
  const Y_MIN = -2, Y_MAX = 10;         // matches the engine's BROADCAST_Y_FLOOR
  const POSES = new Set(['sit', 'lie']);

  // raw → { x, y, z, yaw, walking, backward, pose, mv } or null when x / z are
  // missing, non-finite or out of bounds. yaw is always wrapped to (-π, π]
  // and rounded, so no peer ever receives a value its angle math can't take.
  function sanitizePos(raw, bound) {
    if (!raw || typeof raw !== 'object') return null;
    const b = bound || POSITION_BOUND;
    const x = raw.x, z = raw.z;
    if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    if (Math.abs(x) > b || Math.abs(z) > b) return null;
    const y = (typeof raw.y === 'number' && Number.isFinite(raw.y)) ? Math.max(Y_MIN, Math.min(Y_MAX, raw.y)) : 0;
    const yaw = Math.round(P.wrapAngle(raw.yaw) * 1000) / 1000;
    const walking = raw.walking === true;
    const pose = POSES.has(raw.pose) ? raw.pose : null;
    return { x, y, z, yaw, walking, backward: walking && raw.backward === true, pose, mv: sanitizeMove(raw.mv, pose) };
  }

  // Where a joiner stands, from the join payload (all fields optional).
  function joinPos(raw) {
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= POSITION_BOUND) ? v : 0;
    return { x: num(raw && raw.x), z: num(raw && raw.z), yaw: Math.round(P.wrapAngle(raw && raw.yaw) * 1000) / 1000 };
  }

  // ── Emotes ──
  // One-shots end on their own; loops hold until the player moves, jumps,
  // punches or picks another one. The server stores a looping emote on the
  // player record so late joiners see it.
  const EMOTES = Object.freeze(['wave', 'cheer', 'dance', 'hero', 'talk', 'phone', 'lie', 'kneel']);
  const EMOTE_SET = new Set(EMOTES);
  const EMOTE_LOOPS = new Set(['dance', 'hero', 'talk', 'phone', 'lie', 'kneel']);
  function isEmoteKind(k) { return typeof k === 'string' && EMOTE_SET.has(k); }
  function isLoopingEmote(k) { return typeof k === 'string' && EMOTE_LOOPS.has(k); }

  // ── Public player record ──
  // The ONLY fields a snapshot / joined broadcast carries. The server's own
  // record also holds userId, chat timestamps, island stay accounting and
  // punch/snap timing, none of which other players need.
  const PUBLIC_KEYS = Object.freeze(['socketId', 'username', 'character', 'x', 'y', 'z', 'yaw',
    'walking', 'backward', 'pose', 'mv', 'emote']);

  function publicPlayer(p) {
    const s = p || {};
    return {
      socketId: s.socketId || null,
      username: s.username || null,
      character: s.character || null,
      x: Number.isFinite(s.x) ? s.x : 0,
      y: Number.isFinite(s.y) ? s.y : 0,
      z: Number.isFinite(s.z) ? s.z : 0,
      yaw: Number.isFinite(s.yaw) ? s.yaw : 0,
      walking: !!s.walking,
      backward: !!s.backward,
      pose: s.pose || null,
      mv: Number.isInteger(s.mv) ? s.mv : 0,
      emote: s.emote || null
    };
  }

  // ── Rate limits (per-socket token buckets) ──
  // cap = burst, perSec = steady refill. Joins and voice announces each make
  // the server touch the DB and/or fan out to a whole room; emotes and stone
  // grabs fan out too. Chat, punches, snaps and positions keep their existing
  // floors in world-socket.js.
  const RATES = Object.freeze({
    join:      Object.freeze({ cap: 3, perSec: 0.1 }),
    emote:     Object.freeze({ cap: 4, perSec: 0.5 }),
    announce:  Object.freeze({ cap: 5, perSec: 0.5 }),
    stoneGrab: Object.freeze({ cap: 6, perSec: 2 })
  });

  function bucket(cap, perSec, now) {
    return { tokens: cap, at: Number.isFinite(now) ? now : 0, cap, perSec };
  }

  // Spend `cost` tokens if available. A clock that goes backwards (or a NaN
  // `now`) simply doesn't refill — it can never mint extra tokens.
  function take(b, now, cost) {
    const c = cost == null ? 1 : cost;
    if (Number.isFinite(now) && now > b.at) {
      b.tokens = Math.min(b.cap, b.tokens + ((now - b.at) / 1000) * b.perSec);
      b.at = now;
    }
    if (b.tokens >= c) { b.tokens -= c; return true; }
    return false;
  }

  // store: a per-socket object (socket.data.rl); key: a RATES name.
  function allow(store, key, now) {
    const r = RATES[key];
    if (!r || !store) return true;
    let b = store[key];
    if (!b) b = store[key] = bucket(r.cap, r.perSec, now);
    return take(b, now);
  }

  return {
    MV, MV_MAX, packMove, unpackMove, sanitizeMove,
    POSITION_BOUND, sanitizePos, joinPos,
    EMOTES, isEmoteKind, isLoopingEmote,
    PUBLIC_KEYS, publicPlayer,
    RATES, bucket, take, allow
  };
});
