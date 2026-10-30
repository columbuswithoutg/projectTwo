/************************************************
 * WORLD NET LOGIC — pure helpers shared by the socket server
 * (routes/world-socket.js) and the browser (js/home-socket.js,
 * js/playground3d.js).
 *
 * Everything a position / emote / snapshot packet goes through lives here
 * so both ends agree on the shape and the server can unit-test its
 * validation: position sanitising, the emote whitelist, the public player
 * record, and per-socket token-bucket rate limits.
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

  // ── Position packets ──
  // (The old `mv` movement-flag bitfield is gone: no client sent or read it.)
  const POSITION_BOUND = 1000;          // sanity clamp; the world is < 300u square
  const Y_MIN = -2, Y_MAX = 10;         // matches the engine's BROADCAST_Y_FLOOR
  const POSES = new Set(['sit', 'lie']);

  // raw → { x, y, z, yaw, walking, backward, pose } or null when x / z are
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
    return { x, y, z, yaw, walking, backward: walking && raw.backward === true, pose };
  }

  // Where a joiner stands, from the join payload (all fields optional).
  function joinPos(raw) {
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= POSITION_BOUND) ? v : 0;
    return { x: num(raw && raw.x), z: num(raw && raw.z), yaw: Math.round(P.wrapAngle(raw && raw.yaw) * 1000) / 1000 };
  }

  // ── Emotes ──
  // The wave (the /world emote button): a one-shot that ends on its own. The
  // client only ever sends and plays 'wave', so that is all the server relays
  // (the never-used loops and their 'stop' went with NET-14).
  const EMOTES = Object.freeze(['wave']);
  const EMOTE_SET = new Set(EMOTES);
  function isEmoteKind(k) { return typeof k === 'string' && EMOTE_SET.has(k); }

  // ── Public player record ──
  // The ONLY fields a snapshot / joined broadcast carries. The server's own
  // record also holds userId, chat timestamps, island stay accounting and
  // punch/snap timing, none of which other players need.
  const PUBLIC_KEYS = Object.freeze(['socketId', 'username', 'character', 'x', 'y', 'z', 'yaw',
    'walking', 'backward', 'pose']);

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
      pose: s.pose || null
    };
  }

  // ── Rate limits (per-socket token buckets) ──
  // cap = burst, perSec = steady refill. Joins and voice announces each make
  // the server touch the DB and/or fan out to a whole room; emotes and stone
  // grabs fan out too. Chat, punches, snaps and positions keep their existing
  // floors in world-socket.js.
  // Scene Guess (server/scene-guess.js): starting a lobby reads Mongo on its
  // close, so it gets the tightest bucket; a guess is once per round anyway.
  // Keyed by USER on the server (server/rate-store.js), so a limit is shared
  // by every tab / reconnect of one account: `join` covers every /world
  // join from any tab, `homeJoin` likewise for homes. The handshake pair
  // bounds reconnect churn (per user) and token-less connection floods
  // (per IP, checked before any JWT or DB work).
  // The join buckets used to be cap 4 / 0.1/s: a few reloads, /map <-> /world
  // hops or flaky mobile reconnects (each one a new socket + join) spent it
  // and the next join was dropped, leaving an empty world. A refused join is
  // now answered (world:join-refused / home:join-refused) and retried by the
  // client, so the bucket only has to stop floods.
  const RATES = Object.freeze({
    join:      Object.freeze({ cap: 8, perSec: 0.5 }),
    homeJoin:  Object.freeze({ cap: 8, perSec: 0.5 }),
    handshakeUser: Object.freeze({ cap: 10, perSec: 0.1 }),
    handshakeIp:   Object.freeze({ cap: 30, perSec: 1 }),
    emote:     Object.freeze({ cap: 4, perSec: 0.5 }),
    announce:  Object.freeze({ cap: 5, perSec: 0.5 }),
    stoneGrab: Object.freeze({ cap: 6, perSec: 2 }),
    sgStart:   Object.freeze({ cap: 2, perSec: 0.05 }),
    sgJoin:    Object.freeze({ cap: 4, perSec: 0.5 }),
    sgGuess:   Object.freeze({ cap: 4, perSec: 1 }),
    sgMisc:    Object.freeze({ cap: 6, perSec: 0.5 }),
    qgStart:   Object.freeze({ cap: 2, perSec: 0.05 }),
    qgJoin:    Object.freeze({ cap: 4, perSec: 0.5 }),
    qgAnswer:  Object.freeze({ cap: 4, perSec: 1 }),
    qgMisc:    Object.freeze({ cap: 6, perSec: 0.5 })
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

  // How long a refused caller should wait before retrying: the time an empty
  // `key` bucket takes to mint one token (it just refused, so it holds < 1).
  // Unknown or non-refilling keys get a flat 3 s. Sent as retryInMs with
  // world:join-refused / home:join-refused.
  function refillMs(key) {
    const r = RATES[key];
    if (!r || !(r.perSec > 0)) return 3000;
    return Math.ceil(1000 / r.perSec);
  }

  return {
    POSITION_BOUND, sanitizePos, joinPos,
    EMOTES, isEmoteKind,
    PUBLIC_KEYS, publicPlayer,
    RATES, bucket, take, allow, refillMs
  };
});
