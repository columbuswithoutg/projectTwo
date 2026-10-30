/************************************************
 * Unit tests for the /characters page data in characters.js — the
 * summaries, the shared-body entities (Hulk / Bruce Banner) and the search
 * that brings body-mates along.
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
vm.runInNewContext('this.SUMMARIES = CHARACTER_SUMMARIES; this.SHARED = SHARED_BODIES', ctx);
const { characters, projects, isCharUnlocked, characterPageEntries, characterSearch, characterSummary } = ctx;
const entries = characterPageEntries(characters);
const entry = (id) => entries.find(e => e.id === id);
const ids = (list) => Array.from(list, e => e.id);
const projectIds = new Set(projects.map(p => p.id));

test('every character and page-only entity has a summary', () => {
  const missing = Array.from(entries.filter(e => !characterSummary(e)), e => e.id);
  assert.deepEqual(missing, []);
});

test('no summary is keyed to an unknown id', () => {
  const known = new Set(ids(entries));
  assert.deepEqual(Object.keys(ctx.SUMMARIES).filter(id => !known.has(id)), []);
});

test('a CMS summary wins over the built-in one', () => {
  assert.equal(characterSummary({ id: 'hulk', summary: 'Custom' }), 'Custom');
  assert.match(characterSummary({ id: 'hulk' }), /Hulk/);
});

test('shared-body entities point at real characters and projects', () => {
  const charIds = new Set(characters.map(c => c.id));
  for (const group of ctx.SHARED) {
    for (const m of group) {
      if (m.char) assert.ok(charIds.has(m.char), `${m.char} is a character`);
      else {
        assert.ok(!charIds.has(m.id), `${m.id} does not clash with a character id`);
        assert.ok(projectIds.has(m.debut), `${m.id} debut ${m.debut} is a project`);
        for (const s of m.stages || []) assert.ok(projectIds.has(s.after), `${m.id} stage ${s.after}`);
      }
    }
  }
});

test('Hulk and Bruce Banner are separate cards that know about each other', () => {
  assert.deepEqual(Array.from(entry('hulk').body), ['banner']);
  assert.deepEqual(Array.from(entry('banner').body), ['hulk']);
  // Banner sits right after the Hulk
  assert.equal(ids(entries).indexOf('banner'), ids(entries).indexOf('hulk') + 1);
});

test('Sentry, Bob and the Void share one body', () => {
  assert.deepEqual(Array.from(entry('sentry').body).sort(), ['bob', 'void']);
  assert.deepEqual(Array.from(entry('void').body).sort(), ['bob', 'sentry']);
});

test('searching one shared-body entity shows the others', () => {
  assert.deepEqual(ids(characterSearch(entries, 'banner')).sort(), ['banner', 'hulk']);
  assert.deepEqual(ids(characterSearch(entries, 'bob')).sort(), ['bob', 'sentry', 'void']);
  // Plain matches are unchanged
  assert.deepEqual(ids(characterSearch(entries, 'pepper')), ['pepper']);
});

test('a renamed character is still found by its catalogue name', () => {
  assert.equal(entry('teen_agatha').name, 'Teen');
  assert.ok(ids(characterSearch(entries, 'Teen (Billy')).includes('teen_agatha'));
});

test('search never brings in a locked body-mate', () => {
  const watched = new Set(['hulk']);   // Incredible Hulk only
  const unlocked = entries.filter(e => isCharUnlocked(e, watched));
  assert.deepEqual(ids(characterSearch(unlocked, 'sentry')), []);
  assert.deepEqual(ids(characterSearch(unlocked, 'banner')).sort(), ['banner', 'hulk']);
});

test('every page-only entity portrait exists', () => {
  const dir = path.join(__dirname, '..', 'assets', 'characters');
  const missing = [];
  for (const group of ctx.SHARED) {
    for (const m of group) {
      if (m.char) continue;
      for (const img of [m.image, ...(m.stages || []).map(s => s.image)]) {
        if (img && !fs.existsSync(path.join(dir, img))) missing.push(`${m.id}: ${img}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('Jean Grey no longer lists the Phoenix as one of her looks', () => {
  assert.ok(!entry('jeangrey').stages.some(s => s.after === 'xmen3'));
  // ...but the catalogue entry the walkers use keeps it
  assert.ok(characters.find(c => c.id === 'jeangrey').stages.some(s => s.after === 'xmen3'));
});
