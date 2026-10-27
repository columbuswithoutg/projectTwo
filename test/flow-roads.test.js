/************************************************
 * Chart roads and walker roads are ONE geometry.
 *
 * js/orderRenderer.js renderArrows() draws the watch-order roads and
 * js/walkerView.js buildFlowRoadGeometry() hands walkers the roads they
 * walk. Both now read orderRenderer.flowRoads(); this pins that for every
 * bundled road: the walker road starts and ends where the drawn path does,
 * and its pathD is the very string the chart draws.
 *
 * The browser scripts are classic scripts sharing one global scope (see
 * scripts/build.mjs), so they are loaded the same way here: one vm
 * context, a stub state (everything watched) and a tiny SVG document stub.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contentLoader = require('../server/contentLoader.js');

contentLoader.init();
const BUNDLED = contentLoader.get('projects');

function svgEl(tag) {
  return {
    tag, attrs: {}, children: [],
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; },
    get firstChild() { return this.children[0] || null; },
  };
}

function load(projects) {
  const byId = new Map(projects.map(p => [p.id, p]));
  const ctx = {
    console, Math, Map, Set, JSON, Number, Array, Object, String, Infinity, NaN, isFinite,
    projects,
    state: { byId, isWatched: () => true, getLastWatchedId: () => null },
    isUnlocked: () => true,
    getLayoutVersion: () => 1,
    document: { createElementNS: (_ns, tag) => svgEl(tag), querySelector: () => null, addEventListener() {} },
  };
  vm.createContext(ctx);
  for (const f of ['js/road-router.js', 'js/pan-zoom-logic.js', 'js/orderRenderer.js', 'js/walkerView.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  }
  // Script-scope const/class bindings aren't context properties; fetch them.
  return Object.assign(vm.runInContext('({ orderRenderer, buildFlowRoadGeometry, RoadRouter, ORDER_CELL })', ctx), { ctx });
}

test('walker roads start/end on the drawn roads, for every bundled road', () => {
  const { orderRenderer, buildFlowRoadGeometry, RoadRouter, ORDER_CELL } = load(BUNDLED);
  orderRenderer.nodeElements = new Map();
  orderRenderer.svg = svgEl('svg');

  orderRenderer.renderArrows();
  // Drawn paths, in draw order: required roads draw 3+ layered paths with
  // the same d, a recommended trail draws one. Collect the distinct d's.
  const drawn = new Set(orderRenderer.svg.children
    .filter(el => el.tag === 'path' && el.attrs.d)
    .map(el => el.attrs.d));

  const flow = orderRenderer.flowRoads();
  const required = flow.filter(f => f.road.required);
  assert.ok(required.length > 10, `expected bundled roads, got ${required.length}`);

  const walk = buildFlowRoadGeometry();
  assert.equal(walk.size, required.length, 'one walker road per drawn required road');

  const close = (a, b) => Math.abs(a - b) < 1e-6;
  for (const { road, points } of required) {
    const w = walk.get(road.key);
    assert.ok(w, `walker road missing for ${road.key}`);
    const d = RoadRouter.pathD(points, ORDER_CELL.roadRadius);
    assert.ok(drawn.has(d), `chart never drew ${road.key}`);
    assert.equal(w.pathD, d, `walker pathD differs from the drawn path for ${road.key}`);
    const first = points[0], last = points[points.length - 1];
    assert.ok(close(w.x1, first.x) && close(w.y1, first.y), `${road.key} start ${w.x1},${w.y1} vs ${first.x},${first.y}`);
    assert.ok(close(w.x2, last.x) && close(w.y2, last.y), `${road.key} end ${w.x2},${w.y2} vs ${last.x},${last.y}`);
  }
});

test('flowRoads routes once per layout and filters by what is shown', () => {
  const { orderRenderer, ctx } = load(BUNDLED);
  const a = orderRenderer.flowRoads();
  const b = orderRenderer.flowRoads();
  assert.equal(a.length, b.length);
  assert.equal(a[0].points, b[0].points, 'cached polylines are reused, not re-routed');

  // Hide one card: its roads drop out, everything else keeps its polyline.
  const hidden = a[0].road.toId;
  ctx.state.isWatched = (id) => id !== hidden;
  ctx.isUnlocked = (p) => p.id !== hidden;
  const c = orderRenderer.flowRoads();
  assert.ok(c.length < a.length);
  assert.ok(c.every(f => f.road.fromId !== hidden && f.road.toId !== hidden));
  const kept = a.filter(f => f.road.fromId !== hidden && f.road.toId !== hidden);
  assert.deepEqual(c.map(f => f.points), kept.map(f => f.points));
});
