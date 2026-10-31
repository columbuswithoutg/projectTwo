/************************************************
 * MapRenderer pin click — which map / shelf pins open their popup.
 * A watched title always opens on your own map (NodeFactory never marks it
 * locked); an unwatched title needs its prerequisites; a friend's map opens
 * only watched titles.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fakeRoot() {
  const listeners = {};
  return {
    listeners,
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
  };
}

// Loads js/renderer.js with stubbed globals, wires its event delegation onto
// fake containers and returns a click(id) helper plus the opened popups.
function load({ watched, unlocked, readonly = false }) {
  const opened = [];
  const ids = ['deadpool1', 'xmen-origins'];
  const ctx = {
    CONFIG_WORLD: { zoomDefault: 1 },
    state: {
      readonly,
      byId: new Map(ids.map((id) => [id, { id }])),
      isWatched: (id) => watched.has(id),
    },
    isUnlocked: (p) => unlocked.has(p.id),
    showPopup: (p) => opened.push(p.id),
    activateOnKey: () => {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'renderer.js'), 'utf8') + '\nthis.renderer = renderer;', ctx);
  const r = ctx.renderer;
  r.nodesContainer = fakeRoot();
  r.shelfTrack = fakeRoot();
  r.setupEventDelegation();
  const fire = (root, id) => {
    const node = { dataset: { id } };
    root.listeners.click.forEach((fn) => fn({ target: { closest: (sel) => (sel === '.node' ? node : null) } }));
  };
  return {
    opened,
    click: (id) => fire(r.nodesContainer, id),
    clickShelf: (id) => fire(r.shelfTrack, id),
  };
}

test('a watched title whose prerequisite is unwatched opens its popup', () => {
  // Deadpool watched, but its prerequisite X-Men Origins: Wolverine is not, so isUnlocked is false.
  const m = load({ watched: new Set(['deadpool1']), unlocked: new Set() });
  m.click('deadpool1');
  assert.deepEqual(m.opened, ['deadpool1']);
});

test('an unwatched title with unmet prerequisites stays blocked', () => {
  const m = load({ watched: new Set(), unlocked: new Set() });
  m.click('deadpool1');
  m.clickShelf('deadpool1');
  assert.deepEqual(m.opened, []);
});

test('an unwatched title whose prerequisites are met opens (map and shelf)', () => {
  const m = load({ watched: new Set(), unlocked: new Set(['deadpool1']) });
  m.click('deadpool1');
  m.clickShelf('deadpool1');
  assert.deepEqual(m.opened, ['deadpool1', 'deadpool1']);
});

test("a friend's map blocks an unwatched title even when it is unlocked", () => {
  const m = load({ watched: new Set(), unlocked: new Set(['deadpool1']), readonly: true });
  m.click('deadpool1');
  assert.deepEqual(m.opened, []);
});

test("a friend's map opens a watched title", () => {
  const m = load({ watched: new Set(['deadpool1']), unlocked: new Set(), readonly: true });
  m.click('deadpool1');
  assert.deepEqual(m.opened, ['deadpool1']);
});

test('a click outside any pin does nothing', () => {
  const m = load({ watched: new Set(['deadpool1']), unlocked: new Set(['deadpool1']) });
  m.click('unknown-id');
  assert.deepEqual(m.opened, []);
});
