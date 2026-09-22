/************************************************
 * Unit tests for js/world-stay-logic.js — island stay credit with the
 * one-minute AFK pause, keeper resolution and the HUD formatter.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/world-stay-logic.js');

const MIN = 60 * 1000;

test('continuous activity credits the whole stay', () => {
  const stay = S.enter('ironman1', 0);
  for (let t = 100; t <= 10 * MIN; t += 100) S.touch(stay, t);
  assert.equal(S.drain(stay, 10 * MIN), 10 * MIN);
  assert.equal(stay.pendingMs, 0);
});

test('idle player is credited exactly the AFK limit, then nothing', () => {
  const stay = S.enter('ironman1', 0);
  let total = 0;
  for (let t = MIN; t <= 5 * MIN; t += MIN) total += S.drain(stay, t);   // 1-min flushes
  assert.equal(total, S.C.AFK_LIMIT_MS);
  assert.equal(S.drain(stay, 30 * MIN), 0);
});

test('an action after a long gap credits the limit and resumes from the action', () => {
  const stay = S.enter('ironman1', 0);
  S.touch(stay, 5 * MIN);                       // silent for 5 min
  assert.equal(stay.pendingMs, S.C.AFK_LIMIT_MS);
  S.touch(stay, 5 * MIN + 30 * 1000);           // active again 30 s later
  assert.equal(S.drain(stay, 5 * MIN + 30 * 1000), S.C.AFK_LIMIT_MS + 30 * 1000);
});

test('standing still but chatting every 50 s keeps counting in full', () => {
  const stay = S.enter('ironman1', 0);
  for (let t = 50 * 1000; t <= 10 * MIN; t += 50 * 1000) S.touch(stay, t);
  assert.equal(S.drain(stay, 10 * MIN), 10 * MIN);
});

test('a flush inside a gap never double-credits', () => {
  const stay = S.enter('ironman1', 0);
  const a = S.drain(stay, 20 * 1000);           // flush mid-gap
  S.touch(stay, 40 * 1000);                     // action at 40 s
  const b = S.drain(stay, 40 * 1000);
  assert.equal(a + b, 40 * 1000);
});

test('enter starts at zero; drain zeroes the buffer', () => {
  const stay = S.enter('hulk', 1000);
  assert.equal(stay.pendingMs, 0);
  assert.equal(S.drain(stay, 1000), 0);
  S.touch(stay, 2000);
  assert.equal(S.drain(stay, 2000), 1000);
  assert.equal(stay.pendingMs, 0);
});

test('keeperOf: highest total wins, ties go to the earlier updatedAt, empty is null', () => {
  const rows = [
    { userId: 'a', ms: 5000, updatedAt: new Date('2026-09-01T00:00:00Z') },
    { userId: 'b', ms: 9000, updatedAt: new Date('2026-09-02T00:00:00Z') },
    { userId: 'c', ms: 9000, updatedAt: new Date('2026-09-01T12:00:00Z') }
  ];
  assert.equal(S.keeperOf(rows).userId, 'c');
  assert.equal(S.keeperOf([rows[0]]).userId, 'a');
  assert.equal(S.keeperOf([]), null);
  assert.equal(S.keeperOf(null), null);
});

test('formatStay', () => {
  assert.equal(S.formatStay(0), '<1m');
  assert.equal(S.formatStay(59 * 1000), '<1m');
  assert.equal(S.formatStay(45 * MIN), '45m');
  assert.equal(S.formatStay(3 * 60 * MIN + 12 * MIN), '3h 12m');
});
