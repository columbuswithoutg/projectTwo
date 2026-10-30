/************************************************
 * /customize preview framing (js/playground3d.js _measureRig / _frameCamera).
 * 3D2-04: the measured box used to be one module-level object that every
 * thumbnail overwrote, so the live preview briefly framed the last tile's
 * body (a Box tile even switched it to the Box regions). Each caller now
 * owns its box. The functions are lifted from the engine source and run
 * against a tiny fake THREE (Box3 + translation-only matrices).
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
const SRC = [
  lift(/\n  const PREVIEW_REGIONS = \{[\s\S]*?\n  \};\n/, 'PREVIEW_REGIONS'),
  lift(/\n  const PREVIEW_REGIONS_BOX = \{[\s\S]*?\n  \};\n/, 'PREVIEW_REGIONS_BOX'),
  lift(/\n  const PREVIEW_FULL = .*\n/, 'PREVIEW_FULL'),
  lift(/\n  function _measureRig\([\s\S]*?\n  \}\n/, '_measureRig'),
  lift(/\n  function _frameCamera\([\s\S]*?\n  \}\n/, '_frameCamera')
].join('');

class Box3 {
  constructor() { this.min = { x: Infinity, y: Infinity, z: Infinity }; this.max = { x: -Infinity, y: -Infinity, z: -Infinity }; }
  copy(b) { this.min = { ...b.min }; this.max = { ...b.max }; return this; }
  applyMatrix4(m) {
    for (const k of ['x', 'y', 'z']) { this.min[k] += m[k] || 0; this.max[k] += m[k] || 0; }
    return this;
  }
  union(b) {
    for (const k of ['x', 'y', 'z']) { this.min[k] = Math.min(this.min[k], b.min[k]); this.max[k] = Math.max(this.max[k], b.max[k]); }
    return this;
  }
}
const ctx = { window: { THREE: { Box3 } }, Math, isFinite };
vm.runInNewContext(SRC + '\nthis.measure = _measureRig; this.frame = _frameCamera;', ctx);
const { measure, frame } = ctx;

// A rig: one mesh spanning [-hw, hw] × [0, height], optionally a Box body.
const rig = (height, hw, boxBody) => ({
  visible: true, userData: boxBody ? { boxBody: true } : {}, updateMatrixWorld() {},
  children: [{
    visible: true, isMesh: true, userData: {}, children: [], matrixWorld: {},
    geometry: { boundingBox: { min: { x: -hw, y: 0, z: -hw }, max: { x: hw, y: height, z: hw } } }
  }]
});

test('the module-level shared _frameBox is gone', () => {
  assert.doesNotMatch(ENGINE, /\n  const _frameBox\b/);
  assert.match(ENGINE, /_measureRig\(rig, frameBox\)/, 'the preview measures into its own box');
  assert.match(ENGINE, /_frameCamera\(region, camera\.fov, camera\.aspect, zoom, frameBox\)/, 'and frames with it');
});

test('_measureRig fills the box it is given, or returns a fresh one', () => {
  const mine = { minY: 0, maxY: 0, radius: 0, blocky: false };
  assert.equal(measure(rig(1.8, 0.3), mine), mine);
  assert.deepEqual({ ...mine }, { minY: 0, maxY: 1.8, radius: 0.3, blocky: false });
  const a = measure(rig(1.0, 0.4, true)), b = measure(rig(2.4, 0.5));
  assert.notEqual(a, b);
  assert.equal(a.blocky, true);
  assert.equal(b.maxY, 2.4);
});

test('a thumbnail measured between preview frames does not move the preview camera (3D2-04)', () => {
  const previewBox = { minY: 0, maxY: 0, radius: 0, blocky: false };
  measure(rig(1.8, 0.3), previewBox);
  const before = frame('head', 32, 0.75, 1, previewBox);
  // A thumbnail batch: a Box tile, then a Huge one.
  const boxTile = measure(rig(1.1, 0.5, true));
  frame('head', 32, 0.75, 1, boxTile);
  const hugeTile = measure(rig(2.6, 0.7));
  frame('chest', 32, 0.75, 1, hugeTile);
  assert.deepEqual(frame('head', 32, 0.75, 1, previewBox), before);
  assert.equal(previewBox.blocky, false);
  assert.equal(previewBox.maxY, 1.8);
  // And the tiles really do frame differently (the box matters).
  assert.notDeepEqual(frame('head', 32, 0.75, 1, boxTile), before);
});

test('_frameCamera: the full pose ignores the box; zoom moves closer', () => {
  const box = measure(rig(1.8, 0.3));
  assert.deepEqual(JSON.parse(JSON.stringify(frame('full', 32, 1, 1, box))), { pos: [0, 1.4, 5.8], look: [0, 1.0, 0] });
  assert.ok(frame('head', 32, 1, 2, box).pos[2] < frame('head', 32, 1, 1, box).pos[2]);
});
