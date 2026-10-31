/************************************************
 * POST /api/admin/reports/:id/resolve (routes/admin.js) — the admin
 * approves or rejects a user's request. Models are stubbed behind a
 * stand-in admin gate as in test/admin-memories-route.test.js. Covers: an
 * approved mark-watched adds only the ticked titles (and only ones that
 * were asked for), sets Fixed, records the outcome, replies and tells the
 * user; a rejection sets Won't fix and changes nothing; a handled or
 * withdrawn request can't be resolved again; undo / fix count write the
 * account.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const rulesPath = require.resolve('../server/watchRules');
const projects = new Map([['ironman1', { id: 'ironman1', title: 'Iron Man' }], ['thor', { id: 'thor', title: 'Thor' }], ['hulk', { id: 'hulk', title: 'Hulk' }]]);
require.cache[rulesPath] = { id: rulesPath, filename: rulesPath, loaded: true, exports: { allProjects: async () => projects, getProject: async (id) => projects.get(id) || null } };
const msgPath = require.resolve('../server/messages');
const inbox = [];
require.cache[msgPath] = { id: msgPath, filename: msgPath, loaded: true, exports: { sendSystem: async (m) => { inbox.push(m); } } };

const User = require('../models/user');
const Report = require('../models/Report');
const AuditLog = require('../models/AuditLog');
AuditLog.create = async () => ({});

const UID = '65b000000000000000000001';
const RID = '65b0000000000000000000aa';
let report, userWrites, watched;

function reset(request, status = 'open') {
  report = { _id: RID, user: UID, username: 'bob', kind: 'request', status, title: 'T', description: '', replies: [], request };
  userWrites = [];
  watched = ['ironman1'];
  inbox.length = 0;
}

Report.findById = async () => {
  if (!report) return null;
  const doc = JSON.parse(JSON.stringify(report));
  doc.save = async () => { const { save, toObject, ...plain } = doc; report = JSON.parse(JSON.stringify(plain)); };
  doc.toObject = () => JSON.parse(JSON.stringify(doc));
  return doc;
};
User.exists = async () => ({ _id: UID });
User.findById = () => ({ select() { return this; }, lean: async () => ({ _id: UID, username: 'bob', watchedProjects: watched.map(projectId => ({ projectId })) }) });
User.findOneAndUpdate = (f, u) => ({ lean: async () => { userWrites.push(u); return { _id: UID }; } });
User.updateOne = async (f, u) => { userWrites.push(u); return { matchedCount: 1, modifiedCount: 1 }; };

const app = express();
app.use(express.json());
app.use('/api/admin', (req, res, next) => { req.adminUser = { id: 'a1', username: 'kevin' }; next(); }, require('../routes/admin'));

let server, base;
test.before(() => new Promise((resolve) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api/admin/reports/${RID}/resolve`; resolve(); }); }));
test.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));

const resolve = (body) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, body: await r.json() }));

test('approving mark-watched adds only ticked titles that were asked for', async () => {
  reset({ type: 'mark-watched', projectIds: ['thor', 'hulk'] });
  const r = await resolve({ outcome: 'approved', projectIds: ['thor', 'endgame'], text: 'Enjoy' });
  assert.equal(r.status, 200);
  assert.deepEqual(userWrites[0].$push.watchedProjects.$each.map(e => e.projectId), ['thor']);
  assert.equal(report.status, 'fixed');
  assert.equal(report.request.resolution.outcome, 'approved');
  assert.deepEqual(report.request.resolution.added, ['thor']);
  assert.match(report.replies[0].text, /Thor\. 1 wasn’t approved\.\n\nEnjoy$/);
  await new Promise(r => setImmediate(r));
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].kind, 'admin-notice');
  assert.equal(String(inbox[0].reportId), RID);
});

test('approving mark-watched the user already finished themselves still approves, saying nothing needed changing (REQ-02)', async () => {
  reset({ type: 'mark-watched', projectIds: ['ironman1'] });
  const r = await resolve({ outcome: 'approved' });
  assert.equal(r.status, 200);
  assert.equal(userWrites.length, 0);
  assert.equal(report.status, 'fixed');
  assert.equal(report.request.resolution.outcome, 'approved');
  assert.deepEqual(report.request.resolution.added, []);
  const text = 'Approved: you’d already watched the requested title, so nothing needed changing.';
  assert.equal(report.replies[0].text, text);
  await new Promise(r => setImmediate(r));
  assert.equal(inbox[0].text, text);
});

test('approving mark-watched with some already watched names both groups', async () => {
  reset({ type: 'mark-watched', projectIds: ['ironman1', 'thor'] });
  const r = await resolve({ outcome: 'approved' });
  assert.equal(r.status, 200);
  assert.deepEqual(userWrites[0].$push.watchedProjects.$each.map(e => e.projectId), ['thor']);
  assert.equal(report.replies[0].text, 'Approved: a title is now on your watched list — Thor. Already on your list: Iron Man.');
});

test('approving mark-watched with a title that no longer exists returns which one (REQ-08)', async () => {
  reset({ type: 'mark-watched', projectIds: ['thor', 'gone'] });
  const r = await resolve({ outcome: 'approved' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.unknown, ['gone']);
  assert.match(r.body.error, /gone/);
  assert.equal(userWrites.length, 0);
  assert.equal(report.status, 'open');
});

test('rejecting changes nothing on the account and sends the reason', async () => {
  reset({ type: 'mark-watched', projectIds: ['thor'] });
  const r = await resolve({ outcome: 'rejected', text: 'Please use the timer' });
  assert.equal(r.status, 200);
  assert.equal(userWrites.length, 0);
  assert.equal(report.status, 'wontfix');
  await new Promise(r => setImmediate(r));
  assert.match(inbox[0].text, /wasn’t approved: Please use the timer/);
});

test('a handled or withdrawn request cannot be resolved; bad input is refused', async () => {
  reset({ type: 'undo-watch', projectId: 'ironman1', resolution: { outcome: 'rejected' } });
  assert.equal((await resolve({ outcome: 'approved' })).status, 409);
  reset({ type: 'undo-watch', projectId: 'ironman1' }, 'closed');
  assert.equal((await resolve({ outcome: 'approved' })).status, 400);
  reset({ type: 'undo-watch', projectId: 'ironman1' });
  assert.equal((await resolve({ outcome: 'maybe' })).status, 400);
  reset({ type: 'mark-watched', projectIds: ['thor'] });
  assert.equal((await resolve({ outcome: 'approved', projectIds: [] })).status, 400);
  assert.equal(userWrites.length, 0);
});

test('undo watch and fix count write the account', async () => {
  reset({ type: 'undo-watch', projectId: 'ironman1' });
  assert.equal((await resolve({ outcome: 'approved' })).status, 200);
  assert.deepEqual(userWrites[0].$pull.watchedProjects, { projectId: 'ironman1' });
  reset({ type: 'fix-count', projectId: 'ironman1', count: 4 });
  assert.equal((await resolve({ outcome: 'approved' })).status, 200);
  assert.deepEqual(userWrites[0], { $set: { 'watchedProjects.$.count': 4 } });
  assert.equal(report.status, 'fixed');
});
