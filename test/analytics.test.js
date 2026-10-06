/************************************************
 * Unit tests for server/analytics.js — one signup bucket per UTC day.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const { fillDailyBuckets } = require('../server/analytics.js');

const NOW = Date.UTC(2026, 9, 6, 15, 30);   // 2026-10-06 15:30 UTC

test('fillDailyBuckets: one bucket per day, zero days included, oldest first', () => {
  const out = fillDailyBuckets([{ _id: '2026-10-04', count: 3 }, { _id: '2026-10-06', count: 1 }], 5, NOW);
  assert.deepEqual(out, [
    { _id: '2026-10-02', count: 0 },
    { _id: '2026-10-03', count: 0 },
    { _id: '2026-10-04', count: 3 },
    { _id: '2026-10-05', count: 0 },
    { _id: '2026-10-06', count: 1 }
  ]);
});

test('fillDailyBuckets: always exactly `days` buckets ending today (UTC)', () => {
  const out = fillDailyBuckets([], 30, NOW);
  assert.equal(out.length, 30);
  assert.equal(out[29]._id, '2026-10-06');
  assert.equal(out[0]._id, '2026-09-07');
  assert.ok(out.every((b) => b.count === 0));
});

test('fillDailyBuckets: ignores days outside the window and junk entries', () => {
  const out = fillDailyBuckets([{ _id: '2020-01-01', count: 9 }, null, { count: 2 }, { _id: '2026-10-06', count: '2' }], 2, NOW);
  assert.deepEqual(out, [{ _id: '2026-10-05', count: 0 }, { _id: '2026-10-06', count: 2 }]);
});

test('fillDailyBuckets: crossing a month and a year boundary', () => {
  const out = fillDailyBuckets([], 3, Date.UTC(2027, 0, 1, 0, 5));
  assert.deepEqual(out.map((b) => b._id), ['2026-12-30', '2026-12-31', '2027-01-01']);
});
