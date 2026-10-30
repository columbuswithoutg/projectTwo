/************************************************
 * js/walkers.js logic that runs outside the animation loop.
 *
 * The Walkers IIFE is loaded in a vm context with small stubs for the
 * browser globals it touches (state, characters, getCharStages, a fake
 * DOM). It exports itself via the module.exports guard at the bottom of
 * js/walkers.js; helpers are reached through Walkers._debug.
 *
 * Covers MAP2-01 (line-up signature), MAP2-03 (destroy cleanup),
 * MAP2-04 (picker modal + friend-page toggle), MAP2-06 (re-home clamp),
 * MAP2-09 (an empty server list is authoritative), MAP2-09b (unless the
 * server says it was never saved), MAP2-02 (picks stored by look key),
 * MAP2-05 (no adapter = not mounted), MAP2-07 (fights skip walkers in a
 * dialogue) and MAP-13 (a throw in tick doesn't stop the loop).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(root, 'js/walkers.js'), 'utf8');

/* ---- fakes ---- */

function fakeEl(tag = 'div', body) {
  const el = {
    tagName: tag.toUpperCase(), id: '', className: '', style: {}, attrs: {},
    children: [], listeners: {}, removed: 0, innerHTML: '', textContent: '', _q: {},
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); },
      contains(c) { return this.set.has(c); }, toggle() {}
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    click() { (this.listeners.click || []).forEach(fn => fn({ target: this })); },
    remove() {
      this.removed++;
      if (body) body.children = body.children.filter(x => x !== this);
    },
    querySelector(sel) { return this._q[sel] || (this._q[sel] = fakeEl('div', body)); }
  };
  return el;
}

// Characters: each has a debut look plus stage looks unlocked by `after`.
const CHARS = [
  { id: 'thor', name: 'Thor', debut: 'thor1', image: 'thor.jpg',
    stages: [{ after: 'ragnarok', image: 'thor_rag.jpg', label: 'Ragnarok' }] },
  { id: 'cap', name: 'Cap', debut: 'cap1', image: 'cap.jpg', stages: [] }
];
function getCharStagesStub(char, st) {
  const looks = [];
  if (st.data.has(char.debut)) looks.push({ image: char.image, after: char.debut, label: char.name });
  char.stages.forEach(s => { if (st.data.has(s.after)) looks.push(s); });
  return looks;
}

function load({ watched = ['thor1', 'cap1'], storage = {}, loggedIn = false, chars = CHARS, view = null, timers = null, readonly = false } = {}) {
  const body = { children: [], classList: { remove() {}, add() {} } };
  const store = { ...storage };
  const calls = { setItem: [], fetch: [], modal: [] };
  const ctx = {
    console, Math, JSON, Map, Set, Number, Array, Object, Promise,
    performance: { now: () => 1000 },
    setTimeout: timers ? (fn, ms) => { timers.push({ fn, ms }); return timers.length; } : () => 1,
    clearTimeout: () => {},
    requestAnimationFrame: () => { calls.raf = (calls.raf || 0) + 1; return calls.raf; },
    cancelAnimationFrame: () => {},
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); calls.setItem.push([k, String(v)]); }
    },
    document: {
      body,
      createElement: (t) => fakeEl(t, body),
      getElementById: (id) => body.children.find(c => c.id === id) || null,
      querySelector: () => null,
      querySelectorAll: () => []
    },
    LayoutSystem: { sampleAt: () => null },
    WalkerView: { get: () => (view === null ? { container: () => null } : view), mayFrame: () => false },
    Auth: { isLoggedIn: () => loggedIn, getToken: () => 't' },
    API: '/api',
    fetch: (...a) => { calls.fetch.push(a); return Promise.resolve({ json: () => ({}) }); },
    state: { data: new Set(watched), readonly },
    characters: chars,
    getCharStages: getCharStagesStub,
    isCharUnlocked: (c, st) => getCharStagesStub(c, st).length > 0,
    MERGED_CHARACTER_IDS: {},
    projects: [], isVisible: () => true,
    PosterArt: { charHtml: () => '' },
    esc: (s) => String(s),
    toast: () => {},
    wireModalDismiss: (el, closeFn, opts) => {
      let closed = false;
      const close = () => { if (closed) return; closed = true; closeFn(); };
      el._closeModal = close;
      calls.modal.push({ el, closeFn, opts });
      return close;
    },
    module: { exports: {} }
  };
  // Appended body.appendChild must register the overlay in body.children.
  body.appendChild = (c) => { body.children.push(c); return c; };
  vm.runInNewContext(SRC, ctx, { filename: 'js/walkers.js' });
  return { Walkers: ctx.module.exports, ctx, store, calls, body };
}

