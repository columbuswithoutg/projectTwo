const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const P = require('../server/password');

test('passwordError: length and byte rules', () => {
  assert.equal(P.PASSWORD_MIN, 8);
  assert.equal(P.PASSWORD_MAX_BYTES, 72);
  assert.ok(P.passwordError('1234567'));                 // 7 chars
  assert.equal(P.passwordError('12345678'), null);       // 8 chars
  assert.equal(P.passwordError('a'.repeat(72)), null);   // 72 ASCII bytes
  assert.ok(P.passwordError('a'.repeat(73)));            // 73 bytes
  assert.ok(P.passwordError('é'.repeat(37)));            // 74 bytes, 37 chars
  assert.equal(P.passwordError('é'.repeat(36)), null);   // 72 bytes
  assert.ok(P.passwordError(12345678));
  assert.ok(P.passwordError(null));
  assert.ok(P.passwordError({ length: 10 }));
});

test('needsRehash: old cost needs an upgrade, current cost does not', () => {
  assert.equal(P.BCRYPT_COST, 12);
  // Fixed hashes so the test never spends bcrypt time: cost 4 and cost 12.
  const cost4 = '$2a$04$Y2/XaqpNm3P3dV9ANMp5SuxV3C2fI2BJeiTXbp8pYiUvbqdWaR7gi';
  const cost12 = '$2a$12$Y2/XaqpNm3P3dV9ANMp5SuxV3C2fI2BJeiTXbp8pYiUvbqdWaR7gi';
  assert.equal(P.needsRehash(cost4), true);
  assert.equal(P.needsRehash(cost12), false);
  assert.equal(P.needsRehash('not a hash'), false);
  assert.equal(P.needsRehash(null), false);
});

test('dummyHash: one promise, a real bcrypt hash of the right cost', async () => {
  const a = P.dummyHash();
  const b = P.dummyHash();
  assert.equal(a, b);
  const h = await a;
  assert.equal(bcrypt.getRounds(h), P.BCRYPT_COST);
  assert.equal(await bcrypt.compare('anything', h), false);
});
