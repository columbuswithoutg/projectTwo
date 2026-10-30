/************************************************
 * GET /api/admin/memories and /analytics/overview (routes/admin.js) run
 * their every-memory aggregations with allowDiskUse (RT2-09): the Memories
 * page re-sorts every memory on the site, and past ~100 MB of $group/$sort
 * state Mongo fails the query without it.
 *
 * User.aggregate / countDocuments are stubbed on the model, behind a
 * stand-in admin gate as in test/admin-users-route.test.js.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const User = require('../models/user');

const seen = [];
User.aggregate = (pipeline, options) => { seen.push({ pipeline, options }); return Promise.resolve([]); };
User.countDocuments = () => Promise.resolve(0);

const app = express();
app.use('/api/admin', (req, res, next) => { req.adminUser = { id: 'a1', username: 'kevin' }; next(); }, require('../routes/admin'));

let server;
test.before(() => new Promise((resolve) => { server = app.listen(0, resolve); }));
test.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));

function get(p) {
  return new Promise((resolve, reject) => {
    http.get({ port: server.address().port, path: '/api/admin' + p }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    }).on('error', reject);
  });
}

test('the Memories feed aggregation may spill to disk (RT2-09)', async () => {
  seen.length = 0;
  const r = await get('/memories?page=2');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { items: [], total: 0, page: 2, limit: r.body.limit });
  assert.equal(seen.length, 1);
  assert.ok(seen[0].pipeline.some(s => s.$facet), 'the paged feed pipeline');
  assert.deepEqual(seen[0].options, { allowDiskUse: true });
});

test('the overview memory count may spill to disk too', async () => {
  seen.length = 0;
  const r = await get('/analytics/overview');
  assert.equal(r.status, 200);
  assert.equal(r.body.memories, 0);
  assert.deepEqual(seen[0].options, { allowDiskUse: true });
});
