/************************************************
 * Consistency checks for project-details.js (the synopsis + cast shown in
 * the project popup, js/popup.js) against projects.js and characters.js.
 * A bad id there fails silently in the browser — the character just
 * doesn't show — so it's caught here.
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
for (const f of ['projects.js', 'characters.js', 'project-details.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
}
const { projects, characters, projectDetails } = ctx;
const projectById = new Map(projects.map(p => [p.id, p]));
const charById = new Map(characters.map(c => [c.id, c]));

test('every title has a synopsis and a wiki link', () => {
  for (const p of projects) {
    const d = projectDetails[p.id];
    assert.ok(d, `${p.id} has no entry`);
    assert.ok(typeof d.synopsis === 'string' && d.synopsis.length > 40, `${p.id} synopsis`);
    assert.match(d.wiki, /^https:\/\/[a-z-]+\.fandom\.com\/wiki\//, `${p.id} wiki`);
  }
});

test('no entry for a title that does not exist', () => {
  for (const id of Object.keys(projectDetails)) assert.ok(projectById.has(id), id);
});

test('cast ids and looks exist, with no look from a later title', () => {
  for (const [pid, d] of Object.entries(projectDetails)) {
    const seen = new Set();
    for (const [cid, look] of d.cast) {
      const c = charById.get(cid);
      assert.ok(c, `${pid}: unknown character ${cid}`);
      assert.ok(!seen.has(cid), `${pid}: ${cid} listed twice`);
      seen.add(cid);
      if (look === 'base') continue;
      assert.ok((c.stages || []).some(s => s.after === look), `${pid}: ${cid} has no look ${look}`);
      assert.ok(projectById.get(look).release <= projectById.get(pid).release,
        `${pid}: ${cid} wears the ${look} look, from a later title`);
    }
  }
});
