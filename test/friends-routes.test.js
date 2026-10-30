/************************************************
 * routes/friends.js GET /pending, with Mongo stubbed.
 *
 * The real router is mounted on a throwaway express app behind a stand-in
 * JWT middleware (as in test/quote-routes.test.js). Friend.find returns
 * in-memory rows with `requester` populated from a user map, so a request
 * whose requester account is gone populates as null, like Mongoose does.
 * Covers SRV2-01: orphans are dropped from the response and deleted, the
 * real requests still come back, and the query is capped.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

let currentUser = 'b';
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: (req, res, next) => { req.user = { id: currentUser }; next(); } };

const Friend = require('../models/Friend');

const users = new Map([['a', { _id: 'a', username: 'alice' }], ['c', { _id: 'c', username: 'carol' }]]);
const rows = [];
let lastLimit = null;
let deleted = [];
Friend.find = (filter) => {
  let limit = Infinity;
  let dir = 1;
  const q = {
    sort: (s) => { dir = s && s._id === -1 ? -1 : 1; return q; },
    limit: (n) => { limit = n; lastLimit = n; return q; },
    populate: () => q,
    lean: async () => rows
      .filter(r => r.recipient === filter.recipient && r.status === filter.status)
      .sort((x, y) => (x._id < y._id ? -dir : dir))
      .slice(0, limit)
      .map(r => ({ ...r, requester: users.get(r.requester) || null }))
  };
  return q;
};
Friend.deleteMany = async (f) => {
  const ids = f._id.$in.map(String);
  deleted.push(...ids);
  for (let i = rows.length - 1; i >= 0; i--) if (ids.includes(rows[i]._id)) rows.splice(i, 1);
  return { deletedCount: ids.length };
};

const app = express();
app.use(express.json());
app.use('/api/friends', require('../routes/friends'));

let server;
test.before(() => new Promise((resolve) => { server = app.listen(0, resolve); }));
test.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
test.beforeEach(() => { rows.length = 0; deleted = []; lastLimit = null; currentUser = 'b'; });

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ port: server.address().port, path: '/api/friends' + path }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    }).on('error', reject);
  });
}

test('GET /pending drops and deletes requests whose requester no longer exists (SRV2-01)', async () => {
  rows.push(
    { _id: 'f1', requester: 'a', recipient: 'b', status: 'pending', type: 'friend' },
    { _id: 'f2', requester: 'gone', recipient: 'b', status: 'pending', type: 'friend' },
    { _id: 'f3', requester: 'c', recipient: 'b', status: 'pending', type: 'watch', projectId: 'p1' },
    { _id: 'f4', requester: 'a', recipient: 'x', status: 'pending', type: 'friend' }
  );
  const r = await get('/pending');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map(d => d._id), ['f1', 'f3']);          // oldest first, orphan gone
  assert.deepEqual(r.body.map(d => d.requester.username), ['alice', 'carol']);
  assert.deepEqual(deleted, ['f2']);
  assert.equal(rows.some(d => d._id === 'f2'), false);
  assert.equal(rows.length, 3);                                      // nobody else's rows touched
});

test('GET /pending with no orphans deletes nothing', async () => {
  rows.push({ _id: 'f1', requester: 'a', recipient: 'b', status: 'pending', type: 'friend' });
  const r = await get('/pending');
  assert.deepEqual(r.body.map(d => d._id), ['f1']);
  assert.deepEqual(deleted, []);
});

test('GET /pending is capped and keeps the newest requests', async () => {
  for (let i = 0; i < 130; i++) {
    rows.push({ _id: 'f' + String(i).padStart(3, '0'), requester: 'a', recipient: 'b', status: 'pending', type: 'friend' });
  }
  const r = await get('/pending');
  assert.equal(lastLimit, 100);
  assert.equal(r.body.length, 100);
  assert.equal(r.body[0]._id, 'f030');
  assert.equal(r.body[99]._id, 'f129');
});
