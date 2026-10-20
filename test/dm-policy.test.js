/************************************************
 * server/dm-policy.js — the shared DM / whisper send budget.
 * No Mongo: Friend.exists and Message.countDocuments are stubbed.
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const Friend = require('../models/Friend');
const Message = require('../models/Message');
const ML = require('../js/messaging-logic');
const WC = require('../js/world-chat-logic');
const P = require('../server/dm-policy');

const { C } = ML;

test('dmDecision: floor → cooldown, budget → rate, non-friend daily cap, friends exempt', () => {
  assert.deepEqual(P.dmDecision({ budgetOk: true, floorLeft: 0, isFriend: false, sentToRecipient24h: 0 }), { ok: true });
  assert.deepEqual(P.dmDecision({ budgetOk: true, floorLeft: 300, isFriend: true, sentToRecipient24h: 0 }),
    { ok: false, error: 'cooldown', retryInMs: 300 });
  assert.deepEqual(P.dmDecision({ budgetOk: false, floorLeft: 0, isFriend: true, sentToRecipient24h: 0 }), { ok: false, error: 'rate' });
  const cap = C.NONFRIEND_DAILY_PER_RECIPIENT;
  assert.equal(cap, 20);
  assert.deepEqual(P.dmDecision({ budgetOk: true, floorLeft: 0, isFriend: false, sentToRecipient24h: cap - 1 }), { ok: true });
  assert.deepEqual(P.dmDecision({ budgetOk: true, floorLeft: 0, isFriend: false, sentToRecipient24h: cap }), { ok: false, error: 'daily-cap' });
  assert.deepEqual(P.dmDecision({ budgetOk: true, floorLeft: 0, isFriend: true, sentToRecipient24h: 500 }), { ok: true });
});

test('every new error code has user-facing copy in both logic files', () => {
  for (const code of ['rate', 'daily-cap']) {
    assert.notEqual(ML.errorText(code), ML.errorText('zzz-unknown'), 'messaging-logic: ' + code);
    assert.notEqual(WC.errorText(code), WC.errorText('zzz-unknown'), 'world-chat-logic: ' + code);
  }
});

test('check(): one budget per sender across both paths, floor, then Mongo-backed daily cap', async () => {
  P._store.clear();
  let friends = false, sent = 0;
  Friend.exists = async () => (friends ? { _id: 'f' } : null);
  Message.countDocuments = async () => sent;

  // First send at t0 passes and marks the floor; a second one 100 ms later is on the floor.
  assert.deepEqual(await P.check('A', 'B', 1000), { ok: true });
  const r2 = await P.check('A', 'B', 1100);
  assert.equal(r2.error, 'cooldown');
  assert.equal(r2.retryInMs, C.SEND_FLOOR_MS - 100);

  // Burst: sends spaced just past the floor pass DM_BURST times (plus the
  // trickle refilled meanwhile), then 'rate'.
  P._store.clear();
  let t = 10000, okCount = 0, last = null;
  for (let i = 0; i < 40 && !(last && last.error === 'rate'); i++) {
    last = await P.check('A', 'B', t);
    if (last.ok) okCount++;
    t += C.SEND_FLOOR_MS + 1;
  }
  assert.deepEqual(last, { ok: false, error: 'rate' });
  assert.ok(okCount >= C.DM_BURST && okCount <= C.DM_BURST + 4, 'burst of ' + okCount);
  // The budget is per SENDER, not per path or per recipient: a different recipient is also refused.
  assert.deepEqual(await P.check('A', 'C', t), { ok: false, error: 'rate' });
  // Another sender is untouched.
  assert.deepEqual(await P.check('Z', 'B', t), { ok: true });

  // Daily cap for a stranger; a friend with the same count is fine.
  P._store.clear();
  sent = C.NONFRIEND_DAILY_PER_RECIPIENT;
  assert.deepEqual(await P.check('A', 'B', 50000), { ok: false, error: 'daily-cap' });
  friends = true;
  assert.deepEqual(await P.check('A', 'B', 60000), { ok: true });
  P._store.clear();
});
