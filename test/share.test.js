/************************************************
 * Doomsday story share — js/share-logic.js (the rules both sides use),
 * server/share.js (link preview + sign-up referral) and routes/share.js
 * (the owner's link + the public data), with Mongo stubbed on the models
 * the same way test/quote-routes.test.js does it.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');

const ShareLogic = require('../js/share-logic');
const Router = require('../js/router');

// ── stubs ──
let currentUser = 'u1';
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: (req, res, next) => { req.user = { id: currentUser }; next(); } };

const watchRules = require('../server/watchRules');
const ALL = new Map(ShareLogic.DOOMSDAY_WATCHLIST.map(id => [id, { id, title: id }]));
ALL.delete('fantasticfour');                    // a title the live content lacks
watchRules.allProjects = async () => ALL;

const User = require('../models/user');
const Friend = require('../models/Friend');
let users = [];                                  // the fake collection
let friendCreates = [];
let updates = [];
const lean = (v) => ({ select() { return this; }, lean: async () => (v ? JSON.parse(JSON.stringify(v)) : null) });
const matches = (u, f) => Object.entries(f).every(([k, v]) => {
  if (k === 'banned') return !u.banned;
  if (v && typeof v === 'object' && '$exists' in v) return (u[k] !== undefined) === v.$exists;
  return String(u[k]) === String(v);
});
User.findOne = (f) => lean(users.find(u => matches(u, f)) || null);
User.findById = (id) => lean(users.find(u => String(u._id) === String(id)) || null);
User.updateOne = async (f, upd) => {
  updates.push({ f, upd });
  const u = users.find(x => matches(x, f));
  if (!u) return { matchedCount: 0 };
  if (upd.$set) Object.assign(u, upd.$set);
  if (upd.$unset) for (const k of Object.keys(upd.$unset)) delete u[k];
  if (upd.$inc) for (const [k, n] of Object.entries(upd.$inc)) u[k] = (u[k] || 0) + n;
  return { matchedCount: 1 };
};
Friend.create = async (doc) => { friendCreates.push(doc); return doc; };

const Share = require('../server/share');
const shareRouter = require('../routes/share');

const app = express();
app.use(express.json());
app.use('/api/share', shareRouter);
let server;
test.before(() => new Promise((resolve) => { server = app.listen(0, resolve); }));
test.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
test.beforeEach(() => {
  currentUser = 'u1';
  friendCreates = [];
  updates = [];
  users = [
    { _id: 'u1', username: 'kevin', profilePicture: 'assets/characters/thor.jpg', password: 'HASH', isAdmin: true,
      watchedProjects: [{ projectId: 'cap1', memories: [{ url: 'x' }] }, { projectId: 'endgame' }, { projectId: 'wandavision' }] },
    { _id: 'u2', username: 'elsid', shareToken: 'abcDEF123_-x', shareJoins: 2, watchedProjects: [{ projectId: 'loki1' }] },
    { _id: 'u3', username: 'banned1', shareToken: 'BANNED123456', banned: true, watchedProjects: [] }
  ];
});

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ port: server.address().port, path: '/api/share' + path, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: out ? JSON.parse(out) : null }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// ── ShareLogic ──

test('newToken: 12 URL-safe characters that isToken accepts, different every time', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const t = ShareLogic.newToken(crypto.randomBytes);
    assert.equal(t.length, ShareLogic.TOKEN_LEN);
    assert.ok(ShareLogic.isToken(t), t);
    seen.add(t);
  }
  assert.equal(seen.size, 200);
  assert.equal(ShareLogic.newToken(() => new Uint8Array(9).fill(255)), '____________');
});

test('isToken: refuses anything but exactly 12 safe characters', () => {
  for (const bad of [null, undefined, 42, '', 'short', 'abcDEF123_-xy', 'abcDEF123_-/', '../etc/passw', { $ne: null }]) {
    assert.equal(ShareLogic.isToken(bad), false, String(bad));
  }
});

test('doomsdayProgress: ticks Marvel\'s list in order and skips titles the content lacks', () => {
  const p = ShareLogic.doomsdayProgress(['cap1', 'endgame', 'wandavision'], id => ALL.has(id));
  assert.equal(p.total, ShareLogic.DOOMSDAY_WATCHLIST.length - 1);
  assert.equal(p.met, 2);
  assert.equal(p.items[0].id, 'xmen1');
  assert.equal(p.items[0].watched, false);
  assert.equal(p.items.some(i => i.id === 'fantasticfour'), false);
  assert.equal(ShareLogic.doomsdayProgress(new Set()).total, ShareLogic.DOOMSDAY_WATCHLIST.length);
});

test('daysUntil + countdownText: whole local days, then out today / tomorrow / now in theaters', () => {
  const now = new Date(2026, 9, 30, 22, 15);          // 30 Oct 2026, late evening
  assert.equal(ShareLogic.daysUntil('2026-12-18', now), 49);
  assert.equal(ShareLogic.daysUntil('2026-10-31', now), 1);
  assert.equal(ShareLogic.daysUntil('2026-10-30', now), 0);
  assert.equal(ShareLogic.daysUntil('2026-10-01', now), -29);
  assert.equal(ShareLogic.daysUntil('soon', now), null);
  assert.equal(ShareLogic.countdownText(49, 'Doomsday'), '49 days until Doomsday');
  assert.equal(ShareLogic.countdownText(1, 'Doomsday'), 'Doomsday is out tomorrow');
  assert.equal(ShareLogic.countdownText(0, 'Doomsday'), 'Doomsday is out today');
  assert.equal(ShareLogic.countdownText(-3, 'Doomsday'), 'Doomsday is now in theaters');
  assert.equal(ShareLogic.countdownText(null, 'Doomsday'), '');
});

test('refFromStorage: a fresh saved token only', () => {
  const now = 1_800_000_000_000;
  const good = JSON.stringify({ token: 'abcDEF123_-x', at: now - 1000 });
  assert.equal(ShareLogic.refFromStorage(good, now), 'abcDEF123_-x');
  assert.equal(ShareLogic.refFromStorage({ token: 'abcDEF123_-x', at: now - ShareLogic.REF_TTL_MS - 1 }, now), null);
  assert.equal(ShareLogic.refFromStorage({ token: 'nope', at: now }, now), null);
  assert.equal(ShareLogic.refFromStorage('{broken', now), null);
  assert.equal(ShareLogic.refFromStorage(null, now), null);
});

test('router: /s/<token> pages are public, everything else still needs a login', () => {
  const { isPublic } = Router._debug;
  assert.equal(isPublic('/s/abcDEF123_-x'), true);
  assert.equal(isPublic('/s/abcDEF123_-x/map'), true);
  assert.equal(isPublic('/login'), true);
  for (const p of ['/', '/profile', '/friend/kevin', '/admin', '/sx', '/settings']) assert.equal(isPublic(p), false, p);
});

// ── server/share.js ──

test('injectMeta: replaces the title, adds escaped OG tags and noindex', () => {
  const shell = '<html><head>\n  <title>MCU Tracker</title>\n</head><body></body></html>';
  const out = Share.injectMeta(shell, {
    title: 'kev"<in>\'s road', description: '2 of 13 watched', url: 'https://x.test/s/abcDEF123_-x', image: 'https://x.test/a.jpg'
  });
  assert.ok(!out.includes('<title>MCU Tracker</title>'));
  assert.ok(out.includes('<title>kev&quot;&lt;in&gt;&#39;s road</title>'));
  assert.ok(out.includes('<meta property="og:title" content="kev&quot;&lt;in&gt;&#39;s road" />'));
  assert.ok(out.includes('<meta property="og:image" content="https://x.test/a.jpg" />'));
  assert.ok(out.includes('<meta name="robots" content="noindex, nofollow" />'));
  assert.ok(!/<in>/.test(out));
  // `$&` in user text must not be read as a replacement pattern.
  assert.ok(Share.injectMeta(shell, { title: '$&', description: '', url: '', image: '' }).includes('<title>$&amp;</title>'));
});

test('previewText: personal copy for a live share, generic for a dead link', () => {
  assert.deepEqual(ShareLogic.previewText({ username: 'elsid' }, { met: 1, total: 13 }), {
    title: "elsid's road to Avengers: Doomsday",
    description: '1 of 13 watched. See their watch order and start your own.'
  });
  assert.match(ShareLogic.previewText(null).title, /road to Avengers: Doomsday/);
});

test('creditReferral: the new account asks the sharer to be friends and the join count goes up', async () => {
  assert.equal(await Share.creditReferral('new1', 'abcDEF123_-x'), 'elsid');
  assert.deepEqual(friendCreates, [{ requester: 'new1', recipient: 'u2' }]);
  assert.equal(users.find(u => u._id === 'u2').shareJoins, 3);
});

test('creditReferral: dead, banned, malformed or own token → nothing happens', async () => {
  for (const t of ['ZZZZZZZZZZZZ', 'BANNED123456', { $ne: null }, 'bad']) {
    assert.equal(await Share.creditReferral('new1', t), null);
  }
  assert.equal(await Share.creditReferral('u2', 'abcDEF123_-x'), null);
  assert.equal(friendCreates.length, 0);
  assert.equal(users.find(u => u._id === 'u2').shareJoins, 2);
});

test('doomsdayFor: counts against the live content', async () => {
  assert.deepEqual(await Share.doomsdayFor(users[0]), { met: 2, total: ALL.size });
});

// ── routes/share.js ──

test('GET /public/:token: username, picture and watched ids only, never cached', async () => {
  users[0].shareToken = 'kevTOKEN1234';
  const r = await req('GET', '/public/kevTOKEN1234');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    username: 'kevin', profilePicture: 'assets/characters/thor.jpg', watched: ['cap1', 'endgame', 'wandavision']
  });
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('GET /public/:token: unknown, banned and malformed tokens are one 404', async () => {
  for (const t of ['ZZZZZZZZZZZZ', 'BANNED123456', 'x', '%24ne']) {
    const r = await req('GET', '/public/' + t);
    assert.equal(r.status, 404, t);
    assert.equal(r.body.error, 'This link is no longer shared');
  }
});

test('POST /me mints one token and keeps it; DELETE /me turns it off; GET /me reports both', async () => {
  let r = await req('GET', '/me');
  assert.deepEqual(r.body, { enabled: false, token: null, joins: 0 });
  r = await req('POST', '/me');
  assert.equal(r.body.enabled, true);
  assert.ok(ShareLogic.isToken(r.body.token));
  const first = r.body.token;
  r = await req('POST', '/me');
  assert.equal(r.body.token, first, 'sharing again reuses the live link');
  assert.equal((await req('GET', '/public/' + first)).status, 200);
  r = await req('DELETE', '/me');
  assert.deepEqual(r.body, { enabled: false, token: null, joins: 0 });
  assert.equal((await req('GET', '/public/' + first)).status, 404, 'old stories go dead');
  r = await req('POST', '/me');
  assert.notEqual(r.body.token, first, 'turning it back on makes a new link');
});

test('GET /me: joins come back for the owner', async () => {
  currentUser = 'u2';
  assert.deepEqual((await req('GET', '/me')).body, { enabled: true, token: 'abcDEF123_-x', joins: 2 });
});
