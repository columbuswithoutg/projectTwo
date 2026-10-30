/************************************************
 * Unit tests for js/world-house-logic.js — keeper-editable project houses:
 * palette bounds, sign sanitising, prop placement rules.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../js/world-house-logic.js');

test('empty payload is the default house', () => {
  const r = H.validateHouse({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.house, H.defaultHouse());
  assert.equal(H.validateHouse(null).ok, true);
  assert.equal(H.validateHouse('junk').ok, true);
});

test('colours: null accepted, palette index bounds enforced, non-integers rejected', () => {
  assert.equal(H.validateHouse({ wallColor: null }).house.wallColor, null);
  assert.equal(H.validateHouse({ wallColor: 3 }).house.wallColor, 3);
  assert.equal(H.validateHouse({ roofColor: H.PALETTE.length }).ok, false);
  assert.equal(H.validateHouse({ trimColor: -1 }).ok, false);
  assert.equal(H.validateHouse({ lampColor: 1.5 }).ok, false);
  assert.equal(H.validateHouse({ lampColor: '2' }).ok, false);
});

test('sign: trimmed, collapsed, control chars stripped, capped, markup kept literal', () => {
  assert.equal(H.validateHouse({ sign: '  Stark   Tower \n' }).house.sign, 'Stark Tower');
  assert.equal(H.validateHouse({ sign: 'a\u0000b\u001fc' }).house.sign, 'abc');
  assert.equal(H.validateHouse({ sign: 'x'.repeat(40) }).house.sign.length, H.C.SIGN_MAX);
  assert.equal(H.validateHouse({ sign: '<b>hi</b>' }).house.sign, '<b>hi</b>');
  assert.equal(H.validateHouse({ sign: 42 }).house.sign, '42');
});

test('props: kinds, bounds, cap, duplicate cells, rot wrap, extra keys dropped', () => {
  const ok = H.validateHouse({ props: [{ kind: 'crate', gx: 1, gy: 10, rot: 7, colour: 'red' }] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.house.props, [{ kind: 'crate', gx: 1, gy: 10, rot: 3 }]);
  assert.equal(H.validateHouse({ props: [{ kind: 'hovercraft', gx: 1, gy: 1 }] }).ok, false);
  assert.equal(H.validateHouse({ props: [{ kind: 'crate', gx: 0, gy: 1 }] }).ok, false);
  assert.equal(H.validateHouse({ props: [{ kind: 'crate', gx: 1, gy: 11 }] }).ok, false);
  assert.equal(H.validateHouse({ props: [{ kind: 'crate', gx: 1.5, gy: 1 }] }).ok, false);
  assert.equal(H.validateHouse({ props: 'nope' }).ok, false);
  assert.equal(H.C.MAX_PROPS, 40);
  const twenty = Array.from({ length: 40 }, (_, i) => ({ kind: 'crate', gx: (i % 10) + 1, gy: 2 + Math.floor(i / 10) }));
  assert.equal(H.validateHouse({ props: twenty }).ok, true);
  const twentyOne = twenty.concat([{ kind: 'crate', gx: 1, gy: 6 }]);
  assert.equal(H.validateHouse({ props: twentyOne }).ok, false);
  const dup = [{ kind: 'crate', gx: 2, gy: 2 }, { kind: 'bookshelf', gx: 2, gy: 2 }];
  assert.equal(H.validateHouse({ props: dup }).ok, false);
  assert.equal(H.validateHouse({ props: [{ kind: 'rug', gx: 2, gy: 2, rot: -1 }] }).house.props[0].rot, 3);
});

test('cellToLocal keeps every cell inside the walls', () => {
  const a = H.cellToLocal(1, 1), b = H.cellToLocal(10, 10);
  assert.deepEqual(a, { x: -4.5, z: -4.5 });
  assert.deepEqual(b, { x: 4.5, z: 4.5 });
  for (const v of [a.x, a.z, b.x, b.z]) assert.ok(Math.abs(v) + 0.5 <= 5);
});

test('formatStay', () => {
  assert.equal(H.formatStay(30000), '<1m');
  assert.equal(H.formatStay(45 * 60000), '45m');
  assert.equal(H.formatStay(192 * 60000), '3h 12m');
});

test('portrait: https URL kept, empty allowed, http / junk / oversize rejected', () => {
  assert.equal(H.validateHouse({ portrait: ' https://res.cloudinary.com/x/image/upload/a.jpg ' }).house.portrait, 'https://res.cloudinary.com/x/image/upload/a.jpg');
  assert.equal(H.validateHouse({}).house.portrait, '');
  assert.equal(H.validateHouse({ portrait: '' }).house.portrait, '');
  assert.equal(H.validateHouse({ portrait: 'http://res.cloudinary.com/x/a.jpg' }).ok, false);
  assert.equal(H.validateHouse({ portrait: 'javascript:alert(1)' }).ok, false);
  assert.equal(H.validateHouse({ portrait: 'https://a.b/"onerror=' }).ok, false);
  assert.equal(H.validateHouse({ portrait: 'https://a.b/' + 'x'.repeat(700) }).ok, false);
});

test('frames snap to the nearest wall and face into the room', () => {
  assert.deepEqual(H.snapFrameToWall(5, 2), { gx: 5, gy: 1, rot: 0 });     // north
  assert.deepEqual(H.snapFrameToWall(5, 9), { gx: 5, gy: 10, rot: 2 });    // south
  assert.deepEqual(H.snapFrameToWall(2, 5), { gx: 1, gy: 5, rot: 1 });     // west
  assert.deepEqual(H.snapFrameToWall(9, 6), { gx: 10, gy: 6, rot: 3 });    // east
  assert.equal(H.frameWall({ rot: 2 }), 'S');
  const v = H.validateHouse({ props: [{ kind: 'frame', gx: 6, gy: 3, rot: 1 }] });
  assert.deepEqual(v.house.props, [{ kind: 'frame', gx: 6, gy: 1, rot: 0 }]);
  // a picture hangs ABOVE a floor prop on the same edge cell, but two frames can't share a spot
  assert.equal(H.validateHouse({ props: [{ kind: 'crate', gx: 6, gy: 1 }, { kind: 'frame', gx: 6, gy: 3 }] }).ok, true);
  assert.equal(H.validateHouse({ props: [{ kind: 'frame', gx: 6, gy: 1 }, { kind: 'frame', gx: 6, gy: 3 }] }).ok, false);
});

test('wall-backed props: a bookshelf on an edge cell backs onto that wall, free elsewhere', () => {
  assert.equal(H.wallSideOfCell(5, 1), 'N');
  assert.equal(H.wallSideOfCell(5, 10), 'S');
  assert.equal(H.wallSideOfCell(1, 5), 'W');
  assert.equal(H.wallSideOfCell(10, 5), 'E');
  assert.equal(H.wallSideOfCell(1, 1), 'N');          // corner: N/S first
  assert.equal(H.wallSideOfCell(5, 5), null);
  assert.equal(H.wallBackedRot('bookshelf', 5, 1), 0);   // faces south, into the room
  assert.equal(H.wallBackedRot('bookshelf', 1, 5), 1);   // faces east
  assert.equal(H.wallBackedRot('bookshelf', 5, 10), 2);
  assert.equal(H.wallBackedRot('bookshelf', 10, 5), 3);
  assert.equal(H.wallBackedRot('bookshelf', 5, 5), null); // interior: free
  assert.equal(H.wallBackedRot('chair', 5, 1), 0);        // chairs and beds back onto walls too
  assert.equal(H.wallBackedRot('crate', 5, 1), null);     // a crate just hugs the wall (wallHug), no facing
  assert.equal(H.wallHug('crate', 5, 1), 'N');
  assert.equal(H.wallHug('crate', 5, 5), null);
  assert.equal(H.wallHug('rug', 5, 1), null);             // flat / hung props never hug
  assert.equal(H.wallHug('frame', 5, 1), null);
  // validateHouse forces the facing on the edge and leaves interior rot alone
  const v = H.validateHouse({ props: [{ kind: 'bookshelf', gx: 10, gy: 4, rot: 1 }, { kind: 'bookshelf', gx: 4, gy: 4, rot: 1 }] });
  assert.deepEqual(v.house.props, [{ kind: 'bookshelf', gx: 10, gy: 4, rot: 3 }, { kind: 'bookshelf', gx: 4, gy: 4, rot: 1 }]);
});

test('validateHouse: the prop cap can be overridden (admin setting) — default stays 20', () => {
  const three = [{ kind: 'crate', gx: 2, gy: 2 }, { kind: 'crate', gx: 4, gy: 2 }, { kind: 'crate', gx: 6, gy: 2 }];
  assert.equal(H.validateHouse({ props: three }, { maxProps: 2 }).ok, false);
  assert.match(H.validateHouse({ props: three }, { maxProps: 2 }).error, /at most 2/);
  assert.equal(H.validateHouse({ props: three }, { maxProps: 3 }).ok, true);
  assert.equal(H.validateHouse({ props: three }).ok, true);
  assert.equal(H.validateHouse({ props: three }, { maxProps: 'lots' }).ok, true);   // junk → default
});

test('bed: two cells from the headboard along the facing; forced facing on edges', () => {
  assert.deepEqual(H.propCells({ kind: 'bed', gx: 5, gy: 3, rot: 0 }), [[5, 3], [5, 4]]);
  assert.deepEqual(H.propCells({ kind: 'bed', gx: 5, gy: 3, rot: 1 }), [[5, 3], [6, 3]]);
  assert.deepEqual(H.propCells({ kind: 'bed', gx: 5, gy: 3, rot: 2 }), [[5, 3], [5, 2]]);
  assert.deepEqual(H.propCells({ kind: 'bed', gx: 5, gy: 3, rot: 3 }), [[5, 3], [4, 3]]);
  assert.deepEqual(H.propCells({ kind: 'chair', gx: 5, gy: 3, rot: 1 }), [[5, 3]]);
  assert.deepEqual(H.propCentreOffset({ kind: 'bed', gx: 5, gy: 3, rot: 1 }), { dx: 0.5, dy: 0 });
  assert.deepEqual(H.propCentreOffset({ kind: 'crate', gx: 5, gy: 3, rot: 1 }), { dx: 0, dy: 0 });
  // an edge bed turns to face the room (rather than being rejected), so its
  // foot cell is always inside the grid
  const e = H.validateHouse({ props: [{ kind: 'bed', gx: 10, gy: 5, rot: 0 }] });
  assert.deepEqual(e.house.props, [{ kind: 'bed', gx: 10, gy: 5, rot: 3 }]);
  const s = H.validateHouse({ props: [{ kind: 'bed', gx: 5, gy: 10, rot: 0 }] });
  assert.equal(s.house.props[0].rot, 2);
  // an interior bed's foot cell is always inside the grid (edge anchors are
  // turned), so only overlaps can refuse it
  assert.equal(H.validateHouse({ props: [{ kind: 'bed', gx: 5, gy: 9, rot: 0 }] }).ok, true);
  assert.equal(H.validateHouse({ props: [{ kind: 'crate', gx: 5, gy: 4 }, { kind: 'bed', gx: 5, gy: 3, rot: 0 }] }).ok, false);
  assert.equal(H.validateHouse({ props: [{ kind: 'bed', gx: 5, gy: 3, rot: 0 }, { kind: 'crate', gx: 5, gy: 4 }] }).ok, false);
  assert.equal(H.validateHouse({ props: [{ kind: 'bed', gx: 5, gy: 3, rot: 0 }, { kind: 'crate', gx: 5, gy: 5 }] }).ok, true);
});

test('canPlaceProp: placement + rotate-in-place checks used by the editor', () => {
  const props = [{ kind: 'bed', gx: 5, gy: 3, rot: 0 }, { kind: 'crate', gx: 6, gy: 3, rot: 0 }];
  assert.equal(H.canPlaceProp(props, { kind: 'chair', gx: 5, gy: 4, rot: 0 }).ok, false);       // the bed's foot cell
  assert.equal(H.canPlaceProp(props, { kind: 'chair', gx: 5, gy: 5, rot: 0 }).ok, true);
  assert.match(H.canPlaceProp(props, { kind: 'bed', gx: 6, gy: 3, rot: 1 }).error, /share cell/);  // foot lands on the crate
  assert.equal(H.canPlaceProp([], { kind: 'bed', gx: 5, gy: 10, rot: 0 }).placed.rot, 2);          // edge → forced rot 2, fine
  assert.equal(H.canPlaceProp([], { kind: 'bed', gx: 5, gy: 9, rot: 0 }).ok, true);                // foot on row 10 is inside
  assert.equal(H.canPlaceProp(props, { kind: 'chair', gx: 1, gy: 1, rot: 0 }, { maxProps: 2 }).ok, false);
  // rotating the bed in place: rot 1 collides with the crate, rot 3 is free
  assert.equal(H.canPlaceProp(props, { ...props[0], rot: 1 }, { skipIndex: 0 }).ok, false);
  assert.equal(H.canPlaceProp(props, { ...props[0], rot: 3 }, { skipIndex: 0 }).ok, true);
  assert.equal(H.canPlaceProp(props, { ...props[0], rot: 3 }, { skipIndex: 0, maxProps: 2 }).ok, true);   // itself doesn't count
  const f = H.canPlaceProp([], { kind: 'frame', gx: 5, gy: 3, rot: 0 });
  assert.deepEqual(f.placed, { kind: 'frame', gx: 5, gy: 1, rot: 0 });
});

test('propRuns: bookshelves side by side form runs along the wall', () => {
  const props = [
    { kind: 'bookshelf', gx: 3, gy: 1, rot: 0 }, { kind: 'bookshelf', gx: 5, gy: 1, rot: 0 }, { kind: 'bookshelf', gx: 4, gy: 1, rot: 0 },
    { kind: 'crate', gx: 6, gy: 1, rot: 0 },
    { kind: 'bookshelf', gx: 1, gy: 4, rot: 1 }, { kind: 'bookshelf', gx: 1, gy: 5, rot: 1 },
    { kind: 'bookshelf', gx: 8, gy: 8, rot: 0 }
  ];
  const runs = H.propRuns(props, 'bookshelf');
  assert.equal(runs.length, 3);
  const north = runs.find(r => r.from[1] === 1);
  assert.deepEqual(north.indices.slice().sort(), [0, 1, 2]);
  assert.equal(north.cells, 3);
  assert.deepEqual(north.centre, { gx: 4, gy: 1 });
  const west = runs.find(r => r.rot === 1);
  assert.equal(west.cells, 2);
  assert.deepEqual(west.centre, { gx: 1, gy: 4.5 });
  const lone = runs.find(r => r.cells === 1);
  assert.deepEqual(lone.from, [8, 8]);
  // same cells, different facing → separate runs
  assert.equal(H.propRuns([{ kind: 'bookshelf', gx: 3, gy: 3, rot: 0 }, { kind: 'bookshelf', gx: 4, gy: 3, rot: 2 }], 'bookshelf').length, 2);
  assert.deepEqual(H.propRuns([], 'bookshelf'), []);
});

// ── roof / wall / window options (door stays fixed) ──

test('shape and finish defaults, enum rejection, roofDir / chimney coercion', () => {
  const d = H.validateHouse({}).house;
  assert.equal(d.roofStyle, 'flat');
  assert.equal(d.wallStyle, 'plaster');
  assert.equal(d.windowStyle, 'cross');
  assert.equal(d.roofDir, 0);
  assert.equal(d.chimney, false);
  assert.equal(d.windows, null);
  const ok = H.validateHouse({ roofStyle: 'gable', roofDir: 1, chimney: true, wallStyle: 'brick', windowStyle: 'shutters' }).house;
  assert.equal(ok.roofStyle, 'gable');
  assert.equal(ok.roofDir, 1);
  assert.equal(ok.chimney, true);
  assert.equal(ok.wallStyle, 'brick');
  assert.equal(ok.windowStyle, 'shutters');
  assert.equal(H.validateHouse({ roofStyle: 'dome' }).ok, false);
  assert.equal(H.validateHouse({ wallStyle: 'gold' }).ok, false);
  assert.equal(H.validateHouse({ windowStyle: 'stained' }).ok, false);
  assert.equal(H.validateHouse({ roofDir: 7 }).house.roofDir, 0);
  assert.equal(H.validateHouse({ roofDir: '1' }).house.roofDir, 1);
  assert.equal(H.validateHouse({ chimney: 'yes' }).house.chimney, false);
  assert.equal(H.validateHouse({ chimney: 1 }).house.chimney, true);
  // No door field exists — one sent by a client is dropped, never stored.
  assert.equal('door' in H.validateHouse({ door: { side: 'N', pos: 3 } }).house, false);
});

test('windows: null vs [] preserved, side / pos / cap / spacing / duplicate rules', () => {
  assert.equal(H.validateHouse({ windows: null }).house.windows, null);
  assert.deepEqual(H.validateHouse({ windows: [] }).house.windows, []);
  const ok = H.validateHouse({ windows: [{ side: 'N', pos: 2, extra: 1 }, { side: 'N', pos: 4 }, { side: 'E', pos: 2 }] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.house.windows, [{ side: 'N', pos: 2 }, { side: 'N', pos: 4 }, { side: 'E', pos: 2 }]);
  assert.equal(H.validateHouse({ windows: 'no' }).ok, false);
  assert.equal(H.validateHouse({ windows: [{ side: 'X', pos: 2 }] }).ok, false);
  assert.equal(H.validateHouse({ windows: [{ side: 'N', pos: 0 }] }).ok, false);
  assert.equal(H.validateHouse({ windows: [{ side: 'N', pos: 11 }] }).ok, false);
  assert.equal(H.validateHouse({ windows: [{ side: 'N', pos: 2.5 }] }).ok, false);
  assert.equal(H.validateHouse({ windows: [{ side: 'N', pos: 2 }, { side: 'N', pos: 3 }] }).ok, true);    // adjacent → one wide pane
  assert.equal(H.validateHouse({ windows: [{ side: 'N', pos: 2 }, { side: 'N', pos: 2 }] }).ok, false);   // duplicate
  assert.equal(H.validateHouse({ windows: [{ side: 'N', pos: 2 }, { side: 'S', pos: 2 }] }).ok, true);    // other wall
  const sidesList = ['N', 'S', 'E', 'W'];
  const nine = Array.from({ length: 9 }, (_, i) => ({ side: sidesList[i % 4], pos: 1 + 2 * Math.floor(i / 4) }));
  assert.equal(H.validateHouse({ windows: nine }).ok, false);
});

test('windowSpan / windowBlocked keep panes clear of the (fixed) door and corners', () => {
  assert.deepEqual(H.windowSpan(1), [0.75, 2.25]);
  assert.deepEqual(H.windowSpan(10), [9.75, 11.25]);
  const door = [[4, 8]];                                   // 4-wide doorway centred on the wall
  assert.equal(H.windowBlocked(2, door), false);           // 1.75..3.25 + 0.35 margin < 4
  assert.equal(H.windowBlocked(3, door), true);            // 2.75..4.25 overlaps
  assert.equal(H.windowBlocked(6, door), true);            // inside the opening
  assert.equal(H.windowBlocked(8, door), true);            // 7.75 < 8
  assert.equal(H.windowBlocked(9, door), false);           // 8.75 - 0.35 >= 8
  assert.equal(H.windowBlocked(9, door, 1), true);         // wider margin
  assert.equal(H.windowBlocked(5, []), false);
  assert.equal(H.windowBlocked(5, null), false);
  // A door clipped at a corner (road exits near the edge) and a merged double door.
  assert.equal(H.windowBlocked(1, [[0, 2.5]]), true);
  assert.equal(H.windowBlocked(3, [[0, 2.5]]), true);      // 2.75 − 0.35 margin still touches 2.5
  assert.equal(H.windowBlocked(3, [[0, 2.3]]), false);
  assert.equal(H.windowBlocked(5, [[1, 4], [4.5, 9]]), true);
});

test('openingsToCells / autoWindowCentres mirror the engine for the editor', () => {
  assert.deepEqual(H.openingsToCells([[4, 8]]), [[4, 7]]);
  assert.deepEqual(H.openingsToCells([[3.5, 7.5]]), [[3, 7]]);
  assert.deepEqual(H.openingsToCells([[0, 2.5], [9.7, 12]]), [[0, 2], [9, 11]]);
  assert.deepEqual(H.openingsToCells([]), []);
  assert.deepEqual(H.autoWindowCentres([]), [6]);                         // solid wall: one centred pane
  assert.deepEqual(H.autoWindowCentres([[4, 8]]), [2, 10]);               // 4-long stretches either side
  assert.deepEqual(H.autoWindowCentres([[1, 5]]), [8.5]);                 // 1-long stub too short
  assert.deepEqual(H.autoWindowCentres([[0, 12]]), []);
});

test('windowRuns merges adjacent cells into one wide pane', () => {
  assert.deepEqual(H.windowRuns([]), []);
  assert.deepEqual(H.windowRuns([4]), [{ from: 4, to: 4, cells: 1, centre: 4.5, width: 1.5 }]);
  assert.deepEqual(H.windowRuns([3, 2]), [{ from: 2, to: 3, cells: 2, centre: 3, width: 2.5 }]);
  assert.deepEqual(H.windowRuns([2, 3, 4, 7, 9, 9]), [
    { from: 2, to: 4, cells: 3, centre: 3.5, width: 3.5 },   // cells 2..4 span offsets 2..5
    { from: 7, to: 7, cells: 1, centre: 7.5, width: 1.5 },
    { from: 9, to: 9, cells: 1, centre: 9.5, width: 1.5 }
  ]);
  // a double pane spans exactly from the first cell's left edge to the last cell's right edge
  const [r] = H.windowRuns([2, 3]);
  assert.equal(r.centre - r.width / 2, H.windowSpan(2)[0]);
  assert.equal(r.centre + r.width / 2, H.windowSpan(3)[1]);
});

test('glass is a wall finish', () => {
  assert.ok(H.WALL_STYLES.includes('glass'));
  assert.equal(H.validateHouse({ wallStyle: 'glass' }).house.wallStyle, 'glass');
});

test('canPlaceWindow explains every refusal', () => {
  const door = [[4, 8]];
  assert.equal(H.canPlaceWindow([], 'N', 2, door).ok, true);
  assert.match(H.canPlaceWindow([], 'N', 5, door).error, /door is fixed/);
  assert.equal(H.canPlaceWindow([{ side: 'N', pos: 1 }], 'N', 2, door).ok, true);   // adjacent is fine
  assert.match(H.canPlaceWindow([{ side: 'N', pos: 2 }], 'N', 2, door).error, /already/);
  assert.equal(H.canPlaceWindow([{ side: 'N', pos: 2 }], 'S', 2, []).ok, true);
  assert.match(H.canPlaceWindow([], 'N', 0, door).error, /corner/);
  assert.equal(H.canPlaceWindow(null, 'W', 9, null).ok, true);
  const full = Array.from({ length: H.C.MAX_WINDOWS }, (_, i) => ({ side: 'S', pos: 1 + i }));
  assert.match(H.canPlaceWindow(full, 'N', 2, []).error, /limit/);
});

// ── furniture round (2026-10): layers, joins, surfaces, seats ──

test('every kind sits on exactly one layer, is picker-reachable, and has a footprint', () => {
  const fs2 = require('node:fs');
  const path = require('node:path');
  const src = fs2.readFileSync(path.join(__dirname, '..', 'js', 'playground3d-props.js'), 'utf8');
  const PG = new Function(src + '; return PG3DProps;')();
  const lists = [H.FLOOR_KINDS, H.RUG_KINDS, H.HUNG_KINDS, H.CEILING_KINDS, H.TOP_KINDS];
  assert.equal(new Set(H.PROP_KINDS).size, H.PROP_KINDS.length);
  for (const k of H.PROP_KINDS) {
    assert.equal(lists.filter(l => l.includes(k)).length, 1, k + ' is on one layer');
    assert.ok(PG.FOOTPRINTS[k], k + ' has a footprint');
  }
  assert.equal(lists.reduce((n, l) => n + l.length, 0), H.PROP_KINDS.length);
  const inCat = new Set(H.CATEGORIES.flatMap(c => c.kinds));
  for (const k of inCat) assert.ok(H.PROP_KINDS.includes(k), k + ' (category) is a real kind');
  for (const k of H.PROP_KINDS) assert.ok(inCat.has(k), k + ' is in a category');
  // Surfaces and seats need a standable height; walk-over things never collide.
  for (const k of H.SURFACE_KINDS) { assert.ok(H.FLOOR_KINDS.includes(k)); assert.ok(PG.FOOTPRINTS[k].top > 0, k + ' has a surface height'); }
  for (const k of H.SEAT_KINDS) { assert.ok(H.FLOOR_KINDS.includes(k)); assert.ok(PG.FOOTPRINTS[k].top > 0, k + ' has a seat height'); }
  for (const k of [...H.HUNG_KINDS, ...H.CEILING_KINDS, ...H.TOP_KINDS]) assert.equal(PG.FOOTPRINTS[k].solid, false, k + ' does not collide');
  // A lone wide piece shrinks to one cell when joined; narrow ones are left alone.
  assert.equal(PG.footprint('table', true).hx, 0.5);
  assert.equal(PG.footprint('table').hx, 0.7);
  assert.equal(PG.footprint('fridge', true).hx, 0.47);
});

test('furniture layers: a rug runs under a sofa, a picture over a shelf, a fan over a table', () => {
  const ok = (props) => H.validateHouse({ props });
  assert.equal(ok([{ kind: 'rug', gx: 5, gy: 5 }, { kind: 'sofa', gx: 5, gy: 5 }]).ok, true);
  assert.equal(ok([{ kind: 'bookshelf', gx: 5, gy: 1 }, { kind: 'mirror', gx: 5, gy: 3 }]).ok, true);   // snaps to the north wall, above the shelf
  assert.equal(ok([{ kind: 'table', gx: 5, gy: 5 }, { kind: 'fan', gx: 5, gy: 5 }]).ok, true);
  assert.equal(ok([{ kind: 'sofa', gx: 5, gy: 5 }, { kind: 'sofa', gx: 5, gy: 5 }]).ok, false);          // same layer still collides
  assert.equal(ok([{ kind: 'clock', gx: 5, gy: 1 }, { kind: 'mirror', gx: 5, gy: 1 }]).ok, false);       // one hanging per wall cell
  assert.equal(ok([{ kind: 'fan', gx: 5, gy: 5 }, { kind: 'hangplant', gx: 5, gy: 5 }]).ok, false);
  // Hung kinds go to the nearest wall and face in, like frames always did.
  assert.deepEqual(ok([{ kind: 'clock', gx: 9, gy: 5, rot: 2 }]).house.props, [{ kind: 'clock', gx: 10, gy: 5, rot: 3 }]);
  assert.equal(H.layerOf('kettle'), 'top');
  assert.equal(H.layerOf('rug'), 'rug');
  assert.equal(H.wallHug('mirror', 5, 1), null);   // wall pieces / overhead / table-top things never hug
  assert.equal(H.wallHug('fan', 5, 1), null);
});

test('table-top things need a surface and are listed after it', () => {
  assert.equal(H.validateHouse({ props: [{ kind: 'kettle', gx: 4, gy: 4 }] }).ok, false);
  assert.match(H.validateHouse({ props: [{ kind: 'kettle', gx: 4, gy: 4 }] }).error, /surface/);
  // listed BEFORE the counter it stands on: still fine, and comes out after it
  const v = H.validateHouse({ props: [{ kind: 'kettle', gx: 4, gy: 4 }, { kind: 'counter', gx: 4, gy: 4 }] });
  assert.equal(v.ok, true);
  assert.deepEqual(v.house.props.map(p => p.kind), ['counter', 'kettle']);
  assert.equal(H.validateHouse({ props: [{ kind: 'counter', gx: 4, gy: 4 }, { kind: 'kettle', gx: 4, gy: 4 }, { kind: 'pots', gx: 4, gy: 4 }] }).ok, false);   // one thing per surface cell
  assert.equal(H.validateHouse({ props: [{ kind: 'stove', gx: 4, gy: 4 }, { kind: 'pots', gx: 4, gy: 4 }, { kind: 'table', gx: 6, gy: 4 }, { kind: 'laptop', gx: 6, gy: 4 }] }).ok, true);
  assert.equal(H.validateHouse({ props: [{ kind: 'plant', gx: 4, gy: 4 }, { kind: 'vase', gx: 4, gy: 4 }] }).ok, false);   // a plant is no surface
  // removing a surface takes what stands on it
  const props = [{ kind: 'counter', gx: 3, gy: 3, rot: 0 }, { kind: 'kettle', gx: 3, gy: 3, rot: 0 }, { kind: 'table', gx: 5, gy: 3, rot: 0 }, { kind: 'vase', gx: 5, gy: 3, rot: 0 }];
  assert.deepEqual(H.dependentTops(props, 0), [1]);
  assert.deepEqual(H.dependentTops(props, 2), [3]);
  assert.deepEqual(H.dependentTops(props, 1), []);
  assert.equal(H.surfaceAt(props, 3, 3), true);
  assert.equal(H.surfaceAt(props, 3, 3, 0), false);   // …unless that surface is the one being moved
});

test('joinFlags: neighbours of one group fuse; other facings and groups do not', () => {
  const row = [
    { kind: 'table', gx: 3, gy: 4, rot: 0 }, { kind: 'table', gx: 4, gy: 4, rot: 0 }, { kind: 'table', gx: 5, gy: 4, rot: 0 }, { kind: 'table', gx: 5, gy: 5, rot: 0 }
  ];
  assert.deepEqual([0, 1, 2].map(i => [H.joinFlags(row, i).l, H.joinFlags(row, i).r]), [[false, true], [true, true], [true, false]]);
  assert.deepEqual([H.joinFlags(row, 3).l, H.joinFlags(row, 3).r], [false, false]);   // a table below the row is not beside it
  // facing east: the row runs along y, and "right" is north
  const east = [{ kind: 'sink', gx: 5, gy: 3, rot: 1 }, { kind: 'stove', gx: 5, gy: 4, rot: 1 }];
  assert.equal(H.joinFlags(east, 0).l, true);    // right of east-facing is −y; the stove at +y is its left
  assert.equal(H.joinFlags(east, 1).r, true);
  // the kitchen group mixes counter / sink / stove / fridge, but not a table
  const kit = [{ kind: 'counter', gx: 2, gy: 1, rot: 0 }, { kind: 'sink', gx: 3, gy: 1, rot: 0 }, { kind: 'fridge', gx: 4, gy: 1, rot: 0 }, { kind: 'table', gx: 5, gy: 1, rot: 0 }];
  assert.equal(H.joinFlags(kit, 1).l && H.joinFlags(kit, 1).r, true);
  assert.equal(H.joinFlags(kit, 2).r, false);
  // turned the other way round: no join
  assert.equal(H.joinFlags([{ kind: 'counter', gx: 2, gy: 1, rot: 0 }, { kind: 'counter', gx: 3, gy: 1, rot: 2 }], 0).r, false);
  // beds fuse into a double by their anchors
  const beds = [{ kind: 'bed', gx: 3, gy: 3, rot: 0 }, { kind: 'bed', gx: 4, gy: 3, rot: 0 }];
  assert.equal(H.joinFlags(beds, 0).r, true);
  // rugs know all four sides, whatever their rot
  const rugs = [{ kind: 'rug', gx: 5, gy: 5, rot: 0 }, { kind: 'rug', gx: 6, gy: 5, rot: 3 }, { kind: 'rug', gx: 5, gy: 6, rot: 1 }];
  const r0 = H.joinFlags(rugs, 0);
  assert.deepEqual([r0.n, r0.s, r0.e, r0.w], [false, true, true, false]);
  // anything without a group, and bad indexes, are safe
  assert.equal(H.joinFlags([{ kind: 'plant', gx: 1, gy: 1 }], 0).l, false);
  assert.equal(H.joinFlags([], 3).armL, true);
});

test('sofas: arms only on open ends; an L (a sofa turned in front of an end) drops that end\'s arm', () => {
  const straight = [{ kind: 'sofa', gx: 3, gy: 5, rot: 0 }, { kind: 'sofa', gx: 4, gy: 5, rot: 0 }, { kind: 'sofa', gx: 5, gy: 5, rot: 0 }];
  assert.deepEqual([0, 1, 2].map(i => [H.joinFlags(straight, i).armL, H.joinFlags(straight, i).armR]), [[true, false], [false, false], [false, true]]);
  assert.deepEqual([H.joinFlags([straight[0]], 0).armL, H.joinFlags([straight[0]], 0).armR], [true, true]);
  // a sofa turned east standing in front of the left end (3,6): the corner of an L
  const ell = straight.concat([{ kind: 'sofa', gx: 3, gy: 6, rot: 1 }]);
  assert.equal(H.joinFlags(ell, 0).armL, false);   // the corner end lost its arm
  assert.equal(H.joinFlags(ell, 2).armR, true);    // the far end keeps it
});

test('wall-backed furniture turns its back to the wall; two-cell pieces need room', () => {
  assert.equal(H.wallBackedRot('sofa', 5, 10), 2);
  assert.equal(H.wallBackedRot('fridge', 1, 4), 1);
  assert.equal(H.wallBackedRot('armchair', 5, 10), null);   // free-standing pieces stay free
  assert.equal(H.wallBackedRot('coffee_table', 5, 1), null);
  assert.deepEqual(H.propCells({ kind: 'bathtub', gx: 5, gy: 3, rot: 0 }), [[5, 3], [5, 4]]);
  assert.deepEqual(H.propCells({ kind: 'treadmill', gx: 5, gy: 3, rot: 1 }), [[5, 3], [6, 3]]);
  assert.equal(H.canPlaceProp([], { kind: 'bathtub', gx: 5, gy: 10, rot: 0 }).placed.rot, 2);   // against the south wall it turns round and fits
  assert.equal(H.canPlaceProp([{ kind: 'crate', gx: 5, gy: 4 }], { kind: 'bathtub', gx: 5, gy: 3, rot: 0 }).ok, false);
});

test('a fully furnished house fits the cap, and the seat kinds are the ones people sit on', () => {
  assert.deepEqual(H.SEAT_KINDS.slice().sort(), ['armchair', 'chair', 'sofa', 'stool', 'toilet']);
  const kitchen = ['fridge', 'counter', 'sink', 'stove', 'counter'].map((kind, i) => ({ kind, gx: 2 + i, gy: 1, rot: 0 }));
  // the sink is a basin, not a worktop: the kettle, pots and microwave stand on the counters and stove
  const tops = [['kettle', 3], ['pots', 5], ['microwave', 6]].map(([kind, gx]) => ({ kind, gx, gy: 1 }));
  const house = kitchen.concat(tops, [
    { kind: 'table', gx: 8, gy: 8 }, { kind: 'toaster', gx: 8, gy: 8 },
    { kind: 'sofa', gx: 3, gy: 10 }, { kind: 'sofa', gx: 4, gy: 10 }, { kind: 'tv', gx: 5, gy: 5 }, { kind: 'rug', gx: 5, gy: 6 },
    { kind: 'bed', gx: 10, gy: 3 }, { kind: 'wardrobe', gx: 10, gy: 6 }, { kind: 'toilet', gx: 1, gy: 8 }, { kind: 'bathtub', gx: 1, gy: 5 },
    { kind: 'fan', gx: 5, gy: 5 }, { kind: 'clock', gx: 8, gy: 1 }, { kind: 'frame', gx: 6, gy: 1 }, { kind: 'mirror', gx: 1, gy: 3 }
  ]);
  const v = H.validateHouse({ props: house });
  assert.equal(v.ok, true, v.error);
  assert.ok(v.house.props.length <= H.C.MAX_PROPS);
});

test('sanitizeSign strips every C0 control char and DEL, keeps the rest (3D2-01 escape rewrite)', () => {
  let all = '';
  for (let c = 0; c <= 0x1f; c++) all += String.fromCharCode(c);
  assert.equal(H.sanitizeSign('a' + all + 'b\u007fc'), 'abc');
  assert.equal(H.sanitizeSign('x\u0000\u0009\u000a\u000d\u001b[31my'), 'x[31my');
  assert.equal(H.sanitizeSign('caf\u00e9 \u0080 \u00ff'), 'caf\u00e9 \u0080 \u00ff');
  assert.equal(H.sanitizeSign('a - b ~ c'), 'a - b ~ c');
  assert.equal(H.sanitizeSign(42), '42');
  assert.equal(H.sanitizeSign({ toString() { throw new Error('x'); } }), '');
});
