/************************************************
 * Unit tests for js/admin-users-logic.js — the sort rules behind the admin
 * Users table: the ?sort=&dir= allowlist, what a header click does, the
 * per-column keys (case-insensitive names, dates, numbers, never-active
 * last), stable deterministic ordering, and the Mongo $sort spec the route
 * uses for the same order.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/admin-users-logic.js');

const user = (over) => ({
  _id: 'id0', username: 'x', createdAt: '2026-01-01T00:00:00.000Z',
  lastActiveAt: null, watchedCount: 0, memoryCount: 0, ...over
});
const names = (list) => list.map((u) => u.username);

test('parseSort: the allowlist, the default order, a bad dir on a known sort', () => {
  assert.deepEqual(L.SORT_KEYS, ['username', 'lastActive', 'watched', 'memories', 'joined']);
  assert.deepEqual(L.parseSort(undefined, undefined), { sort: 'joined', dir: 'desc' });
  assert.deepEqual(L.parseSort('createdAt', 'asc'), { sort: 'joined', dir: 'desc' });   // unknown → the whole default
  assert.deepEqual(L.parseSort(['username'], 'asc'), { sort: 'joined', dir: 'desc' });  // a repeated query param
  assert.deepEqual(L.parseSort('username', undefined), { sort: 'username', dir: 'asc' });
  assert.deepEqual(L.parseSort('username', 'DESC'), { sort: 'username', dir: 'asc' });
  for (const k of L.SORT_KEYS) for (const d of L.DIRS) assert.deepEqual(L.parseSort(k, d), { sort: k, dir: d });
});

test('nextSort: a new column starts ascending, the same column flips, an unknown key changes nothing', () => {
  const s0 = { sort: 'joined', dir: 'desc' };
  const s1 = L.nextSort(s0, 'watched');
  assert.deepEqual(s1, { sort: 'watched', dir: 'asc' });
  const s2 = L.nextSort(s1, 'watched');
  assert.deepEqual(s2, { sort: 'watched', dir: 'desc' });
  assert.deepEqual(L.nextSort(s2, 'watched'), { sort: 'watched', dir: 'asc' });
  assert.deepEqual(L.nextSort(s2, 'actions'), s2);
  assert.deepEqual(L.nextSort({}, 'username'), { sort: 'username', dir: 'asc' });
  assert.deepEqual(L.nextSort(s0, 'joined'), { sort: 'joined', dir: 'asc' });  // the default column flips too
});

test('sortKey: lower-cased names, dates → ms, counts → numbers, missing → null / 0', () => {
  assert.equal(L.sortKey({ username: 'KevinAgain' }, 'username'), 'kevinagain');
  assert.equal(L.sortKey({}, 'username'), '');
  assert.equal(L.sortKey({ lastActiveAt: '2026-10-27T10:00:00.000Z' }, 'lastActive'), Date.parse('2026-10-27T10:00:00.000Z'));
  assert.equal(L.sortKey({ lastActiveAt: new Date(5000) }, 'lastActive'), 5000);
  assert.equal(L.sortKey({ lastActiveAt: null }, 'lastActive'), null);
  assert.equal(L.sortKey({ lastActiveAt: 'not a date' }, 'lastActive'), null);
  assert.equal(L.sortKey({}, 'lastActive'), null);
  assert.equal(L.sortKey({ createdAt: '2026-01-02T00:00:00.000Z' }, 'joined'), Date.parse('2026-01-02T00:00:00.000Z'));
  // No join date = the account predates the timestamps = oldest (-Infinity), not "no value".
  assert.equal(L.sortKey({}, 'joined'), -Infinity);
  assert.equal(L.sortKey({ createdAt: null }, 'joined'), -Infinity);
  assert.equal(L.sortKey({ watchedCount: '12' }, 'watched'), 12);
  assert.equal(L.sortKey({ watchedCount: undefined }, 'watched'), 0);
  assert.equal(L.sortKey({ memoryCount: 'x' }, 'memories'), 0);
  assert.equal(L.sortKey({ memoryCount: 4 }, 'memories'), 4);
  assert.equal(L.sortKey({ username: 'a' }, 'nope'), null);
  assert.equal(L.sortKey(null, 'username'), '');
});

test('sortUsers: Username is case-insensitive, both directions', () => {
  const list = [
    user({ _id: '1', username: 'jacobo' }), user({ _id: '2', username: 'Christian_abin' }),
    user({ _id: '3', username: 'caroln_' }), user({ _id: '4', username: 'Potpot' })
  ];
  assert.deepEqual(names(L.sortUsers(list, 'username', 'asc')), ['caroln_', 'Christian_abin', 'jacobo', 'Potpot']);
  assert.deepEqual(names(L.sortUsers(list, 'username', 'desc')), ['Potpot', 'jacobo', 'Christian_abin', 'caroln_']);
});

test('sortUsers: Last active by date, never-active users last BOTH ways', () => {
  const list = [
    user({ _id: '1', username: 'never', lastActiveAt: null }),
    user({ _id: '2', username: 'old', lastActiveAt: '2026-08-30T21:21:50.000Z' }),
    user({ _id: '3', username: 'recent', lastActiveAt: '2026-10-27T12:00:00.000Z' }),
    user({ _id: '4', username: 'missing' }),
    user({ _id: '5', username: 'mid', lastActiveAt: '2026-10-22T15:39:24.000Z' })
  ];
  delete list[3].lastActiveAt;
  assert.deepEqual(names(L.sortUsers(list, 'lastActive', 'asc')), ['old', 'mid', 'recent', 'never', 'missing']);
  assert.deepEqual(names(L.sortUsers(list, 'lastActive', 'desc')), ['recent', 'mid', 'old', 'never', 'missing']);
});

test('sortUsers: Joined by date; Watched / Memories numerically (10 after 9, not after 1)', () => {
  const j = [
    user({ _id: '1', username: 'b', createdAt: '2026-09-07T08:49:19.000Z' }),
    user({ _id: '2', username: 'a', createdAt: '2026-10-27T14:22:54.000Z' }),
    user({ _id: '3', username: 'c', createdAt: '2026-08-03T14:09:20.000Z' })
  ];
  assert.deepEqual(names(L.sortUsers(j, 'joined', 'asc')), ['c', 'b', 'a']);
  assert.deepEqual(names(L.sortUsers(j, 'joined', 'desc')), ['a', 'b', 'c']);
  // An account from before the schema had timestamps (no createdAt — the
  // owner's own account is one) is the oldest: first ascending, last
  // descending, exactly where Mongo puts a null createdAt.
  const pre = j.concat([user({ _id: '0', username: 'pre', createdAt: undefined })]);
  assert.deepEqual(names(L.sortUsers(pre, 'joined', 'asc')), ['pre', 'c', 'b', 'a']);
  assert.deepEqual(names(L.sortUsers(pre, 'joined', 'desc')), ['a', 'b', 'c', 'pre']);
  assert.deepEqual(names(L.sortUsers(pre)), ['a', 'b', 'c', 'pre']);   // default order too
  const w = [
    user({ _id: '1', username: 'ten', watchedCount: 10, memoryCount: 1 }),
    user({ _id: '2', username: 'nine', watchedCount: 9, memoryCount: 10 }),
    user({ _id: '3', username: 'one', watchedCount: 1, memoryCount: 9 }),
    user({ _id: '4', username: 'eightyfour', watchedCount: 84, memoryCount: 0 })
  ];
  assert.deepEqual(names(L.sortUsers(w, 'watched', 'asc')), ['one', 'nine', 'ten', 'eightyfour']);
  assert.deepEqual(names(L.sortUsers(w, 'watched', 'desc')), ['eightyfour', 'ten', 'nine', 'one']);
  assert.deepEqual(names(L.sortUsers(w, 'memories', 'asc')), ['eightyfour', 'ten', 'one', 'nine']);
  assert.deepEqual(names(L.sortUsers(w, 'memories', 'desc')), ['nine', 'one', 'ten', 'eightyfour']);
});

test('sortUsers: stable and deterministic — ties fall back to newest account first, then _id; input untouched', () => {
  const list = [
    user({ _id: 'b', username: 'tie1', watchedCount: 2, createdAt: '2026-01-01T00:00:00.000Z' }),
    user({ _id: 'a', username: 'tie2', watchedCount: 2, createdAt: '2026-01-01T00:00:00.000Z' }),
    user({ _id: 'c', username: 'tie3', watchedCount: 2, createdAt: '2026-03-01T00:00:00.000Z' }),
    user({ _id: 'd', username: 'less', watchedCount: 1, createdAt: '2026-12-01T00:00:00.000Z' })
  ];
  const before = JSON.stringify(list);
  const asc = names(L.sortUsers(list, 'watched', 'asc'));
  assert.deepEqual(asc, ['less', 'tie3', 'tie2', 'tie1']);
  // The same ties come out the same way whatever the input order was.
  assert.deepEqual(names(L.sortUsers(list.slice().reverse(), 'watched', 'asc')), asc);
  assert.deepEqual(names(L.sortUsers(list, 'watched', 'desc')), ['tie3', 'tie2', 'tie1', 'less']);
  assert.equal(JSON.stringify(list), before);
  // The default order itself: newest first, then _id for same-second accounts.
  assert.deepEqual(names(L.sortUsers(list)), ['less', 'tie3', 'tie2', 'tie1']);
  assert.deepEqual(L.sortUsers(null), []);
});

test('compareUsers: a plain comparator (usable with Array#sort); an unknown sort is the default order', () => {
  const a = user({ _id: '1', username: 'A', createdAt: '2026-01-01T00:00:00.000Z' });
  const b = user({ _id: '2', username: 'b', createdAt: '2026-02-01T00:00:00.000Z' });
  assert.ok(L.compareUsers(a, b, 'username', 'asc') < 0);
  assert.ok(L.compareUsers(a, b, 'username', 'desc') > 0);
  assert.ok(L.compareUsers(a, b, 'nope', 'asc') > 0);      // default: newest (b) first
  assert.equal(L.compareUsers(a, a, 'username', 'asc'), 0);
});

test('sortStage: the Mongo $sort for each key and direction — same precedence as compareUsers', () => {
  assert.deepEqual(L.sortStage(), { createdAt: -1, _id: 1 });
  assert.deepEqual(L.sortStage('bogus', 'asc'), { createdAt: -1, _id: 1 });
  assert.deepEqual(L.sortStage('joined', 'asc'), { createdAt: 1, _id: 1 });
  assert.deepEqual(L.sortStage('username', 'asc'), { _un: 1, createdAt: -1, _id: 1 });
  assert.deepEqual(L.sortStage('username', 'desc'), { _un: -1, createdAt: -1, _id: 1 });
  assert.deepEqual(L.sortStage('watched', 'desc'), { watchedCount: -1, createdAt: -1, _id: 1 });
  assert.deepEqual(L.sortStage('memories', 'asc'), { memoryCount: 1, createdAt: -1, _id: 1 });
  // Never-active users last both ways: the _na flag (0 = has a date) leads.
  assert.deepEqual(Object.entries(L.sortStage('lastActive', 'asc')), [['_na', 1], ['lastActiveAt', 1], ['createdAt', -1], ['_id', 1]]);
  assert.deepEqual(Object.entries(L.sortStage('lastActive', 'desc')), [['_na', 1], ['lastActiveAt', -1], ['createdAt', -1], ['_id', 1]]);
});

// The two orders must agree: sort a fixture in JS, then simulate Mongo's
// $sort (field by field over the projected doc: the _na flag, the
// lower-cased name, dates, numbers, the id) and check the sequences match
// for every key and direction.
test('sortUsers and sortStage order the same fixture the same way', () => {
  const fixture = [
    { _id: '0001', username: 'Zed',  createdAt: '2026-05-01T00:00:00.000Z', lastActiveAt: '2026-10-01T00:00:00.000Z', watchedCount: 3, memoryCount: 0 },
    { _id: '0002', username: 'amy',  createdAt: '2026-05-01T00:00:00.000Z', lastActiveAt: null,                       watchedCount: 3, memoryCount: 5 },
    { _id: '0003', username: 'Bob',  createdAt: '2026-07-01T00:00:00.000Z', lastActiveAt: '2026-09-01T00:00:00.000Z', watchedCount: 0, memoryCount: 5 },
    { _id: '0004', username: 'bob2', createdAt: '2026-01-01T00:00:00.000Z', lastActiveAt: '2026-10-20T00:00:00.000Z', watchedCount: 9, memoryCount: 1 },
    { _id: '0005', username: 'Carl', createdAt: '2026-07-01T00:00:00.000Z', lastActiveAt: null,                       watchedCount: 9, memoryCount: 1 },
    // A pre-timestamps account: no createdAt at all (Mongo: null sorts first asc, last desc).
    { _id: '0006', username: 'kev',  createdAt: null,                       lastActiveAt: '2026-10-27T00:00:00.000Z', watchedCount: 9, memoryCount: 5 }
  ];
  // What the route's $project stage adds to each doc.
  const projected = fixture.map((u) => ({ ...u, _un: u.username.toLowerCase(), _na: u.lastActiveAt ? 0 : 1 }));
  const bson = (v) => (v == null ? -Infinity : typeof v === 'string' && /\dT\d/.test(v) ? Date.parse(v) : v);
  const mongoSort = (spec) => projected.slice().sort((a, b) => {
    for (const [f, dir] of Object.entries(spec)) {
      const x = bson(a[f]), y = bson(b[f]);
      if (x < y) return -dir;
      if (x > y) return dir;
    }
    return 0;
  }).map((u) => u.username);
  for (const k of L.SORT_KEYS) {
    for (const d of L.DIRS) {
      assert.deepEqual(mongoSort(L.sortStage(k, d)), names(L.sortUsers(fixture, k, d)), `${k} ${d}`);
    }
  }
});
