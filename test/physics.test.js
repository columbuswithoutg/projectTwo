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

// ── Actor footprint (build-scaled collision radius) ──

test('actorRadius: Normal and Slim keep the base radius; Hulk-type grows but fits doorways', () => {
  const PLAYER_RADIUS = 0.45;
  const DOORWAY_W = 4.0;
  assert.equal(P.actorRadius(PLAYER_RADIUS, 1), PLAYER_RADIUS);
  assert.equal(P.actorRadius(PLAYER_RADIUS, 0.83), PLAYER_RADIUS);   // Slim never shrinks
  const hulk = P.actorRadius(PLAYER_RADIUS, 1.4 * 1.75);              // Huge widthFactor
  assert.ok(hulk > 0.65 && hulk < 0.75, `hulk radius ${hulk}`);
  assert.ok(hulk * 2 < DOORWAY_W / 2, 'a Hulk still passes a doorway with room to spare');
  assert.equal(P.actorRadius(PLAYER_RADIUS, 100), PLAYER_RADIUS * 1.8); // capped
  assert.equal(P.actorRadius(PLAYER_RADIUS, NaN), PLAYER_RADIUS);
});

// ── Spawn islands (world spawn-picker grouping) ──

// A small MCU-shaped fixture: three prerequisite branches that only merge at
// The Avengers, plus two independent start nodes (Guardians, Doctor Strange).
const PROJECTS = [
  { id: 'ironman1',    title: 'Iron Man',        image: 'a.png', phase: 'Phase 1', prerequisites: [] },
  { id: 'ironman2',    title: 'Iron Man 2',      image: 'b.png', phase: 'Phase 1', prerequisites: ['ironman1'] },
  { id: 'hulk',        title: 'The Hulk',        image: 'c.png', phase: 'Phase 1', prerequisites: ['ironman2'] },
  { id: 'thor1',       title: 'Thor',            image: 'd.png', phase: 'Phase 1', prerequisites: ['ironman2'] },
  { id: 'cap1',        title: 'Captain America', image: 'e.png', phase: 'Phase 1', prerequisites: ['ironman2'] },
  { id: 'avengers1',   title: 'The Avengers',    image: 'f.png', phase: 'Phase 1', prerequisites: ['thor1', 'cap1', 'hulk'] },
  { id: 'guardians1',  title: 'Guardians',       image: 'g.png', phase: 'Phase 2', prerequisites: [] },
  { id: 'doctorstrange', title: 'Doctor Strange', image: 'h.png', phase: 'Phase 3', prerequisites: [] }
];
// Mirror of _isProjectUnlocked: watched OR a start node (no prerequisites).
const unlockedBy = (watched) => (p) =>
  watched.has(p.id) || !(p.prerequisites && p.prerequisites.length);

test('spawnIslands: fresh user (only start nodes) → 3 separate islands', () => {
  const islands = P.spawnIslands(PROJECTS, unlockedBy(new Set()));
  assert.equal(islands.length, 3);
  assert.deepEqual(islands.map(i => i.anchor.id), ['ironman1', 'guardians1', 'doctorstrange']);
  for (const i of islands) assert.equal(i.nodes.length, 1);   // each start node alone
});

test('spawnIslands: a branch merges via The Avengers → still 3 islands, one is bigger', () => {
  const watched = new Set(['ironman2', 'hulk', 'thor1', 'cap1', 'avengers1']);
  const islands = P.spawnIslands(PROJECTS, unlockedBy(watched));
  assert.equal(islands.length, 3);   // Iron-Man island + Guardians + Doctor Strange
  const ironIsland = islands.find(i => i.anchor.id === 'ironman1');
  assert.ok(ironIsland, 'Iron Man is the anchor of the merged island');
  assert.deepEqual(
    ironIsland.nodes.map(n => n.id),
    ['ironman1', 'ironman2', 'hulk', 'thor1', 'cap1', 'avengers1']   // array order preserved
  );
  // The two lone start nodes remain their own single-node islands.
  assert.ok(islands.some(i => i.anchor.id === 'guardians1' && i.nodes.length === 1));
  assert.ok(islands.some(i => i.anchor.id === 'doctorstrange' && i.nodes.length === 1));
});

test('spawnIslands: a locked prerequisite does NOT connect two unlocked nodes', () => {
  // hulk is watched but its prereq ironman2 is NOT → hulk cannot join Iron Man's
  // island through a locked link; it stands alone.
  const islands = P.spawnIslands(PROJECTS, unlockedBy(new Set(['hulk'])));
  const hulkIsland = islands.find(i => i.nodes.some(n => n.id === 'hulk'));
  assert.equal(hulkIsland.nodes.length, 1);
  assert.equal(hulkIsland.anchor.id, 'hulk');
});

test('spawnIslands: fully-watched fixture collapses toward fewer islands', () => {
  const watched = new Set(PROJECTS.map(p => p.id));
  const islands = P.spawnIslands(PROJECTS, unlockedBy(watched));
  // Guardians & Doctor Strange have no links to anything here, so they stay
  // separate; the six Iron-Man-branch films form one island.
  assert.equal(islands.length, 3);
  assert.equal(islands.find(i => i.anchor.id === 'ironman1').nodes.length, 6);
});

/************************************************
 * Roaming /world NPCs — the patrol has to be a PURE function of a shared
 * clock, because every client simulates these heroes locally with no server
 * broadcast. If it isn't, two users see the same hero in different places
 * (which is exactly what the old Math.random() wander did).
 ************************************************/
