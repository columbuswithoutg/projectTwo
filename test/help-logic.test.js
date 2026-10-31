/************************************************
 * HelpLogic (js/help-logic.js): the "?" guide's red dot, search, and that
 * every screenshot a card names exists under assets/help/.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HelpLogic = require('../js/help-logic');
const { SECTIONS, GUIDE_VERSION, seenKey, needsDot, search } = HelpLogic;

test('red dot shows until the current guide version is opened', () => {
  assert.equal(needsDot(null), true);
  assert.equal(needsDot(''), true);
  assert.equal(needsDot('junk'), true);
  assert.equal(needsDot(String(GUIDE_VERSION)), false);
  assert.equal(needsDot(String(GUIDE_VERSION + 3)), false);
  // A newer guide brings the dot back for people who saw the old one.
  assert.equal(needsDot('1', 2), true);
});

test('seen flag is per user', () => {
  assert.notEqual(seenKey('a1'), seenKey('b2'));
  assert.equal(seenKey(null), 'mcu_help_seen_anon');
});

test('search matches every word across title, steps and keys', () => {
  assert.equal(search(SECTIONS, ''), SECTIONS);
  const chat = search(SECTIONS, 'whisper');
  assert.deepEqual(chat.map(s => s.id), ['world']);
  assert.deepEqual(chat[0].cards.map(c => c.id), ['chat']);
  // a key binding
  assert.ok(search(SECTIONS, 'punch').some(s => s.cards.some(c => c.id === 'move')));
  // section title counts too, and all words must match
  assert.ok(search(SECTIONS, 'board drag').length === 1);
  assert.deepEqual(search(SECTIONS, 'zzzz nothing'), []);
});

test('cards are well formed, ids unique, and every screenshot exists', () => {
  const ids = new Set();
  for (const s of SECTIONS) {
    for (const c of s.cards) {
      const key = s.id + '/' + c.id;
      assert.ok(!ids.has(key), 'duplicate ' + key);
      ids.add(key);
      assert.ok(c.title && Array.isArray(c.steps) && c.steps.length, key);
      if (c.img) {
        const file = path.join(__dirname, '..', 'assets', 'help', c.img);
        assert.ok(fs.existsSync(file), 'missing screenshot ' + c.img);
      }
    }
  }
});
