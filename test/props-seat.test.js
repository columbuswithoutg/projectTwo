/************************************************
 * 3D2-06: _buildProps (js/playground3d.js) must stand the local player up
 * when the prop they sit / lie on is gone, including when the rebuild leaves
 * the island with no props at all (that path returned before the check, so
 * the player stayed seated over bare floor). _buildProps + _keepSeat are
 * lifted from the engine source and run with stubbed engine state.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'js/playground3d.js'), 'utf8');
const lift = (re, what) => {
  const m = ENGINE.match(re);
  assert.ok(m, what + ' not found in js/playground3d.js');
  return m[0];
};
const SRC = lift(/\n  function _buildProps\(node\) \{[\s\S]*?\n  \}\n/, '_buildProps')
  + lift(/\n  function _keepSeat\(node\) \{[\s\S]*?\n  \}\n/, '_keepSeat');

// Fresh engine stubs per test. PG3DProps / WorldHouseLogic stay undefined,
// so only the empty-list path runs (the full build needs three.js).
function engine(seat) {
  const ctx = { window: { THREE: {} } };
  vm.runInNewContext(`
    let _scene = {}, _walls = [], _seat = null, stood = 0, disposed = 0;
    function _disposeDecor() { disposed++; }
    function _standUp() { if (_seat) { stood++; _seat = null; } }
    ${SRC}
    this.api = {
      build: _buildProps,
      setSeat(s) { _seat = s; },
      seat: () => _seat,
      stood: () => stood,
      walls: () => _walls,
      setWalls(w) { _walls = w; },
      disposed: () => disposed
    };`, ctx);
  if (seat) ctx.api.setSeat(seat);
  return ctx.api;
}

const chair = { kind: 'chair', gx: 3, gy: 4 };
const nodeWith = (props, house) => {
  const aabb = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
  return {
    project: { id: 'p1' },
    house,
    props: props.map(p => ({ ...p, obj: {}, aabb, nodeId: 'p1' })),
    aabb
  };
};

test('house with no props left: a seated player stands up (3D2-06)', () => {
  const e = engine({ nodeId: 'p1', ...chair, x: 1, z: 1 });
  const node = nodeWith([chair], { props: [] });
  e.setWalls([node.aabb, { other: true }]);
  e.build(node);
  assert.equal(e.seat(), null);
  assert.equal(e.stood(), 1);
  assert.equal(node.props.length, 0);
  assert.equal(e.disposed(), 1, 'the old chair is disposed');
  assert.equal(e.walls().length, 1, 'and its collision box dropped');
});

test('house gone (null) while lying on the only bed: stands up', () => {
  const bed = { kind: 'bed', gx: 1, gy: 1 };
  const e = engine({ nodeId: 'p1', ...bed, x: 0, z: 0 });
  const node = nodeWith([bed], null);
  e.build(node);
  assert.equal(e.seat(), null);
  assert.equal(e.stood(), 1);
});

test('a seat on another island is left alone', () => {
  const e = engine({ nodeId: 'p2', ...chair, x: 1, z: 1 });
  e.build(nodeWith([chair], { props: [] }));
  assert.notEqual(e.seat(), null);
  assert.equal(e.stood(), 0);
});

test('nobody seated: an empty rebuild is a no-op for the seat', () => {
  const e = engine(null);
  e.build(nodeWith([chair], { props: [] }));
  assert.equal(e.seat(), null);
  assert.equal(e.stood(), 0);
});
