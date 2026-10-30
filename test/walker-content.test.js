/************************************************
 * Consistency checks for the bundled map content: characters.js,
 * projects.js and js/walker-dialogues.js refer to each other by id, and a
 * typo in any of them fails silently in the browser (a dialogue that never
 * plays, a villain that fights with default stats, a portrait that 404s).
 * These are the static fallbacks; the DB copy edited in the admin CMS is
 * not covered here.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

const ctx = {};
for (const f of ['projects.js', 'characters.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
}
vm.runInNewContext(
  'this.MERGED = MERGED_CHARACTER_IDS; this.STATS = WALKER_STATS;' +
  ' this.VILLAINS = VILLAIN_DATA; this.COLORS = WEAPON_COLORS;', ctx);
const { characters, projects, MERGED, STATS, VILLAINS, COLORS } = ctx;

// The dialogue pairs live inside an IIFE; read them the same way the server
// builds its static fallback, so this also covers that extraction.
const { pairs } = require('../server/contentLoader').get('dialogues');

const charIds = new Set(characters.map(c => c.id));
const projectIds = new Set(projects.map(p => p.id));
const isCharId = (id) => charIds.has(id) || Object.prototype.hasOwnProperty.call(MERGED, id);

// Portraits referenced by the data but not yet supplied. Every consumer
// (characters grid, profile picker, map walkers) shows the character's
// monogram when the file 404s, so these degrade cleanly — but each one is
// still a missing asset. Remove an entry as soon as its file is added.
const MISSING_PORTRAIT_ALLOWLIST = new Set([]);

test('dialogues were extracted at all', () => {
  assert.ok(Object.keys(pairs).length > 10);
});

test('every dialogue pair key is sorted and names two real characters', () => {
  for (const key of Object.keys(pairs)) {
    const ids = key.split('|');
    assert.equal(ids.length, 2, `${key}: not an "a|b" key`);
    assert.equal([...ids].sort().join('|'), key, `${key}: ids not in sorted order`);
    for (const id of ids) assert.ok(isCharId(id), `${key}: "${id}" is not a character id`);
  }
});

test('every dialogue requires a real project and starts with one of the pair', () => {
  for (const [key, exchanges] of Object.entries(pairs)) {
    const ids = key.split('|');
    for (const e of exchanges) {
      assert.ok(projectIds.has(e.requires), `${key}: requires "${e.requires}" is not a project id`);
      if (e.startsWith != null) {
        assert.ok(ids.includes(e.startsWith), `${key}: startsWith "${e.startsWith}" is not in the pair`);
      }
    }
  }
});

test('every spawnable villain is a character with its own WALKER_STATS row', () => {
  for (const [nodeId, villainIds] of Object.entries(VILLAINS)) {
    assert.ok(projectIds.has(nodeId), `VILLAIN_DATA key "${nodeId}" is not a project id`);
    for (const v of villainIds) {
      assert.ok(charIds.has(v), `${nodeId}: villain "${v}" is not a character id`);
      assert.ok(Object.prototype.hasOwnProperty.call(STATS, v), `${nodeId}: villain "${v}" has no WALKER_STATS`);
    }
  }
});

test('every weapon used in WALKER_STATS has a WEAPON_COLORS entry', () => {
  for (const [id, s] of Object.entries(STATS)) {
    for (const slot of [s.melee, s.range]) {
      if (!slot) continue;
      assert.ok(Object.prototype.hasOwnProperty.call(COLORS, slot[0]), `${id}: weapon "${slot[0]}" has no colour`);
    }
  }
});

test('every character portrait referenced exists under assets/characters', () => {
  const dir = path.join(ROOT, 'assets', 'characters');
  const missing = [];
  for (const c of characters) {
    for (const img of [c.image, ...(c.stages || []).map(s => s.image)]) {
      if (!img || MISSING_PORTRAIT_ALLOWLIST.has(img)) continue;
      if (!fs.existsSync(path.join(dir, img))) missing.push(`${c.id}: ${img}`);
    }
  }
  assert.deepEqual(missing, []);
  // A stale allowlist entry hides nothing, but it should go once the file lands.
  for (const img of MISSING_PORTRAIT_ALLOWLIST) {
    assert.ok(!fs.existsSync(path.join(dir, img)), `${img} now exists: drop it from the allowlist`);
  }
});
