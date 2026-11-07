/************************************************
 * js/onboarding-logic.js — the first-run welcome's title lists and the
 * first-visit tips' "already toured" record.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../js/onboarding-logic');
const Help = require('../js/help-logic');

const P = [
  { id: 'b', title: 'B', release: '2010-01-01' },
  { id: 'a', title: 'A', release: '2008-01-01' },
  { id: 'future', title: 'Future', release: '2099-01-01' },
  { id: 'c', title: 'C', release: '2012-01-01' }
];

test('candidates: All Marvel is every released title oldest first; Doomsday is the list order', () => {
  assert.deepEqual(L.candidates(P, 'all', [], '2026-11-07').map(p => p.id), ['a', 'b', 'c']);
  assert.deepEqual(L.candidates(P, 'dd', ['c', 'missing', 'a', 'future'], '2026-11-07').map(p => p.id), ['c', 'a']);
});

test('nextUp: the first revealed titles of the path', () => {
  const revealed = (p) => p.id !== 'a';
  assert.deepEqual(L.nextUp(P, 'all', [], revealed, 2).map(p => p.id), ['b', 'c']);
  assert.deepEqual(L.nextUp(P, 'dd', ['c', 'a', 'b'], revealed, 3).map(p => p.id), ['c', 'b']);
});

test('tips record: per user, survives junk, adds each page once, resets on a version bump', () => {
  assert.equal(L.tipsKey('u1'), 'mcu_tips_seen_u1');
  assert.equal(L.tipsKey(null), 'mcu_tips_seen_anon');
  assert.deepEqual(L.tipsSeen(null), []);
  assert.deepEqual(L.tipsSeen('{not json'), []);
  let v = L.markTip(null, '/');
  v = L.markTip(v, '/board');
  v = L.markTip(v, '/');
  assert.deepEqual(L.tipsSeen(v), ['/', '/board']);
  assert.deepEqual(L.tipsSeen(JSON.stringify({ v: L.TIPS_VERSION - 1, pages: ['/'] })), []);
});

test('every tour points at a real help section and has steps with a target and text', () => {
  const sections = new Set(Help.SECTIONS.map(s => s.id));
  for (const [page, tour] of Object.entries(L.TIPS)) {
    assert.ok(sections.has(tour.help), `${page}: help section "${tour.help}"`);
    assert.ok(tour.steps.length >= 2, page);
    for (const s of tour.steps) assert.ok(s.sel && s.title && s.text, `${page}: ${s.title}`);
  }
});

test('the bundle lists both onboarding files, logic first', () => {
  const build = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build.mjs'), 'utf8');
  const a = build.indexOf("'js/onboarding-logic.js'"), b = build.indexOf("'js/onboarding.js'");
  assert.ok(a > 0 && b > a);
});
