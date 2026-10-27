/************************************************
 * Unit tests for middleware/requireAdmin.js — the only gate on /api/admin.
 *
 * No Mongo, no JWTs: middleware/auth.js is replaced in the require cache by
 * a stub that sets (or doesn't set) req.user and calls the callback, so
 * these cases exercise only requireAdmin's own decision — a fresh DB read
 * of isAdmin / banned, never the token's claim. User.findById is stubbed on
 * the model (mongoose.model() registers without connecting), like
 * test/auth-middleware.test.js.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ---- stub middleware/auth.js before requireAdmin loads it ----------------
let authBehaviour = () => {};          // (req) => err | undefined; may set req.user
let pending = null;                    // the async callback's promise
const authPath = path.join(__dirname, '..', 'middleware', 'auth.js');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: (req, res, cb) => { pending = Promise.resolve(cb(authBehaviour(req))); }
};

const User = require('../models/user');
const requireAdmin = require('../middleware/requireAdmin');

const db = new Map();                  // id -> lean doc
let findImpl = async (id) => db.get(String(id));
let selected = null;
User.findById = (id) => ({ select: (s) => { selected = s; return { lean: () => findImpl(id) }; } });

async function run(user) {
  authBehaviour = (req) => { if (user !== undefined) req.user = user; };
  const req = { headers: {} };
  const out = { status: 200, body: null, next: [] };
  const res = {
    status(c) { out.status = c; return res; },
    json(b) { out.body = b; return res; }
  };
  pending = null;
  requireAdmin(req, res, (...args) => { out.next.push(args); });
  await pending;
  return { req, out };
}

test.beforeEach(() => { db.clear(); findImpl = async (id) => db.get(String(id)); });

test('auth passes but no req.user -> 401, next not called', async () => {
  const { out } = await run(undefined);
  assert.equal(out.status, 401);
  assert.deepEqual(out.body, { error: 'Unauthorized' });
  assert.equal(out.next.length, 0);
});

test('req.user without an id -> 401', async () => {
  const { out } = await run({ username: 'x' });
  assert.equal(out.status, 401);
  assert.equal(out.next.length, 0);
});

test('an auth error is forwarded to next(err) untouched', async () => {
  const boom = new Error('auth broke');
  authBehaviour = () => boom;
  const calls = [];
  requireAdmin({ headers: {} }, {}, (...a) => calls.push(a));
  await pending;
  assert.deepEqual(calls, [[boom]]);
});

test('user not found in the DB -> 403', async () => {
  const { out } = await run({ id: 'gone' });
  assert.equal(out.status, 403);
  assert.deepEqual(out.body, { error: 'Admin access required' });
  assert.equal(out.next.length, 0);
});

test('JWT claims admin but the DB says isAdmin false -> 403 (demoted admin)', async () => {
  db.set('u1', { username: 'demoted', isAdmin: false, banned: false });
  const { req, out } = await run({ id: 'u1', isAdmin: true });
  assert.equal(out.status, 403);
  assert.equal(out.next.length, 0);
  assert.equal(req.adminUser, undefined);
});

test('banned admin -> 403', async () => {
  db.set('u2', { username: 'bannedboss', isAdmin: true, banned: true });
  const { out } = await run({ id: 'u2' });
  assert.equal(out.status, 403);
  assert.equal(out.next.length, 0);
});

test('DB throws -> 500 and next is NOT called', async () => {
  findImpl = async () => { throw new Error('mongo down'); };
  const { out } = await run({ id: 'u3' });
  assert.equal(out.status, 500);
  assert.deepEqual(out.body, { error: 'Server error' });
  assert.equal(out.next.length, 0);
});

test('real admin -> next() once with no args, req.adminUser = { id, username }', async () => {
  db.set('u4', { username: 'boss', isAdmin: true, banned: false });
  const { req, out } = await run({ id: 'u4' });
  assert.deepEqual(out.next, [[]]);
  assert.equal(out.body, null);
  assert.deepEqual(req.adminUser, { id: 'u4', username: 'boss' });
  // The fresh read must fetch the fields the decision depends on.
  assert.match(selected, /isAdmin/);
  assert.match(selected, /banned/);
});
