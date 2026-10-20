const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../server/socket-guard');

test('parseTrustProxy: default 1, integers 0–10, junk → 1', () => {
  assert.equal(G.parseTrustProxy(undefined), 1);
  assert.equal(G.parseTrustProxy(''), 1);
  assert.equal(G.parseTrustProxy('2'), 2);
  assert.equal(G.parseTrustProxy('0'), 0);
  assert.equal(G.parseTrustProxy('x'), 1);
  assert.equal(G.parseTrustProxy('-1'), 1);
  assert.equal(G.parseTrustProxy('99'), 1);
  assert.equal(G.parseTrustProxy('1.5'), 1);
});

test('clientIp: hop counting matches Express trust proxy', () => {
  assert.equal(G.clientIp('a, b', '9.9.9.9', 1), 'b');
  assert.equal(G.clientIp('a, b', '9.9.9.9', 2), 'a');
  assert.equal(G.clientIp('a, b', '9.9.9.9', 5), 'a');
  assert.equal(G.clientIp('', '9.9.9.9', 1), '9.9.9.9');
  assert.equal(G.clientIp(undefined, '::ffff:10.0.0.7', 1), '10.0.0.7');
  assert.equal(G.clientIp('a, b', '9.9.9.9', 0), '9.9.9.9');
  assert.equal(G.clientIp('a, b', '::ffff:9.9.9.9', undefined), 'b');
});

test('homeEjections: both directions only, other homes untouched', () => {
  const map = new Map([
    ['s1', { userId: 'A', ownerId: 'B' }],   // A inside B's home
    ['s2', { userId: 'B', ownerId: 'A' }],   // B inside A's home
    ['s3', { userId: 'A', ownerId: 'C' }],   // A inside C's home — stays
    ['s4', { userId: 'C', ownerId: 'B' }],   // C inside B's home — stays
    ['s5', null]
  ]);
  assert.deepEqual(G.homeEjections(map, 'A', 'B'), [{ sid: 's1', ownerId: 'B' }, { sid: 's2', ownerId: 'A' }]);
  assert.deepEqual(G.homeEjections(map, 'A', 'Z'), []);
  assert.deepEqual(G.homeEjections(null, 'A', 'B'), []);
});
