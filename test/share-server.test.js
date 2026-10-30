/************************************************
 * Doomsday story share — the two server paths test/share.test.js leaves
 * out (SRV2-04), with Mongo stubbed:
 *   routes/auth.js POST /register with a `ref`   the "Start your own" sign-up
 *   server/share.js sharePage(spaFile)           GET /s/<token>[/map]
 *
 * The real auth router and the real sharePage handler run on a throwaway
 * express app; User / Friend get a tiny in-memory store, the password hash
 * is stubbed (bcrypt at cost 12 is slow), and the shell is a temp file.
 * Covers: a bad / unknown / banned `ref` still signs up (200, referredBy
 * null); a good one sends the friend request and counts the join; a
 * creditReferral that throws (Friend.create down, the sharer lookup down)
 * never fails sign-up; the share page always serves the shell with
 * no-store, generic preview text for a dead / banned token or a failed
 * lookup, and escaped personal text for a live one.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const authPath = require.resolve('../middleware/auth');
const fakeAuth = (req, res, next) => { req.user = { id: 'nobody' }; next(); };
fakeAuth.invalidateUser = () => {};
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: fakeAuth };

const ShareLogic = require('../js/share-logic');
const watchRules = require('../server/watchRules');
const ALL = new Map(ShareLogic.DOOMSDAY_WATCHLIST.map(id => [id, { id, title: id }]));
watchRules.allProjects = async () => ALL;

// routes/auth.js destructures hashPassword at require time → stub it first.
const Password = require('../server/password');
Password.hashPassword = async (pw) => 'hashed:' + pw.length;

const Username = require('../server/username');
Username.setReady(true);

const User = require('../models/user');
const Friend = require('../models/Friend');
let users = [];
let friendCreates = [];
let failFriend = null;       // an Error → Friend.create rejects with it
let failShareLookup = null;  // an Error → the shareToken lookup rejects with it
let failProjects = null;     // an Error → watchRules.allProjects rejects with it
const matches = (u, f) => Object.entries(f).every(([k, v]) => {
  if (v && typeof v === 'object' && '$ne' in v) return u[k] !== v.$ne;
  return String(u[k]) === String(v);
});
const lean = (run) => { const q = { select: () => q, lean: async () => { const v = await run(); return v ? JSON.parse(JSON.stringify(v)) : null; } }; return q; };
User.findOne = (f) => lean(async () => {
  if ('shareToken' in f && failShareLookup) throw failShareLookup;
  return users.find(u => matches(u, f)) || null;
});
User.create = async (doc) => {
  const u = { _id: 'n' + (users.length + 1), ...doc, usernameLower: doc.username.toLowerCase() };
  users.push(u);
  return { ...u };
};
User.updateOne = async (f, upd) => {
  const u = users.find(x => matches(x, f));
  if (!u) return { matchedCount: 0 };
  if (upd.$inc) for (const [k, n] of Object.entries(upd.$inc)) u[k] = (u[k] || 0) + n;
  return { matchedCount: 1 };
};
Friend.create = async (doc) => { if (failFriend) throw failFriend; friendCreates.push(doc); return doc; };
const realAllProjects = watchRules.allProjects;
watchRules.allProjects = async () => { if (failProjects) throw failProjects; return realAllProjects(); };

const Share = require('../server/share');
const realCredit = Share.creditReferral;

// A shell like dist/spa.html.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-server-'));
const spaFile = path.join(dir, 'spa.html');
fs.writeFileSync(spaFile, '<!doctype html><html><head><meta charset="utf-8" /><title>MCU Watch Order</title></head><body><div id="app"></div></body></html>');

const app = express();
app.use(express.json());
app.use('/api/auth', require('../routes/auth'));
app.get(/^\/s\/[A-Za-z0-9_-]{12}(\/map)?$/, Share.sharePage(spaFile));

let server;
test.before(() => new Promise((resolve) => { server = app.listen(0, resolve); }));
test.after(() => new Promise((resolve) => {
  server.closeAllConnections();
  server.close(() => { fs.rmSync(dir, { recursive: true, force: true }); resolve(); });
}));

const TOKEN = ShareLogic.newToken(crypto.randomBytes);
const BANNED = ShareLogic.newToken(crypto.randomBytes);
const DEAD = ShareLogic.newToken(crypto.randomBytes);
test.beforeEach(() => {
  users = [
    { _id: 's1', username: 'elsid', usernameLower: 'elsid', shareToken: TOKEN, watchedProjects: ShareLogic.DOOMSDAY_WATCHLIST.slice(0, 3).map(projectId => ({ projectId })) },
    { _id: 's2', username: 'banned1', usernameLower: 'banned1', shareToken: BANNED, banned: true }
  ];
  friendCreates = [];
  failFriend = null; failShareLookup = null; failProjects = null;
  Share.creditReferral = realCredit;
});

function request(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ port: server.address().port, method, path: p, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        let json = null;
        try { json = b ? JSON.parse(b) : null; } catch (_) { /* html */ }
        resolve({ status: res.statusCode, headers: res.headers, text: b, body: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const register = (body) => request('POST', '/api/auth/register', body);
const quiet = async (fn) => {
  const orig = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
};

// ── POST /register with a referral ──

test('register with a live ref: 200, referredBy is the sharer, one friend request to them, their join counted', async () => {
  const r = await register({ username: 'newfan', password: 'longenough1', ref: TOKEN });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { message: 'User created', referredBy: 'elsid' });
  const created = users.find(u => u.username === 'newfan');
  assert.ok(created);
  assert.deepEqual(friendCreates, [{ requester: created._id, recipient: 's1' }]);
  assert.equal(users.find(u => u._id === 's1').shareJoins, 1);
});

test('register with a bad, unknown or banned ref still signs up: 200, referredBy null, no friend request', async () => {
  const refs = ['short', 'x'.repeat(13), '<script>xx</', { $ne: null }, ['a'], 42, DEAD, BANNED];
  for (let i = 0; i < refs.length; i++) {
    const r = await register({ username: 'fan' + i, password: 'longenough1', ref: refs[i] });
    assert.equal(r.status, 200, JSON.stringify(refs[i]));
    assert.deepEqual(r.body, { message: 'User created', referredBy: null }, JSON.stringify(refs[i]));
    assert.ok(users.some(u => u.username === 'fan' + i), 'the account exists');
  }
  assert.deepEqual(friendCreates, []);
  assert.equal(users.find(u => u._id === 's2').shareJoins, undefined, 'a banned sharer gets no credit');
});

test('register without a ref: referredBy null and the referral code is never called', async () => {
  let called = 0;
  Share.creditReferral = async () => { called++; return 'x'; };
  const r = await register({ username: 'plainfan', password: 'longenough1' });
  assert.deepEqual(r.body, { message: 'User created', referredBy: null });
  assert.equal(called, 0);
});

test('a throwing creditReferral never fails sign-up', async () => {
  // The real one, with the friend write down…
  failFriend = new Error('mongo down');
  let r = await quiet(() => register({ username: 'fanA', password: 'longenough1', ref: TOKEN }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { message: 'User created', referredBy: null });
  // …with the sharer lookup down…
  failFriend = null;
  failShareLookup = new Error('timeout');
  r = await quiet(() => register({ username: 'fanB', password: 'longenough1', ref: TOKEN }));
  assert.equal(r.status, 200);
  assert.equal(r.body.referredBy, null);
  // …and a replacement that rejects outright.
  failShareLookup = null;
  Share.creditReferral = async () => { throw new Error('boom'); };
  r = await quiet(() => register({ username: 'fanC', password: 'longenough1', ref: TOKEN }));
  assert.equal(r.status, 200);
  assert.equal(r.body.referredBy, null);
  assert.ok(['fanA', 'fanB', 'fanC'].every(n => users.some(u => u.username === n)), 'every account was created');
});

test('register: a taken name is refused before any referral work', async () => {
  let called = 0;
  Share.creditReferral = async () => { called++; return null; };
  const r = await register({ username: 'ELSID', password: 'longenough1', ref: TOKEN });
  assert.equal(r.status, 400);
  assert.equal(called, 0);
});

// ── GET /s/<token> ──

const GENERIC = ShareLogic.previewText(null);
function assertShell(r) {
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.ok(r.text.includes('<div id="app"></div>'), 'the SPA shell is served');
  assert.ok(r.text.includes('<meta name="robots" content="noindex, nofollow" />'));
  assert.equal((r.text.match(/<title>/g) || []).length, 1, 'the title is replaced, not duplicated');
}
const titleOf = (html) => (html.match(/<title>([^<]*)<\/title>/) || [])[1];

test('share page for a live token: the shell with no-store and the personal preview', async () => {
  const r = await request('GET', '/s/' + TOKEN);
  assertShell(r);
  assert.equal(titleOf(r.text), "elsid&#39;s road to Avengers: Doomsday");
  assert.ok(r.text.includes(`content="3 of ${ShareLogic.DOOMSDAY_WATCHLIST.length} watched.`));
  assert.ok(r.text.includes(`/s/${TOKEN}" />`), 'og:url is the share link');
  // /map serves the same shell and preview.
  const m = await request('GET', '/s/' + TOKEN + '/map');
  assertShell(m);
  assert.equal(titleOf(m.text), titleOf(r.text));
});

test('share page for a dead or banned token: the shell with the generic preview, no name', async () => {
  for (const t of [DEAD, BANNED]) {
    const r = await request('GET', '/s/' + t);
    assertShell(r);
    assert.equal(titleOf(r.text), GENERIC.title.replace(/'/g, '&#39;'));
    assert.ok(!r.text.includes('banned1'));
  }
});

test('share page when the lookup throws: still the shell, generic preview, no-store', async () => {
  failShareLookup = new Error('mongo down');
  const r = await quiet(() => request('GET', '/s/' + TOKEN));
  assertShell(r);
  assert.equal(titleOf(r.text), GENERIC.title);
  assert.ok(!r.text.includes('elsid'));
});

test('share page when the progress read throws: personal title with a zero count, never a 500', async () => {
  failProjects = new Error('content down');
  const r = await quiet(() => request('GET', '/s/' + TOKEN));
  assertShell(r);
  assert.equal(titleOf(r.text), "elsid&#39;s road to Avengers: Doomsday");
  assert.ok(r.text.includes(`content="0 of ${ShareLogic.DOOMSDAY_WATCHLIST.length} watched.`));
});

test('share page escapes a legacy username with HTML in it', async () => {
  users[0].username = '<img src=x onerror=alert(1)>"&';
  const r = await request('GET', '/s/' + TOKEN);
  assertShell(r);
  assert.ok(!r.text.includes('<img src=x'), 'no raw tag from the name');
  assert.equal(titleOf(r.text), '&lt;img src=x onerror=alert(1)&gt;&quot;&amp;&#39;s road to Avengers: Doomsday');
});

test('share page re-reads the shell only after a build rewrites it', async () => {
  let r = await request('GET', '/s/' + DEAD);
  assert.ok(r.text.includes('<div id="app"></div>'));
  fs.writeFileSync(spaFile, '<!doctype html><html><head><title>v2</title></head><body><main id="v2"></main></body></html>');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(spaFile, later, later);
  r = await request('GET', '/s/' + DEAD);
  assert.ok(r.text.includes('<main id="v2"></main>'));
  assert.equal(r.headers['cache-control'], 'no-store');
});
