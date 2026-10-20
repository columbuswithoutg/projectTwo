const test = require('node:test');
const assert = require('node:assert/strict');
const RateStore = require('../server/rate-store');

const RATES = { chat: { cap: 2, perSec: 1 }, slow: { cap: 3, perSec: 0.1 } };

test('same key keeps its limit across "reconnects"; other keys are independent', () => {
  const s = new RateStore({ rates: RATES });
  assert.equal(s.allow('u1', 'chat', 1000), true);
  assert.equal(s.allow('u1', 'chat', 1000), true);
  assert.equal(s.allow('u1', 'chat', 1000), false);     // burst spent
  // A "new socket" for the same user asks again — still limited.
  assert.equal(s.allow('u1', 'chat', 1001), false);
  assert.equal(s.allow('u2', 'chat', 1001), true);      // someone else is fine
  assert.equal(s.allow('u1', 'chat', 2100), true);      // refilled one token after ~1 s
  assert.equal(s.allow('u1', 'nope', 1), true);         // unknown names unlimited
});

test('floorLeft / mark arithmetic, clamped to the floor length', () => {
  const s = new RateStore({ rates: RATES, floorMaxMs: 10000 });
  assert.equal(s.floorLeft('u', 'world', 10000, 5000), 0);           // never marked
  s.mark('u', 'world', 5000);
  assert.equal(s.floorLeft('u', 'world', 10000, 5000), 10000);
  assert.equal(s.floorLeft('u', 'world', 10000, 9000), 6000);
  assert.equal(s.floorLeft('u', 'world', 10000, 15000), 0);
  assert.equal(s.floorLeft('u', 'world', 10000, 4000), 10000);       // clock went backwards: never more than the floor
  assert.equal(s.floorLeft('u', 'other', 10000, 5000), 0);           // other floors untouched
});

test('idleMs covers the slowest refill and the longest floor', () => {
  const s = new RateStore({ rates: RATES, floorMaxMs: 10000 });
  assert.equal(s.idleMs, 30000);                                      // slow: 3 / 0.1 = 30 s
  const t = new RateStore({ rates: { x: { cap: 1, perSec: 1 } }, floorMaxMs: 60000 });
  assert.equal(t.idleMs, 60000);
});

test('sweep drops only idle entries, and a recreated entry allows exactly what the old one would', () => {
  const s = new RateStore({ rates: RATES });
  for (let i = 0; i < 3; i++) s.allow('busy', 'slow', 0);           // spent at t=0
  s.allow('idle', 'slow', 0);
  s.allow('busy', 'slow', 29000);                                     // touched again (and refused: 2.9 tokens refilled → allowed actually)
  s.sweep(30000);
  assert.equal(s.entries.has('idle'), false);
  assert.equal(s.entries.has('busy'), true);
  // After a full idle period a fresh entry gives the full burst — same as a kept one would.
  assert.equal(s.allow('idle', 'slow', 30000), true);
  assert.equal(s.allow('idle', 'slow', 30000), true);
  assert.equal(s.allow('idle', 'slow', 30000), true);
  assert.equal(s.allow('idle', 'slow', 30000), false);
});

test('maxKeys is a hard cap with LRU eviction; a touched key survives', () => {
  const s = new RateStore({ rates: RATES, maxKeys: 3 });
  s.allow('a', 'chat', 1); s.allow('b', 'chat', 2); s.allow('c', 'chat', 3);
  s.allow('a', 'chat', 4);                                            // a is now most recent
  s.allow('d', 'chat', 5);                                            // evicts b
  assert.equal(s.size, 3);
  assert.deepEqual([...s.entries.keys()], ['c', 'a', 'd']);
});

test('a NaN or backwards clock never mints tokens', () => {
  const s = new RateStore({ rates: RATES });
  assert.equal(s.allow('u', 'chat', 1000), true);
  assert.equal(s.allow('u', 'chat', 1000), true);
  assert.equal(s.allow('u', 'chat', NaN), false);
  assert.equal(s.allow('u', 'chat', 500), false);
  assert.equal(s.allow('u', 'chat', 1000), false);
});
