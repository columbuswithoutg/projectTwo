/************************************************
 * User requests (Report kind 'request') — the shared validation in
 * js/messaging-logic.js and the server rules in server/user-requests.js:
 * what a user may file, the account writes an approval makes, and the
 * inbox note.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/messaging-logic');
const R = require('../server/user-requests');

const projects = new Map([
  ['ironman1', { id: 'ironman1', title: 'Iron Man' }],
  ['thor', { id: 'thor', title: 'Thor' }],
  ['endgame', { id: 'endgame', title: 'Avengers: Endgame' }]
]);
const titleOf = (id) => (projects.get(id) || {}).title;

test('validateRequest: each type needs its own fields', () => {
  assert.equal(L.validateRequest({ type: 'nope' }).error, 'bad-request-type');
  assert.equal(L.validateRequest({ type: 'mark-watched', projectIds: [] }).error, 'no-titles');
  assert.equal(L.validateRequest({ type: 'mark-watched', projectIds: [{ $ne: 1 }] }).error, 'bad-project');
  assert.equal(L.validateRequest({ type: 'mark-watched', projectIds: Array(201).fill('x') }).error, 'too-many-titles');
  assert.deepEqual(L.validateRequest({ type: 'mark-watched', projectIds: ['a', 'a', 'b'] }).report.request.projectIds, ['a', 'b']);
  assert.equal(L.validateRequest({ type: 'undo-watch' }).error, 'no-project');
  assert.equal(L.validateRequest({ type: 'fix-count', projectId: 'thor', count: 0 }).error, 'bad-count');
  assert.equal(L.validateRequest({ type: 'fix-count', projectId: 'thor', count: 2.5 }).error, 'bad-count');
  assert.equal(L.validateRequest({ type: 'fix-count', projectId: 'thor', count: '3' }).report.request.count, 3);
  assert.equal(L.validateRequest({ type: 'add-title', title: '  ' }).error, 'no-suggest-title');
  assert.equal(L.validateRequest({ type: 'rename', newUsername: 'a b' }).error, 'bad-username');
  assert.equal(L.validateRequest({ type: 'rename', newUsername: ' new_name ' }).report.request.newUsername, 'new_name');
  assert.equal(L.validateRequest({ type: 'delete-account', confirm: 'yes' }).error, 'no-confirm');
  assert.equal(L.validateRequest({ type: 'delete-account', confirm: true }).ok, true);
});

test('validateRequest: the note is optional and capped; the report is kind request', () => {
  const v = L.validateRequest({ type: 'add-title', title: 'Echo' });
  assert.equal(v.report.kind, 'request');
  assert.equal(v.report.description, '');
  assert.equal(L.validateRequest({ type: 'add-title', title: 'Echo', note: 'x'.repeat(2001) }).error, 'description-too-long');
  // Old clients still can't file a request through validateReport's kinds check alone.
  assert.equal(L.isKind('request'), true);
});

test('requestTitle names the titles and stays under the title cap', () => {
  assert.equal(L.requestTitle({ type: 'mark-watched', projectIds: ['ironman1', 'thor', 'endgame'] }, titleOf), 'Mark as watched: Iron Man, Thor and 1 more');
  assert.equal(L.requestTitle({ type: 'fix-count', projectId: 'thor', count: 3 }, titleOf), 'Set watch count of Thor to 3');
  assert.equal(L.requestTitle({ type: 'rename', newUsername: 'Bob' }), 'Change username to Bob');
  assert.ok(L.requestTitle({ type: 'add-title', title: 'x'.repeat(200) }).length <= L.C.TITLE_MAX);
});

test('usernameError matches the register rule', () => {
  assert.equal(L.usernameError('ab'), 'Username must be 3–30 characters');
  assert.equal(L.usernameError('bad name'), 'Username can only contain letters, numbers, _ or -');
  assert.equal(L.usernameError('good_name-1'), null);
});

const user = { _id: 'u1', username: 'bob', watchedProjects: [{ projectId: 'ironman1', count: 2 }] };
const free = async () => false;

test('checkNewRequest: mark-watched drops titles already watched; all-watched or unknown is refused', async () => {
  const ok = await R.checkNewRequest({ type: 'mark-watched', projectIds: ['ironman1', 'thor'] }, user, projects, free);
  assert.deepEqual(ok.request.projectIds, ['thor']);
  assert.equal((await R.checkNewRequest({ type: 'mark-watched', projectIds: ['ironman1'] }, user, projects, free)).ok, false);
  assert.equal((await R.checkNewRequest({ type: 'mark-watched', projectIds: ['gone'] }, user, projects, free)).ok, false);
});

test('checkNewRequest: undo / fix count need a watched title and a real change', async () => {
  assert.equal((await R.checkNewRequest({ type: 'undo-watch', projectId: 'thor' }, user, projects, free)).ok, false);
  assert.equal((await R.checkNewRequest({ type: 'undo-watch', projectId: 'ironman1' }, user, projects, free)).ok, true);
  assert.equal((await R.checkNewRequest({ type: 'fix-count', projectId: 'ironman1', count: 2 }, user, projects, free)).ok, false);
  assert.equal((await R.checkNewRequest({ type: 'fix-count', projectId: 'ironman1', count: 5 }, user, projects, free)).ok, true);
});

test('checkNewRequest: rename refuses a taken name but allows a case-only change', async () => {
  const taken = async () => true;
  assert.equal((await R.checkNewRequest({ type: 'rename', newUsername: 'alice' }, user, projects, taken)).ok, false);
  const caseOnly = await R.checkNewRequest({ type: 'rename', newUsername: 'Bob' }, user, projects, taken);
  assert.equal(caseOnly.ok, true);
  assert.equal(caseOnly.request.oldUsername, 'bob');
  assert.equal((await R.checkNewRequest({ type: 'rename', newUsername: 'bob' }, user, projects, free)).ok, false);
});

test('undoWatch pulls the entry and its timer; setCount sets the positional count', async () => {
  const calls = [];
  const User = { updateOne: async (f, u) => { calls.push([f, u]); return { modifiedCount: 1, matchedCount: 1 }; } };
  assert.equal((await R.undoWatch(User, 'u1', 'thor')).ok, true);
  assert.deepEqual(calls[0][1], { $pull: { watchedProjects: { projectId: 'thor' }, watchSessions: { projectId: 'thor' } } });
  await R.setCount(User, 'u1', 'thor', 4);
  assert.deepEqual(calls[1][1], { $set: { 'watchedProjects.$.count': 4 } });
  const none = { updateOne: async () => ({ modifiedCount: 0, matchedCount: 0 }) };
  assert.equal((await R.undoWatch(none, 'u1', 'thor')).ok, false);
  assert.equal((await R.setCount(none, 'u1', 'thor', 4)).ok, false);
});

test('rename: account first (signs them out), then co-watcher tags and reports; a lost race stops everything', async () => {
  const steps = R.renameSteps('u1', 'bob', 'robert');
  assert.deepEqual(steps.map(s => s.name), ['user', 'watched-with', 'feed-watched-with', 'reports']);
  assert.deepEqual(steps[0].update.$inc, { tokenVersion: 1 });
  assert.equal(steps[0].update.$set.usernameLower, 'robert');

  const log = [];
  const model = (name, result) => new Proxy({}, { get: (_, op) => async (f) => { log.push(`${name}.${op}`); return result(f); } });
  const ok = await R.rename({ User: model('User', () => ({ matchedCount: 1 })), FeedPost: model('FeedPost', () => ({})), Report: model('Report', () => ({})) }, 'u1', 'bob', 'robert');
  assert.equal(ok.ok, true);
  assert.deepEqual(log, ['User.updateOne', 'User.updateMany', 'FeedPost.updateMany', 'Report.updateMany']);

  log.length = 0;
  const raced = await R.rename({ User: model('User', () => ({ matchedCount: 0 })), FeedPost: model('FeedPost', () => ({})), Report: model('Report', () => ({})) }, 'u1', 'bob', 'robert');
  assert.equal(raced.ok, false);
  assert.deepEqual(log, ['User.updateOne']);

  const dupUser = { updateOne: async () => { throw Object.assign(new Error('dup'), { code: 11000 }); } };
  const dup = await R.rename({ User: dupUser, FeedPost: {}, Report: {} }, 'u1', 'bob', 'robert');
  assert.match(dup.error, /taken/);
});

test('inboxText says what changed, or why not', () => {
  const mw = { type: 'mark-watched', projectIds: ['thor', 'endgame', 'ironman1'] };
  assert.equal(R.inboxText(mw, 'approved', { titleOf, added: ['thor', 'endgame'], skipped: [] }),
    'Approved: 2 titles are now on your watched list — Thor, Avengers: Endgame. 1 wasn’t approved.');
  assert.equal(R.inboxText({ type: 'undo-watch', projectId: 'thor' }, 'approved', { titleOf }), 'Approved: Thor is off your watched list.');
  assert.equal(R.inboxText({ type: 'fix-count', projectId: 'thor', count: 1 }, 'approved', { titleOf }), 'Approved: Thor now shows 1 watch.');
  assert.equal(R.inboxText({ type: 'rename', newUsername: 'robert' }, 'rejected', { reason: 'name is reserved' }),
    'Your request “Change username to robert” wasn’t approved: name is reserved');
  assert.equal(R.inboxText({ type: 'add-title', title: 'Echo' }, 'rejected', {}), 'Your request “Add a missing title: Echo” wasn’t approved.');
});
