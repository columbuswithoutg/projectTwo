/************************************************
 * NodeFactory.updateState — the state classes on a project node.
 * `.node.locked` is display:none, so a node marked locked shows no poster.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load({ watched, unlocked }) {
  const ctx = {
    state: { isWatched: (id) => watched.has(id), isInProgress: () => false },
    isUnlocked: (p) => unlocked.has(p.id),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'nodeFactory.js'), 'utf8') + '\nthis.NodeFactory = NodeFactory;', ctx);
  return ctx.NodeFactory;
}

function fakeNode() {
  const classes = new Set();
  return {
    dataset: {},
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), has: (c) => classes.has(c) },
    has: (c) => classes.has(c),
  };
}

test('a watched title whose prerequisite is unwatched is not locked (its poster stays visible)', () => {
  // Deadpool watched, but its prerequisite X-Men Origins: Wolverine is not, so isUnlocked is false.
  const NF = load({ watched: new Set(['deadpool1']), unlocked: new Set() });
  const node = fakeNode();
  NF.updateState(node, { id: 'deadpool1' });
  assert.equal(node.has('watched'), true);
  assert.equal(node.has('locked'), false);
});

test('an unwatched title with unmet prerequisites is locked', () => {
  const NF = load({ watched: new Set(), unlocked: new Set() });
  const node = fakeNode();
  NF.updateState(node, { id: 'deadpool1' });
  assert.equal(node.has('locked'), true);
});

test('an unwatched title whose prerequisites are met is open', () => {
  const NF = load({ watched: new Set(), unlocked: new Set(['deadpool1']) });
  const node = fakeNode();
  NF.updateState(node, { id: 'deadpool1' });
  assert.equal(node.has('locked'), false);
  assert.equal(node.has('watched'), false);
});
