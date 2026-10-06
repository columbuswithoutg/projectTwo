/************************************************
 * Unit tests for js/project-logic.js — prerequisite loops, list validation
 * and free board cells for the admin project editor (and routes/admin.js).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/project-logic.js');
const contentLoader = require('../server/contentLoader.js');

contentLoader.init();
const BUNDLED = contentLoader.get('projects');

const P = (id, extra) => Object.assign({ id, phase: 'Phase 1', prerequisites: [] }, extra);

test('the bundled projects.js has no lock loops (phase unlockers included)', () => {
  assert.ok(BUNDLED.length > 50);
  for (const p of BUNDLED) {
    assert.equal(L.findPrereqCycle(BUNDLED, p), null, `loop through ${p.id}`);
  }
});

test('lockDeps: required + hidden + the phase unlocker', () => {
  const deps = L.lockDeps(P('x', { phase: 'Phase 3', prerequisites: ['a'], hiddenPrerequisites: ['b'] }));
  assert.deepEqual(deps, [
    { id: 'a', via: 'required' },
    { id: 'b', via: 'hidden' },
    { id: 'ageofultron', via: 'phase' }
  ]);
  assert.deepEqual(L.lockDeps(P('y')), []);
});

test('findPrereqCycle: a direct two-project loop', () => {
  const projects = [P('a', { prerequisites: ['b'] }), P('b')];
  const loop = L.findPrereqCycle(projects, { id: 'b', prerequisites: ['a'] });
  assert.deepEqual(loop.map((s) => s.id), ['b', 'a', 'b']);
  assert.equal(L.findPrereqCycle(projects, { id: 'b', prerequisites: [] }), null);
});

test('findPrereqCycle: a transitive loop through a hidden prerequisite', () => {
  const projects = [P('a', { hiddenPrerequisites: ['c'] }), P('b', { prerequisites: ['a'] }), P('c')];
  const loop = L.findPrereqCycle(projects, { id: 'c', prerequisites: ['b'] });
  assert.deepEqual(loop.map((s) => s.id), ['c', 'b', 'a', 'c']);
  assert.equal(loop[loop.length - 1].via, 'hidden');
});

test('findPrereqCycle: a loop closed by a phase unlocker', () => {
  // avengers1 unlocks Phase 2; requiring a Phase 2 title closes the loop.
  const projects = [P('avengers1'), P('ironman2', { phase: 'Phase 2' })];
  const loop = L.findPrereqCycle(projects, { id: 'avengers1', prerequisites: ['ironman2'] });
  assert.deepEqual(loop.map((s) => s.id), ['avengers1', 'ironman2', 'avengers1']);
  assert.equal(loop[2].via, 'phase');
  // The unlocker moved into its own phase waits on itself.
  const self = L.findPrereqCycle(projects, { id: 'avengers1', phase: 'Phase 2' });
  assert.deepEqual(self.map((s) => s.id), ['avengers1', 'avengers1']);
});

test('findPrereqCycle: requiring yourself is a loop; unknown ids are not', () => {
  assert.ok(L.findPrereqCycle([P('a')], { id: 'a', prerequisites: ['a'] }));
  assert.equal(L.findPrereqCycle([P('a')], { id: 'a', prerequisites: ['ghost'] }), null);
});

test('dependentsOf: everything that waits on a project, transitively', () => {
  const projects = [P('a'), P('b', { prerequisites: ['a'] }), P('c', { prerequisites: ['b'] }), P('d')];
  assert.deepEqual([...L.dependentsOf(projects, 'a')].sort(), ['b', 'c']);
  assert.deepEqual([...L.dependentsOf(projects, 'd')], []);
  // Phase edges count: every Phase 2 title waits on avengers1.
  const withPhase = [P('avengers1'), P('ironman2', { phase: 'Phase 2' })];
  assert.ok(L.dependentsOf(withPhase, 'avengers1').has('ironman2'));
  assert.deepEqual(L.requiredBy(projects, 'a'), ['b']);
});

test('validatePrereqLists: explicit errors, never silent trimming', () => {
  const known = new Set(['a', 'b', 'c', 'x']);
  let r = L.validatePrereqLists({ id: 'x', prerequisites: ['a', 'a', 'b'], recommendedPrerequisites: ['c'] }, known);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.required, ['a', 'b']);            // de-duplicated
  r = L.validatePrereqLists({ id: 'x', prerequisites: ['a', 'ghost'] }, known);
  assert.deepEqual(r.errors, [{ code: 'unknown', list: 'required', ids: ['ghost'] }]);
  r = L.validatePrereqLists({ id: 'x', prerequisites: ['x'] }, known);
  assert.equal(r.errors[0].code, 'self');
  r = L.validatePrereqLists({ id: 'x', prerequisites: ['a'], recommendedPrerequisites: ['a'] }, known);
  assert.deepEqual(r.errors, [{ code: 'both', ids: ['a'] }]);
  r = L.validatePrereqLists({ id: 'x', prerequisites: ['bad id!'] }, known);
  assert.equal(r.errors[0].code, 'bad-id');
  r = L.validatePrereqLists({ id: 'x', prerequisites: 'a' }, known);
  assert.equal(r.errors[0].code, 'not-a-list');
  const many = Array.from({ length: 21 }, (_, i) => 'p' + i);
  r = L.validatePrereqLists({ id: 'x', prerequisites: many }, new Set(many), { max: 20 });
  assert.deepEqual(r.errors, [{ code: 'too-many', list: 'required', max: 20, count: 21 }]);
  assert.equal(r.required.length, 21);                 // nothing dropped
});

test('errorText names titles, including a loop', () => {
  const titles = { a: 'Thor: Ragnarok', b: 'Age of Ultron' };
  const t = (id) => titles[id] || id;
  const loop = [{ id: 'a' }, { id: 'b' }, { id: 'a' }];
  assert.match(L.errorText({ code: 'cycle', path: loop }, t), /^Thor: Ragnarok → Age of Ultron → Thor: Ragnarok: /);
  assert.match(L.errorText({ code: 'unknown', list: 'required', ids: ['ghost'] }, t), /ghost/);
});

test('firstFreeCell: the anchor if free, then rings in a fixed order', () => {
  const occ = L.occupiedCells([P('a', { gridX: 0, gridY: 0 }), P('b', { gridX: 0, gridY: -1 })]);
  assert.deepEqual(L.firstFreeCell(occ, { anchor: { gx: 5, gy: 5 } }), { gx: 5, gy: 5 });
  // (0,0) taken → ring 1 starts at the top-left corner (-1,-1).
  assert.deepEqual(L.firstFreeCell(occ, { anchor: { gx: 0, gy: 0 } }), { gx: -1, gy: -1 });
  // A full search area → null.
  const full = new Map([['0,0', 'a']]);
  assert.equal(L.firstFreeCell(full, { anchor: { gx: 0, gy: 0 }, maxRadius: 0 }), null);
});

test('defaultNewCell lands below the lowest row and never on a project', () => {
  const projects = [P('a', { gridX: 0, gridY: 3 }), P('b', { gridX: 2, gridY: 7 })];
  assert.deepEqual(L.defaultNewCell(projects), { gx: 0, gy: 8 });
  const cell = L.defaultNewCell(BUNDLED);
  assert.ok(!L.occupiedCells(BUNDLED).has(`${cell.gx},${cell.gy}`));
  assert.deepEqual(L.defaultNewCell([]), { gx: 0, gy: 0 });
});
