/************************************************
 * GET / POST /api/progress/walkers (routes/progress.js), Mongo stubbed,
 * plus the look-key rules of server/walkers.js.
 *
 * The real router is mounted on a throwaway express app behind a stand-in
 * JWT middleware (as in test/friends-routes.test.js); User.findById and
 * User.updateOne are replaced on the model (mongoose.model() registers
 * without connecting).
 * Covers MAP2-02 (a string look key is stored, junk is not) and MAP2-09b
 * (GET tells "never saved" from "cleared": `saved`).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: (req, res, next) => { req.user = { id: 'u1' }; next(); } };

const User = require('../models/user');
const { sanitizeWalkers } = require('../server/walkers');

let doc = null;          // what findById hands back
let updates = [];        // what updateOne was asked to $set
User.findById = () => {
  const q = { select: () => q, lean: async () => doc };
  return q;
};
User.updateOne = async (filter, update) => { updates.push({ filter, update }); return { acknowledged: true }; };

const app = express();
app.use(express.json());
app.use('/api/progress', require('../routes/progress'));

let server;
test.before(() => new Promise((resolve) => { server = app.listen(0, resolve); }));
test.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
test.beforeEach(() => { doc = null; updates = []; });

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({
      port: server.address().port, method, path: '/api/progress' + path,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test('sanitizeWalkers keeps a valid look key as { id, look } and rejects junk keys (MAP2-02)', () => {
  assert.deepEqual(sanitizeWalkers([{ id: 'fisk', look: 'hawkeye' }]), [{ id: 'fisk', look: 'hawkeye' }]);
  assert.deepEqual(sanitizeWalkers([{ id: 'fisk', look: '@base' }]), [{ id: 'fisk', look: '@base' }]);
  // A look wins over a stage; nothing else survives.
  assert.deepEqual(sanitizeWalkers([{ id: 'fisk', look: 'hawkeye', stage: 3, x: 1 }]), [{ id: 'fisk', look: 'hawkeye' }]);
  // Junk look → the stage rules (legacy integer kept, else -1).
  for (const look of ['', 'a'.repeat(81), 'has space', '<script>', '@@x', 'a/b', 5, null, { k: 1 }, ['x']]) {
    assert.deepEqual(sanitizeWalkers([{ id: 'fisk', look, stage: 1 }]), [{ id: 'fisk', stage: 1 }], JSON.stringify(look));
    assert.deepEqual(sanitizeWalkers([{ id: 'fisk', look }]), [{ id: 'fisk', stage: -1 }], JSON.stringify(look));
  }
  assert.deepEqual(sanitizeWalkers([{ id: 'thor', stage: 2 }, 'cap']), [{ id: 'thor', stage: 2 }, { id: 'cap', stage: -1 }]);
});

test('GET /walkers: never saved → saved: false; cleared → saved: true (MAP2-09b)', async () => {
  doc = { walkers: [] };                                     // schema default, no walkersSavedAt
  assert.deepEqual((await req('GET', '/walkers')).body, { walkers: [], saved: false });
  doc = null;                                                // no such user
  assert.deepEqual((await req('GET', '/walkers')).body, { walkers: [], saved: false });
  doc = { walkers: [], walkersSavedAt: new Date() };         // deselected all on another device
  assert.deepEqual((await req('GET', '/walkers')).body, { walkers: [], saved: true });
  // A list saved before walkersSavedAt existed is still "saved".
  doc = { walkers: [{ id: 'thor', stage: 1 }, { id: 'fisk', look: 'hawkeye', junk: 1 }] };
  assert.deepEqual((await req('GET', '/walkers')).body, { walkers: [{ id: 'thor', stage: 1 }, { id: 'fisk', look: 'hawkeye' }], saved: true });
});

test('POST /walkers stores sanitised look keys and stamps walkersSavedAt, also for an empty list', async () => {
  const before = Date.now();
  let r = await req('POST', '/walkers', { walkers: [{ id: 'fisk', look: 'hawkeye' }, { id: 'cap', look: 'bad key!' }] });
  assert.equal(r.status, 200);
  assert.equal(updates.length, 1);
  const set = updates[0].update.$set;
  assert.deepEqual(set.walkers, [{ id: 'fisk', look: 'hawkeye' }, { id: 'cap', stage: -1 }]);
  assert.ok(set.walkersSavedAt instanceof Date && set.walkersSavedAt.getTime() >= before);
  r = await req('POST', '/walkers', { walkers: [] });
  assert.equal(r.status, 200);
  assert.deepEqual(updates[1].update.$set.walkers, []);
  assert.ok(updates[1].update.$set.walkersSavedAt instanceof Date);
  r = await req('POST', '/walkers', { walkers: 'nope' });
  assert.equal(r.status, 400);
  assert.equal(updates.length, 2);
});
