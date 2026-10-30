/************************************************
 * routes/reports.js — bug reports & suggestions, the user side, with
 * Mongo stubbed (SRV2-05).
 *
 * The real router runs on a throwaway express app behind a stand-in JWT
 * middleware (as in test/quote-routes.test.js); Report / User get a tiny
 * in-memory store (Report.findOne resolves to a doc with save(), like a
 * hydrated Mongoose doc, or .lean()s to a plain copy). Covers the owner-only
 * rule the `{ _id, user: req.user.id }` filter is the only check for: B
 * can't read or reply to A's report (404, the same answer as a missing id,
 * so ids can't be probed), /mine lists only the caller's own; plus the
 * reply rules (closed, full, validation), the admin's name never shown, and
 * filing: validation, the hourly limit, the owner taken from the token.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const mongoose = require('mongoose');

const A = '65b000000000000000000001';
const B = '65b000000000000000000002';
let currentUser = A;
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: (req, res, next) => { req.user = { id: currentUser }; next(); } };

const Report = require('../models/Report');
const User = require('../models/user');
const L = require('../js/messaging-logic');

let users = [];
let reports = [];
let saves = 0;
const eq = (a, b) => String(a) === String(b);
const matches = (d, f) => Object.entries(f).every(([k, v]) => {
  if (v && typeof v === 'object' && !(v instanceof Date) && '$gte' in v) return d[k] >= v.$gte;
  return eq(d[k], v);
});
const copy = (d) => JSON.parse(JSON.stringify(d));

Report.countDocuments = async (f) => reports.filter(r => matches(r, f)).length;
Report.find = (f) => {
  let skip = 0, limit = Infinity;
  const q = {
    sort: () => q,
    skip: (n) => { skip = n; return q; },
    limit: (n) => { limit = n; return q; },
    lean: async () => reports.filter(r => matches(r, f)).sort((x, y) => y.createdAt - x.createdAt).slice(skip, skip + limit).map(copy)
  };
  return q;
};
Report.findOne = (f) => {
  const hit = () => reports.find(r => matches(r, f)) || null;
  const hydrate = () => {
    const row = hit();
    if (!row) return null;
    const doc = copy(row);
    doc.replies = doc.replies || [];
    doc.save = async () => { saves++; const { save, ...plain } = doc; Object.assign(row, copy(plain)); return doc; };
    return doc;
  };
  return { lean: async () => (hit() ? copy(hit()) : null), then: (a, b) => Promise.resolve().then(hydrate).then(a, b) };
};
Report.create = async (doc) => {
  const r = { _id: new mongoose.Types.ObjectId().toString(), status: 'open', replies: [], createdAt: new Date(), updatedAt: new Date(), ...doc };
  reports.push(r);
  return copy(r);
};
User.findById = (id) => ({ select() { return this; }, lean: async () => { const u = users.find(x => eq(x._id, id)); return u ? { ...u } : null; } });

const app = express();
app.use(express.json());
app.use('/api/reports', require('../routes/reports'));

let server;
test.before(() => new Promise((resolve) => { server = app.listen(0, resolve); }));
test.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));

const RA = '65c00000000000000000000a';   // alice's
const RB = '65c00000000000000000000b';   // bob's
const RC = '65c00000000000000000000c';   // alice's, closed
test.beforeEach(() => {
  currentUser = A;
  saves = 0;
  users = [{ _id: A, username: 'alice' }, { _id: B, username: 'bob' }];
  const t = Date.UTC(2026, 9, 1);
  reports = [
    { _id: RA, user: A, username: 'alice', kind: 'bug', status: 'open', title: 'A bug', description: 'it broke', createdAt: new Date(t + 1000), updatedAt: new Date(t + 1000),
      replies: [{ _id: '65d000000000000000000001', author: '65e000000000000000000001', authorUsername: 'kevin', isAdmin: true, text: 'looking', createdAt: new Date(t + 2000) }] },
    { _id: RB, user: B, username: 'bob', kind: 'suggestion', status: 'open', title: "Bob's idea", description: 'private', createdAt: new Date(t + 3000), updatedAt: new Date(t + 3000), replies: [] },
    { _id: RC, user: A, username: 'alice', kind: 'bug', status: 'closed', title: 'Old bug', description: 'fixed', createdAt: new Date(t), updatedAt: new Date(t), replies: [] }
  ];
});

function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ port: server.address().port, method, path: '/api/reports' + path, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── owner-only reads ──

test('the owner reads their report; the admin reply shows as "Admin", never by name', async () => {
  const r = await call('GET', '/' + RA);
  assert.equal(r.status, 200);
  assert.equal(r.body.report.title, 'A bug');
  assert.deepEqual(r.body.report.replies.map(x => [x.from, x.isAdmin, x.text]), [['Admin', true, 'looking']]);
  assert.ok(!JSON.stringify(r.body).includes('kevin'));
  assert.ok(!('user' in r.body.report) && !('userAgent' in r.body.report), 'no owner id or user agent in the shape');
});

test("someone else's report is 404 — the same answer as a missing or malformed id", async () => {
  currentUser = B;
  const theirs = await call('GET', '/' + RA);
  const missing = await call('GET', '/65c0000000000000000000ff');
  const malformed = await call('GET', '/not-an-id');
  for (const r of [theirs, missing, malformed]) assert.deepEqual([r.status, r.body], [404, { error: 'Not found' }]);
  assert.equal((await call('GET', '/' + RB)).status, 200, 'their own is fine');
});

test('/mine lists only the caller\'s reports, newest first, paged', async () => {
  let r = await call('GET', '/mine');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map(i => i.id), [RA, RC]);
  assert.equal(r.body.total, 2);
  r = await call('GET', '/mine?limit=1&page=2');
  assert.deepEqual(r.body.items.map(i => i.id), [RC]);
  assert.deepEqual([r.body.page, r.body.limit, r.body.total], [2, 1, 2]);
  currentUser = B;
  r = await call('GET', '/mine');
  assert.deepEqual(r.body.items.map(i => i.title), ["Bob's idea"]);
});

// ── owner-only replies ──

test("replying to someone else's report is 404 and writes nothing", async () => {
  currentUser = B;
  const r = await call('POST', `/${RA}/replies`, { text: 'sneaky' });
  assert.equal(r.status, 404);
  assert.equal(saves, 0);
  assert.equal(reports.find(x => x._id === RA).replies.length, 1);
  assert.equal((await call('POST', '/bad-id/replies', { text: 'x' })).status, 404);
});

test('the owner replies on an open report: stored under their name, not as admin', async () => {
  const r = await call('POST', `/${RA}/replies`, { text: '  thanks!  ', isAdmin: true, authorUsername: 'kevin' });
  assert.equal(r.status, 200);
  const last = r.body.report.replies[r.body.report.replies.length - 1];
  assert.deepEqual([last.from, last.isAdmin, last.text], ['alice', false, 'thanks!']);
  const stored = reports.find(x => x._id === RA);
  assert.equal(stored.replies.length, 2);
  assert.equal(String(stored.replies[1].author), A);
  assert.ok(stored.lastReplyAt);
});

test('reply rules: closed thread, full thread, empty / too long', async () => {
  let r = await call('POST', `/${RC}/replies`, { text: 'reopen?' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /closed/);
  reports.find(x => x._id === RA).replies = Array.from({ length: L.C.REPLIES_MAX }, (_, i) => ({ _id: 'r' + i, isAdmin: false, authorUsername: 'alice', text: 'x' }));
  r = await call('POST', `/${RA}/replies`, { text: 'one more' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /full/);
  r = await call('POST', `/${RB}/replies`, { text: '   ' });
  assert.equal(r.status, 400, 'validation runs first (even before the owner check)');
  currentUser = B;
  r = await call('POST', `/${RB}/replies`, { text: 'x'.repeat(L.C.REPLY_MAX + 1) });
  assert.equal(r.status, 400);
  assert.equal(saves, 0);
});

// ── filing ──

test('filing: 201 owned by the token\'s user whatever the body says; validation; the hourly limit', async () => {
  let r = await call('POST', '/', { kind: 'bug', title: 'New', description: 'details', user: B, username: 'bob', status: 'closed' });
  assert.equal(r.status, 201);
  const stored = reports[reports.length - 1];
  assert.equal(String(stored.user), A);
  assert.equal(stored.username, 'alice');
  assert.equal(r.body.report.status, 'open', 'the body cannot set the status');

  r = await call('POST', '/', { kind: 'rant', title: 'x', description: 'y' });
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'kind');
  r = await call('POST', '/', { kind: 'bug', title: '', description: 'y' });
  assert.equal(r.body.field, 'title');

  for (let i = 0; i < L.C.REPORTS_PER_HOUR; i++) reports.push({ _id: 'x' + i, user: A, createdAt: new Date(), replies: [] });
  r = await call('POST', '/', { kind: 'bug', title: 'Spam', description: 'y' });
  assert.equal(r.status, 429);
  currentUser = B;
  r = await call('POST', '/', { kind: 'bug', title: 'Fine', description: 'y' });
  assert.equal(r.status, 201, "alice's limit is not bob's");
});

test('filing with a token whose account is gone is 401', async () => {
  currentUser = '65b0000000000000000000ff';
  const before = reports.length;
  const r = await call('POST', '/', { kind: 'bug', title: 'Ghost', description: 'y' });
  assert.equal(r.status, 401);
  assert.equal(reports.length, before);
});
