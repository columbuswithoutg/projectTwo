const jwt = require('jsonwebtoken');
const User = require('../models/user');

// Per-request validation cache. Verifying the JWT signature is cheap, but
// re-checking tokenVersion + banned against Mongo on every authed request
// would 2x our DB load. Cache the (id, tv) -> {ok, banned, banReason}
// decision for 30s; ban / tokenVersion bump effects propagate within that
// window. The cache is keyed on tv so a bump immediately invalidates.
const VALIDATION_TTL_MS = 30 * 1000;
const validationCache = new Map(); // key = `${id}|${tv}` -> {expires, ok, banReason}

// Throttled lastActiveAt writer. The admin Users tab shows an "online" dot
// for users active in the last 5 minutes. Writing on every authed request
// would double our DB write volume for no extra resolution, so we only
// write at most once per minute per user. The map is bounded the same way
// as the validation cache.
const LAST_ACTIVE_THROTTLE_MS = 60 * 1000;
const lastActiveWrites = new Map(); // userId -> lastWriteMs

function touchLastActive(userId) {
  const now = Date.now();
  const last = lastActiveWrites.get(userId) || 0;
  if (now - last < LAST_ACTIVE_THROTTLE_MS) return;
  lastActiveWrites.set(userId, now);
  if (lastActiveWrites.size > 5000) {
    const firstKey = lastActiveWrites.keys().next().value;
    lastActiveWrites.delete(firstKey);
  }
  // Fire-and-forget; the request must not wait on this write.
  User.updateOne({ _id: userId }, { $set: { lastActiveAt: new Date(now) } })
    .catch(err => console.error('lastActiveAt update failed:', err && err.message));
}

function cacheGet(key) {
  const entry = validationCache.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    validationCache.delete(key);
    return null;
  }
  return entry;
}

function cacheSet(key, value) {
  // Bound the cache; this LRU-ish trim keeps memory predictable on a
  // long-running process without a real eviction policy.
  if (validationCache.size > 5000) {
    const firstKey = validationCache.keys().next().value;
    validationCache.delete(firstKey);
  }
  validationCache.set(key, { ...value, expires: Date.now() + VALIDATION_TTL_MS });
}

// Core token validation, shared by the HTTP middleware below and the
// Socket.IO handshake (routes/world-socket.js). Verifies the JWT signature
// then enforces tokenVersion + banned against Mongo (cached 30s). Returns a
// plain result object so non-HTTP callers (sockets) can use it too:
//   { ok:true, payload, username }
//   { ok:false, status, error, reason? }
async function validateToken(token) {
  if (!token) return { ok: false, status: 401, error: 'No token' };

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return { ok: false, status: 401, error: 'Invalid token' };
  }

  // Old tokens (issued before tokenVersion existed) carry no tv claim. Treat
  // missing tv as 0 — matches the schema default — so existing sessions
  // stay valid across the deploy that introduces this field.
  const tv = typeof payload.tv === 'number' ? payload.tv : 0;
  const cacheKey = `${payload.id}|${tv}`;
  const cached = cacheGet(cacheKey);

  if (cached) {
    if (!cached.ok) {
      return { ok: false, status: 403, error: 'Account suspended', reason: cached.banReason || '' };
    }
    return { ok: true, payload, username: cached.username };
  }

  // Cache miss — validate against Mongo. We pull only the fields we need to
  // keep the document small.
  let userDoc;
  try {
    userDoc = await User.findById(payload.id).select('tokenVersion banned banReason username').lean();
  } catch {
    return { ok: false, status: 500, error: 'Server error' };
  }
  if (!userDoc) {
    return { ok: false, status: 401, error: 'Invalid token' };
  }
  const storedTv = userDoc.tokenVersion || 0;
  if (storedTv !== tv) {
    // Token rotation — user was banned/unbanned/forced-logout since this JWT
    // was issued. Force re-login.
    return { ok: false, status: 401, error: 'Session expired, please log in again' };
  }
  if (userDoc.banned) {
    cacheSet(cacheKey, { ok: false, banReason: userDoc.banReason });
    return { ok: false, status: 403, error: 'Account suspended', reason: userDoc.banReason || '' };
  }

  cacheSet(cacheKey, { ok: true, username: userDoc.username });
  return { ok: true, payload, username: userDoc.username };
}

async function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  const result = await validateToken(token);
  if (!result.ok) {
    const body = { error: result.error };
    if (result.reason !== undefined) body.reason = result.reason;
    return res.status(result.status).json(body);
  }
  req.user = result.payload;
  // Authed responses are user-specific — don't let browser/proxy caches
  // serve User A's response to User B sharing the same tab. `private`
  // forbids shared caches; `no-store` skips the local cache entirely.
  res.set('Cache-Control', 'private, no-store');
  touchLastActive(result.payload.id);
  next();
}

// Exposed so /api/admin/users/:id/ban can drop a now-stale cache entry
// instead of waiting 30s for it to expire.
auth.invalidateUser = function invalidateUser(userId) {
  const prefix = `${userId}|`;
  for (const key of validationCache.keys()) {
    if (key.startsWith(prefix)) validationCache.delete(key);
  }
  // Let live realtime sockets (world/home/voice) be torn down on ban/forced
  // logout — the socket handshake auth only runs at connect, so an active
  // socket would otherwise keep full access until its JWT expires. The
  // world-socket module registers this hook at boot.
  if (typeof auth.onInvalidate === 'function') {
    try { auth.onInvalidate(String(userId)); } catch (e) { console.error('onInvalidate failed:', e && e.message); }
  }
};

// Set by routes/world-socket.js so invalidateUser can disconnect live sockets.
auth.onInvalidate = null;

// Shared with the Socket.IO handshake — same ban/tokenVersion enforcement.
auth.validateToken = validateToken;

module.exports = auth;
