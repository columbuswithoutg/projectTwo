/************************************************
 * GET /api/admin/users — the ?sort=&dir= query of routes/admin.js, with the
 * Mongo calls stubbed.
 *
 * The real router is mounted on a throwaway express app behind a stand-in
 * admin gate (the real one has test/require-admin.test.js), and
 * User.aggregate / User.countDocuments are replaced on the model
 * (mongoose.model() registers without connecting). Each case reads the
 * pipeline the route built: the $sort spec per ?sort=&dir= (the allowlist —
 * anything else is today's order), $skip / $limit from ?page=&limit=, the
 * ?q= $match, and the counts coming out of the pipeline rather than JS.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const User = require('../models/user');

let pipeline = null;                   // what the route last asked Mongo for
let docs = [];                         // what the aggregate stub hands back
let total = 0;
User.aggregate = (p) => { pipeline = p; return Promise.resolve(docs); };
User.countDocuments = () => Promise.resolve(total);

const adminRouter = require('../routes/admin');

const app = express();
app.use('/api/admin', (req, res, next) => { req.adminUser = { id: 'a1', username: 'kevin' }; next(); }, adminRouter);

let server;
test.before(() => new Promise((resolve) => { server = app.listen(0, resolve); }));
test.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
test.beforeEach(() => { pipeline = null; docs = []; total = 0; });

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ port: server.address().port, path: '/api/admin' + path }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    }).on('error', reject);
  });
}

const stage = (name) => {
  const s = (pipeline || []).find((st) => Object.prototype.hasOwnProperty.call(st, name));
  assert.ok(s, `pipeline has a ${name} stage`);
  return s[name];
};

const DEFAULT = { createdAt: -1, _id: 1 };

test('no sort param → today\'s order (newest account first), page 1 of 25, no filter', async () => {
  total = 3;
  const { status, body } = await get('/users');
  assert.equal(status, 200);
  assert.deepEqual(stage('$sort'), DEFAULT);
  assert.equal(stage('$skip'), 0);
  assert.equal(stage('$limit'), 25);
  assert.deepEqual(stage('$match'), {});
  assert.deepEqual(body, { items: [], total: 3, page: 1, limit: 25, sort: 'joined', dir: 'desc' });
});

test('every allowlisted sort, both directions → the matching $sort spec, echoed back', async () => {
  const want = {
    username:   { asc: { _un: 1, createdAt: -1, _id: 1 }, desc: { _un: -1, createdAt: -1, _id: 1 } },
    lastActive: { asc: { _na: 1, lastActiveAt: 1, createdAt: -1, _id: 1 }, desc: { _na: 1, lastActiveAt: -1, createdAt: -1, _id: 1 } },
    watched:    { asc: { watchedCount: 1, createdAt: -1, _id: 1 }, desc: { watchedCount: -1, createdAt: -1, _id: 1 } },
    memories:   { asc: { memoryCount: 1, createdAt: -1, _id: 1 }, desc: { memoryCount: -1, createdAt: -1, _id: 1 } },
    joined:     { asc: { createdAt: 1, _id: 1 }, desc: { createdAt: -1, _id: 1 } }
  };
  for (const [sort, dirs] of Object.entries(want)) {
    for (const [dir, spec] of Object.entries(dirs)) {
      const { body } = await get(`/users?sort=${sort}&dir=${dir}`);
      assert.deepEqual(stage('$sort'), spec, `${sort} ${dir}`);
      // Key ORDER is the sort precedence in Mongo — check it too.
      assert.deepEqual(Object.keys(stage('$sort')), Object.keys(spec), `${sort} ${dir} key order`);
      assert.equal(body.sort, sort);
      assert.equal(body.dir, dir);
    }
  }
});

test('allowlist: an unknown sort is the default order; a bad dir on a known sort is ascending', async () => {
  for (const bad of ['password', 'createdAt', '_un', '', '%24where', 'USERNAME']) {
    const { status, body } = await get(`/users?sort=${bad}&dir=desc`);
    assert.equal(status, 200, bad);
    assert.deepEqual(stage('$sort'), DEFAULT, bad);
    assert.equal(body.sort, 'joined', bad);
    assert.equal(body.dir, 'desc', bad);
  }
  const { body } = await get('/users?sort=watched&dir=sideways');
  assert.deepEqual(stage('$sort'), { watchedCount: 1, createdAt: -1, _id: 1 });
  assert.equal(body.dir, 'asc');
  // A repeated param arrives as an array → not in the allowlist → default.
  await get('/users?sort=username&sort=watched&dir=asc');
  assert.deepEqual(stage('$sort'), DEFAULT);
});

test('search, paging and sort work together: $match → $project → $sort → $skip → $limit', async () => {
  total = 57;
  const { body } = await get('/users?q=a.b*&page=3&limit=10&sort=memories&dir=desc');
  assert.deepEqual(pipeline.map((s) => Object.keys(s)[0]), ['$match', '$project', '$sort', '$skip', '$limit']);
  assert.deepEqual(stage('$match'), { username: { $regex: 'a\\.b\\*', $options: 'i' } });
  assert.deepEqual(stage('$sort'), { memoryCount: -1, createdAt: -1, _id: 1 });
  assert.equal(stage('$skip'), 20);
  assert.equal(stage('$limit'), 10);
  assert.equal(body.total, 57);
  assert.equal(body.page, 3);
  assert.equal(body.limit, 10);
});

test('the counts and the sort helper fields are computed in the pipeline; watchedProjects never leaves Mongo', async () => {
  await get('/users?sort=lastActive&dir=asc');
  const p = stage('$project');
  assert.deepEqual(p.watchedCount, { $size: { $ifNull: ['$watchedProjects', []] } });
  assert.ok(p.memoryCount.$sum.$map, 'memoryCount sums the per-entry memories $size');
  assert.deepEqual(p.memoryCount.$sum.$map.in, { $size: { $ifNull: ['$$e.memories', []] } });
  assert.deepEqual(p._un, { $toLower: { $ifNull: ['$username', ''] } });
  assert.deepEqual(p._na, { $cond: [{ $eq: [{ $type: '$lastActiveAt' }, 'date'] }, 0, 1] });
  assert.equal('watchedProjects' in p, false);
  assert.equal('password' in p, false);
});

test('rows: the pipeline\'s counts pass through; helper fields do not', async () => {
  docs = [{
    _id: 'u1', username: 'Jacobo', isAdmin: 1, banned: 0, createdAt: '2026-10-27T14:22:54.000Z',
    watchedCount: 3, memoryCount: 7, _un: 'jacobo', _na: 1
  }];
  total = 1;
  const { body } = await get('/users');
  assert.equal(body.items.length, 1);
  const row = body.items[0];
  assert.deepEqual(row, {
    _id: 'u1', username: 'Jacobo', isAdmin: true, banned: false,
    createdAt: '2026-10-27T14:22:54.000Z', lastActiveAt: null, profilePicture: '',
    watchedCount: 3, memoryCount: 7
  });
  assert.equal('_un' in row, false);
  assert.equal('_na' in row, false);
});
