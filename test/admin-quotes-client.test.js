/************************************************
 * Admin Quote Guess client (js/views/admin/cms-quotes.js and
 * cms-quotes-queue.js) under a small stub DOM:
 *   - an open line edit form survives a list re-render (search, Hide,
 *     another form's Save) and is dropped only when its line is gone;
 *   - lineForm.save() is one request at a time and returns its promise,
 *     and Editor.save() waits for every dirty form;
 *   - the Quote suggestions pane has an unsaved-changes guard
 *     (isDirty / discard / save) over its "Edit & approve" forms.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');

// Just enough element: any querySelector answers with a (cached) stub, form
// fields come from elements.namedItem, listeners can be fired by hand.
function el(tag) {
  const kids = [];
  const listeners = {};
  const qs = new Map();
  const named = new Map();
  const cls = new Set();
  const e = {
    tagName: tag, value: '', textContent: '', hidden: false, open: false, disabled: false, isConnected: false,
    dataset: {}, style: {}, kids, _html: '', _qsa: null, _onHtml: null,
    get innerHTML() { return e._html; },
    set innerHTML(v) { e._html = String(v); kids.splice(0).forEach(k => { k.isConnected = false; }); if (e._onHtml) e._onHtml(e._html); },
    classList: {
      add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
      toggle: (c, on) => { on = on === undefined ? !cls.has(c) : !!on; if (on) cls.add(c); else cls.delete(c); return on; }
    },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    fire(t) { return (listeners[t] || []).map(f => f({ preventDefault() {}, target: e, button: 0 })); },
    querySelector(s) { if (!qs.has(s)) qs.set(s, el('q')); return qs.get(s); },
    querySelectorAll(s) { return (e._qsa && e._qsa(s)) || []; },
    appendChild(c) { kids.push(c); c.isConnected = true; return c; },
    append(...cs) { cs.forEach(c => e.appendChild(c)); },
    prepend(c) { kids.unshift(c); c.isConnected = true; },
    replaceWith(n) { e.isConnected = false; n.isConnected = true; },
    remove() { e.isConnected = false; },
    focus() {}, reset() {}, setAttribute() {}, closest() { return null; },
    elements: { namedItem: (n) => { if (!named.has(n)) named.set(n, el('input')); return named.get(n); } },
    get firstChild() { return kids[0] || null; }
  };
  return e;
}

function setup() {
  const ctx = {
    console, setTimeout, clearTimeout, URLSearchParams,
    document: { createElement: el, getElementById: () => null, body: el('body') },
    location: { pathname: '/admin', search: '' },
    history: { state: null, replaceState() {} },
    Router: { go() {}, replaceUrl() { return true; } },
    confirmDialog: async () => true
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['scene-guess-logic.js', 'quote-guess-logic.js', 'views/admin/index.js', 'views/admin/cms-quotes.js', 'views/admin/cms-quotes-queue.js']) vm.runInContext(read(f), ctx);
  vm.runInContext('this.AdminView = AdminView;', ctx);
  const AdminView = ctx.AdminView;
  AdminView.toast = () => {};
  return { ctx, AdminView, Editor: AdminView._cms.quotes, Shared: AdminView._quotes, Queue: AdminView._quotes.queue };
}

// The island page's line list: setting innerHTML makes one card per data-id.
function islandHost(Editor) {
  const lines = el('div');
  lines._cards = [];
  lines._onHtml = (html) => {
    lines._cards = [...html.matchAll(/<article class="qte-line[^"]*" data-id="([^"]*)"/g)].map(m => {
      const c = el('article'); c.dataset.id = m[1]; c.isConnected = true; return c;
    });
  };
  lines._qsa = (s) => (s === '.qte-line' ? lines._cards : []);
  const host = el('div');
  host.querySelector = (s) => (s === '.qte-lines' ? lines : el('q'));
  Editor._container = { querySelector: (s) => (s === '.qte-host' ? host : el('q')), querySelectorAll: () => [] };
  return lines;
}
const card = (lines, id) => lines._cards.find(c => c.dataset.id === id);
const typeInto = (form, name, v) => { form.el.elements.namedItem(name).value = v; form.el.fire('input'); };

const PROJECT = { id: 'avengers1', title: 'The Avengers', episodes: [] };
const line = (id, speaker, text, extra) => Object.assign({ id, projectId: 'avengers1', speaker: { name: speaker, key: speaker.toLowerCase() }, text, reply: null, status: 'approved', active: true, origin: 'admin', decoys: {} }, extra);

test('an open line edit form survives re-renders (Hide, search) and is dropped only when its line is gone', () => {
  const { Editor } = setup();
  const lines = islandHost(Editor);
  const a = line('a', 'Loki', 'I have an army.');
  const b = line('b', 'Tony Stark', 'We have a Hulk.');
  Editor._detail = { project: PROJECT, lines: [a, b] };
  Editor._filter = { q: '', status: 'live' };
  Editor._forms.clear();
  Editor.renderLines();
  assert.deepEqual(lines._cards.map(c => c.dataset.id), ['b', 'a'], 'newest first');

  card(lines, 'a').querySelector('.qte-edit').fire('click');
  const form = [...Editor._forms][0];
  assert.equal(form.lineId, 'a');
  assert.equal(card(lines, 'a').kids[0], form.el);
  typeInto(form, 'text', 'I have an army!');
  assert.equal(Editor.isDirty(), true);

  // "Hide" on line b re-renders the list: a's form is put back in its card.
  b.active = false;
  Editor.renderLines();
  assert.deepEqual(lines._cards.map(c => c.dataset.id), ['a']);
  assert.equal(card(lines, 'a').kids[0], form.el);
  assert.ok(card(lines, 'a').classList.contains('is-editing'));
  assert.equal(form.el.elements.namedItem('text').value, 'I have an army!', 'the edit is still there');
  assert.equal(Editor._forms.has(form), true);

  // A search that doesn't match keeps the line being edited on screen.
  Editor._filter.q = 'zzz';
  Editor.renderLines();
  assert.deepEqual(lines._cards.map(c => c.dataset.id), ['a']);
  assert.equal(card(lines, 'a').kids[0], form.el);

  // The line was deleted: nothing left to save.
  Editor._detail.lines = [b];
  Editor.renderLines();
  assert.equal(Editor._forms.has(form), false);
  assert.equal(Editor.isDirty(), false);
});

test('lineForm.save(): one request at a time, returns its promise; Editor.save() waits for every dirty form', async () => {
  const { Shared, Editor } = setup();
  let calls = 0;
  let release;
  const form = Shared.lineForm({
    project: PROJECT, submitLabel: 'Add line',
    onSubmit: () => { calls++; return new Promise(r => { release = r; }); }
  });
  typeInto(form, 'speaker', 'Loki');
  typeInto(form, 'text', 'I have an army.');
  assert.equal(form.isDirty(), true);
  const p1 = form.save();
  const p2 = form.save();
  form.el.fire('submit');               // the form's own button, mid-flight
  assert.equal(p1, p2, 'a second Save while one is in flight gets the same promise');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(calls, 1, 'one POST');
  release();
  assert.equal(await p1, true);
  assert.equal(form.isDirty(), false);

  // Invalid → false, nothing sent.
  const bad = Shared.lineForm({ project: PROJECT, onSubmit: () => { calls++; } });
  typeInto(bad, 'speaker', 'Loki');
  assert.equal(await bad.save(), false);
  assert.equal(calls, 1);

  // Editor.save() resolves only after the requests settle.
  let done = false;
  let finish;
  Editor._forms.clear();
  Editor._forms.add({ isDirty: () => true, save: () => new Promise(r => { finish = () => { done = true; r(true); }; }) });
  Editor._forms.add({ isDirty: () => false, save: () => { throw new Error('clean forms are not saved'); } });
  assert.equal(Editor.canSave(), true);
  const saving = Editor.save();
  assert.equal(typeof saving.then, 'function');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(done, false);
  finish();
  await saving;
  assert.equal(done, true);

  // Only an import running: dirty, but nothing Save can do.
  Editor._forms.clear();
  Shared.io = { isBusy: () => true };
  assert.equal(Editor.isDirty(), true);
  assert.equal(Editor.canSave(), false);
  delete Shared.io;
});

test('Quote suggestions pane: "Edit & approve" forms count as unsaved, survive Load more, and Save/Discard reach them', async () => {
  const { AdminView, Queue } = setup();
  const pane = AdminView._tabs.suggestions;
  const host = el('div');
  const list = el('div');
  host.querySelector = (s) => (s === '.qte-queue-list' ? list : el('q'));
  Queue._host = host;
  Queue._ctx = {};
  Queue._open.clear();
  const item = (id) => line(id, 'Loki', 'Line ' + id, { status: 'pending', origin: 'suggestion', suggestedByName: 'sam', projectTitle: 'The Avengers', createdAt: new Date(1).toISOString() });
  Queue._items = [item('s1'), item('s2')];
  Queue._total = 3;
  Queue.render();
  assert.equal(list.kids.length, 2);
  assert.equal(pane.isDirty(), false);

  const cardEl = list.kids[0];
  Queue.edit(Queue._items[0], cardEl);
  const open = Queue._open.get('s1');
  assert.ok(open && open.el === cardEl);
  assert.equal(pane.isDirty(), false, 'opened but untouched');
  typeInto(open.form, 'text', 'Line s1, fixed.');
  assert.equal(pane.isDirty(), true);
  assert.equal(AdminView._canBarSave(pane), true);

  // Load more re-renders the list: the open form's card goes back in.
  Queue._items = Queue._items.concat([item('s3')]);
  Queue.render();
  assert.equal(list.kids[0], cardEl);
  assert.equal(pane.isDirty(), true);

  // The Save bar approves through the form (and waits for it).
  let posted = null;
  AdminView.api = async (p, o) => { posted = { p, body: JSON.parse(o.body) }; return {}; };
  await pane.save();
  assert.equal(posted.p, '/quotes/line/s1/approve');
  assert.equal(posted.body.edits.text, 'Line s1, fixed.');
  assert.equal(Queue._open.size, 0);
  assert.equal(pane.isDirty(), false);

  // Discard (Save bar, leave guard) and unmount forget open forms.
  Queue.edit(Queue._items[0], list.kids[1]);
  typeInto([...Queue._open.values()][0].form, 'note', 'x');
  assert.equal(pane.isDirty(), true);
  pane.discard();
  assert.equal(pane.isDirty(), false);
  Queue.edit(Queue._items[0], list.kids[1]);
  typeInto([...Queue._open.values()][0].form, 'note', 'y');
  pane.unmount();
  assert.equal(pane.isDirty(), false);
});
