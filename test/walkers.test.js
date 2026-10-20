const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeWalkers, MAX_WALKERS } = require('../server/walkers');

test('sanitizeWalkers: strings become { id, stage: -1 }; objects keep only id + a valid stage', () => {
  assert.deepEqual(sanitizeWalkers(['ironman']), [{ id: 'ironman', stage: -1 }]);
  assert.deepEqual(sanitizeWalkers([{ id: 'thor', stage: 2 }]), [{ id: 'thor', stage: 2 }]);
  assert.deepEqual(sanitizeWalkers([{ id: 'thor', stage: -1 }]), [{ id: 'thor', stage: -1 }]);
  assert.deepEqual(sanitizeWalkers([{ id: 'thor', stage: 1.5 }]), [{ id: 'thor', stage: -1 }]);
  assert.deepEqual(sanitizeWalkers([{ id: 'thor', stage: 'x' }]), [{ id: 'thor', stage: -1 }]);
  assert.deepEqual(sanitizeWalkers([{ id: 'thor', stage: 99 }]), [{ id: 'thor', stage: -1 }]);
  assert.deepEqual(sanitizeWalkers([{ id: 'thor', stage: 0, extra: { big: 'blob' }, __proto__x: 1 }]), [{ id: 'thor', stage: 0 }]);
});

test('sanitizeWalkers: drops junk, caps the list', () => {
  assert.deepEqual(sanitizeWalkers(null), []);
  assert.deepEqual(sanitizeWalkers('ironman'), []);
  assert.deepEqual(sanitizeWalkers([null, 42, {}, { id: 5 }, { id: '' }, { id: 'a'.repeat(81) }, '']), []);
  assert.deepEqual(sanitizeWalkers(['a'.repeat(80)]), [{ id: 'a'.repeat(80), stage: -1 }]);
  const many = Array.from({ length: MAX_WALKERS + 25 }, (_, i) => 'w' + i);
  assert.equal(sanitizeWalkers(many).length, MAX_WALKERS);
});
