/************************************************
 * Unit tests for the stage helpers in characters.js — which characters a
 * watch history unlocks and which of their looks it shows — plus the
 * bundled data they rely on.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = {};
for (const f of ['projects.js', 'characters.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
}
vm.runInNewContext('this.MERGED = MERGED_CHARACTER_IDS', ctx);
const { characters, projects, isCharUnlocked, getCharStages, getCharImage } = ctx;
const char = (id) => characters.find(c => c.id === id);
// Array.from: arrays made inside the vm context fail deepStrictEqual against ours
const images = (c, watched) => Array.from(getCharStages(c, watched), s => s.image);

test('Deadpool & Wolverine alone unlocks Wolverine, showing only the yellow suit', () => {
  const watched = new Set(['deadpool3']);
  assert.equal(isCharUnlocked(char('wolverine'), watched), true);
  assert.deepEqual(images(char('wolverine'), watched), ['wolverine_dw.jpg']);
  assert.equal(isCharUnlocked(char('profx'), watched), false);
});

test('the debut look joins once the debut is watched; the latest look wins', () => {
  const watched = new Set(['deadpool3', 'xmen1']);
  assert.deepEqual(images(char('wolverine'), watched), ['wolverine.jpg', 'wolverine_dw.jpg']);
  assert.equal(getCharImage(char('wolverine'), watched), 'wolverine_dw.jpg');
  assert.equal(getCharImage(char('wolverine'), new Set(['xmen1'])), 'wolverine.jpg');
});

test('Hawkeye unlocks Fisk as Kingpin without the Netflix Daredevil, and Echo at her debut', () => {
  const watched = new Set(['hawkeye']);
  assert.equal(isCharUnlocked(char('fisk'), watched), true);
  assert.deepEqual(Array.from(getCharStages(char('fisk'), watched), s => s.after), ['hawkeye']);
  assert.equal(getCharImage(char('echo'), watched), 'echo.jpg');
  assert.equal(getCharImage(char('echo'), new Set(['hawkeye', 'echo'])), 'echo_series.jpg');
});

test('a locked character still resolves to its debut look; isWatched() objects work too', () => {
  assert.deepEqual(images(char('magneto'), new Set()), ['magneto.jpg']);
  const state = { isWatched: (id) => id === 'logan' };
  assert.equal(isCharUnlocked(char('laura'), state), true);
  assert.equal(getCharImage(char('profx'), state), 'profx_logan.jpg');
});

test('bundled data: every debut / stage project exists, no image is used twice, merged ids point at real characters', () => {
  const pids = new Set(projects.map(p => p.id));
  const cids = new Set(characters.map(c => c.id));
  const seen = new Map();
  for (const c of characters) {
    assert.ok(pids.has(c.debut), `${c.id} debut ${c.debut}`);
    for (const s of c.stages || []) assert.ok(pids.has(s.after), `${c.id} stage after ${s.after}`);
    for (const img of [c.image, ...(c.stages || []).map(s => s.image)]) {
      assert.ok(!seen.has(img), `${img} used by ${seen.get(img)} and ${c.id}`);
      seen.set(img, c.id);
    }
  }
  assert.equal(cids.size, characters.length, 'duplicate character id');
  for (const [from, to] of Object.entries(ctx.MERGED)) {
    assert.ok(!cids.has(from), `${from} is merged but still listed`);
    assert.ok(cids.has(to), `${from} → ${to} does not exist`);
  }
});