/* ---- MAP2-01: lineupSignature ---- */

test('lineupSignature ignores the slot count (watching an unrelated title)', () => {
  const { Walkers, ctx } = load({ watched: ['thor1', 'cap1', 'x1'] });
  const entries = [{ id: 'thor', stage: -1 }, { id: 'cap', stage: 0 }];
  const before = Walkers._debug.lineupSignature(entries);
  ctx.state.data.add('x2');                 // slots 3 → 4, looks unchanged
  assert.equal(Walkers._debug.lineupSignature(entries), before);
  assert.doesNotMatch(before, /^\d+\|/, 'signature still carries a slot-count prefix');
});

test('lineupSignature changes when the resolved line-up changes', () => {
  const { Walkers, ctx } = load({ watched: ['thor1', 'cap1'] });
  const latest = [{ id: 'thor', stage: -1 }];
  const before = Walkers._debug.lineupSignature(latest);
  ctx.state.data.add('ragnarok');           // "latest look" now resolves to Ragnarok
  const after = Walkers._debug.lineupSignature(latest);
  assert.notEqual(after, before);
  assert.match(after, /thor_rag\.jpg/);
  // A pinned look is not affected by the new unlock.
  const pinned = [{ id: 'thor', stage: 0 }];
  const p1 = Walkers._debug.lineupSignature(pinned);
  ctx.state.data.add('y');
  assert.equal(Walkers._debug.lineupSignature(pinned), p1);
  // Different entries, different signature.
  assert.notEqual(Walkers._debug.lineupSignature([{ id: 'cap', stage: 0 }]), p1);
});

test('the redeploy check (signature of getSelectedEntries) is stable across a watch', () => {
  const { Walkers, ctx } = load({
    watched: ['thor1', 'cap1'],
    storage: { mcu_walkers: JSON.stringify([{ id: 'thor', stage: 0 }, { id: 'cap', stage: 0 }]) }
  });
  const sig = Walkers._debug.lineupSignature(Walkers.getSelectedEntries());
  ctx.state.data.add('some_new_title');
  assert.equal(Walkers._debug.lineupSignature(Walkers.getSelectedEntries()), sig);
});

/* ---- MAP2-06: re-home clamp ---- */

test('clampIntoRect works on a buildNodeRects-shaped rect and never yields NaN', () => {
  const { Walkers } = load();
  const clamp = (...a) => ({ ...Walkers._debug.clampIntoRect(...a) });   // plain object across the vm realm
  // buildNodeRects shape: left/top/right/bottom + cx/cy, no minX/maxX.
  const rect = { id: 'c', left: 100, top: 50, right: 300, bottom: 150, cx: 200, cy: 100 };
  const cases = [[0, 0], [200, 100], [1000, 1000], [NaN, NaN], [undefined, 120], [Infinity, -Infinity]];
  for (const [x, y] of cases) {
    const p = clamp(rect, x, y, 12);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `NaN for (${x}, ${y}): ${JSON.stringify(p)}`);
    assert.ok(p.x >= 112 && p.x <= 288 && p.y >= 62 && p.y <= 138, `outside rect for (${x}, ${y})`);
  }
  assert.deepEqual(clamp(rect, 0, 0, 12), { x: 112, y: 62 });
  assert.deepEqual(clamp(rect, 150, 90, 12), { x: 150, y: 90 });
  assert.deepEqual(clamp(rect, NaN, NaN, 12), { x: 200, y: 100 });
});

test('the re-home path uses clampIntoRect, not the adapter-only minX/maxX fields', () => {
  assert.doesNotMatch(SRC, /best\.(minX|maxX|minY|maxY)/);
  assert.match(SRC, /clampIntoRect\(best, w\._cx, w\._cy, PHYSICS\.WALKER\.r\)/);
});

/* ---- MAP2-03: destroy ---- */