const NPC_RING = 7.0;        // Chebyshev half-extent of the patrol loop
const NPC_SPEED = 1.5;       // base units/sec
const APRON_HALF = 8;        // walkable half-extent around a node
const WALL_HALF = 6;         // platform edge — the building's wall plane
const NPC_RADIUS = 0.40;

test('npcPatrol: same id → identical patrol; different ids → different ones', () => {
  const a1 = P.npcPatrol('thor', NPC_RING, NPC_SPEED);
  const a2 = P.npcPatrol('thor', NPC_RING, NPC_SPEED);
  assert.deepEqual(a1, a2, 'the same hero must always get the same patrol');

  const b = P.npcPatrol('hawkeye', NPC_RING, NPC_SPEED);
  // Two heroes sharing a debut node must not stand on the same spot.
  assert.notEqual(a1.phase0, b.phase0);
});

test('npcPathPoint: two clients at the same instant agree exactly', () => {
  // Same hero, same shared time, evaluated twice as two independent "clients".
  const patrol = P.npcPatrol('ironman', NPC_RING, NPC_SPEED);
  for (const t of [0, 1.37, 12.5, 999.25, 86400.5]) {
    const clientA = P.npcPathPoint(patrol, 18, -36, NPC_RING, t);
    const clientB = P.npcPathPoint(P.npcPatrol('ironman', NPC_RING, NPC_SPEED), 18, -36, NPC_RING, t);
    assert.deepEqual(clientA, clientB, `divergence at t=${t}`);
  }
});

test('npcPathPoint: stays on the walkable apron ring, never on the building', () => {
  const ids = ['thor', 'hawkeye', 'ironman', 'widow', 'strange'];
  for (const id of ids) {
    const patrol = P.npcPatrol(id, NPC_RING, NPC_SPEED);
    for (let t = 0; t < 120; t += 0.25) {
      const p = P.npcPathPoint(patrol, 100, -50, NPC_RING, t);
      const cheb = Math.max(Math.abs(p.x - 100), Math.abs(p.z - (-50)));
      // Body clear of the wall plane, and inside the apron.
      assert.ok(cheb >= WALL_HALF + NPC_RADIUS, `${id} clipped the wall at t=${t} (cheb ${cheb})`);
      assert.ok(cheb <= APRON_HALF - NPC_RADIUS, `${id} left the apron at t=${t} (cheb ${cheb})`);
    }
  }
});

test('npcPathPoint: position is continuous — a pause holds, never a teleport', () => {
  const patrol = P.npcPatrol('hawkeye', NPC_RING, NPC_SPEED);
  const dt = 1 / 60;
  const maxStep = patrol.speed * dt * 1.0001;   // a frame can never outrun the walk speed
  let prev = P.npcPathPoint(patrol, 0, 0, NPC_RING, 0);
  let sawPause = false;
  let sawWalk = false;
  for (let t = dt; t < 60; t += dt) {
    const p = P.npcPathPoint(patrol, 0, 0, NPC_RING, t);
    const step = Math.hypot(p.x - prev.x, p.z - prev.z);
    assert.ok(step <= maxStep, `jumped ${step.toFixed(4)}u in one frame at t=${t.toFixed(2)}`);
    if (p.walking) sawWalk = true;
    else {
      // Standing still means standing still — but allow the single frame that
      // decelerates INTO the pause (previous frame was still walking).
      if (!prev.walking) assert.ok(step < 1e-9, `drifted ${step} while paused at t=${t.toFixed(2)}`);
      sawPause = true;
    }
    prev = p;
  }
  assert.ok(sawWalk && sawPause, 'expected both strolling and standing within a minute');
});

test('npcPathPoint: a full lap returns to where it started', () => {
  const patrol = P.npcPatrol('widow', NPC_RING, NPC_SPEED);
  const start = P.npcPathPoint(patrol, 0, 0, NPC_RING, 0);
  // Moving time for one lap, converted to wall-clock by adding back the whole
  // pauses that fall inside it.
  const lapMoveSecs = (NPC_RING * 8) / patrol.speed;
  const t = lapMoveSecs + Math.floor(lapMoveSecs / patrol.moveSecs) * patrol.pauseSecs;
  const end = P.npcPathPoint(patrol, 0, 0, NPC_RING, t);
  assert.ok(Math.hypot(end.x - start.x, end.z - start.z) < 0.01, 'lap did not close');
});

test('npcPathPoint: heroes face the way they are travelling, both directions', () => {
  const dt = 1 / 60;
  for (const dir of [1, -1]) {
    const patrol = { phase0: 3, dir, speed: 1.5, moveSecs: 1e6, pauseSecs: 0 };
    for (let t = 0; t < 40; t += 0.37) {
      const a = P.npcPathPoint(patrol, 0, 0, NPC_RING, t);
      const b = P.npcPathPoint(patrol, 0, 0, NPC_RING, t + dt);
      const travel = Math.atan2(b.x - a.x, b.z - a.z);
      // Skip the frame that turns a corner — heading changes mid-step there.
      if (Math.abs(a.yaw - b.yaw) > 1e-9) continue;
      const off = Math.abs(((travel - a.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      assert.ok(off < 1e-6, `dir ${dir} faced ${a.yaw} but moved ${travel} at t=${t.toFixed(2)}`);
    }
  }
});
