/************************************************
 * DELETE /api/admin/content/projects/:id (routes/admin.js) also removes the
 * project's island house and stay rows, after dropping its queued stay
 * credit (RT2-06), plus routes/world-socket.js dropProjectCredits itself.
 *
 * The real admin router is mounted behind a stand-in admin gate (as in
 * test/admin-users-route.test.js) with every model call it makes stubbed;
 * routes/world-socket.js is replaced in require.cache so the order of
 * "drop credit" and "delete rows" can be read. The export is then checked
 * on a fresh copy of the real module with its private maps exposed.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');

const calls = [];
const wsPath = require.resolve('../routes/world-socket');
require.cache[wsPath] = { id: wsPath, filename: wsPath, loaded: true, exports: {
  dropProjectCredits: async (id) => { calls.push('dropProjectCredits:' + id); },
  invalidateProjectGrid: () => {}
} };

const rows = { WorldHouse: [], ProjectStay: [] };
const deleter = (name) => async (f) => {
  calls.push(name + '.deleteMany');
  const before = (rows[name] || []).length;
  if (rows[name]) rows[name] = rows[name].filter(r => r.projectId !== f.projectId);
  return { deletedCount: before - (rows[name] || []).length };
};
const lean = (v) => ({ select: () => ({ lean: async () => v }), lean: async () => v });
const Project = require('../models/Project');
Project.exists = async () => true;
Project.deleteOne = async (f) => ({ deletedCount: f.id === 'gone' ? 0 : 1 });
Project.find = () => lean([]);
Project.updateMany = async () => ({});
for (const m of ['SceneIsland', 'SceneStill', 'SceneScore', 'QuoteIsland', 'QuoteLine', 'QuoteScore', 'WorldHouse', 'ProjectStay']) {
  require('../models/' + m).deleteMany = deleter(m);
}
require('../models/SceneStill').find = () => lean([]);
const audits = [];
require('../models/AuditLog').create = async (d) => { audits.push(d); return d; };

const app = express();
app.use(express.json());
app.use('/api/admin', (req, res, next) => { req.adminUser = { id: 'a1', username: 'kevin' }; next(); }, require('../routes/admin'));

let server;
test.before(() => new Promise((resolve) => { server = app.listen(0, resolve); }));
test.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));

function del(p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port: server.address().port, path: '/api/admin' + p, method: 'DELETE' }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('deleting a project removes its house and stay rows, after dropping its queued credit (RT2-06)', async () => {
  rows.WorldHouse = [{ projectId: 'foo' }, { projectId: 'bar' }];
  rows.ProjectStay = [{ projectId: 'foo', userId: 'u1' }, { projectId: 'foo', userId: 'u2' }, { projectId: 'bar', userId: 'u1' }];
  calls.length = 0; audits.length = 0;
  const r = await del('/content/projects/foo');
  assert.equal(r.status, 200);
  assert.deepEqual(rows.WorldHouse, [{ projectId: 'bar' }], 'only that project\'s house');
  assert.deepEqual(rows.ProjectStay, [{ projectId: 'bar', userId: 'u1' }], 'only that project\'s stays');
  const drop = calls.indexOf('dropProjectCredits:foo');
  assert.ok(drop >= 0, 'queued credit dropped');
  assert.ok(drop < calls.indexOf('ProjectStay.deleteMany'), 'before the stay rows go');
  await new Promise(r2 => setImmediate(r2));
  assert.deepEqual(audits[0].meta.houses, { houses: 1, stays: 2 });
});

test('an unknown project is a 404 and touches no house or stay rows', async () => {
  calls.length = 0;
  assert.equal((await del('/content/projects/gone')).status, 404);
  assert.ok(!calls.some(c => /WorldHouse|ProjectStay|dropProjectCredits/.test(c)));
});

// A fresh copy of the real routes/world-socket.js with its private maps exposed.
function freshWorldSocket() {
  const file = path.join(__dirname, '../routes/world-socket.js');
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports._t = { pendingCredits, worldPlayers };', file);
  return m.exports;
}

test('dropProjectCredits drops only that project\'s queued credit and live stays', async () => {
  const WS = freshWorldSocket();
  const { pendingCredits, worldPlayers } = WS._t;
  pendingCredits.set('u1|foo', 1000).set('u2|foo', 2000).set('u1|bar', 3000).set('u3|xfoo', 4000);
  const onFoo = { userId: 'u4', stay: { projectId: 'foo' } };
  const onBar = { userId: 'u5', stay: { projectId: 'bar' } };
  worldPlayers.set('s1', onFoo).set('s2', onBar);
  await WS.dropProjectCredits('foo');
  assert.deepEqual([...pendingCredits.keys()].sort(), ['u1|bar', 'u3|xfoo']);
  assert.equal(onFoo.stay, null, 'a live stay on the deleted island ends');
  assert.deepEqual(onBar.stay, { projectId: 'bar' });
  await WS.dropProjectCredits('');
  assert.equal(pendingCredits.size, 2, 'no id → no-op');
});
