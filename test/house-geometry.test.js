/************************************************
 * Unit tests for js/playground3d-house.js — the pure roof-surface math
 * behind gable / hip roofs and chimney placement. (The THREE-facing
 * builders are exercised in the browser preview, not here.)
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/playground3d-house.js');

test('flat roof has no height anywhere', () => {
  assert.equal(R.roofHeightAt('flat', 0, 0, 0), 0);
  assert.equal(R.roofHeightAt('flat', 1, 3.5, -3.5), 0);
  assert.equal(R.roofHeightAt('nonsense', 0, 0, 0), 0);
});

test('gable: full pitch on the ridge, zero at the eaves, ridge follows roofDir', () => {
  const P = R.PITCH.gable;
  assert.ok(P > 0);
  const B = 6 + R.OVERHANG;
  // dir 0 — ridge along x: height depends on z only
  assert.equal(R.roofHeightAt('gable', 0, 0, 0), P);
  assert.equal(R.roofHeightAt('gable', 0, 5, 0), P);
  assert.equal(R.roofHeightAt('gable', 0, 0, B), 0);
  assert.equal(R.roofHeightAt('gable', 0, 0, -B / 2), P / 2);
  // dir 1 — ridge along z: height depends on x only
  assert.equal(R.roofHeightAt('gable', 1, 0, 5), P);
  assert.equal(R.roofHeightAt('gable', 1, B, 0), 0);
  assert.equal(R.roofHeightAt('gable', 1, B / 2, 0), P / 2);
  // never below the base past the eaves
  assert.equal(R.roofHeightAt('gable', 0, 0, B + 3), 0);
  // explicit pitch override
  assert.equal(R.roofHeightAt('gable', 0, 0, 0, 1), 1);
});

test('hip: apex at the centre, symmetric, zero along the whole eave', () => {
  const P = R.PITCH.hip;
  const B = 6 + R.OVERHANG;
  assert.equal(R.roofHeightAt('hip', 0, 0, 0), P);
  assert.equal(R.roofHeightAt('hip', 0, B, 2), 0);
  assert.equal(R.roofHeightAt('hip', 0, 2, -B), 0);
  assert.equal(R.roofHeightAt('hip', 0, 3, 1), R.roofHeightAt('hip', 0, -3, -1));
  assert.equal(R.roofHeightAt('hip', 0, 3, 1), R.roofHeightAt('hip', 1, 1, 3));
  assert.equal(R.roofHeightAt('hip', 0, B / 2, B / 2), P / 2);
});

test('chimney corner sits below the ridge on either gable direction', () => {
  const P = R.PITCH.gable;
  for (const dir of [0, 1]) {
    const h = R.roofHeightAt('gable', dir, 3.5, -3.5);
    assert.ok(h > 0 && h < P, `dir ${dir}: ${h}`);
  }
});