test('destroy removes every fighter\'s HP bar along with chip, weapon and HP number', () => {
  const { Walkers } = load();
  const parts = () => ({ el: fakeEl(), weaponEl: fakeEl(), hpEl: fakeEl(), hpBarEl: fakeEl() });
  const ws = [parts(), parts(), { el: fakeEl() }];   // the last one never fought
  ws.forEach(w => Walkers._debug.walkers().push(w));
  Walkers.destroy();
  ws.slice(0, 2).forEach(w => {
    for (const k of ['el', 'weaponEl', 'hpEl', 'hpBarEl']) assert.equal(w[k].removed, 1, `${k} left on screen`);
  });
  assert.equal(ws[2].el.removed, 1);
  assert.equal(Walkers._debug.walkers().length, 0);
});

test('fight resolve and revive timers go through fightTimeout (cleared by destroy)', () => {
  const body = (name) => {
    const start = SRC.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name + ' not found');
    let depth = 0;
    for (let i = SRC.indexOf('{', start); i < SRC.length; i++) {
      if (SRC[i] === '{') depth++;
      else if (SRC[i] === '}' && --depth === 0) return SRC.slice(start, i + 1);
    }
  };
  for (const fn of ['handleVillainDefeat', 'handleVillainWins', 'checkFaintedRevives']) {
    assert.doesNotMatch(body(fn), /(^|[^.\w])setTimeout\(/, `${fn} schedules an untracked setTimeout`);
  }
  assert.match(body('destroy'), /fightTimers\.forEach\(t => clearTimeout\(t\)\)/);
});

/* ---- MAP2-04: picker modal + friend page ---- */

test('walker picker is a registered modal; the close button closes it through wireModalDismiss', () => {
  const { Walkers, calls, body } = load();
  Walkers.showWalkerPicker();
  assert.equal(calls.modal.length, 1, 'wireModalDismiss not called');
  const { el, opts } = calls.modal[0];
  assert.equal(el.id, 'walker-picker-overlay');
  const closeBtn = el.querySelector('#walker-picker-close');
  assert.equal(opts.initialFocus, closeBtn);
  assert.equal(el.listeners.click, undefined, 'own backdrop handler bypasses the modal stack');
  closeBtn.click();
  assert.equal(el.removed, 1);
  assert.ok(!body.children.includes(el));
  // Reopening replaces an open picker through its registered close.
  Walkers.showWalkerPicker();
  const first = calls.modal[1].el;
  Walkers.showWalkerPicker();
  assert.equal(first.removed, 1);
  assert.equal(body.children.filter(c => c.id === 'walker-picker-overlay').length, 1);
});

test('toggleCharacter is a no-op while a friend\'s line-up is shown', () => {
  const own = JSON.stringify([{ id: 'cap', stage: 0 }]);
  const { Walkers, store, calls, body } = load({ storage: { mcu_walkers: own }, loggedIn: true });
  Walkers.deployWithSelections([{ id: 'thor', stage: 0 }]);
  calls.setItem.length = 0; calls.fetch.length = 0;
  assert.equal(Walkers.toggleCharacter('cap', 0), false);
  assert.equal(Walkers.toggleCharacter('thor', 0), false);
  // A card click in the picker during a friend visit doesn't save either.
  Walkers.showWalkerPicker();
  const overlay = body.children.find(c => c.id === 'walker-picker-overlay');
  const grid = overlay.querySelector('#walker-picker-grid');
  grid.children.forEach(card => card.click());
  assert.equal(calls.setItem.filter(([k]) => k === 'mcu_walkers').length, 0);
  assert.equal(calls.fetch.length, 0);
  assert.equal(store.mcu_walkers, own);
  // Back on the user's own line-up, toggling works again.
  Walkers.restoreSelections();
  assert.equal(Walkers.toggleCharacter('thor', '@base'), true);
  // (The legacy { stage: 0 } is stored by look key now — MAP2-02.)
  assert.deepEqual(JSON.parse(store.mcu_walkers), [{ id: 'cap', look: '@base' }, { id: 'thor', look: '@base' }]);
});

/* ---- MAP2-09: loadFromServer ---- */

