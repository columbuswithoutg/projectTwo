/************************************************
 * Unit tests for server/admin-sanitize.js — the pure payload validators
 * behind routes/admin.js (config, CMS projects / characters / locations /
 * dialogues, the board's bulk positions) and routes/admin-scenes.js
 * (Scene Guess still time + episode).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../server/admin-sanitize.js');
const SceneLogic = require('../js/scene-guess-logic.js');

// ---------- config ----------

test('pickNumber: range, integer rule, non-numbers', () => {
  const rule = { min: 0, max: 10 };
  assert.equal(S.pickNumber(5, rule), 5);
  assert.equal(S.pickNumber(0, rule), 0);
  assert.equal(S.pickNumber(11, rule), null);
  assert.equal(S.pickNumber(-1, rule), null);
  assert.equal(S.pickNumber('5', rule), null);
  assert.equal(S.pickNumber(NaN, rule), null);
  assert.equal(S.pickNumber(Infinity, { min: 0, max: Infinity }), null);
  assert.equal(S.pickNumber(2.5, { min: 0, max: 10, integer: true }), null);
  assert.equal(S.pickNumber(2, { min: 0, max: 10, integer: true }), 2);
});

test('diffConfig: changed leaves only, one nested level per NPC', () => {
  const prev = { walker: { speed: 40, pauseMin: 100 }, world: { npcBodyTypes: { thor: 0, hulk: 1 } } };
  const next = { walker: { speed: 50, pauseMin: 100 }, world: { npcBodyTypes: { thor: 1, hulk: 1 } }, flags: { fightsEnabled: true } };
  assert.deepEqual(S.diffConfig(prev, next), {
    'walker.speed': { from: 40, to: 50 },
    'world.npcBodyTypes.thor': { from: 0, to: 1 },
    'flags.fightsEnabled': { from: undefined, to: true }
  });
  assert.deepEqual(S.diffConfig(null, null), {});
});

// ---------- projects ----------

test('sanitizeProject: invalid id / required title field codes', () => {
  assert.deepEqual(S.sanitizeProject({ id: 'bad id!', title: '' }, true).errors, { id: 'invalid id', title: 'required' });
  assert.deepEqual(S.sanitizeProject({ title: '   ' }, true).errors, { id: 'invalid id', title: 'required' });
  const ok = S.sanitizeProject({ id: 'ironman1', title: 'Iron Man' }, true);
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.out.id, 'ironman1');
  // An edit (requireId false) never carries an id.
  assert.equal('id' in S.sanitizeProject({ id: 'x', title: 'T' }, false).out, false);
});

test('sanitizeProject: omitted gridX/gridY stay omitted (a form save must not reset the board to 0,0)', () => {
  const { out } = S.sanitizeProject({ title: 'Iron Man' }, false);
  assert.equal('gridX' in out, false);
  assert.equal('gridY' in out, false);
  const moved = S.sanitizeProject({ title: 'Iron Man', gridX: 3, gridY: -4 }, false).out;
  assert.equal(moved.gridX, 3);
  assert.equal(moved.gridY, -4);
});

test('sanitizeProject: runtime is ignored for a series, bounded strings', () => {
  const series = S.sanitizeProject({ title: 'Loki', runtime: 90, episodes: [50, 'x', 55] }, false).out;
  assert.deepEqual(series.episodes, [50, 55]);
  assert.equal(series.runtime, 0);
  const movie = S.sanitizeProject({ title: 'Iron Man', runtime: 126.4 }, false).out;
  assert.deepEqual(movie.episodes, []);
  assert.equal(movie.runtime, 126);
  assert.equal(S.sanitizeProject({ title: 'x'.repeat(400) }, false).out.title.length, S.STR_MAX);
});

// MAP-14: integers within ±GRID_LIMIT, as field errors (no more clamp to ±500).
test('sanitizeProject: gridX/gridY must be integers within ±GRID_LIMIT', () => {
  const L = S.GRID_LIMIT;
  assert.equal(L, 60);
  assert.deepEqual(S.sanitizeProject({ title: 'T', gridX: L, gridY: -L }, false).errors, {});
  assert.deepEqual(S.sanitizeProject({ title: 'T', gridX: L + 1, gridY: -500 }, false).errors, { gridX: 'out of range', gridY: 'out of range' });
  assert.deepEqual(S.sanitizeProject({ title: 'T', gridX: 1.5, gridY: '3' }, false).errors, { gridX: 'invalid', gridY: 'invalid' });
  assert.deepEqual(S.sanitizeProject({ title: 'T', gridX: null }, false).errors, { gridX: 'invalid' });
});

test('the bundled board fits inside ±GRID_LIMIT', () => {
  const contentLoader = require('../server/contentLoader.js');
  for (const p of contentLoader.get('projects')) {
    assert.ok(Math.abs(p.gridX | 0) <= S.GRID_LIMIT && Math.abs(p.gridY | 0) <= S.GRID_LIMIT, p.id);
  }
});

test('parsePositions: a cell past ±GRID_LIMIT names the axis', () => {
  const r = S.parsePositions([{ id: 'a', gridX: 61, gridY: 0 }]);
  assert.equal(r.error, 'Coordinates must be between -60 and 60');
  assert.deepEqual(r.fields, { id: 'a', gridX: 'out of range' });
  assert.deepEqual(S.parsePositions([{ id: 'a', gridX: 0, gridY: -500 }]).fields, { id: 'a', gridY: 'out of range' });
  assert.ok(S.parsePositions([{ id: 'a', gridX: -60, gridY: 60 }]).wanted);
});

test('parsePositions: shape errors', () => {
  assert.equal(S.parsePositions(null).error, 'positions must be an array');
  assert.match(S.parsePositions(new Array(S.POSITIONS_MAX + 1).fill({})).error, /At most/);
  assert.equal(S.parsePositions([null]).error, 'Invalid position entry');
  assert.deepEqual(S.parsePositions([{ id: 'a b', gridX: 0, gridY: 0 }]).fields, { id: 'a b' });
  assert.equal(S.parsePositions([{ id: 'a', gridX: 0, gridY: 0 }, { id: 'a', gridX: 1, gridY: 0 }]).error, 'Duplicate id in payload');
  assert.equal(S.parsePositions([{ id: 'a', gridX: 0.5, gridY: 0 }]).error, 'gridX/gridY must be integers');
  const ok = S.parsePositions([{ id: 'a', gridX: 1, gridY: 2 }]);
  assert.deepEqual([...ok.wanted], [['a', { gridX: 1, gridY: 2 }]]);
});

test('planPositions: wanted moves merge over saved positions; conflicts reported, nothing changed in place', () => {
  const all = [{ id: 'a', gridX: 0, gridY: 0 }, { id: 'b', gridX: 1, gridY: 0 }, { id: 'c', gridX: 2, gridY: 0 }];
  const snapshot = JSON.stringify(all);
  // Swap a and b: each lands on the other's saved cell — fine once merged.
  const swap = S.planPositions(all, new Map([['a', { gridX: 1, gridY: 0 }], ['b', { gridX: 0, gridY: 0 }]]));
  assert.deepEqual(swap.conflicts, []);
  assert.deepEqual(swap.changes.map(c => c.id), ['a', 'b']);
  assert.deepEqual(swap.next, [{ id: 'a', gridX: 1, gridY: 0 }, { id: 'b', gridX: 0, gridY: 0 }, { id: 'c', gridX: 2, gridY: 0 }]);
  // Moving a onto c (which stays put) is a conflict.
  const clash = S.planPositions(all, new Map([['a', { gridX: 2, gridY: 0 }]]));
  assert.deepEqual(clash.conflicts, [{ gridX: 2, gridY: 0, ids: ['a', 'c'] }]);
  // A "move" to the saved cell is no change.
  assert.deepEqual(S.planPositions(all, new Map([['c', { gridX: 2, gridY: 0 }]])).changes, []);
  assert.equal(JSON.stringify(all), snapshot);
});

// ---------- characters / locations ----------

test('sanitizeCharacter: field codes, stages need `after`', () => {
  assert.deepEqual(S.sanitizeCharacter({ id: '', name: '' }, true).errors, { id: 'invalid id', name: 'required' });
  const { out } = S.sanitizeCharacter({ id: 'ironman', name: 'Iron Man', stages: [{ after: 'avengers1' }, { image: 'x' }, null] }, true);
  assert.deepEqual(out.stages, [{ after: 'avengers1', image: '', look: '' }]);
});

const LOC = { id: 'nyc', label: 'Manhattan', worldX: 2700, worldY: 1000, width: 380, height: 220, clusterRadius: 130, region: 'nyc' };

test('sanitizeLocation: invalid id / required label', () => {
  assert.deepEqual(S.sanitizeLocation({ ...LOC, id: 'no spaces', label: '' }, true).errors, { id: 'invalid id', label: 'required' });
  const ok = S.sanitizeLocation(LOC, true);
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.out, LOC);
});

// ADM-11: no more silent fallback to 0 / the default sizes.
test('sanitizeLocation: create needs every number; bad numbers are field errors', () => {
  assert.deepEqual(S.sanitizeLocation({ id: 'x', label: 'X' }, true).errors, {
    worldX: 'required', worldY: 'required', width: 'required', height: 'required', clusterRadius: 'required'
  });
  assert.deepEqual(S.sanitizeLocation({ ...LOC, worldX: null, worldY: 'a', width: 0, height: -5, clusterRadius: -1 }, true).errors, {
    worldX: 'invalid', worldY: 'invalid', width: 'invalid', height: 'invalid', clusterRadius: 'invalid'
  });
  assert.deepEqual(S.sanitizeLocation({ ...LOC, clusterRadius: 0, worldX: -3 }, true).errors, {});
});

test('sanitizeLocation: an edit keeps numbers it does not send, rejects bad ones it does', () => {
  const { out, errors } = S.sanitizeLocation({ label: 'Manhattan', worldY: 50 }, false);
  assert.deepEqual(errors, {});
  assert.deepEqual(Object.keys(out).sort(), ['label', 'region', 'worldY']);
  assert.deepEqual(S.sanitizeLocation({ label: 'Manhattan', worldX: NaN }, false).errors, { worldX: 'invalid' });
});

// ---------- dialogues ----------

test('sanitizePairs: a non-canonical (unsorted) pair key is dropped', () => {
  const ex = [{ requires: 'avengers1', lines: ['Hi', 'Hello'] }];
  const { out, errors } = S.sanitizePairs({ 'thor|loki': ex, 'loki|thor': ex, 'bad key': ex });
  assert.deepEqual(Object.keys(out), ['loki|thor']);
  assert.deepEqual(errors, {});
});

test('sanitizePairs: an exchange needs `requires` and two lines', () => {
  const { out } = S.sanitizePairs({ 'a|b': [{ requires: '', lines: ['x', 'y'] }, { requires: 'p', lines: ['x'] }] });
  assert.deepEqual(out, {});
});

test('sanitizeVillainLines: bad keys and non-arrays dropped', () => {
  assert.deepEqual(S.sanitizeVillainLines({ 'bad key': ['x'], loki: 'x', thanos: ['I am inevitable'] }).out, { thanos: ['I am inevitable'] });
});

// ADM-07: trim + drop blanks; too many / too long is an error, not a cut.
test('dialogue lines: trimmed, blanks dropped (blank-only exchanges no longer count)', () => {
  const { out, errors } = S.sanitizePairs({ 'a|b': [{ requires: 'p', lines: ['  Hi ', '', '   ', 'Hello'] }, { requires: 'p', lines: ['x', '  '] }] });
  assert.deepEqual(errors, {});
  assert.deepEqual(out['a|b'].map(e => e.lines), [['Hi', 'Hello']]);
  assert.deepEqual(S.sanitizeVillainLines({ thanos: ['', ' Snap ', '  '], loki: [' '] }).out, { thanos: ['Snap'] });
});

test('dialogue lines: over DIALOG_LINES_MAX lines or DIALOG_LINE_MAX chars → field errors', () => {
  const many = Array.from({ length: S.DIALOG_LINES_MAX + 1 }, (_, i) => 'line ' + i);
  const long = ['ok', 'y'.repeat(S.DIALOG_LINE_MAX + 1)];
  const p = S.sanitizePairs({ 'a|b': [{ requires: 'p', lines: ['x', 'y'] }, { requires: 'p', lines: many }, { requires: 'p', lines: long }] });
  assert.deepEqual(p.errors, { 'pairs.a|b.1': 'at most 12 lines', 'pairs.a|b.2': 'line 2 is over 600 characters' });
  // Exactly at the limits is fine (and nothing is cut).
  const edge = Array.from({ length: S.DIALOG_LINES_MAX }, () => 'z'.repeat(S.DIALOG_LINE_MAX));
  const e = S.sanitizePairs({ 'a|b': [{ requires: 'p', lines: edge }] });
  assert.deepEqual(e.errors, {});
  assert.deepEqual(e.out['a|b'][0].lines, edge);
  const v = S.sanitizeVillainLines({ thanos: many, loki: long }, 'villainDefeatLines');
  assert.deepEqual(v.errors, { 'villainDefeatLines.thanos': 'at most 12 lines', 'villainDefeatLines.loki': 'line 2 is over 600 characters' });
});

// ---------- Scene Guess stills ----------

test('parseEpisode: null-ish → null, integers, NaN otherwise', () => {
  assert.equal(S.parseEpisode(undefined), null);
  assert.equal(S.parseEpisode(''), null);
  assert.equal(S.parseEpisode('null'), null);
  assert.equal(S.parseEpisode('0'), 0);
  assert.equal(S.parseEpisode(2), 2);
  assert.ok(Number.isNaN(S.parseEpisode('1.5')));
  assert.ok(Number.isNaN(S.parseEpisode('two')));
});

test('checkFields: series vs movie episode handling', () => {
  const movie = SceneLogic.timeline({ runtime: 120 });
  const series = SceneLogic.timeline({ episodes: [40, 40] });
  assert.deepEqual(S.checkFields(movie, '1:00', 'null'), { ok: true, fields: { timeSec: 60, episode: null } });
  assert.deepEqual(S.checkFields(movie, '1:00', '2'), { ok: false, error: 'Movies have no episodes.' });
  assert.deepEqual(S.checkFields(series, '1:00', '0'), { ok: true, fields: { timeSec: 60, episode: 0 } });
  assert.equal(S.checkFields(series, '1:00', 'null').ok, false);
  assert.equal(S.checkFields(series, '1:00', 'x').error, 'Pick an episode.');
  assert.equal(S.checkFields(movie, 'soon', null).error, 'Enter the time as h:mm:ss, m:ss or seconds.');
});
