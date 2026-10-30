/************************************************
 * js/layout.js (LayoutSystem): pin packing, cluster rects and road geometry
 * for the 2D map. Pure functions over three globals — CONFIG_WORLD,
 * LOCATION_BY_ID and isCosmicLocation — so the real file runs in a vm,
 * first over small stubs, then over the bundled projects.js / locations.js
 * (CLI2-10a).
 *
 * LAYOUT_DATA_DIR=<dir> points the bundled-data tests at other copies of
 * projects.js / locations.js (e.g. `git show HEAD:…` while the working tree
 * is mid-edit).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const DATA = process.env.LAYOUT_DATA_DIR || ROOT;
const LAYOUT_SRC = fs.readFileSync(path.join(ROOT, 'js', 'layout.js'), 'utf8');

const PIN = { pinWidth: 30, pinHeight: 45, pinGap: 4, pinShelfPad: 14, cosmosThresholdY: 3400 };

// LayoutSystem over a stub LOCATIONS list.
function loadStub(locations) {
  const warns = [];
  const ctx = {
    console: { warn: (m) => warns.push(String(m)), log() {} },
    CONFIG_WORLD: PIN,
    LOCATION_BY_ID: new Map(locations.map(l => [l.id, l])),
    isCosmicLocation: (loc) => !!loc && loc.worldY > PIN.cosmosThresholdY
  };
  vm.createContext(ctx);
  vm.runInContext(LAYOUT_SRC + '\nthis.LayoutSystem = LayoutSystem;', ctx);
  return { LS: ctx.LayoutSystem, warns };
}

// state.initProjects derives `unlocks` the same way.
function withUnlocks(list) {
  list.forEach(p => { p.unlocks = list.filter(c => (c.prerequisites || []).includes(p.id)).map(c => c.id); });
  return list;
}

// The real bundle order: world-config.js, locations.js, projects.js, layout.js.
function loadBundled() {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'world-config.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(DATA, 'locations.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(DATA, 'projects.js'), 'utf8'), ctx);
  vm.runInContext(LAYOUT_SRC + '\nthis.LayoutSystem = LayoutSystem; this.P = projects; this.L = LOCATIONS; this.LB = LOCATION_BY_ID;', ctx);
  return { LS: ctx.LayoutSystem, projects: withUnlocks(ctx.P), locations: ctx.L, byId: ctx.LB };
}

const plain = (m) => JSON.parse(JSON.stringify([...m.entries()]));
const overlaps = (a, b) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

// ── stub data ────────────────────────────────────────────────────────────
const LOCS = [
  { id: 'a', worldX: 1000, worldY: 1000, width: 400, height: 280 },
  { id: 'b', worldX: 3000, worldY: 1000, width: 400, height: 280 },
  { id: 'mid', worldX: 2000, worldY: 1000, width: 280, height: 200 },     // sits on the a–b line
  { id: 'space', worldX: 2000, worldY: 4000, width: 280, height: 200 }    // cosmic
];

test('computeLayout: one centred pin row per location, in release order, unmapped skipped with one warning', () => {
  const { LS, warns } = loadStub(LOCS);
  const list = [
    { id: 'a2', location: 'a', release: '2012-01-01' },
    { id: 'a1', location: 'a', release: '2010-01-01' },
    { id: 'a3', location: 'a', release: '2014-01-01' },
    { id: 's1', location: 'space', release: '2011-01-01' },
    { id: 'lost', location: 'nowhere', release: '2011-01-01' },
    { id: 'hidden', location: 'b', release: '2011-01-01' }
  ];
  const lay = LS.computeLayout(list, p => p.id !== 'hidden');
  assert.deepEqual([...lay.keys()].sort(), ['a1', 'a2', 'a3', 's1']);
  const row = ['a1', 'a2', 'a3'].map(id => lay.get(id));
  assert.deepEqual(row.map(r => r.clusterIndex), [0, 1, 2]);
  assert.deepEqual(row.map(r => r.x), [966, 1000, 1034], 'centred on worldX, 30 px pins + 4 px gaps');
  // Bottom edge 1140, minus the 14 px shelf pad, minus half a pin.
  row.forEach(r => { assert.equal(r.y, 1140 - 14 - 22.5); assert.equal(r.clusterId, 'a'); assert.equal(r.isPin, true); assert.equal(r.isCosmic, false); });
  assert.equal(lay.get('s1').isCosmic, true);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /project lost has unmapped location "nowhere"/);
  LS.computeLayout(list, () => true);
  assert.equal(warns.length, 1, 'warned once per project, not per relayout');
});

test('computeLayout / computeClusterRects / buildRoadGeometry are deterministic', () => {
  const { LS } = loadStub(LOCS);
  const mk = () => withUnlocks([
    { id: 'a1', location: 'a', release: '2010-01-01', prerequisites: [] },
    { id: 'b1', location: 'b', release: '2011-01-01', prerequisites: ['a1'] },
    { id: 's1', location: 'space', release: '2012-01-01', prerequisites: ['b1'] }
  ]);
  const run = (list) => {
    const lay = LS.computeLayout(list, () => true);
    const rects = LS.computeClusterRects(lay);
    return { lay: plain(lay), rects: plain(rects), roads: plain(LS.buildRoadGeometry(list, lay, rects)) };
  };
  const one = run(mk());
  assert.deepEqual(run(mk()), one);
  assert.deepEqual(run(mk().reverse()).lay.sort(), one.lay.slice().sort(), 'input order does not move pins');
});

test('computeClusterRects: the authored rectangle of each location that has a pin', () => {
  const { LS } = loadStub(LOCS);
  const lay = LS.computeLayout([{ id: 'a1', location: 'a', release: '1' }, { id: 'a2', location: 'a', release: '2' }], () => true);
  const rects = LS.computeClusterRects(lay);
  assert.deepEqual([...rects.keys()], ['a']);
  const r = rects.get('a');
  assert.deepEqual({ minX: r.minX, maxX: r.maxX, minY: r.minY, maxY: r.maxY, cx: r.cx, cy: r.cy },
    { minX: 800, maxX: 1200, minY: 860, maxY: 1140, cx: 1000, cy: 1000 });
  assert.deepEqual([...r.memberIds], ['a1', 'a2']);
});

test('buildRoadGeometry: one road per cluster pair, none inside a cluster, bent around a location in the way', () => {
  const { LS } = loadStub(LOCS);
  const list = withUnlocks([
    { id: 'a1', location: 'a', release: '1', prerequisites: [] },
    { id: 'a2', location: 'a', release: '2', prerequisites: ['a1'] },        // same cluster: no road
    { id: 'b1', location: 'b', release: '3', prerequisites: ['a1', 'a2'] },  // two links, one a→b road
    { id: 'm1', location: 'mid', release: '4', prerequisites: [] }
  ]);
  const lay = LS.computeLayout(list, () => true);
  const rects = LS.computeClusterRects(lay);
  const roads = LS.buildRoadGeometry(list, lay, rects);
  assert.deepEqual([...roads.keys()], ['a|b']);
  const r = roads.get('a|b');
  assert.equal(r.fromId, 'a1');
  assert.equal(r.toId, 'b1');
  assert.equal(r.type, 'bezier');
  // Ends tucked 22 px inside each card edge, on the a→b axis.
  assert.deepEqual([...r.p0], [1178, 1000]);
  assert.deepEqual([...r.p3], [2822, 1000]);
  // 'mid' sits right on the straight line: the curve must clear it (36 px margin).
  const m = rects.get('mid');
  for (const s of r.samples) {
    const inside = s.x >= m.minX - 36 && s.x <= m.maxX + 36 && s.y >= m.minY - 36 && s.y <= m.maxY + 36;
    assert.ok(!inside, `sample (${s.x.toFixed(0)}, ${s.y.toFixed(0)}) runs through "mid"`);
  }
  assert.ok(r.length > 1644, 'a detour is longer than the chord');
  assert.equal(r.samples[0].cumLen, 0);
  assert.equal(r.samples[r.samples.length - 1].cumLen, r.length);
  assert.match(r.pathD, /^M 1178 1000 C /);
  // sampleAt clamps and interpolates along the arc.
  assert.equal(LS.sampleAt(r.samples, -5), r.samples[0]);
  assert.equal(LS.sampleAt(r.samples, r.length + 5), r.samples[r.samples.length - 1]);
  const half = LS.sampleAt(r.samples, r.length / 2);
  assert.equal(half.cumLen, r.length / 2);
  assert.ok(half.t > 0.3 && half.t < 0.7);
});

test('buildRoadGeometry: a link to a hidden or unmapped project draws nothing', () => {
  const { LS } = loadStub(LOCS);
  const list = withUnlocks([
    { id: 'a1', location: 'a', release: '1', prerequisites: [] },
    { id: 'b1', location: 'b', release: '2', prerequisites: ['a1'] },
    { id: 'x1', location: 'nowhere', release: '3', prerequisites: ['a1'] }
  ]);
  const lay = LS.computeLayout(list, p => p.id !== 'b1');
  assert.equal(LS.buildRoadGeometry(list, lay, LS.computeClusterRects(lay)).size, 0);
});

// ── the bundled data ─────────────────────────────────────────────────────
test('bundled data: every project is placed, and no two location rectangles overlap', () => {
  const { LS, projects, byId } = loadBundled();
  const lay = LS.computeLayout(projects, () => true);
  const unplaced = [...projects].filter(p => !lay.has(p.id)).map(p => `${p.id} (${p.location})`);
  assert.deepEqual(unplaced, [], 'projects with no mapped location');
  const rects = [...LS.computeClusterRects(lay).values()];
  assert.ok(rects.length > 10);
  const bad = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) if (overlaps(rects[i], rects[j])) bad.push(`${rects[i].id} × ${rects[j].id}`);
  }
  assert.deepEqual(bad, [], 'overlapping location rectangles');
  // Every location id is unique (LOCATION_BY_ID would silently keep the last).
  const { locations } = loadBundled();
  assert.equal(byId.size, locations.length, 'duplicate location ids');
});

test('bundled data: a road joins every pair of locations linked by a prerequisite', () => {
  const { LS, projects } = loadBundled();
  const lay = LS.computeLayout(projects, () => true);
  const rects = LS.computeClusterRects(lay);
  const roads = LS.buildRoadGeometry(projects, lay, rects);
  const want = new Set();
  projects.forEach(p => (p.prerequisites || []).forEach(pre => {
    const a = lay.get(pre), b = lay.get(p.id);
    if (a && b && a.clusterId !== b.clusterId) want.add(`${a.clusterId}|${b.clusterId}`);
  }));
  assert.ok(want.size > 10);
  assert.deepEqual([...want].filter(k => !roads.has(k)), [], 'linked locations with no road');
  assert.deepEqual([...roads.keys()].filter(k => !want.has(k)), [], 'roads with no prerequisite behind them');
  for (const [key, r] of roads) {
    const [from, to] = key.split('|');
    assert.equal(r.fromClusterId, from);
    assert.equal(r.toClusterId, to);
    assert.ok(projects.find(p => p.id === r.toId).prerequisites.includes(r.fromId), `${key}: ${r.fromId} → ${r.toId} is not a prerequisite`);
    assert.ok(Number.isFinite(r.length) && r.length > 0, key);
    // Each end starts near its own card: within the 22 px tuck plus up to 8 × 12 px of nudging.
    const near = (pt, rc) => pt[0] >= rc.minX - 120 && pt[0] <= rc.maxX + 120 && pt[1] >= rc.minY - 120 && pt[1] <= rc.maxY + 120;
    assert.ok(near(r.p0, rects.get(from)), `${key}: start is far from ${from}`);
    assert.ok(near(r.p3, rects.get(to)), `${key}: end is far from ${to}`);
  }
  // Same input, same geometry.
  assert.deepEqual(plain(LS.buildRoadGeometry(projects, lay, rects)), plain(roads));
});

// Found while writing the tests above: at full unlock two locations get more
// pins than their card is wide (multiverse 21 pins = 710 px in a 560 px card;
// hells-kitchen 14 pins = 472 px in a 220 px card), so the row spills past
// the card on the 2D map. Data/layout call for the owner; tracked as a todo.
test('bundled data: each location\'s pin row fits inside its card at full unlock', { todo: 'pin rows overflow multiverse and hells-kitchen' }, () => {
  const { LS, projects } = loadBundled();
  const lay = LS.computeLayout(projects, () => true);
  const rects = LS.computeClusterRects(lay);
  const spill = [];
  lay.forEach((pos, id) => {
    const r = rects.get(pos.clusterId);
    if (pos.x - PIN.pinWidth / 2 < r.minX || pos.x + PIN.pinWidth / 2 > r.maxX) spill.push(pos.clusterId);
  });
  assert.deepEqual([...new Set(spill)], []);
});
