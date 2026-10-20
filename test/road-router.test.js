/************************************************
 * Unit tests for js/road-router.js — rook-style roads that never run
 * through another project and never overlap another road.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/road-router.js');
const contentLoader = require('../server/contentLoader.js');

contentLoader.init();
const BUNDLED = contentLoader.get('projects');

const P = (id, gridX, gridY, prerequisites, extra) => Object.assign({ id, gridX, gridY, prerequisites: prerequisites || [] }, extra);

// A view in lattice units (pitch 2 → one lattice step = 1), lanes 0.2 apart.
const UNIT = { pitchX: 2, pitchY: 2, originX: 0, originY: 0, laneSpacing: 0.2, laneRoom: 0.4, nodeHalfW: 0, nodeHalfH: 0, trails: true };

function segmentsOf(result, view, filter) {
  const segs = [];
  for (const r of result.roads) {
    if (filter && !filter(r)) continue;
    const pts = R.toView(r, view).points;
    for (let i = 1; i < pts.length; i++) segs.push({ key: r.key, a: pts[i - 1], b: pts[i] });
  }
  return segs;
}

function assertAxisAligned(segs) {
  for (const s of segs) {
    const h = Math.abs(s.a.y - s.b.y) < 1e-9, v = Math.abs(s.a.x - s.b.x) < 1e-9;
    assert.ok(h || v, `diagonal leg in ${s.key}: ${JSON.stringify(s)}`);
  }
}

// Parallel legs of different roads whose extents overlap must sit at least
// `minGap` apart (i.e. never on top of each other).
function assertNoOverlap(segs, minGap) {
  const H = [], V = [];
  for (const s of segs) {
    if (Math.abs(s.a.y - s.b.y) < 1e-9 && Math.abs(s.a.x - s.b.x) > 1e-9) H.push({ key: s.key, c: s.a.y, lo: Math.min(s.a.x, s.b.x), hi: Math.max(s.a.x, s.b.x) });
    else if (Math.abs(s.a.y - s.b.y) > 1e-9) V.push({ key: s.key, c: s.a.x, lo: Math.min(s.a.y, s.b.y), hi: Math.max(s.a.y, s.b.y) });
  }
  for (const list of [H, V]) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i], q = list[j];
        if (p.key === q.key) continue;
        const shared = Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo);
        if (shared <= 1e-6) continue;
        assert.ok(Math.abs(p.c - q.c) >= minGap - 1e-9, `${p.key} overlaps ${q.key} (${p.c} vs ${q.c}, shared ${shared})`);
      }
    }
  }
}

// Legs of different roads that properly cross (a crossroads, or a road
// cutting through a neighbour's lane). Ends clipped to the project boxes
// don't count — use a view with nodeHalfW/H > 0.
function countCrossings(segs) {
  const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const cross = (p, q) => {
    const d1 = d(p.a, p.b, q.a), d2 = d(p.a, p.b, q.b), d3 = d(q.a, q.b, p.a), d4 = d(q.a, q.b, p.b);
    return ((d1 > 1e-6 && d2 < -1e-6) || (d1 < -1e-6 && d2 > 1e-6)) && ((d3 > 1e-6 && d4 < -1e-6) || (d3 < -1e-6 && d4 > 1e-6));
  };
  let n = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    if (segs[i].key !== segs[j].key && cross(segs[i], segs[j])) n++;
  }
  return n;
}

// No lattice vertex a road visits is another project's cell.
function assertAvoidsProjects(projects, result) {
  const cells = new Map(projects.map((p) => [`${2 * p.gridX},${2 * p.gridY}`, p.id]));
  for (const r of result.roads) {
    for (const run of r.runs) {
      const step = run.to > run.from ? 1 : -1;
      for (let t = run.from; t !== run.to + step; t += step) {
        const k = run.o === 'h' ? `${t},${run.line}` : `${run.line},${t}`;
        const id = cells.get(k);
        if (id) assert.ok(id === r.fromId || id === r.toId, `${r.key} runs through ${id}`);
      }
    }
  }
}

test('neighbours in a row get one straight road', () => {
  const res = R.route([P('a', 0, 0), P('b', 1, 0, ['a'])]);
  assert.equal(res.roads.length, 1);
  const road = res.roads[0];
  assert.equal(road.runs.length, 1);
  assert.equal(road.fromSide, 'E');
  assert.equal(road.toSide, 'W');
  const pts = R.toView(road, UNIT).points;
  assert.deepEqual(pts, [{ x: 0, y: 0 }, { x: 2, y: 0 }]);
});

test('a project in the way makes the road detour through the gaps', () => {
  const projects = [P('a', 0, 0), P('x', 1, 0), P('b', 2, 0, ['a'])];
  const res = R.route(projects);
  const road = res.byKey.get('a__b');
  assert.ok(road.runs.length >= 3, 'needs to turn around x');
  assertAvoidsProjects(projects, res);
  assertAxisAligned(segmentsOf(res, UNIT));
});

test('diagonal neighbours get an L through a gap, never a diagonal', () => {
  const projects = [P('a', 0, 0), P('b', 1, 1, ['a'])];
  const res = R.route(projects);
  const segs = segmentsOf(res, UNIT);
  assertAxisAligned(segs);
  assert.ok(segs.length >= 2);
});

test('roads sharing a gap get separate lanes', () => {
  // Two parents on the left, two children on the right, a wall of projects
  // in the middle column with a single gap row between them.
  const projects = [
    P('a', 0, 0), P('c', 0, 1),
    P('w1', 1, 0), P('w2', 1, 1),
    P('b', 2, 0, ['a', 'c']), P('d', 2, 1, ['a', 'c'])
  ];
  const res = R.route(projects);
  assertAvoidsProjects(projects, res);
  const segs = segmentsOf(res, UNIT);
  assertAxisAligned(segs);
  assertNoOverlap(segs, 0.1);
});

test('roads sharing a doorstep peel off without crossing each other', () => {
  // One parent, three children down the row below it: the roads leave the
  // hub along its row in lanes and turn south one after another. The lane
  // order must follow the turn order (the road turning first takes the
  // inner lane) or the first to turn cuts through the others.
  const projects = [P('hub', 0, 0), P('a', 1, 2, ['hub']), P('b', 2, 2, ['hub']), P('c', 3, 2, ['hub'])];
  const res = R.route(projects);
  const box = Object.assign({}, UNIT, { nodeHalfW: 0.45, nodeHalfH: 0.45 });
  const segs = segmentsOf(res, box);
  assertAxisAligned(segs);
  assertNoOverlap(segs, 0.1);
  assert.equal(countCrossings(segs), 0);
  // Mirror image: three parents into one child.
  const joined = [P('a', 1, 0), P('b', 2, 0), P('c', 3, 0), P('hub', 0, 2, ['a', 'b', 'c'])];
  const segs2 = segmentsOf(R.route(joined), box);
  assertNoOverlap(segs2, 0.1);
  assert.equal(countCrossings(segs2), 0);
});

test('ports match the ends of the routes', () => {
  const projects = [P('a', 0, 0), P('b', 1, 0, ['a']), P('c', 0, 1, ['a'])];
  const res = R.route(projects);
  const ports = R.portsView(res, 'a', UNIT);
  assert.deepEqual(ports.map((p) => p.side).sort(), ['E', 'S']);
  assert.deepEqual(R.portsView(res, 'b', UNIT).map((p) => p.side), ['W']);
});

test('recommended trails are routed too, but never change the required roads', () => {
  const projects = [
    P('a', 0, 0), P('x', 1, 0), P('b', 2, 0, ['a']),
    P('c', 0, 2, [], { recommendedPrerequisites: [] }), P('d', 2, 2, [], { recommendedPrerequisites: ['c', 'a'] })
  ];
  const withTrails = R.route(projects);
  const roadsOnly = R.route(projects, { trails: false });
  assert.equal(roadsOnly.roads.every((r) => r.required), true);
  const view = Object.assign({}, UNIT, { trails: false });
  assert.deepEqual(
    R.toView(withTrails.byKey.get('a__b'), view).points,
    R.toView(roadsOnly.byKey.get('a__b'), view).points
  );
  assert.ok(withTrails.byKey.get('c__d') && !withTrails.byKey.get('c__d').required);
});

test('routing is deterministic', () => {
  const a = R.route(BUNDLED.map((p) => Object.assign({}, p)));
  const b = R.route(BUNDLED.map((p) => Object.assign({}, p, { _bust: 1 })).reverse().reverse());
  assert.deepEqual(a.roads.map((r) => [r.key, r.runs]), b.roads.map((r) => [r.key, r.runs]));
});

test('the bundled projects: every road routed, rook-only, no project hit, no overlaps', () => {
  const res = R.route(BUNDLED);
  const expected = new Set();
  for (const p of BUNDLED) for (const id of p.prerequisites || []) expected.add(`${id}__${p.id}`);
  for (const k of expected) assert.ok(res.byKey.has(k), `missing road ${k}`);
  assertAvoidsProjects(BUNDLED, res);
  const segs = segmentsOf(res, UNIT);
  assertAxisAligned(segs);
  assertNoOverlap(segs, 0.1);
  // Roads-only view (/world) too.
  const roadsOnly = R.route(BUNDLED, { trails: false });
  const segs2 = segmentsOf(roadsOnly, Object.assign({}, UNIT, { trails: false }));
  assertNoOverlap(segs2, 0.1);
  const bends = res.roads.filter((r) => r.required).reduce((n, r) => n + r.runs.length - 1, 0);
  // Crossings the eye sees (lane offsets included), required roads only.
  // 74 before the reroute passes + ordered lanes, 14 after; the ceiling
  // guards against a cost tweak quietly bringing the braids back.
  const box = Object.assign({}, UNIT, { nodeHalfW: 0.45, nodeHalfH: 0.45, trails: false });
  const crossings = countCrossings(segmentsOf(roadsOnly, box));
  assert.ok(crossings <= 20, `${crossings} crossings between required roads`);
  console.log(`bundled: ${res.roads.length} routes, ${bends} bends on required roads, ${crossings} crossings, ${res.overCapacity.length} over-capacity gaps`);
});

test('pathD rounds corners and samplePolyline measures the same route', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  const d = R.pathD(pts, 4);
  assert.match(d, /^M 0 0 L 6 0 Q 10 0 10 4 L 10 10$/);
  const { samples, length } = R.samplePolyline(pts, 4);
  assert.ok(length > 18 && length < 20, `length ${length}`);
  assert.equal(samples[0].x, 0);
  assert.equal(samples[samples.length - 1].y, 10);
  assert.ok(Math.abs(samples[0].tx - 1) < 1e-9 && Math.abs(samples[samples.length - 1].ty - 1) < 1e-9);
});
