/************************************************
 * Unit tests for js/playground3d-physics.js — the pure math behind the
 * 3D engine's jump / gap-crossing / fall-respawn behavior.
 *
 * Run: npm test  (node --test)
 *
 * Constants mirrored from playground3d.js — if those change there, the
 * expectations here document what the gameplay tuning guarantees:
 *   SPEED 4.0, JUMP { GRAVITY 22, INITIAL_V 7.5 },
 *   FALL { AIR_SPEED_MUL 1.25, RESPAWN_DEPTH -8, RESPAWN_DELAY_MS 1000 }
 *   World geometry: platform+apron half-extent 8u; orthogonal island gap
 *   2.0u; diagonal corner gap ≈2.8u; non-adjacent islands 20u apart.
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/playground3d-physics.js');

const SPEED = 4.0;
const GRAVITY = 22;
const INITIAL_V = 7.5;
const AIR_SPEED_MUL = 1.25;
const FALL_OPTS = { RESPAWN_DELAY_MS: 1000, RESPAWN_DEPTH: -8 };
const HALF_A = 8; // (PLATFORM_W 12 + APRON_MARGIN 4) / 2

test('airtime ≈ 0.68s and apex ≈ 1.28u for the tuned jump', () => {
  const t = P.airtime(INITIAL_V, GRAVITY);
  assert.ok(Math.abs(t - 0.6818) < 0.001, `airtime ${t}`);
  const apex = (INITIAL_V * INITIAL_V) / (2 * GRAVITY);
  assert.ok(Math.abs(apex - 1.278) < 0.01, `apex ${apex}`);
});

test('air carry clears orthogonal (2u) and diagonal (2.8u) gaps but not 20u', () => {
  const carry = P.airCarry(SPEED, AIR_SPEED_MUL, INITIAL_V, GRAVITY);
  assert.ok(carry > 2.0, `carry ${carry} must clear 2u orthogonal gap`);
  assert.ok(carry > 2.8, `carry ${carry} must clear 2.8u diagonal gap`);
  assert.ok(carry < 20, `carry ${carry} must NOT reach a non-adjacent island`);
});

test('without the air-speed boost the diagonal gap is NOT clearable (boost is load-bearing)', () => {
  const carry = P.airCarry(SPEED, 1.0, INITIAL_V, GRAVITY);
  assert.ok(carry < 2.8, `unboosted carry ${carry} — if this fails the boost can be removed`);
});

test('isWalkable: inside platform, on apron edge, and outside', () => {
  const nodes = [{ x: 0, z: 0 }, { x: 18, z: 0 }];
  assert.equal(P.isWalkable(0, 0, nodes, HALF_A, []), true);
  assert.equal(P.isWalkable(8, 8, nodes, HALF_A, []), true);      // apron corner, inclusive
  assert.equal(P.isWalkable(9, 0, nodes, HALF_A, []), false);     // mid-gap between the two aprons (8..10)
  assert.equal(P.isWalkable(10.5, 0, nodes, HALF_A, []), true);   // inside second node's apron
  assert.equal(P.isWalkable(0, 8.01, nodes, HALF_A, []), false);  // just off the apron
  assert.equal(P.isWalkable(100, 100, nodes, HALF_A, []), false);
});

test('isWalkable: rotated road rectangle', () => {
  // A road centered at (5,5), rotated 45°, 2.5u wide, 10u long.
  const angle = Math.PI / 4;
  const roads = [{
    cx: 5, cz: 5,
    cosA: Math.cos(angle), sinA: Math.sin(angle),
    halfW: 1.25, halfL: 5
  }];
  assert.equal(P.isWalkable(5, 5, [], HALF_A, roads), true);        // center
  // Along the road's long axis (local +z maps to world (-sin, cos)·… — just
  // probe a point we can compute: local (0, 4) → world offset rotated by +angle.
  const wx = 5 + (0 * Math.cos(angle) + 4 * Math.sin(angle));
  const wz = 5 + (-0 * Math.sin(angle) + 4 * Math.cos(angle));
  assert.equal(P.isWalkable(wx, wz, [], HALF_A, roads), true);      // on the road, 4u down
  assert.equal(P.isWalkable(5 + 3, 5 - 3, [], HALF_A, roads), false); // perpendicular, off-width
});

test('stepVertical: full arc integrates up then lands', () => {
  let y = 0, velY = INITIAL_V;
  const dt = 1 / 60;
  let apex = 0, steps = 0, landed = false;
  while (steps++ < 200) {
    const s = P.stepVertical(y, velY, dt, GRAVITY, null);
    y = s.y; velY = s.velY;
    apex = Math.max(apex, y);
    if (s.landed) { landed = true; break; }
  }
  assert.ok(landed, 'jump must come back down');
  assert.ok(apex > 1.15 && apex < 1.35, `apex ${apex} out of tuned range`);
  assert.ok(steps * (1 / 60) < 0.8, `airtime ${steps / 60}s too long`);
});

test('stepVertical: ceiling bonk zeroes upward velocity and caps y', () => {
  const s = P.stepVertical(0.9, 5, 1 / 60, GRAVITY, 0.95);
  assert.equal(s.y, 0.95);
  assert.equal(s.velY, 0);
  assert.equal(s.bonked, true);
});

test('stepVertical: keeps integrating below zero during a fall', () => {
  let y = 0, velY = 0;
  for (let i = 0; i < 60; i++) {
    const s = P.stepVertical(y, velY, 1 / 60, GRAVITY, null);
    y = s.y; velY = s.velY;
    assert.equal(s.landed, true); // below zero every frame — caller ignores while falling
  }
  assert.ok(y < -5, `after 1s of freefall y=${y} should be well below the world`);
});

test('shouldRespawn: fires on the timer OR the depth, not before', () => {
  assert.equal(P.shouldRespawn(1500, 1000, -3, FALL_OPTS), false); // 500ms in, above depth
  assert.equal(P.shouldRespawn(2000, 1000, -3, FALL_OPTS), true);  // timer elapsed
  assert.equal(P.shouldRespawn(1100, 1000, -8.5, FALL_OPTS), true); // depth reached early
});

// ── Daily Infinity Stone placement ──

const NODES = [{ x: 0, z: 0 }, { x: 18, z: 0 }, { x: 0, z: 18 }, { x: 18, z: 18 }];

test('pickStoneSpots: deterministic for the same seed, different across days', () => {
  const seed1 = P.hashString('2026-07-07|a,b,c,d');
  const seed2 = P.hashString('2026-07-08|a,b,c,d');
  const a = P.pickStoneSpots({ nodes: NODES, roads: [], halfA: HALF_A, seed: seed1 });
  const b = P.pickStoneSpots({ nodes: NODES, roads: [], halfA: HALF_A, seed: seed1 });
  const c = P.pickStoneSpots({ nodes: NODES, roads: [], halfA: HALF_A, seed: seed2 });
  assert.deepEqual(a, b, 'same seed must produce identical spots');
  assert.notDeepEqual(a, c, 'different dates must move the stones');
});

test('pickStoneSpots: 6 stones, all on walkable ground, well separated', () => {
  const spots = P.pickStoneSpots({ nodes: NODES, roads: [], halfA: HALF_A, seed: 12345 });
  assert.equal(spots.length, 6);
  const ids = new Set(spots.map(s => s.id));
  assert.equal(ids.size, 6, 'each of the 6 stones appears once');
  for (const s of spots) {
    assert.ok(P.isWalkable(s.x, s.z, NODES, HALF_A, []), `${s.id} at (${s.x},${s.z}) must be walkable`);
    assert.ok(s.y === 0 || Math.abs(s.y - 1.1) < 0.001, 'y is ground or jump height');
  }
  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      const d = Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z);
      assert.ok(d >= 4, `stones ${i}/${j} too close (${d})`);
    }
  }
});

test('pickStoneSpots: small worlds spawn fewer stones; empty world spawns none', () => {
  const one = P.pickStoneSpots({ nodes: [NODES[0]], roads: [], halfA: HALF_A, seed: 7 });
  assert.equal(one.length, 2, '1 island → 2 stones');
  const two = P.pickStoneSpots({ nodes: NODES.slice(0, 2), roads: [], halfA: HALF_A, seed: 7 });
  assert.equal(two.length, 4, '2 islands → 4 stones');
  assert.deepEqual(P.pickStoneSpots({ nodes: [], roads: [], halfA: HALF_A, seed: 7 }), []);
});

// ── Punch target selection ──

test('pickPunchTarget: nearest in range wins; out of range → null', () => {
  const actors = [
    { id: 'far',  x: 5,   z: 0 },
    { id: 'near', x: 1,   z: 0 },
    { id: 'mid',  x: 1.2, z: 0.3 }
  ];
  assert.equal(P.pickPunchTarget(0, 0, 0, actors, 1.4), 'near');
  assert.equal(P.pickPunchTarget(0, 0, 0, [{ id: 'far', x: 5, z: 0 }], 1.4), null);
  assert.equal(P.pickPunchTarget(0, 0, 0, [], 1.4), null);
});

test('pickPunchTarget: vertical bound — cannot punch someone far above/below', () => {
  const actors = [{ id: 'up', x: 0.5, z: 0, y: 2.0 }];
  assert.equal(P.pickPunchTarget(0, 0, 0, actors, 1.4), null);     // 2u above
  assert.equal(P.pickPunchTarget(0, 0, 1.0, actors, 1.4), 'up');   // within 1.5u
});

test('elevated stones are out of reach on foot but reachable at jump apex', () => {
  // Pickup rule: 3D distance from the player's FEET position < 0.9.
  const stoneY = 1.1;
  const standingDist = Math.hypot(0, stoneY);          // directly underneath, feet on ground
  assert.ok(standingDist > 0.9, 'walking under an elevated stone must NOT collect it');
  const apex = (INITIAL_V * INITIAL_V) / (2 * GRAVITY); // ≈1.28
  const jumpDist = Math.abs(apex - stoneY);
  assert.ok(jumpDist < 0.9, 'a full jump directly under it must collect it');
});
