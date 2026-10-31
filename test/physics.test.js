/************************************************
 * Unit tests for js/playground3d-physics.js — the pure math behind the
 * 3D engine's movement / collision / jump / fall-respawn behavior.
 *
 * Run: npm test  (node --test)
 *
 * The tuning constants are IMPORTED (PG3DPhysics.MOVE / JUMP / FALL /
 * WORLD_GRID) — the same objects js/playground3d.js builds its tables from
 * (asserted below) — so a retune changes what these tests check instead of
 * leaving them on a stale copy. World geometry at SCALE 24: island centres
 * 24u apart, platform+apron half-extent 8u, so neighbouring aprons have an
 * 8u gap (≈11.3u corner to corner on a diagonal) bridged only by roads.
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../js/playground3d-physics.js');

const { SPEED } = P.MOVE;
const { GRAVITY, INITIAL_V } = P.JUMP;
const { AIR_SPEED_MUL } = P.FALL;
const FALL_OPTS = P.FALL;
const G = P.WORLD_GRID;
const HALF_A = (G.PLATFORM_W + G.APRON_MARGIN) / 2;   // platform + apron half-extent
const GAP = G.SCALE - 2 * HALF_A;                      // open ground between neighbouring aprons
const DIAG_GAP = Math.SQRT2 * GAP;                     // apron corner to apron corner, diagonal neighbours
// Horizontal distance of a full running jump (max stick, air boost on).
const carry = (mul) => SPEED * mul * P.airtime(INITIAL_V, GRAVITY);

test('the engine builds its tuning tables from PG3DPhysics (no local copies)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/playground3d.js'), 'utf8');
  assert.match(src, /const JUMP = PG3DPhysics\.JUMP;/);
  assert.match(src, /const FALL = PG3DPhysics\.FALL;/);
  for (const key of ['SPEED', 'TURN_RATE', 'PLAYER_RADIUS', 'BACKPEDAL_MUL']) {
    assert.match(src, new RegExp(`\\b${key}: PG3DPhysics\\.MOVE\\.${key}\\b`), `PHYSICS.${key}`);
  }
  for (const key of ['SCALE', 'PLATFORM_W', 'APRON_MARGIN']) {
    assert.match(src, new RegExp(`\\b${key}: PG3DPhysics\\.WORLD_GRID\\.${key}\\b`), `WORLD.${key}`);
  }
});

test('shared tuning keeps the values the engine shipped with', () => {
  assert.deepEqual({ ...P.MOVE }, { SPEED: 4.0, TURN_RATE: 13.4, PLAYER_RADIUS: 0.45, BACKPEDAL_MUL: 0.6 });
  assert.deepEqual({ ...P.JUMP }, { GRAVITY: 22, INITIAL_V: 7.5 });
  assert.deepEqual({ ...P.FALL }, { AIR_SPEED_MUL: 1.25, RESPAWN_DEPTH: -8, RESPAWN_DELAY_MS: 1000, BROADCAST_Y_FLOOR: -2 });
  assert.deepEqual({ ...G }, { SCALE: 24, PLATFORM_W: 12, APRON_MARGIN: 4 });
  assert.ok(Object.isFrozen(P.MOVE) && Object.isFrozen(P.FALL), 'shared tables are read-only');
});

test('airtime ≈ 0.68s and apex ≈ 1.28u for the tuned jump', () => {
  const t = P.airtime(INITIAL_V, GRAVITY);
  assert.ok(Math.abs(t - 0.6818) < 0.001, `airtime ${t}`);
  const apex = (INITIAL_V * INITIAL_V) / (2 * GRAVITY);
  assert.ok(Math.abs(apex - 1.278) < 0.01, `apex ${apex}`);
});

// Gap-jumping between islands went away when SCALE went 18 → 24 (1cdaeae):
// the 2u gaps became 8u. Islands are reached by road only; if a retune ever
// makes this clearable again, the FALL comments in playground3d.js and
// playground3d-physics.js need revisiting (and roads stop being the only way).
test('a running jump does NOT clear the gap between neighbouring islands', () => {
  assert.equal(GAP, 8);
  const c = carry(AIR_SPEED_MUL);
  assert.ok(Math.abs(c - 3.41) < 0.01, `carry ${c}`);
  assert.ok(c < GAP, `carry ${c} must not clear the ${GAP}u orthogonal gap`);
  assert.ok(c < DIAG_GAP, `carry ${c} must not clear the ${DIAG_GAP}u diagonal gap`);
  // The air boost is feel only: it lengthens a hop (onto props) by ~0.7u.
  assert.ok(c > carry(1.0));
});

test('isWalkable: inside platform, on apron edge, and outside', () => {
  const nodes = [{ x: 0, z: 0 }, { x: G.SCALE, z: 0 }];
  assert.equal(P.isWalkable(0, 0, nodes, HALF_A, []), true);
  assert.equal(P.isWalkable(HALF_A, HALF_A, nodes, HALF_A, []), true);         // apron corner, inclusive
  assert.equal(P.isWalkable(G.SCALE / 2, 0, nodes, HALF_A, []), false);      // mid-gap between the two aprons
  assert.equal(P.isWalkable(HALF_A + 0.01, 0, nodes, HALF_A, []), false);    // just past the first apron
  assert.equal(P.isWalkable(G.SCALE - HALF_A + 0.5, 0, nodes, HALF_A, []), true); // inside second node's apron
  assert.equal(P.isWalkable(0, HALF_A + 0.01, nodes, HALF_A, []), false);    // just off the apron
  assert.equal(P.isWalkable(100, 100, nodes, HALF_A, []), false);
});

test('isWalkable: takes any iterable of nodes (the engine passes Map.values())', () => {
  const m = new Map([['a', { x: 0, z: 0 }], ['b', { x: G.SCALE, z: 0 }]]);
  assert.equal(P.isWalkable(G.SCALE, HALF_A, m.values(), HALF_A, []), true);
  assert.equal(P.isWalkable(G.SCALE / 2, 0, m.values(), HALF_A, []), false);
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

test('standable props: groundAt / blocksAt / stepVertical onto a floor', () => {
  const crate = { minX: 1, maxX: 2, minZ: 1, maxZ: 2, top: 0.8 };
  const shelf = { minX: 1.5, maxX: 2.5, minZ: 1.5, maxZ: 2.5, top: 1.8 };
  const wall = { minX: 5, maxX: 6, minZ: 0, maxZ: 10 };
  const r = 0.45;
  assert.equal(P.groundAt(1.5, 1.5, r, []), 0);
  assert.equal(P.groundAt(1.5, 1.5, r, [crate]), 0.8);
  assert.equal(P.groundAt(2.0, 2.0, r, [crate, shelf]), 1.8);          // highest wins
  assert.equal(P.groundAt(2.4, 1.2, r, [crate]), 0.8);                 // partial overlap still counts
  assert.equal(P.groundAt(4, 4, r, [crate, shelf]), 0);
  assert.equal(P.groundAt(5.5, 5, r, [wall]), 0);                      // walls have no top
  assert.equal(P.blocksAt(wall, 3), true);
  assert.equal(P.blocksAt(crate, 0), true);
  assert.equal(P.blocksAt(crate, 0.8 - P.STEP - 0.01), true);
  assert.equal(P.blocksAt(crate, 0.8 - P.STEP), false);                // within a step of the top
  assert.equal(P.blocksAt(crate, 1.2), false);
  // landing from a jump onto a crate top
  let y = 1.2, velY = -1;
  let s;
  for (let i = 0; i < 60; i++) { s = P.stepVertical(y, velY, 1 / 60, GRAVITY, null, 0.8); y = s.y; velY = s.velY; if (s.landed) break; }
  assert.equal(s.landed, true);
  assert.ok(y <= 0.8 && y > 0.6, `landed at ${y}`);
  // a cap below the floor is ignored (never clamps you into your own platform)
  const c = P.stepVertical(0.8, 0, 1 / 60, GRAVITY, 0.3, 0.8);
  assert.ok(c.y <= 0.8 && c.y > 0.7);
  assert.equal(c.bonked, false);
  // default floor is still the ground
  assert.equal(P.stepVertical(0.01, -1, 1 / 60, GRAVITY, null).landed, true);
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

// ── Punch cooldown ──

test('punchCooldown: ready before the first punch, blocked for a second after', () => {
  assert.equal(P.PUNCH_COOLDOWN_MS, 1000);
  assert.deepEqual(P.punchCooldown(500, 0), { ready: true, remainingMs: 0, frac: 0 }, 'never punched');
  const just = P.punchCooldown(5000, 5000);
  assert.equal(just.ready, false);
  assert.equal(just.frac, 1);
  const half = P.punchCooldown(5500, 5000);
  assert.equal(half.ready, false);
  assert.equal(half.remainingMs, 500);
  assert.equal(half.frac, 0.5);
  assert.equal(P.punchCooldown(5999, 5000).ready, false);
  assert.equal(P.punchCooldown(6000, 5000).ready, true);
  assert.equal(P.punchCooldown(9000, 5000).frac, 0);
});

test('punchCooldown: custom length, and clock going backwards never exceeds a full cooldown', () => {
  assert.equal(P.punchCooldown(1300, 1000, 600).ready, false, '300ms into a 600ms cooldown');
  assert.equal(P.punchCooldown(1600, 1000, 600).ready, true);
  assert.equal(P.punchCooldown(1600, 1000, 600).frac, 0);
  assert.equal(P.punchCooldown(900, 1000).frac, 1);
});

test('server punch floor is the client cooldown less a little network slack', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'routes', 'world-socket.js'), 'utf8');
  const m = src.match(/const PUNCH_INTERVAL_MS = PUNCH_COOLDOWN_MS - (\d+);/);
  assert.ok(m, 'server derives its floor from PUNCH_COOLDOWN_MS');
  const slack = +m[1];
  assert.ok(slack > 0 && slack <= 250, `slack ${slack}ms`);
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

test('pinchZoom: spreading fingers zooms in, pinching zooms out, clamped like the wheel', () => {
  const { pinchZoom } = require('../js/playground3d-physics.js');
  assert.equal(pinchZoom(8, 100, 200, 3, 14), 4);     // fingers apart → closer
  assert.equal(pinchZoom(8, 200, 100, 3, 14), 14);    // 16 clamped to MAX_DIST
  assert.equal(pinchZoom(8, 100, 1000, 3, 14), 3);    // 0.8 clamped to MIN_DIST
  assert.equal(pinchZoom(8, 0, 100, 3, 14), 8);       // degenerate gap → unchanged
  assert.equal(pinchZoom(8, 100, NaN, 3, 14), 8);
});

test('fovForAspect: landscape keeps 60°, portrait opens up, capped at 80°', () => {
  const { fovForAspect } = require('../js/playground3d-physics.js');
  assert.equal(fovForAspect(2), 60);                       // phone landscape
  assert.equal(fovForAspect(1), 60);                       // square
  assert.ok(Math.abs(fovForAspect(0.8) - 71.64) < 0.05, `0.8 → ${fovForAspect(0.8)}`);   // 2·atan(tan30°/0.8)
  assert.equal(fovForAspect(0.46), 80);                    // phone portrait → cap
  assert.equal(fovForAspect(NaN), 60);
  assert.equal(fovForAspect(0), 60);
  let prev = Infinity;                                     // never widens as the view gets wider
  for (const a of [0.3, 0.46, 0.6, 0.8, 1, 1.5, 2.2]) { const f = fovForAspect(a); assert.ok(f <= prev); prev = f; }
});

test('wallBetween: a house wall blocks reaching a chair on its far side', () => {
  const wall = { minX: 4.9, maxX: 5.1, minZ: -3, maxZ: 3 };        // full-height (no top)
  const chair = { minX: 4.4, maxX: 4.9, minZ: -0.25, maxZ: 0.25, top: 0.45 };
  const boxes = [wall, chair];
  // Inside the room, beside the chair → reachable.
  assert.equal(P.wallBetween(3.9, 0, 4.65, 0, boxes, chair), false);
  // Outside the wall, same distance from the chair's edge → blocked.
  assert.equal(P.wallBetween(5.5, 0, 4.65, 0, boxes, chair), true);
  // Standable props in between never block, and neither does the target itself.
  assert.equal(P.wallBetween(3, 0, 4.65, 0, [{ minX: 3.5, maxX: 4, minZ: -1, maxZ: 1, top: 0.8 }], null), false);
  // Parallel to the wall, not crossing it.
  assert.equal(P.wallBetween(4.5, -2, 4.5, 2, boxes, chair), false);
});

// ── Angles (the /world freeze: `while (d > π) d -= 2π` never ends for 1e300) ──

test('wrapAngle: any input lands in (-π, π], huge and non-finite included', () => {
  const inRange = (a) => a > -Math.PI - 1e-12 && a <= Math.PI + 1e-12;
  for (const a of [0, 1, -1, Math.PI, -Math.PI, 3 * Math.PI, -7.5, 1e300, -1e300, Number.MAX_VALUE, 1e-300]) {
    assert.ok(inRange(P.wrapAngle(a)), `${a} → ${P.wrapAngle(a)}`);
  }
  assert.equal(P.wrapAngle(NaN), 0);
  assert.equal(P.wrapAngle(Infinity), 0);
  assert.equal(P.wrapAngle('1'), 0);
  assert.ok(Math.abs(P.wrapAngle(2 * Math.PI + 0.25) - 0.25) < 1e-12);
  assert.ok(Math.abs(P.wrapAngle(-Math.PI) - Math.PI) < 1e-12, '-π maps to +π');
});

test('lerpAngle: takes the short way round and survives garbage', () => {
  // 170° → -170° is 20° through ±180°, not 340° the long way.
  const a = 170 * Math.PI / 180, b = -170 * Math.PI / 180;
  const mid = P.lerpAngle(a, b, 0.5);
  assert.ok(Math.abs(Math.abs(mid) - Math.PI) < 1e-9, `mid ${mid}`);
  assert.ok(Math.abs(P.lerpAngle(0, 1, 1) - 1) < 1e-12);
  assert.equal(P.lerpAngle(0.5, NaN, 0.5), 0.5, 'bad target: stay put');
  assert.ok(Number.isFinite(P.lerpAngle(1e300, -1e300, 0.3)));
});

test('turnToward: converges without overshoot, independent of frame rate', () => {
  let slow = 0, fast = 0;
  for (let i = 0; i < 30; i++) slow = P.turnToward(slow, 2, 1 / 30, 14);     // 1 s at 30 fps
  for (let i = 0; i < 144; i++) fast = P.turnToward(fast, 2, 1 / 144, 14);   // 1 s at 144 fps
  assert.ok(Math.abs(slow - 2) < 1e-4 && Math.abs(fast - 2) < 1e-4);
  assert.ok(Math.abs(slow - fast) < 1e-4, 'same result at any frame rate');
  let y = 0;
  for (let i = 0; i < 10; i++) { y = P.turnToward(y, 1, 0.016, 14); assert.ok(y <= 1 + 1e-12, 'no overshoot'); }
  assert.equal(P.turnToward(0.3, 1, 0, 14), 0.3, 'dt 0 → no turn');
});

// ── Server punch validation ──

test('punchCheck: reach, vertical reach, victim immunity, downed attacker', () => {
  const at = (x, z, extra) => Object.assign({ x, y: 0, z, downAt: 0 }, extra);
  const now = 100000;
  const opts = (attacker, victim) => ({ now, attacker, victim, range: 1.4 });
  assert.equal(P.punchCheck(opts(at(0, 0), at(1.4, 0))), 'ok');
  assert.equal(P.punchCheck(opts(at(0, 0), at(2.9, 0))), 'ok', 'latency slack');
  assert.equal(P.punchCheck(opts(at(0, 0), at(50, 0))), 'range', 'across the map');
  assert.equal(P.punchCheck(opts(at(0, 0), at(0.5, 0, { y: 5 }))), 'range', 'high above');
  assert.equal(P.punchCheck(opts(at(0, 0), at(1, 0, { downAt: now - 1000 }))), 'immune', 'still down');
  assert.equal(P.punchCheck(opts(at(0, 0), at(1, 0, { downAt: now - 4000 }))), 'immune', 'getting up + grace');
  assert.equal(P.punchCheck(opts(at(0, 0), at(1, 0, { downAt: now - P.KNOCKDOWN.IMMUNE_MS }))), 'ok');
  assert.equal(P.punchCheck(opts(at(0, 0, { downAt: now - 500 }), at(1, 0))), 'attacker-down');
  // Immunity outlasts the time a victim is helpless, so no chain-stun.
  assert.ok(P.KNOCKDOWN.IMMUNE_MS > P.KNOCKDOWN.DOWN_MS + P.KNOCKDOWN.GETUP_MS);
});

test('stoneSlot: six slots on a radius-4 ring, same as the client ring', () => {
  const pts = [0, 1, 2, 3, 4, 5].map(i => P.stoneSlot(10, -20, i));
  for (const p of pts) assert.ok(Math.abs(Math.hypot(p.x - 10, p.z + 20) - P.STONE_RING.R) < 1e-9);
  assert.ok(Math.abs(pts[0].x - 14) < 1e-9 && Math.abs(pts[0].z + 20) < 1e-9, 'slot 0 due +X');
});

test('seatOccupied: someone within the radius takes the seat', () => {
  assert.equal(P.seatOccupied(0, 0, [], 0.6), false);
  assert.equal(P.seatOccupied(0, 0, [{ x: 0.5, z: 0 }], 0.6), true);
  assert.equal(P.seatOccupied(0, 0, [{ x: 0.7, z: 0 }], 0.6), false);
  assert.equal(P.seatOccupied(0, 0, [null, { x: 0.1, z: 0.1 }]), true, 'default radius, tolerates holes');
});

test('snapShadowCenter: lands on whole texels across the light, moves < a texel', () => {
  const dir = { x: -0.62, y: 0.5, z: 0.6 };
  const l = Math.hypot(dir.x, dir.y, dir.z); dir.x /= l; dir.y /= l; dir.z /= l;
  const texel = (2 * 36) / 2048;
  // The light camera's right/up axes (same basis Matrix4.lookAt builds).
  const xl = Math.hypot(dir.z, dir.x);
  const ax = { x: dir.z / xl, y: 0, z: -dir.x / xl };
  const ay = { x: dir.y * ax.z - dir.z * ax.y, y: dir.z * ax.x - dir.x * ax.z, z: dir.x * ax.y - dir.y * ax.x };
  const dot = (p, a) => p.x * a.x + p.y * a.y + p.z * a.z;
  for (const [px, pz] of [[10.001, 5.002], [-123.4567, 88.8888], [0.3, -0.7]]) {
    const c = P.snapShadowCenter(px, 0, pz, dir, texel);
    for (const a of [ax, ay]) {
      const k = dot(c, a) / texel;
      assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `on a texel boundary (${k})`);
    }
    // Only the across-light components move, each by at most half a texel.
    const d = Math.hypot(c.x - px, c.y, c.z - pz);
    assert.ok(d <= (texel * Math.SQRT2) / 2 + 1e-9, `moved ${d}`);
  }
  // Straight-down sun and a bad texel don't blow up.
  assert.ok(Number.isFinite(P.snapShadowCenter(1, 0, 1, { x: 0, y: 1, z: 0 }, texel).x));
  assert.deepEqual(P.snapShadowCenter(1, 2, 3, dir, 0), { x: 1, y: 2, z: 3 });
});

// ── Movement / collision (moved out of playground3d.js) ──

// The engine's _moveWithCollision + _collideActors as they were before the
// move, verbatim apart from taking the state as arguments. Kept to show the
// shared function changes nothing except the "already inside a box" case.
function oldMove(x0, z0, feetY, dx, dz, r, walls, actors, isWalkable) {
  let x = x0 + dx, z = z0 + dz;
  for (const w of walls) {
    if (!P.blocksAt(w, feetY)) continue;
    if (x + r <= w.minX || x - r >= w.maxX || z + r <= w.minZ || z - r >= w.maxZ) continue;
    if (dx !== 0 && dz === 0) x = dx > 0 ? w.minX - r - 0.001 : w.maxX + r + 0.001;
    else if (dz !== 0 && dx === 0) z = dz > 0 ? w.minZ - r - 0.001 : w.maxZ + r + 0.001;
  }
  for (const a of actors) {
    const sep2 = (r + a.r) ** 2;
    const ddx = x - a.x, ddz = z - a.z;
    if (ddx * ddx + ddz * ddz >= sep2) continue;
    if ((x0 - a.x) ** 2 + (z0 - a.z) ** 2 < sep2) continue;
    if (dx !== 0 && dz === 0) { const reach = Math.sqrt(Math.max(0, sep2 - ddz * ddz)); x = dx > 0 ? a.x - reach - 0.001 : a.x + reach + 0.001; }
    else if (dz !== 0 && dx === 0) { const reach = Math.sqrt(Math.max(0, sep2 - ddx * ddx)); z = dz > 0 ? a.z - reach - 0.001 : a.z + reach + 0.001; }
  }
  if (isWalkable && !isWalkable(x, z)) { if (dx !== 0 && dz === 0) x = x0; else if (dz !== 0 && dx === 0) z = z0; }
  return { x, z };
}
const R = P.MOVE.PLAYER_RADIUS;
const move = (x0, z0, dx, dz, walls, actors, walk, feetY) =>
  P.moveWithCollision({ x: 0, z: 0 }, x0, z0, feetY || 0, dx, dz, R, walls, actors || [], (actors || []).length, walk || null);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('moveWithCollision: walking into a wall stops at its face, the other axis untouched', () => {
  const wall = { minX: 2, maxX: 2.3, minZ: -5, maxZ: 5 };
  const out = move(1.5, 0, 0.2, 0, [wall]);
  near(out.x, 2 - R - 0.001, 'stopped at the face');
  near(out.z, 0, 'z unchanged');
  near(move(1.5, 0, -0.2, 0, [wall]).x, 1.3, 'walking away is free');
});

test('moveWithCollision: wall sliding — the Z step along a wall you are pressed into is free', () => {
  const wall = { minX: 2, maxX: 2.3, minZ: -5, maxZ: 5 };
  const x0 = 2 - R - 0.001;                    // flush with the face after the X step
  const out = move(x0, 0, 0, 0.3, [wall]);
  near(out.x, x0, 'x stays flush');
  near(out.z, 0.3, 'slides along');
});

test('moveWithCollision: a box you are already inside does not snap you through it ([3D-08])', () => {
  // A keeper drops a 2×2 crate (no top: blocks at any height) onto a visitor.
  const crate = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  near(move(0.2, 0, 0.1, 0, [crate]).x, 0.3, 'walks on, out of the box');
  // The old code resolved a +x step to the box's -x face: backwards through
  // whatever stood behind it (a house wall).
  near(oldMove(0.2, 0, 0, 0.1, 0, R, [crate], [], null).x, -1 - R - 0.001, 'old snap');
  // Walls you are NOT inside still stop you on the way out.
  const wall = { minX: 1.2, maxX: 1.5, minZ: -5, maxZ: 5 };
  near(move(0.2, 0, 0.6, 0, [crate, wall]).x, 1.2 - R - 0.001, 'other wall still stops');
});

test('moveWithCollision: props stop blocking near their top; actors bump; walkability refuses per axis', () => {
  const crate = { minX: 2, maxX: 3, minZ: -1, maxZ: 1, top: 0.8 };
  near(move(1.5, 0, 0.2, 0, [crate], null, null, 0).x, 2 - R - 0.001, 'blocks from the floor');
  near(move(1.5, 0, 0.2, 0, [crate], null, null, 0.7).x, 1.7, 'feet near the top: passes over');
  const peer = { x: 2, z: 0, r: 0.4 };
  near(move(1, 0, 0.3, 0, [], [peer]).x, 2 - (R + 0.4) - 0.001, 'bumps the peer');
  near(move(2.1, 0, 0.1, 0, [], [peer]).x, 2.2, 'already overlapping a peer: walks out');
  const walk = (x) => x <= 5;
  const o = move(4.9, 1, 0.2, 0, [], [], walk);
  near(o.x, 4.9, 'x step off the edge refused');
  near(move(4.9, 1, 0, 0.2, [], [], walk).z, 1.2, 'z step along the edge allowed');
});

test('moveWithCollision: matches the old engine code whenever the start is clear', () => {
  const walls = [
    { minX: 2, maxX: 2.3, minZ: -5, maxZ: 5 },
    { minX: -3, maxX: 3, minZ: 3, maxZ: 3.3 },
    { minX: -1, maxX: 0, minZ: -2, maxZ: -1.5, top: 0.6 }
  ];
  const actors = [{ x: -2, z: 0, r: 0.4 }, { x: 0, z: 2, r: 0.55 }];
  const walk = (x, z) => Math.abs(x) <= 6 && Math.abs(z) <= 6;
  let checked = 0;
  for (let x0 = -2.5; x0 <= 1.5; x0 += 0.37) {
    for (let z0 = -2.5; z0 <= 2.5; z0 += 0.41) {
      if (walls.some((w) => x0 + R > w.minX && x0 - R < w.maxX && z0 + R > w.minZ && z0 - R < w.maxZ)) continue;
      for (const [dx, dz] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [1.2, 0], [0, 1.2]]) {
        const a = move(x0, z0, dx, dz, walls, actors, walk);
        const b = oldMove(x0, z0, 0, dx, dz, R, walls, actors, walk);
        near(a.x, b.x, `x from (${x0},${z0}) by (${dx},${dz})`);
        near(a.z, b.z, `z from (${x0},${z0}) by (${dx},${dz})`);
        checked++;
      }
    }
  }
  assert.ok(checked > 100, `${checked} cases`);
});

test('moveWithCollision: writes into the caller scratch object, uses only actorCount actors', () => {
  const out = { x: 0, z: 0 };
  const pool = [{ x: 1, z: 0, r: 0.4 }, { x: 99, z: 99, r: 0.4 }];
  assert.equal(P.moveWithCollision(out, 0, 0, 0, 0.5, 0, R, [], pool, 0, null), out);
  near(out.x, 0.5, 'actor beyond actorCount ignored');
  P.moveWithCollision(out, 0, 0, 0, 0.5, 0, R, [], pool, 1, null);
  near(out.x, 1 - (R + 0.4) - 0.001, 'first actor counted');
});

test('ceilingCap: under a lintel, on the threshold, and under open sky', () => {
  const nodes = [{ x: 0, z: 0, ceiling: true, wallHeight: 4.5 }, { x: G.SCALE, z: 0, ceiling: null }];
  const half = G.PLATFORM_W / 2;
  // Head 2.1 tall: lintel underside 4.5 - 0.45 = 4.05 → feet may reach 1.95.
  near(P.ceilingCap(0, 0, nodes, half, 0.5, 2.1, 4.5), 4.5 - P.LINTEL_DROP - 2.1, 'indoors');
  near(P.ceilingCap(half + 0.4, 0, nodes, half, 0.5, 2.1, 4.5), 1.95, 'doorway threshold counts');
  assert.equal(P.ceilingCap(half + 0.6, 0, nodes, half, 0.5, 2.1, 4.5), null, 'outside');
  assert.equal(P.ceilingCap(G.SCALE, 0, nodes, half, 0.5, 2.1, 4.5), null, 'roofless island');
  // Taller than the lintel clamps to 0; a node without wallHeight uses the default.
  assert.equal(P.ceilingCap(0, 0, nodes, half, 0.5, 5, 4.5), 0);
  near(P.ceilingCap(0, 0, [{ x: 0, z: 0, ceiling: true }], half, 0.5, 2.1, 3.0), 3.0 - 0.45 - 2.1, 'default wall height');
  // The lower of two overlapping roofs wins.
  near(P.ceilingCap(0, 0, [nodes[0], { x: 0.5, z: 0, ceiling: true, wallHeight: 4 }], half, 0.5, 2.1, 4.5), 4 - 0.45 - 2.1, 'min');
});

test('spreadSpawn: inner ring first, outer ring when the inner is taken, anchor when nothing is free', () => {
  const rand = () => 0;                                  // a0 = 0, pick the first spot
  const d = (p) => Math.hypot(p.x - 10, p.z - 5);
  near(d(P.spreadSpawn(10, 5, () => true, rand)), P.SPAWN_RINGS[0], 'inner ring');
  const outerOnly = (x, z) => Math.hypot(x - 10, z - 5) > 2;
  near(d(P.spreadSpawn(10, 5, outerOnly, rand)), P.SPAWN_RINGS[1], 'outer ring');
  // Only the +z point of the outer ring is free → that's the one returned.
  const one = (x, z) => Math.abs(x - 10) < 1e-6 && z > 7;
  const p = P.spreadSpawn(10, 5, one, () => 0);
  assert.ok(Math.abs(p.x - 10) < 1e-6 && Math.abs(p.z - (5 + P.SPAWN_RINGS[1])) < 1e-6, JSON.stringify(p));
  assert.deepEqual(P.spreadSpawn(10, 5, () => false, rand), { x: 10, z: 5 });
});

test('turn rates: the exponential rates match the old linear lerps at 60 fps', () => {
  // Old per-frame fraction min(1, rate * dt) at dt = 1/60 vs new 1 - e^(-k dt).
  const frac = (k) => 1 - Math.exp(-k / 60);
  for (const [k, old] of [[P.MOVE.TURN_RATE, 12], [4.14, 4], [10.9, 10], [6.3, 6], [8.6, 8]]) {
    assert.ok(Math.abs(frac(k) - old / 60) < 0.002, `${k}/s vs linear ${old}/s: ${frac(k)} vs ${old / 60}`);
  }
});

test('orbitView: above the floor it orbits; below it the view tilts up, capped', () => {
  const floor = 0.4, maxUp = 0.9;
  // Normal orbit: camera at the elevation, looking down at the player.
  assert.deepEqual(P.orbitView(0.7, floor, maxUp), { camElev: 0.7, pitch: -0.7 });
  // Exactly at the floor: still looking down at the player.
  assert.deepEqual(P.orbitView(floor, floor, maxUp), { camElev: floor, pitch: -floor });
  // Past the floor: the camera holds, the view tilts by the overshoot.
  const v = P.orbitView(0, floor, maxUp);
  assert.equal(v.camElev, floor);
  assert.ok(Math.abs(v.pitch - 0) < 1e-12, 'level with the horizon');
  const up = P.orbitView(-0.5, floor, maxUp);
  assert.ok(up.pitch > 0.49 && up.pitch < 0.51, 'looking up');
  // The orbit's lowest value -maxUp gives exactly maxUp, and never more.
  assert.ok(Math.abs(P.orbitView(-maxUp, floor, maxUp).pitch - maxUp) < 1e-12);
  assert.equal(P.orbitView(-5, floor, maxUp).pitch, maxUp);
});
