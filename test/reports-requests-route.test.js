/************************************************
 * routes/reports.js — filing and withdrawing a request (kind 'request'),
 * with Mongo stubbed like test/reports-routes.test.js. Covers: the server
 * names the titles and drops ones already watched, one open request of each
 * type, a second type is fine, withdraw closes an unhandled request only.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');

const A = '65b000000000000000000001';
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: (req, res, next) => { req.user = { id: A }; next(); } };
const rulesPath = require.resolve('../server/watchRules');
const projects = new Map([['ironman1', { id: 'ironman1', title: 'Iron Man' }], ['thor', { id: 'thor', title: 'Thor' }]]);
require.cache[rulesPath] = { id: rulesPath, filename: rulesPath, loaded: true, exports: { allProjects: async () => projects } };

const Report = require('../models/Report');
const User = require('../models/user');

let reports = [];
const eq = (a, b) => String(a) === String(b);
const get = (d, k) => k.split('.').reduce((o, p) => (o == null ? o : o[p]), d);
const matches = (d, f) => Object.entries(f).every(([k, v]) => {
  if (v && typeof v === 'object' && '$gte' in v) return get(d, k) >= v.$gte;
  if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(get(d, k));
  return eq(get(d, k), v);
});
const copy = (d) => JSON.parse(JSON.stringify(d));

Report.countDocuments = async (f) => reports.filter(r => matches(r, f)).length;
Report.findOne = (f) => {
  const hit = () => reports.find(r => matches(r, f)) || null;
  const hydrate = () => {
    const row = hit();
    if (!row) return null;
    const doc = copy(row);
    doc.save = async () => { const { save, ...plain } = doc; Object.assign(row, copy(plain)); return doc; };
    return doc;
  };
  return { lean: async () => (hit() ? copy(hit()) : null), then: (a, b) => Promise.resolve().then(hydrate).then(a, b) };
};
Report.create = async (doc) => {
  const r = { _id: new mongoose.Types.ObjectId().toString(), status: 'open', replies: [], createdAt: new Date(), ...doc };
  reports.push(r);
  return copy(r);
};
User.findById = () => ({ select() { return this; }, lean: async () => ({ _id: A, username: 'bob', watchedProjects: [{ projectId: 'ironman1', count: 1 }] }) });

const app = express();
app.use(express.json());
app.use('/api/reports', require('../routes/reports'));

let server, base;
test.before(() => new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api/reports`; resolve(); }); }));
test.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
test.beforeEach(() => { reports = []; });

const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
  .then(async r => ({ status: r.status, body: await r.json() }));

test('a mark-watched request is filed with server-made title, already-watched titles dropped', async () => {
  const { status, body } = await post('/', { kind: 'request', type: 'mark-watched', projectIds: ['ironman1', 'thor'], note: 'cinema' });
  assert.equal(status, 201);
  assert.equal(body.report.kind, 'request');
  assert.equal(body.report.title, 'Mark as watched: Thor');
  assert.deepEqual(body.report.request.projectIds, ['thor']);
  assert.equal(body.report.description, 'cinema');
  assert.equal(body.report.request.resolution, null);
});

test('one open request of each type; another type still goes through', async () => {
  assert.equal((await post('/', { kind: 'request', type: 'mark-watched', projectIds: ['thor'] })).status, 201);
  const second = await post('/', { kind: 'request', type: 'mark-watched', projectIds: ['thor'] });
  assert.equal(second.status, 409);
  assert.ok(second.body.reportId);
  assert.equal((await post('/', { kind: 'request', type: 'add-title', title: 'Echo' })).status, 201);
});

test('withdraw closes an unhandled request, then a new one of that type is allowed', async () => {
  const first = await post('/', { kind: 'request', type: 'undo-watch', projectId: 'ironman1' });
  const w = await post(`/${first.body.report.id}/withdraw`);
  assert.equal(w.status, 200);
  assert.equal(w.body.report.status, 'closed');
  assert.equal((await post(`/${first.body.report.id}/withdraw`)).status, 400);
  assert.equal((await post('/', { kind: 'request', type: 'undo-watch', projectId: 'ironman1' })).status, 201);
});

test('a bug report cannot be withdrawn; an invalid request is refused with a friendly error', async () => {
  const bug = await post('/', { kind: 'bug', title: 'Broken', description: 'It broke' });
  assert.equal((await post(`/${bug.body.report.id}/withdraw`)).status, 400);
  const bad = await post('/', { kind: 'request', type: 'undo-watch', projectId: 'thor' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /isn’t on your watched list/);
});
