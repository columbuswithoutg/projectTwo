const test = require('node:test');
const assert = require('node:assert');
const A = require('../server/admin-watch');

const known = new Map([['ironman1', {}], ['thor1', {}], ['avengers1', {}], ['endgame', {}]]);

test('adds only titles the user has not watched; already-watched ones are skipped', () => {
  const plan = A.planMarkWatched(['ironman1', 'thor1', 'endgame'], new Set(['thor1']), known);
  assert.deepStrictEqual(plan, { add: ['ironman1', 'endgame'], skip: ['thor1'] });
});

test('prerequisites and phase locks are bypassed (Endgame before anything else)', () => {
  assert.deepStrictEqual(A.planMarkWatched(['endgame'], new Set(), known), { add: ['endgame'], skip: [] });
});

test('duplicate ids in one request count once', () => {
  assert.deepStrictEqual(A.planMarkWatched(['ironman1', 'ironman1'], new Set(), known).add, ['ironman1']);
});

test('unknown project ids reject the whole request and are named', () => {
  const plan = A.planMarkWatched(['ironman1', 'nope'], new Set(), known);
  assert.strictEqual(plan.error, 'Unknown project: nope');
  assert.deepStrictEqual(plan.unknown, ['nope']);
  assert.strictEqual(plan.add, undefined);
});

test('bad payloads are rejected', () => {
  assert.ok(A.planMarkWatched(undefined, new Set(), known).error);
  assert.ok(A.planMarkWatched('ironman1', new Set(), known).error);
  assert.ok(A.planMarkWatched([], new Set(), known).error);
  assert.ok(A.planMarkWatched([{ $ne: 1 }], new Set(), known).error);
  assert.ok(A.planMarkWatched(['x'.repeat(81)], new Set(), known).error);
  assert.ok(A.planMarkWatched(new Array(A.MAX_PER_REQUEST + 1).fill('ironman1'), new Set(), known).error);
});

test('the watched-list cap is respected', () => {
  const full = new Set(Array.from({ length: A.MAX_WATCHED }, (_, i) => 'p' + i));
  assert.ok(A.planMarkWatched(['ironman1'], full, known).error);
  // Nothing new to add never trips the cap.
  const almost = new Set([...full].slice(1).concat('ironman1'));
  assert.deepStrictEqual(A.planMarkWatched(['ironman1'], almost, known), { add: [], skip: ['ironman1'] });
});

test('new entries count as one finished watch dated now', () => {
  const now = new Date(1_000_000);
  assert.deepStrictEqual(A.newEntries(['thor1'], now), [
    { projectId: 'thor1', count: 1, watchedWith: [], memories: [], lastWatchedAt: now }
  ]);
});

test('inbox note names the titles, then "and N more"', () => {
  assert.strictEqual(A.inboxText(['Iron Man']), 'An admin marked a project as watched for you: Iron Man.');
  assert.strictEqual(A.inboxText(['Iron Man', 'Thor']), 'An admin marked 2 projects as watched for you: Iron Man, Thor.');
  const many = Array.from({ length: 12 }, (_, i) => 'T' + i);
  assert.match(A.inboxText(many), /^An admin marked 12 projects as watched for you: T0, .*T9 and 2 more\.$/);
});
