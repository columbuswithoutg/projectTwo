/************************************************
 * routes/messages.js — the Messages inbox API, with Mongo stubbed (SRV2-05).
 *
 * The real router runs on a throwaway express app behind a stand-in JWT
 * middleware (as in test/quote-routes.test.js), with the real
 * server/messages.js, server/dm-policy.js and server/username.js on top of
 * in-memory Message / User / Friend stores. Covers the authz the code is
 * the only check for: a thread is always the caller's own pair (A asking
 * for B never sees B's thread with C), only messages addressed to the
 * caller are marked read, the Admin thread and the conversation list are
 * per user; and the send rules: validation, unknown user, self, the shared
 * DM budget (floor + non-friend daily cap), a sender id taken from the
 * token rather than the body.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const mongoose = require('mongoose');

const A = '65a000000000000000000001';
const B = '65a000000000000000000002';
const C_ = '65a000000000000000000003';
let currentUser = A;
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: (req, res, next) => { req.user = { id: currentUser }; next(); } };

const Message = require('../models/Message');
const User = require('../models/user');
const Friend = require('../models/Friend');
const Username = require('../server/username');
const DmPolicy = require('../server/dm-policy');
const L = require('../js/messaging-logic');
Username.setReady(true);

// ── in-memory stores ──
let users = [];
let messages = [];
let friends = new Set();          // "a|b" pairs, either order
let seq = 0;

const eq = (a, b) => String(a) === String(b);
function matches(doc, f) {
  return Object.entries(f || {}).every(([k, want]) => {
    if (k === '$or') return want.some(x => matches(doc, x));
    const have = doc[k];
    if (want === null) return have == null;
    if (want && typeof want === 'object' && !(want instanceof Date) && !mongoose.isValidObjectId(want)) {
      if ('$in' in want) return want.$in.some(v => eq(v, have));
      if ('$lt' in want) return have < want.$lt;
      if ('$gte' in want) return have >= want.$gte;
    }
    return eq(have, want);
  });
}
function query(run) {
  let sort = null, limit = Infinity;
  const q = {
    select: () => q,
    sort: (s) => { sort = s; return q; },
    limit: (n) => { limit = n; return q; },
    lean: async () => {
      let out = run();
      if (!Array.isArray(out)) return out ? { ...out } : null;
      out = out.map(d => ({ ...d }));
      if (sort && sort.createdAt) out.sort((x, y) => (x.createdAt - y.createdAt) * sort.createdAt);
      return out.slice(0, limit);
    }
  };
  return q;
}

User.findOne = (f) => query(() => users.find(u => matches(u, f)) || null);
User.findById = (id) => query(() => users.find(u => eq(u._id, id)) || null);
User.find = (f) => query(() => users.filter(u => matches(u, f)));
Friend.exists = async (f) => {
  // friendFilter(s, r) → an accepted friend doc between the two, either way.
  const s = JSON.stringify(f);
  for (const pair of friends) {
    const [x, y] = pair.split('|');
    if (s.includes(x) && s.includes(y)) return { _id: 'f' };
  }
  return null;
};
Message.find = (f) => query(() => messages.filter(m => matches(m, f)));
Message.countDocuments = async (f) => messages.filter(m => matches(m, f)).length;
Message.updateMany = async (f, u) => {
  const hit = messages.filter(m => matches(m, f));
  for (const m of hit) Object.assign(m, u.$set);
  return { modifiedCount: hit.length };
};
Message.create = async (doc) => {
  const m = { _id: new mongoose.Types.ObjectId().toString(), createdAt: new Date(Date.now() + (++seq)), readAt: null, ...doc };
  messages.push(m);
  return { ...m };
};
// The conversation list: $match (the caller as sender or recipient) → newest
// per pairKey + its unread count for the caller.
Message.aggregate = async (pipeline) => {
  const match = pipeline[0].$match;
  const me = String(match.$or[0].sender);
  const rows = messages.filter(m => matches(m, match)).sort((x, y) => y.createdAt - x.createdAt);
  const by = new Map();
  for (const m of rows) {
    const g = by.get(m.pairKey) || { _id: m.pairKey, last: m, unread: 0 };
    if (eq(m.recipient, me) && m.readAt == null) g.unread++;
    by.set(m.pairKey, g);
  }
  return [...by.values()];
};

const app = express();
app.use(express.json());
app.use('/api/messages', require('../routes/messages'));

let server;
test.before(() => new Promise((resolve) => { server = app.listen(0, resolve); }));
test.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));

const T0 = Date.UTC(2026, 9, 1);
function msg(from, to, text, min, extra = {}) {
  messages.push({ _id: new mongoose.Types.ObjectId().toString(), sender: from, recipient: to, pairKey: L.pairKey(from, to), kind: 'dm', text, createdAt: new Date(T0 + min * 60e3), readAt: null, ...extra });
}
function adminMsg(to, text, min) {
  messages.push({ _id: new mongoose.Types.ObjectId().toString(), sender: null, system: L.SYSTEM_ADMIN, recipient: to, pairKey: L.adminPairKey(to), kind: 'report-reply', text, createdAt: new Date(T0 + min * 60e3), readAt: null });
}

test.beforeEach(() => {
  users = [
    { _id: A, username: 'alice', usernameLower: 'alice' },
    { _id: B, username: 'bob', usernameLower: 'bob' },
    { _id: C_, username: 'carol', usernameLower: 'carol' }
  ];
  messages = [];
  friends = new Set();
  DmPolicy._store.clear();
  currentUser = A;
  msg(B, C_, 'bob to carol: secret', 1);
  msg(C_, B, 'carol to bob: secret reply', 2);
  msg(B, A, 'bob to alice', 3);
  msg(A, B, 'alice to bob', 4);
  adminMsg(B, 'admin to bob', 5);
  adminMsg(A, 'admin to alice', 6);
});

function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ port: server.address().port, method, path: '/api/messages' + path, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const texts = (r) => r.body.messages.map(m => m.text);

// ── reading ──

test('a thread is always the caller\'s own pair: alice asking for bob or carol never sees bob↔carol', async () => {
  let r = await call('GET', '/with/bob');
  assert.equal(r.status, 200);
  assert.deepEqual(texts(r), ['bob to alice', 'alice to bob']);
  assert.deepEqual(r.body.other, { id: B, username: 'bob', profilePicture: '' });
  assert.deepEqual(r.body.messages.map(m => m.mine), [false, true]);
  r = await call('GET', '/with/carol');
  assert.equal(r.status, 200);
  assert.deepEqual(texts(r), [], 'alice and carol never talked');
  r = await call('GET', '/with/BOB');
  assert.deepEqual(texts(r), ['bob to alice', 'alice to bob'], 'case-insensitive name');
});

test('opening a thread marks read only the messages addressed to the caller', async () => {
  await call('GET', '/with/bob');
  const toAlice = messages.find(m => m.text === 'bob to alice');
  const toBob = messages.find(m => m.text === 'alice to bob');
  assert.ok(toAlice.readAt instanceof Date);
  assert.equal(toBob.readAt, null, "bob's unread message stays unread");
  assert.equal(messages.find(m => m.text === 'bob to carol: secret').readAt, null);
  assert.equal(messages.find(m => m.text === 'carol to bob: secret reply').readAt, null);
});

test('the Admin thread is per user', async () => {
  let r = await call('GET', '/system');
  assert.equal(r.status, 200);
  assert.deepEqual(texts(r), ['admin to alice']);
  assert.equal(r.body.system, L.SYSTEM_ADMIN);
  assert.equal(messages.find(m => m.text === 'admin to bob').readAt, null);
  currentUser = B;
  r = await call('GET', '/system');
  assert.deepEqual(texts(r), ['admin to bob']);
});

test('the conversation list and the unread count only cover the caller', async () => {
  let r = await call('GET', '/');
  assert.equal(r.status, 200);
  const keys = r.body.conversations.map(c => c.key).sort();
  assert.deepEqual(keys, [L.adminPairKey(A), L.pairKey(A, B)].sort());
  const withBob = r.body.conversations.find(c => c.key === L.pairKey(A, B));
  assert.equal(withBob.other.username, 'bob');
  assert.deepEqual(withBob.last, { text: 'alice to bob', createdAt: new Date(T0 + 4 * 60e3).toISOString(), mine: true });
  assert.equal(withBob.unread, 1);
  assert.ok(!JSON.stringify(r.body).includes('secret'));
  r = await call('GET', '/unread-count');
  assert.deepEqual(r.body, { count: 2 });         // bob's DM + the admin reply
  currentUser = C_;
  r = await call('GET', '/unread-count');
  assert.deepEqual(r.body, { count: 1 });
});

test('a thread with an unknown or over-long name is 404', async () => {
  assert.equal((await call('GET', '/with/nobody')).status, 404);
  assert.equal((await call('GET', '/with/' + 'x'.repeat(41))).status, 404);
});

// ── sending ──

test('send: 201, stored from the token\'s user to the named one, whatever the body claims', async () => {
  const r = await call('POST', '/', { to: 'carol', text: '  hi carol  ', sender: B, senderId: B, from: 'bob' });
  assert.equal(r.status, 201);
  assert.equal(r.body.message.text, 'hi carol');
  assert.equal(r.body.message.mine, true);
  assert.deepEqual(r.body.to, { id: C_, username: 'carol', profilePicture: '' });
  const stored = messages[messages.length - 1];
  assert.equal(String(stored.sender), A);
  assert.equal(String(stored.recipient), C_);
  assert.equal(stored.pairKey, L.pairKey(A, C_));
  assert.equal(stored.readAt, null, 'carol is not in /world → unread');
});

test('send: validation, unknown user, yourself', async () => {
  const before = messages.length;
  let r = await call('POST', '/', { to: 'bob', text: '   ' });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'empty');
  r = await call('POST', '/', { text: 'hi' });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'no-target');
  r = await call('POST', '/', { to: 'bob', text: 'x'.repeat(L.C.DM_MAX_LEN + 1) });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'too-long');
  r = await call('POST', '/', { to: { $ne: null }, text: 'hi' });
  assert.equal(r.status, 400);
  r = await call('POST', '/', { to: 'nobody', text: 'hi' });
  assert.equal(r.status, 404);
  r = await call('POST', '/', { to: 'ALICE', text: 'hi me' });
  assert.equal(r.status, 400);
  assert.equal(messages.length, before, 'nothing stored');
});

test('send: the shared DM floor refuses a second send right away', async () => {
  assert.equal((await call('POST', '/', { to: 'bob', text: 'one' })).status, 201);
  const r = await call('POST', '/', { to: 'carol', text: 'two' });
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'cooldown');
  assert.ok(r.body.retryInMs > 0);
});

test('send: a non-friend hits the daily cap per recipient; a friend does not', async () => {
  for (let i = 0; i < L.C.NONFRIEND_DAILY_PER_RECIPIENT; i++) {
    messages.push({ _id: 'old' + i, sender: A, recipient: C_, pairKey: L.pairKey(A, C_), text: 'x', createdAt: new Date(), readAt: null });
  }
  let r = await call('POST', '/', { to: 'carol', text: 'one more' });
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'daily-cap');
  DmPolicy._store.clear();
  friends.add(`${A}|${C_}`);
  r = await call('POST', '/', { to: 'carol', text: 'one more' });
  assert.equal(r.status, 201);
});

test('send: a token whose account is gone gets 401 and nothing is stored', async () => {
  currentUser = '65a0000000000000000000ff';
  const before = messages.length;
  const r = await call('POST', '/', { to: 'bob', text: 'ghost' });
  assert.equal(r.status, 401);
  assert.equal(messages.length, before);
});
