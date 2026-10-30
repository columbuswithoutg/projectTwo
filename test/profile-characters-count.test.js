/************************************************
 * Profile "Characters Unlocked" (js/views/profile.js) must match the
 * "N of M unlocked" on /characters, which counts characterPageEntries —
 * shared bodies (Hulk / Bruce Banner, …) as separate cards (CLI2-08).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ctx = {};
vm.createContext(ctx);
for (const f of ['projects.js', 'characters.js', 'js/views/profile.js']) vm.runInContext(read(f), ctx);
vm.runInContext('this.ProfileView = ProfileView; this.characters = characters; this.projects = projects;' +
  'this.characterPageEntries = characterPageEntries; this.isCharUnlocked = isCharUnlocked;', ctx);
const { ProfileView, characters, projects, characterPageEntries, isCharUnlocked } = ctx;
const pageCount = (ids) => characterPageEntries(characters).filter(c => isCharUnlocked(c, ids)).length;

test('everything watched: the profile count is the /characters total, page-only cards included', () => {
  const all = new Set(projects.map(p => p.id));
  const entries = characterPageEntries(characters);
  assert.ok(entries.length > characters.length, 'expected page-only shared-body entries');
  assert.equal(ProfileView.charactersUnlocked(all), entries.filter(c => isCharUnlocked(c, all)).length);
  assert.notEqual(ProfileView.charactersUnlocked(all), characters.filter(c => isCharUnlocked(c, all)).length);
});

test('any watched set gives the same number as /characters', () => {
  const ids = projects.map(p => p.id);
  for (const n of [0, 1, 5, Math.floor(ids.length / 2)]) {
    const watched = new Set(ids.slice(0, n));
    assert.equal(ProfileView.charactersUnlocked(watched), pageCount(watched), `first ${n} watched`);
  }
});
