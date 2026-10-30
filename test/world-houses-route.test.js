/************************************************
 * routes/world.js GET /houses and PUT /houses/:projectId keeper choice,
 * with Mongo stubbed.
 *
 * The real router is mounted on a throwaway express app behind a stand-in
 * JWT middleware (as in test/quote-routes.test.js). ProjectStay gets an
 * in-memory store whose aggregate understands the keeper pipeline ($match
 * userId $nin, $sort, $group $first) and whose findOne honours the same
 * filter and sort. Covers SRV2-02: a banned user is never the keeper, so
 * the next-longest stay keeps (and may edit) the house.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

let currentUser = null;
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: (req, res, next) => { req.user = { id: currentUser }; next(); } };

const ProjectStay = require('../models/ProjectStay');
const WorldHouse = require('../models/WorldHouse');
const User = require('../models/user');
const AdminConfig = require('../models/AdminConfig');
const watchRules = require('../server/watchRules');
const WorldSocket = require('../routes/world-socket');

const MIN = 60 * 1000;
const X = 'aaaaaaaaaaaaaaaaaaaaaaaa';   // banned, longest stay
const Y = 'bbbbbbbbbbbbbbbbbbbbbbbb';   // next-longest
const Z = 'cccccccccccccccccccccccc';   // short stay
const users = new Map([[X, { _id: X, username: 'xavier', banned: true }], [Y, { _id: Y, username: 'yara', banned: false }], [Z, { _id: Z, username: 'zed', banned: false }]]);
const stays = [];

const lean = (v) => ({ select: () => lean(v), sort: () => lean(v), lean: async () => v });
const notIn = (f, r) => !(f && f.userId && f.userId.$nin) || !f.userId.$nin.map(String).includes(String(r.userId));
const byKeeper = (a, b) => (b.ms - a.ms) || (a.updatedAt - b.updatedAt);

User.distinct = async (field, f) => [...users.values()].filter(u => !f || !f.banned || u.banned).map(u => u._id);
User.find = (f) => lean([...users.values()].filter(u => f._id.$in.map(String).includes(u._id)));
User.findById = (id) => lean(users.get(String(id)) || null);
ProjectStay.aggregate = async (pipeline) => {
  let rows = stays.slice();
  const m = pipeline.find(s => s.$match);
  if (m) rows = rows.filter(r => notIn(m.$match, r));
  rows.sort((a, b) => a.projectId.localeCompare(b.projectId) || byKeeper(a, b));
  const out = new Map();
  for (const r of rows) if (!out.has(r.projectId)) out.set(r.projectId, { _id: r.projectId, userId: r.userId, ms: r.ms });
  return [...out.values()];
};
ProjectStay.find = (f) => lean(stays.filter(r => String(r.userId) === String(f.userId)));
ProjectStay.findOne = (f) => lean(stays.filter(r => r.projectId === f.projectId && notIn(f, r)).sort(byKeeper)[0] || null);
WorldHouse.find = () => lean([]);
let saved = null;
WorldHouse.findOneAndUpdate = (f, u) => { saved = { projectId: f.projectId, ...u.$set }; return lean(saved); };
AdminConfig.findOne = () => lean(null);
watchRules.getProject = async (id) => (id === 'ironman1' ? { id } : null);
WorldSocket.flushStays = async () => {};
WorldSocket.broadcastWorld = () => {};

const app = express();
app.use(express.json());
app.use('/api/world', require('../routes/world'));

let server;
test.before(() => new Promise((resolve) => { server = app.listen(0, resolve); }));
test.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
test.beforeEach(() => {
  stays.length = 0;
  saved = null;
  stays.push(
    { userId: X, projectId: 'ironman1', ms: 600 * MIN, updatedAt: 1 },
    { userId: Y, projectId: 'ironman1', ms: 30 * MIN, updatedAt: 2 },
    { userId: Z, projectId: 'ironman1', ms: 10 * MIN, updatedAt: 3 },
    { userId: X, projectId: 'hulk', ms: 60 * MIN, updatedAt: 4 }
  );
  users.get(X).banned = true;
});

function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ port: server.address().port, method, path: '/api/world' + path, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('GET /houses skips a banned keeper: the next-longest stay keeps the island (SRV2-02)', async () => {
  currentUser = Z;
  const r = await call('GET', '/houses');
  assert.equal(r.status, 200);
  assert.equal(r.body.keepers.ironman1.userId, Y);
  assert.equal(r.body.keepers.ironman1.username, 'yara');
  assert.equal(r.body.keepers.hulk, undefined);   // only the banned user stayed there
});

test('PUT /houses: the next-longest stay may edit once the leader is banned; others still get 403 naming them', async () => {
  currentUser = Y;
  const ok = await call('PUT', '/houses/ironman1', {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.keeper.userId, Y);
  assert.equal(String(saved.editedBy), Y);

  currentUser = Z;
  const no = await call('PUT', '/houses/ironman1', {});
  assert.equal(no.status, 403);
  assert.equal(no.body.keeper.userId, Y);
});

test('PUT /houses: an unbanned leader is still the keeper', async () => {
  users.get(X).banned = false;
  currentUser = Y;
  const no = await call('PUT', '/houses/ironman1', {});
  assert.equal(no.status, 403);
  assert.equal(no.body.keeper.userId, X);
});
