/************************************************
 * computeDoomsdayGoal (js/goals.js) is built on ShareLogic.doomsdayProgress,
 * the rule the server's link preview uses, so the goals panel / story card
 * ("3/16") and the link preview ("3 of 16") can't drift apart (CLI2-09).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
const ShareLogic = require('../js/share-logic');
const LIST = ShareLogic.DOOMSDAY_WATCHLIST;

// state: byId (the live content) + data (watched ids), as js/state.js keeps them.
function load({ have = LIST, watched = [], unlocked = () => true } = {}) {
  const byId = new Map(have.map(id => [id, { id, title: 'T:' + id }]));
  byId.set('doomsday', { id: 'doomsday', title: 'Avengers: Doomsday', release: '2026-12-18' });
  const data = new Map(watched.map(id => [id, { count: 1 }]));
  const ctx = {
    console,
    state: { byId, data, isWatched: (id) => data.has(id) },
    isUnlocked: (p) => unlocked(p.id)
  };
  vm.createContext(ctx);
  vm.runInContext(read('share-logic.js'), ctx);
  vm.runInContext(read('goals.js') + '\nthis.computeDoomsdayGoal = computeDoomsdayGoal;', ctx);
  // JSON round-trip: plain objects of this realm, for deepEqual.
  return () => JSON.parse(JSON.stringify(ctx.computeDoomsdayGoal()));
}

test('same items, met and total as ShareLogic.doomsdayProgress, in Marvel\'s order', () => {
  const have = LIST.filter(id => id !== 'fantasticfour');      // a title the live content lacks
  const watched = ['cap1', 'endgame', 'wandavision'];
  const g = load({ have, watched })();
  const p = ShareLogic.doomsdayProgress(watched, id => have.includes(id));
  assert.deepEqual(g.items.map(i => i.id), p.items.map(i => i.id));
  assert.deepEqual(g.items.map(i => i.watched), p.items.map(i => i.watched));
  assert.equal(g.met, p.met);
  assert.equal(g.total, p.total);
  assert.equal(g.total, LIST.length - 1);
  assert.equal(g.met, 2);
  assert.equal(g.target.id, 'doomsday');
});

test('items carry the title and ready = unlocked and not watched yet', () => {
  const g = load({ watched: ['xmen1'], unlocked: (id) => id !== 'xmen2' })();
  const by = Object.fromEntries(g.items.map(i => [i.id, i]));
  assert.deepEqual(by.xmen1, { id: 'xmen1', title: 'T:xmen1', watched: true, ready: false });
  assert.deepEqual(by.xmen2, { id: 'xmen2', title: 'T:xmen2', watched: false, ready: false });
  assert.deepEqual(by.cap1, { id: 'cap1', title: 'T:cap1', watched: false, ready: true });
  assert.equal(g.total, LIST.length);
});