function runLoadFromServer(serverWalkers, saved) {
  const start = SRC.indexOf('async function loadFromServer(');
  assert.ok(start >= 0, 'loadFromServer not found');
  let depth = 0, end = -1;
  for (let i = SRC.indexOf('{', start); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const store = { mcu_walkers: JSON.stringify([{ id: 'thor', stage: 0 }]) };
  const posted = [];
  const ctx = {
    STORAGE_KEY: 'mcu_walkers', API: '/api', JSON, Array,
    Auth: { isLoggedIn: () => true, getToken: () => 't' },
    fetch: async () => ({ json: async () => (saved === undefined ? { walkers: serverWalkers } : { walkers: serverWalkers, saved }) }),
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    normalizeEntry: (e) => e,
    postSelections: (list) => posted.push(list)
  };
  vm.runInNewContext(SRC.slice(start, end) + '\nthis.p = loadFromServer();', ctx);
  return ctx.p.then(() => Object.assign(store, { posted }));
}

test('loadFromServer: an empty server list clears the local picks (other device deselected all)', async () => {
  assert.equal((await runLoadFromServer([])).mcu_walkers, '[]');
  assert.equal((await runLoadFromServer([{ id: 'cap', stage: 0 }])).mcu_walkers, JSON.stringify([{ id: 'cap', stage: 0 }]));
  // A malformed response leaves local picks alone.
  assert.equal((await runLoadFromServer(undefined)).mcu_walkers, JSON.stringify([{ id: 'thor', stage: 0 }]));
});

test('loadFromServer: a never-saved empty list keeps the local picks and uploads them once (MAP2-09b)', async () => {
  const kept = await runLoadFromServer([], false);
  assert.equal(kept.mcu_walkers, JSON.stringify([{ id: 'thor', stage: 0 }]));
  assert.deepEqual(kept.posted, [[{ id: 'thor', stage: 0 }]]);
  // Saved and cleared on another device: authoritative, nothing uploaded.
  const cleared = await runLoadFromServer([], true);
  assert.equal(cleared.mcu_walkers, '[]');
  assert.deepEqual(cleared.posted, []);
  // A non-empty list always wins.
  const other = await runLoadFromServer([{ id: 'cap', look: '@base' }], false);
  assert.equal(other.mcu_walkers, JSON.stringify([{ id: 'cap', look: '@base' }]));
});

/* ---- MAP2-02: picks stored by look key ---- */

// Fisk: the debut (daredevil1) and a Kingpin look unlocked by hawkeye.
// Groot: a stage unlocked at his own debut, so `after` alone can't be the key.
const LOOK_CHARS = [
  { id: 'fisk', name: 'Fisk', debut: 'daredevil1', image: 'fisk.jpg',
    stages: [{ after: 'hawkeye', image: 'kingpin.jpg', label: 'Kingpin' }] },
  { id: 'groot', name: 'Groot', debut: 'g1', image: 'groot.jpg',
    stages: [{ after: 'g1', image: 'babygroot.jpg', label: 'Baby' }, { after: 'g2', image: 'teen.jpg', label: 'Teen' }] }
];
const images = (Walkers) => Walkers.getSelectedEntries().map(e => {
  const ch = LOOK_CHARS.find(c => c.id === e.id);
  return Walkers._debug.resolveLook(e, ch).image;
});

test('a look pick survives an earlier look unlocking, and an un-watch keeps it in storage', () => {
  const { Walkers, ctx, store } = load({ chars: LOOK_CHARS, watched: ['hawkeye', 'x1'] });
  assert.equal(Walkers.toggleCharacter('fisk', 'hawkeye'), true);
  assert.deepEqual(JSON.parse(store.mcu_walkers), [{ id: 'fisk', look: 'hawkeye' }]);
  assert.deepEqual(images(Walkers), ['kingpin.jpg']);
  // Watching the debut puts the default look at index 0: still Kingpin.
  ctx.state.data.add('daredevil1');
  assert.deepEqual(images(Walkers), ['kingpin.jpg']);
  // Un-watching hawkeye locks the look: not deployed, but not deleted...
  ctx.state.data.delete('hawkeye');
  assert.deepEqual(Walkers.getSelectedEntries(), []);
  // ...not even by toggling another pick.
  assert.equal(Walkers.toggleCharacter('fisk', '@base'), true);
  assert.deepEqual(JSON.parse(store.mcu_walkers), [{ id: 'fisk', look: 'hawkeye' }, { id: 'fisk', look: '@base' }]);
  ctx.state.data.add('hawkeye');
  assert.deepEqual(images(Walkers), ['kingpin.jpg', 'fisk.jpg']);
});

test('picks past the slot count stay stored and come back when a slot opens', () => {
  const { Walkers, ctx, store } = load({ chars: LOOK_CHARS, watched: ['daredevil1', 'hawkeye', 'g1'],
    storage: { mcu_walkers: JSON.stringify([{ id: 'fisk', look: '@base' }, { id: 'fisk', look: 'hawkeye' }, { id: 'groot', look: '@base' }, { id: 'groot', look: 'g1' }]) } });
  assert.equal(Walkers.getSelectedEntries().length, 3);                  // 3 watched = 3 slots
  assert.equal(Walkers.toggleCharacter('fisk', '@base'), true);           // remove one
  assert.equal(JSON.parse(store.mcu_walkers).length, 3);
  assert.deepEqual(images(Walkers), ['kingpin.jpg', 'groot.jpg', 'babygroot.jpg']);
  ctx.state.data.delete('g1');                                            // 2 slots; groot locked
  assert.deepEqual(images(Walkers), ['kingpin.jpg']);
  assert.equal(JSON.parse(store.mcu_walkers).length, 3);
});

test('look keys: the debut look is @base even when a stage unlocks at the debut; stage -1 is not frozen', () => {
  const { Walkers, ctx, store, calls } = load({ chars: LOOK_CHARS, watched: ['g1'],
    storage: { mcu_walkers: JSON.stringify([{ id: 'groot', stage: -1 }]) } });
  const groot = LOOK_CHARS[1];
  assert.equal(Walkers._debug.lookKeyOf(groot, { after: 'g1', image: 'groot.jpg' }), '@base');
  assert.equal(Walkers._debug.lookKeyOf(groot, groot.stages[0]), 'g1');
  assert.deepEqual(images(Walkers), ['babygroot.jpg']);
  ctx.state.data.add('g2');
  assert.deepEqual(images(Walkers), ['teen.jpg'], '-1 should follow the newest look');
  assert.equal(calls.setItem.length, 0, 'resolving -1 must not re-save the list');
  assert.equal(store.mcu_walkers, JSON.stringify([{ id: 'groot', stage: -1 }]));
});

test('legacy index entries are mapped to look keys once, against the user\'s own progress', () => {
  const legacy = JSON.stringify([{ id: 'fisk', stage: 1 }, { id: 'groot', stage: 0 }, { id: 'groot', stage: 9 }, 'fisk']);
  const { Walkers, store, calls } = load({ chars: LOOK_CHARS, watched: ['daredevil1', 'hawkeye', 'g1', 'x', 'y'], storage: { mcu_walkers: legacy } });
  Walkers.getSelectedEntries();
  assert.deepEqual(JSON.parse(store.mcu_walkers), [
    { id: 'fisk', look: 'hawkeye' },      // index 1 of [Default, Kingpin]
    { id: 'groot', look: '@base' },       // index 0 of [Default, Baby]
    { id: 'groot', look: 'g1' },          // past the end: highest unlocked
    { id: 'fisk', stage: -1 }             // a bare id stays "latest"
  ]);
  const writes = calls.setItem.length;
  Walkers.getSelectedEntries();
  assert.equal(calls.setItem.length, writes, 'mapped more than once');
  // Not on a friend's swapped-in data, and not before progress has loaded.
  for (const opts of [{ readonly: true, watched: ['hawkeye'] }, { watched: [] }]) {
    const r = load({ chars: LOOK_CHARS, storage: { mcu_walkers: legacy }, ...opts });
    r.Walkers.getSelectedEntries();
    assert.equal(r.store.mcu_walkers, legacy);
  }
});

test('the picker ticks and toggles by look key, and names a stage look shown first', () => {
  const { Walkers, body, store } = load({ chars: LOOK_CHARS, watched: ['hawkeye'],
    storage: { mcu_walkers: JSON.stringify([{ id: 'fisk', look: 'hawkeye' }]) } });
  Walkers.showWalkerPicker();
  const grid = body.children.find(c => c.id === 'walker-picker-overlay').querySelector('#walker-picker-grid');
  assert.equal(grid.children.length, 1);
  const card = grid.children[0];
  assert.match(card.innerHTML, /Fisk — Kingpin/);
  assert.match(card.className, /selected/);
  card.click();
  assert.deepEqual(JSON.parse(store.mcu_walkers), []);
});

/* ---- MAP2-05: no adapter = not mounted ---- */

test('deploy() with no WalkerView adapter is a no-op (a view unmounted)', () => {
  const { Walkers, ctx, calls } = load({ storage: { mcu_walkers: JSON.stringify([{ id: 'thor', look: '@base' }]) } });
  ctx.WalkerView.get = () => null;
  assert.doesNotThrow(() => Walkers.deploy());
  assert.doesNotThrow(() => Walkers.restoreSelections());
  assert.equal(Walkers._debug.walkers().length, 0);
  assert.equal(calls.raf || 0, 0);
});

test('SharedOrderView.unmount stops the walkers and clears the adapter; every walker view clears it', () => {
  const src = fs.readFileSync(path.join(root, 'js/views/shared.js'), 'utf8');
  const log = [];
  const ctx = {
    Walkers: { destroy() { log.push('destroy'); } },
    WalkerView: { set(a) { log.push(['set', a]); } },
    orderRenderer: { destroy() { log.push('renderer'); } }
  };
  vm.runInNewContext(src + '\nthis.SharedOrderView = SharedOrderView;', ctx);
  ctx.SharedOrderView.unmount();
  assert.deepEqual(JSON.parse(JSON.stringify(log)), ['destroy', ['set', null], 'renderer']);
  for (const f of ['app.js', 'watchorder.js', 'friend-watch.js', 'friend-map.js']) {
    const s = fs.readFileSync(path.join(root, 'js/views', f), 'utf8');
    const unmount = s.slice(s.indexOf('unmount()'));
    assert.match(unmount, /Walkers\.destroy\(\);[\s\S]*?WalkerView\.set\(null\)/, f + ' unmount leaves the adapter set');
  }
});

/* ---- MAP2-07: fights vs dialogues ---- */

function fightRig() {
  const timers = [];
  const container = fakeEl();
  const view = { container: () => container, clusterOf: () => 'c1', nodePosition: () => ({ x: 0, y: 0 }) };
  const r = load({ view, timers });
  r.ctx.WALKER_DIALOGUES = { getDialogue: () => [{ speaker: 'thor', text: 'hi' }], getKey: () => 'k' };
  r.ctx.WALKER_STATS = { _default: { hp: 100 } };
  r.ctx.randBetween = (lo) => lo;
  const mk = (id, x) => ({ id, charId: id, el: fakeEl(), weaponEl: fakeEl(), hpEl: fakeEl(), hpBarEl: fakeEl(),
    clusterId: 'c1', location: 'node', _spawned: true, state: 'walking', currentNode: 'n1', _cx: x, _cy: 0, vx: 0, vy: 0 });
  return { ...r, timers, mk };
}

test('joinFight skips walkers mid-dialogue; the dialogue end only releases walkers still in it', () => {
  const { Walkers, timers, mk } = fightRig();
  const a = mk('thor', 0), b = mk('cap', 5), c = mk('hulk', 10);
  const villain = mk('loki', 0);
  [a, b, c, villain].forEach(w => Walkers._debug.walkers().push(w));
  Walkers._debug.queueEncounter(a, b);
  assert.equal(a.state, 'encounter');
  Walkers._debug.fights().set('n1', { villain, participants: new Set(), nodeId: 'n1' });
  Walkers._debug.joinFight('n1');
  const fight = Walkers._debug.fights().get('n1');
  assert.ok(fight.participants.has(c));
  assert.ok(!fight.participants.has(a) && !fight.participants.has(b), 'a talking walker was enrolled');
  assert.equal(a.state, 'encounter');
  // Had one been enrolled anyway (or joined later), the end timer leaves it fighting.
  a.state = 'fighting';
  const end = timers[timers.length - 1];
  end.fn();
  assert.equal(a.state, 'fighting');
  assert.equal(b.state, 'walking');
});

/* ---- MAP-13: a throw in tick ---- */

test('a throw inside tick is logged once and the loop keeps going; destroy stops it', () => {
  const { Walkers, ctx, calls } = load();
  const errors = [];
  ctx.console = { ...console, error: (...a) => errors.push(a) };
  ctx.WalkerView.get = () => { throw new Error('boom'); };
  Walkers._debug.walkers().push({ el: fakeEl() });
  Walkers._debug.tick(16);
  Walkers._debug.tick(32);
  assert.equal(calls.raf, 2, 'next frame not scheduled after a throw');
  assert.equal(errors.length, 1);
  ctx.WalkerView.get = () => ({ container: () => null });
  Walkers.destroy();
  Walkers._debug.tick(48);
  assert.equal(calls.raf, 2, 'loop kept running after destroy');
});
