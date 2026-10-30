/************************************************
 * The admin Projects board's layout rules (ADM2-14) —
 * js/views/admin/cms-projects-board.js, required under node, where its
 * `module.exports` guard hands out only the pure functions the board's
 * module state runs through:
 *   seedMaps     reseed(): saved cells + kept moves for surviving ids
 *   occupancyOf / conflictsOf / dirtyListOf   the Save bar's checks
 *   cellAt       _cellFromUser(): board point → cell (negative cells too)
 *   cellTaken    the drop and arrow-key rule: never onto another project
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../js/views/admin/cms-projects-board.js');

const items = (...rows) => rows.map(([id, gridX, gridY]) => ({ id, gridX, gridY }));
const map = (obj) => new Map(Object.entries(obj).map(([id, [gx, gy]]) => [id, { gx, gy }]));
const plain = (m) => Object.fromEntries([...m].map(([id, p]) => [id, [p.gx, p.gy]]));

// ── seedMaps (reseed) ──

test('seedMaps without keepMoves: pos is a copy of the saved cells', () => {
  const prev = map({ a: [5, 5] });
  const { orig, pos } = B.seedMaps(items(['a', 0, 0], ['b', 2, 1]), prev, false);
  assert.deepEqual(plain(orig), { a: [0, 0], b: [2, 1] });
  assert.deepEqual(plain(pos), { a: [0, 0], b: [2, 1] }, 'the pending move is dropped (after the board\'s own save)');
  pos.get('a').gx = 9;
  assert.equal(orig.get('a').gx, 0, 'pos and orig never share cell objects');
});

test('seedMaps with keepMoves keeps moves only for ids that still exist', () => {
  // a was moved, gone was moved and then deleted through the form, c is new.
  const prev = map({ a: [3, 0], b: [1, 0], gone: [7, 7] });
  const { orig, pos } = B.seedMaps(items(['a', 0, 0], ['b', 1, 0], ['c', 4, 4]), prev, true);
  assert.deepEqual(plain(pos), { a: [3, 0], b: [1, 0], c: [4, 4] });
  assert.equal(pos.has('gone'), false, "a deleted project's pending move is not kept");
  assert.deepEqual(B.dirtyListOf(orig, pos), [{ id: 'a', gridX: 3, gridY: 0 }]);
  prev.get('a').gx = 99;
  assert.equal(pos.get('a').gx, 3, 'kept moves are copied, not aliased');
});

test('seedMaps: missing / fractional / string coordinates become integer cells; no items → empty', () => {
  const { orig } = B.seedMaps([{ id: 'a' }, { id: 'b', gridX: 2.7, gridY: '-3' }, { id: 'c', gridX: null, gridY: undefined }], null, true);
  assert.deepEqual(plain(orig), { a: [0, 0], b: [2, -3], c: [0, 0] });
  const empty = B.seedMaps(null, null, false);
  assert.equal(empty.orig.size, 0);
  assert.equal(empty.pos.size, 0);
});

// ── dirtyListOf / conflictsOf / occupancyOf ──

test('a move back to the original cell is clean', () => {
  const { orig, pos } = B.seedMaps(items(['a', 0, 0], ['b', 1, 0]), null, false);
  pos.set('a', { gx: 2, gy: 0 });
  assert.deepEqual(B.dirtyListOf(orig, pos), [{ id: 'a', gridX: 2, gridY: 0 }]);
  pos.set('a', { gx: 0, gy: 0 });
  assert.deepEqual(B.dirtyListOf(orig, pos), []);
});

test('a position with no saved baseline is not reported as a move', () => {
  const orig = map({ a: [0, 0] });
  const pos = map({ a: [0, 0], stray: [5, 5] });
  assert.deepEqual(B.dirtyListOf(orig, pos), []);
});

test('two ids on one cell conflict; occupancy lists every id per cell', () => {
  const pos = map({ a: [1, 1], b: [1, 1], c: [2, 1], d: [-1, 0] });
  assert.deepEqual([...B.occupancyOf(pos)], [['1,1', ['a', 'b']], ['2,1', ['c']], ['-1,0', ['d']]]);
  assert.deepEqual(B.conflictsOf(pos), [['1,1', ['a', 'b']]]);
  pos.set('b', { gx: 3, gy: 1 });
  assert.deepEqual(B.conflictsOf(pos), []);
});

// ── cellAt (_cellFromUser) ──

test('cellAt maps a board point to its cell, flooring negative coordinates', () => {
  const W = B.CELL_W, H = B.CELL_H;
  assert.deepEqual(B.cellAt({ x: 0, y: 0 }, 0, 0, W, H), { gx: 0, gy: 0 });
  assert.deepEqual(B.cellAt({ x: W - 0.01, y: H - 0.01 }, 0, 0, W, H), { gx: 0, gy: 0 });
  assert.deepEqual(B.cellAt({ x: W, y: H }, 0, 0, W, H), { gx: 1, gy: 1 });
  // The board's top-left cell is (padX0, padY0) — e.g. (-2, -1) with nodes at negative cells.
  assert.deepEqual(B.cellAt({ x: 5, y: 5 }, -2, -1, W, H), { gx: -2, gy: -1 });
  assert.deepEqual(B.cellAt({ x: W * 2 + 1, y: H + 1 }, -2, -1, W, H), { gx: 0, gy: 0 });
  // A point left of / above the origin (auto-scroll past the edge) floors, not truncates.
  assert.deepEqual(B.cellAt({ x: -1, y: -0.5 }, 0, 0, W, H), { gx: -1, gy: -1 });
  assert.deepEqual(B.cellAt({ x: -W - 1, y: -H }, 3, 3, W, H), { gx: 1, gy: 2 });
});

// ── cellTaken (drop + arrow keys) ──

test('a drop onto an occupied cell is refused; onto a free cell or its own cell is fine', () => {
  const pos = map({ a: [0, 0], b: [1, 0] });
  assert.equal(B.cellTaken(pos, 'a', { gx: 1, gy: 0 }), true, 'b is there');
  assert.equal(B.cellTaken(pos, 'a', { gx: 2, gy: 0 }), false);
  assert.equal(B.cellTaken(pos, 'a', { gx: 0, gy: 0 }), false, 'dropping back where it was');
  assert.equal(B.cellTaken(pos, 'a', { gx: -1, gy: -1 }), false);
  // A cell two others already overlap on is still taken for a third.
  pos.set('c', { gx: 1, gy: 0 });
  assert.equal(B.cellTaken(pos, 'a', { gx: 1, gy: 0 }), true);
  // One of the overlapping pair may move within its own (conflicting) cell.
  assert.equal(B.cellTaken(pos, 'b', { gx: 1, gy: 0 }), true, 'c is there too');
});

test('the arrow-key rule walks a node around others, never onto them', () => {
  const pos = map({ a: [0, 0], b: [1, 0] });
  const step = (id, dx, dy) => {
    const cur = pos.get(id);
    const next = { gx: cur.gx + dx, gy: cur.gy + dy };
    if (B.cellTaken(pos, id, next)) return false;
    pos.set(id, next);
    return true;
  };
  assert.equal(step('a', 1, 0), false, 'right is b');
  assert.equal(step('a', 0, 1), true);
  assert.equal(step('a', 1, 0), true);
  assert.equal(step('a', 0, -1), false, 'up is b');
  assert.equal(step('a', -1, 0), true);
  assert.equal(step('a', -1, 0), true);
  assert.deepEqual(plain(pos), { a: [-1, 1], b: [1, 0] });
  assert.deepEqual(B.conflictsOf(pos), []);
});
