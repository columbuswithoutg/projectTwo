/************************************************
 * Unit tests for js/world-net-logic.js — the packet shapes and guards the
 * /world + /home socket layer (routes/world-socket.js) runs on.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../js/world-net-logic.js');

// ── Movement flags (removed, NET2-05) ──

test('the unused mv movement flags are gone from the protocol', () => {
  for (const k of ['MV', 'MV_MAX', 'packMove', 'unpackMove', 'sanitizeMove', 'isLoopingEmote']) {
    assert.equal(N[k], undefined, k + ' removed');
  }
  // An old client's mv is dropped, never relayed.
  assert.ok(!('mv' in N.sanitizePos({ x: 0, z: 0, mv: 31 })));
});

// ── Position packets ──

test('sanitizePos: terminates and wraps a huge yaw (the freeze exploit)', () => {
  for (const yaw of [1e300, -1e300, 1e20, Number.MAX_VALUE]) {
    const s = N.sanitizePos({ x: 0, z: 0, yaw });
    assert.ok(s, 'still accepted');
    assert.ok(s.yaw > -Math.PI - 1e-3 && s.yaw <= Math.PI + 1e-3, `yaw ${s.yaw} wrapped`);
  }
  assert.equal(N.sanitizePos({ x: 0, z: 0, yaw: NaN }).yaw, 0);
  assert.equal(N.sanitizePos({ x: 0, z: 0, yaw: 'x' }).yaw, 0);
  assert.equal(N.sanitizePos({ x: 0, z: 0 }).yaw, 0);
});

test('sanitizePos: rejects bad x/z, clamps y, whitelists pose and booleans', () => {
  assert.equal(N.sanitizePos(null), null);
  assert.equal(N.sanitizePos({ x: 'a', z: 0 }), null);
  assert.equal(N.sanitizePos({ x: NaN, z: 0 }), null);
  assert.equal(N.sanitizePos({ x: 0, z: 1001 }), null);
  const s = N.sanitizePos({ x: 1, z: 2, y: 999, walking: 'yes', backward: true, pose: { toString: 1 } });
  assert.equal(s.y, 10);
  assert.equal(s.walking, false, 'only a real true counts');
  assert.equal(s.backward, false);
  assert.equal(s.pose, null);
  assert.equal(N.sanitizePos({ x: 0, z: 0, y: -50 }).y, -2);
  assert.equal(N.sanitizePos({ x: 0, z: 0, pose: 'lie' }).pose, 'lie');
  assert.deepEqual(Object.keys(N.sanitizePos({ x: 0, z: 0 })).sort(),
    ['backward', 'pose', 'walking', 'x', 'y', 'yaw', 'z']);
});

test('joinPos: defaults missing / out-of-range fields and wraps yaw', () => {
  assert.deepEqual(N.joinPos(undefined), { x: 0, z: 0, yaw: 0 });
  assert.deepEqual(N.joinPos({ x: 5, z: -5000, yaw: 4 * Math.PI + 0.5 }), { x: 5, z: 0, yaw: 0.5 });
});

// ── Emotes ──

test('isEmoteKind: the wave only (the one emote the client sends and plays), no prototype keys', () => {
  assert.deepEqual([...N.EMOTES], ['wave']);
  assert.ok(N.isEmoteKind('wave'));
  for (const k of ['__proto__', 'constructor', 'toString', 'stop', 'dance', 'cheer', 'lie', '', 'WAVE', 1, null, {}]) {
    assert.equal(N.isEmoteKind(k), false, String(k));
  }
});

// ── Public player record ──

test('publicPlayer: exactly the public keys, never the private ones', () => {
  const rec = {
    socketId: 's1', userId: 'u1', username: 'tony', character: { skin: 1 }, x: 1, y: 0, z: 2, yaw: 0.5,
    walking: true, backward: false, pose: null, mv: 4, emote: 'dance',   // stale fields: not broadcast
    lastChat: 5, lastAnyChat: 6, stay: { projectId: 'p' }, lastPunch: 7, lastSnap: 8, projectId: 'p', downAt: 9
  };
  const out = N.publicPlayer(rec);
  assert.deepEqual(Object.keys(out).sort(), [...N.PUBLIC_KEYS].sort());
  for (const k of ['userId', 'lastChat', 'lastAnyChat', 'stay', 'lastPunch', 'lastSnap', 'projectId', 'downAt']) {
    assert.ok(!(k in out), `${k} must not be broadcast`);
  }
  assert.ok(!('mv' in out) && !('emote' in out), 'no movement flags or looping emote in the snapshot');
  assert.equal(N.publicPlayer({ socketId: 's2' }).pose, null);
});

// ── Token buckets ──

test('token bucket: burst, then refill at the steady rate, capped', () => {
  const b = N.bucket(3, 0.5, 0);
  assert.ok(N.take(b, 0) && N.take(b, 0) && N.take(b, 0), 'burst of 3');
  assert.equal(N.take(b, 0), false, 'empty');
  assert.equal(N.take(b, 1000), false, 'half a token after 1 s');
  assert.equal(N.take(b, 2000), true, 'one token after 2 s');
  N.take(b, 1e9);                         // long idle: refill caps at the burst size
  assert.ok(b.tokens <= 3);
});

test('token bucket: a clock going backwards or NaN never mints tokens', () => {
  const b = N.bucket(1, 1, 10000);
  assert.ok(N.take(b, 10000));
  assert.equal(N.take(b, 5000), false, 'earlier time');
  assert.equal(N.take(b, NaN), false, 'NaN time');
  assert.ok(N.take(b, 11000), 'real time moving on refills');
});

test('allow: per-key buckets from RATES; unknown keys are unlimited', () => {
  const store = {};
  let n = 0;
  for (let i = 0; i < 20; i++) if (N.allow(store, 'announce', 0)) n++;
  assert.equal(n, N.RATES.announce.cap, '20 announces in one instant → the burst only');
  assert.ok(N.allow(store, 'emote', 0), 'separate bucket per key');
  assert.ok(N.allow(store, 'no-such-limit', 0));
});

test('Scene Guess events each have a bucket (an unknown key would be unlimited)', () => {
  for (const key of ['sgStart', 'sgJoin', 'sgGuess', 'sgMisc', 'qgStart', 'qgJoin', 'qgAnswer', 'qgMisc']) {
    assert.ok(N.RATES[key], key);
    const store = {};
    let n = 0;
    for (let i = 0; i < 50; i++) if (N.allow(store, key, 0)) n++;
    assert.equal(n, N.RATES[key].cap, `${key}: burst only`);
  }
  assert.ok(N.RATES.sgStart.perSec <= 0.1, 'starting a lobby is the tightest');
  assert.ok(N.RATES.qgStart.perSec <= 0.1, 'for either game');
});

test('join buckets: roomy enough for reloads / reconnects, refillMs says when to retry', () => {
  for (const key of ['join', 'homeJoin']) {
    assert.ok(N.RATES[key].cap >= 8, `${key}: burst covers a run of reloads`);
    assert.ok(N.RATES[key].perSec >= 0.5, `${key}: refills within seconds`);
    const store = {};
    for (let i = 0; i < N.RATES[key].cap; i++) assert.ok(N.allow(store, key, 0));
    assert.equal(N.allow(store, key, 0), false, `${key}: refused once spent`);
    const wait = N.refillMs(key);
    assert.equal(wait, Math.ceil(1000 / N.RATES[key].perSec));
    assert.equal(N.allow(store, key, wait - 1), false, `${key}: not yet`);
    assert.ok(N.allow(store, key, wait), `${key}: a retry after refillMs is let in`);
  }
  assert.equal(N.refillMs('no-such-limit'), 3000, 'unknown key: flat fallback');
});
