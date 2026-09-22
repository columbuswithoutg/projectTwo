/************************************************
 * Unit tests for middleware/auth.js — JWT verify + tokenVersion + ban
 * enforcement, the 30s validation cache, and invalidateUser.
 *
 * No Mongo: User.findById / User.updateOne are stubbed on the model
 * (mongoose.model() registers without connecting). The validation cache
 * is module-level and keyed by user id, so every case uses a fresh id.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

const User = require('../models/user');
const auth = require('../middleware/auth');

// ---- stubs -------------------------------------------------------------
const db = new Map();        // id -> user doc (absent = "not found")
let findCalls = 0;
User.findById = (id) => {
  findCalls++;
  return { select: () => ({ lean: async () => db.get(String(id)) }) };
};
User.updateOne = () => ({ catch() {} });

let nextId = 1;
function seed(doc) {
  const id = String(nextId++).padStart(24, '0');   // valid ObjectId shape
  if (doc !== undefined) {
    db.set(id, { _id: id, username: 'user' + id.slice(-1), tokenVersion: 0, banned: false, ...doc });
  }
  return id;
}
function tokenFor(id, tv) {
  const payload = { id };
  if (tv !== undefined) payload.tv = tv;
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}
function run(token) {
  const req = { headers: token ? { authorization: 'Bearer ' + token } : {} };
  const out = { status: 200, body: null, headers: {}, nextCalled: false };
  const res = {
    status(c) { out.status = c; return res; },
    json(b) { out.body = b; return res; },
    set(k, v) { out.headers[k] = v; }
  };
  return auth(req, res, () => { out.nextCalled = true; }).then(() => ({ req, out }));
}

// ---- cases -------------------------------------------------------------
test('no token -> 401 "No token"', async () => {
  const { out } = await run(undefined);
  assert.equal(out.status, 401);
  assert.deepEqual(out.body, { error: 'No token' });
  assert.equal(out.nextCalled, false);
});

test('bad signature -> 401 "Invalid token"', async () => {
  const bad = jwt.sign({ id: seed({}) }, 'some-other-secret');
  const { out } = await run(bad);
  assert.equal(out.status, 401);
  assert.deepEqual(out.body, { error: 'Invalid token' });
});

test('valid token + matching tokenVersion -> next(), req.user, no-store header', async () => {
  const id = seed({ tokenVersion: 3 });
  const { req, out } = await run(tokenFor(id, 3));
  assert.equal(out.nextCalled, true);
  assert.equal(out.body, null);
  assert.equal(req.user.id, id);
  assert.equal(out.headers['Cache-Control'], 'private, no-store');
});

test('legacy token with no tv claim is treated as tokenVersion 0', async () => {
  const id = seed({ tokenVersion: 0 });
  const { out } = await run(tokenFor(id));
  assert.equal(out.nextCalled, true);
});

test('tokenVersion mismatch -> 401 "Session expired"', async () => {
  const id = seed({ tokenVersion: 5 });
  const { out } = await run(tokenFor(id, 4));
  assert.equal(out.status, 401);
  assert.match(out.body.error, /Session expired/);
  assert.equal(out.nextCalled, false);
});

test('banned -> 403 with reason', async () => {
  const id = seed({ banned: true, banReason: 'spam' });
  const { out } = await run(tokenFor(id, 0));
  assert.equal(out.status, 403);
  assert.deepEqual(out.body, { error: 'Account suspended', reason: 'spam' });
});

test('unknown user -> 401 "Invalid token"', async () => {
  const id = seed(undefined);
  const { out } = await run(tokenFor(id, 0));
  assert.equal(out.status, 401);
  assert.deepEqual(out.body, { error: 'Invalid token' });
});

test('second request with the same (id, tv) is served from the cache', async () => {
  const id = seed({});
  const t = tokenFor(id, 0);
  const before = findCalls;
  await run(t);
  await run(t);
  assert.equal(findCalls - before, 1);
});

test('invalidateUser drops the cached decision and calls onInvalidate', async () => {
  const id = seed({});
  const t = tokenFor(id, 0);
  await run(t);
  let hooked = null;
  auth.onInvalidate = (uid) => { hooked = uid; };
  try {
    auth.invalidateUser(id);
  } finally {
    auth.onInvalidate = null;
  }
  assert.equal(hooked, id);
  const before = findCalls;
  await run(t);
  assert.equal(findCalls - before, 1);
});

test('a ban that lands after caching is enforced once the cache is invalidated', async () => {
  const id = seed({});
  const t = tokenFor(id, 0);
  assert.equal((await run(t)).out.nextCalled, true);
  db.get(id).banned = true;
  db.get(id).banReason = 'later';
  assert.equal((await run(t)).out.nextCalled, true);   // still cached
  auth.invalidateUser(id);
  const { out } = await run(t);
  assert.equal(out.status, 403);
  assert.equal(out.body.reason, 'later');
});

test('validateToken is exported for the socket handshake and returns the same decisions', async () => {
  const id = seed({ username: 'sock' });
  const r = await auth.validateToken(tokenFor(id, 0));
  assert.equal(r.ok, true);
  assert.equal(r.username, 'sock');
  assert.equal(r.payload.id, id);
  const bad = await auth.validateToken('nope');
  assert.deepEqual(bad, { ok: false, status: 401, error: 'Invalid token' });
});
