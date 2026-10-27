const test = require('node:test');
const assert = require('node:assert/strict');
// Requiring the script must not connect: main() only runs as the entry point.
const S = require('../scripts/seed-content');

test('parseArgs: insert-only by default, each flag opt-in', () => {
  assert.deepEqual(S.parseArgs([]), { wipe: false, yes: false, dryRun: false, overwrite: false });
  assert.deepEqual(S.parseArgs(['--wipe', '--yes', '--dry-run', '--overwrite']),
    { wipe: true, yes: true, dryRun: true, overwrite: true });
  assert.equal(S.parseArgs(['--wipe']).yes, false);
});

test('redactMongoUri: drops credentials and query, keeps scheme, hosts and db', () => {
  assert.equal(S.redactMongoUri('mongodb+srv://bob:s3cr%40t@cluster0.ab.mongodb.net/mcu-tracker?retryWrites=true'),
    'mongodb+srv://cluster0.ab.mongodb.net/mcu-tracker');
  assert.equal(S.redactMongoUri('mongodb://u:p@h1:27017,h2:27017/db?replicaSet=rs'), 'mongodb://h1:27017,h2:27017/db');
  assert.equal(S.redactMongoUri('mongodb://localhost:27017/'), 'mongodb://localhost:27017');
  assert.equal(S.redactMongoUri('mongodb://localhost'), 'mongodb://localhost');
  assert.equal(S.redactMongoUri(''), '(unparseable MONGO_URI)');
  assert.ok(!S.redactMongoUri('mongodb+srv://bob:pw@x.net/db').includes('pw'));
});

test('planUpserts: insert-only never touches existing rows', () => {
  const items = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }];
  const plan = S.planUpserts(items, ['b', 'zz']);
  assert.deepEqual(plan.insert, ['a', 'c']);
  assert.deepEqual(plan.keep, ['b']);
  assert.deepEqual(plan.overwrite, []);
  assert.equal(plan.ops.length, 3);
  for (const op of plan.ops) {
    assert.deepEqual(Object.keys(op.updateOne.update), ['$setOnInsert']);
    assert.equal(op.updateOne.upsert, true);
  }
  assert.deepEqual(plan.ops[1].updateOne, { filter: { id: 'b' }, update: { $setOnInsert: items[1] }, upsert: true });
});

test('planUpserts: --overwrite resets existing rows with $set', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  const plan = S.planUpserts(items, ['b'], { overwrite: true });
  assert.deepEqual(plan.insert, ['a']);
  assert.deepEqual(plan.overwrite, ['b']);
  assert.deepEqual(plan.keep, []);
  for (const op of plan.ops) assert.deepEqual(Object.keys(op.updateOne.update), ['$set']);
});

test('planUpserts: items without a string id are skipped, not written', () => {
  const plan = S.planUpserts([{ id: '' }, null, { title: 'x' }, { id: 7 }, { id: 'ok' }], []);
  assert.equal(plan.invalid, 4);
  assert.deepEqual(plan.insert, ['ok']);
  assert.equal(plan.ops.length, 1);
  assert.deepEqual(S.planUpserts(undefined, undefined).ops, []);
});

test('describePlan: counts and ids, "would" only on a dry run', () => {
  const plan = S.planUpserts([{ id: 'a' }, { id: 'b' }], ['b'], { overwrite: true });
  assert.equal(S.describePlan('projects', plan, true),
    '  projects: would insert 1, would overwrite 1, keep 0\n    insert: a\n    overwrite: b');
  assert.equal(S.describePlan('projects', S.planUpserts([{ id: 'b' }], ['b']), false),
    '  projects: insert 0, overwrite 0, keep 1');
});
