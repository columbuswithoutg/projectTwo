/************************************************
 * CharactersView (js/views/characters.js): boot can remount /characters
 * while the first mount's progress load is still in flight. The late load
 * must not wire a second click / input listener onto the new grid, or one
 * tap opens two stacked detail sheets (CLI2-05).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'views', 'characters.js'), 'utf8');

// Minimal element: records listeners, holds innerHTML/textContent.
function el(id) {
  const listeners = {};
  return {
    id, innerHTML: '', textContent: '', listeners,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
  };
}
// A container whose innerHTML write builds a fresh set of the page's
// elements, like the real DOM replacing the previous mount's nodes.
function container() {
  let els = {};
  return {
    get els() { return els; },
    set innerHTML(_) {
      els = {};
      for (const id of ['back-btn', 'unlocked-count', 'characters-grid', 'search-input']) els[id] = el(id);
    },
    querySelector(sel) { return els[sel.replace(/^#/, '')] || null; }
  };
}

function setup() {
  const pending = [];   // resolvers for /progress/load, in call order
  const opened = [];
  const ctx = {
    API: '/api', console,
    Auth: {
      isLoggedIn: () => true,
      getToken: () => 'tok',
      fetch: () => new Promise(r => pending.push(() => r({ ok: true, json: async () => ({ watchedProjects: [{ projectId: 'ironman1', count: 1 }] }) })))
    },
    Router: { go() {}, back() {} },
    characters: [{ id: 'tony', name: 'Tony Stark', debut: 'ironman1' }, { id: 'pepper', name: 'Pepper', debut: 'ironman1' }],
    characterPageEntries: (list) => list,
    isCharUnlocked: (c, ids) => ids.has(c.debut),
    characterSearch: (list, q) => list.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase())),
    getCharImage: () => '',
    PosterArt: { charHtml: () => '' },
    esc: (s) => String(s),
    // A page that still queries `document` would get the CURRENT mount's
    // nodes here, which is exactly the double-wiring bug.
    document: { getElementById: (id) => current && current.els[id] }
  };
  let current = null;
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.CharactersView = CharactersView;', ctx);
  const V = ctx.CharactersView;
  V._openDetail = (c) => opened.push(c.id);
  const mount = () => { current = container(); V.mount(current); return current; };
  return { V, mount, pending, opened };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const tap = (grid, id) => (grid.listeners.click || []).forEach(fn => fn({ target: { closest: () => ({ dataset: { id } }) } }));

test('overlapping remount: the first mount\'s late load does not wire the new grid (one sheet per tap)', async () => {
  const { V, mount, pending, opened } = setup();
  mount();                    // mount A: progress load in flight
  V.unmount();
  const b = mount();          // boot remounts /characters: mount B
  assert.equal(pending.length, 2);
  pending[0]();               // A's load answers first...
  await tick();
  pending[1]();               // ...then B's
  await tick();
  const grid = b.els['characters-grid'];
  assert.equal((grid.listeners.click || []).length, 1);
  assert.equal((b.els['search-input'].listeners.input || []).length, 1);
  tap(grid, 'tony');
  assert.deepEqual(opened, ['tony']);
  assert.equal(b.els['unlocked-count'].textContent, '2 of 2 unlocked');
});

test('a remount without unmount in between is guarded too, and a load after leaving does nothing', async () => {
  const { V, mount, pending } = setup();
  mount();
  const b = mount();
  pending[1]();
  await tick();
  pending[0]();
  await tick();
  assert.equal((b.els['characters-grid'].listeners.click || []).length, 1);
  V.unmount();
  const before = b.els['characters-grid'].innerHTML;
  const c = mount(); V.unmount();
  pending[2]();
  await tick();
  assert.equal((c.els['characters-grid'].listeners.click || []).length, 0);
  assert.equal(c.els['unlocked-count'].textContent, '');
  assert.equal(b.els['characters-grid'].innerHTML, before);
});
