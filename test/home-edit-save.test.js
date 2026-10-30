/************************************************
 * 3D2-08: js/views/home-edit.js — a Save whose PUT lands after the user has
 * left the editor must not Router.go('/home') (tearing down the page they
 * moved to) or repaint the gone panel. The view runs in a vm with stub
 * Auth / Router / document.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js/views/home-edit.js'), 'utf8');
const tick = () => new Promise(r => setImmediate(r));

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const response = (ok, body) => ({ ok, status: ok ? 200 : 500, json: async () => body });

function harness() {
  const els = new Map();
  let attached = true;          // the editor's DOM is on the page
  const el = (id) => {
    if (!els.has(id)) {
      const e = {
        id, innerHTML: '', textContent: '', disabled: false, handlers: {}, renders: 0,
        addEventListener(type, fn) { this.handlers[type] = fn; },
        querySelector() { return e; }, querySelectorAll() { return []; }
      };
      els.set(id, e);
    }
    return els.get(id);
  };
  const calls = { go: [], fetch: [] };
  const fetches = [];
  const ctx = {
    API: '/api',
    setTimeout, Promise, JSON, Math, Set, Map, Array, String, Error,
    Auth: {
      isLoggedIn: () => true,
      fetch(url, opts) { calls.fetch.push({ url, method: (opts && opts.method) || 'GET' }); const d = deferred(); fetches.push(d); return d.promise; }
    },
    Router: { go(to, o) { calls.go.push(to); }, back() {}, confirmLeave: () => true },
    document: { getElementById: (id) => (attached ? el(id) : null), createElement: () => el('tmp'), body: { appendChild() {} } },
    activateOnKey() {},
    PosterArt: { html: () => '' }
  };
  vm.runInNewContext(SRC + '\nthis.View = HomeEditView;', ctx);
  return {
    View: ctx.View, calls, fetches, el,
    detach() { attached = false; els.clear(); }
  };
}

async function openEditor(h) {
  h.View.mount(h.el('root'));
  h.fetches[0].resolve(response(true, { homeLayout: { rooms: [] }, maxRooms: 2, watchedCount: 4, watchedIds: [] }));
  await tick();
  assert.ok(h.el('pg-edit-save').handlers.click, 'Save is wired');
}

test('save, then leave before the PUT returns: no navigation back to /home (3D2-08)', async () => {
  const h = harness();
  await openEditor(h);
  h.el('pg-edit-save').handlers.click();
  assert.equal(h.calls.fetch[1].method, 'PUT');
  h.View.unmount();             // Back / a drawer link → the router unmounts the editor
  h.detach();
  h.fetches[1].resolve(response(true, { ok: true }));
  await tick();
  assert.deepEqual(h.calls.go, []);
});

test('save fails after leaving: no repaint, no error written anywhere', async () => {
  const h = harness();
  await openEditor(h);
  h.el('pg-edit-save').handlers.click();
  h.View.unmount();
  h.detach();
  h.fetches[1].reject(new Error('offline'));
  await tick();
  assert.deepEqual(h.calls.go, []);
  assert.equal(h.el('pg-edit-error').textContent, '');
});

test('leave and come back while the old PUT is out: the old answer does not navigate', async () => {
  const h = harness();
  await openEditor(h);
  h.el('pg-edit-save').handlers.click();
  h.View.unmount();
  h.View.mount(h.el('root'));   // fetches[2] is the new mount's load
  h.fetches[1].resolve(response(true, { ok: true }));
  await tick();
  assert.deepEqual(h.calls.go, []);
});

test('a save that returns while still on the editor goes to /home as before', async () => {
  const h = harness();
  await openEditor(h);
  h.el('pg-edit-save').handlers.click();
  h.fetches[1].resolve(response(true, { ok: true }));
  await tick();
  assert.deepEqual(h.calls.go, ['/home']);
});

test('a failed save while still on the editor shows the error and re-enables Save', async () => {
  const h = harness();
  await openEditor(h);
  h.el('pg-edit-save').handlers.click();
  h.fetches[1].resolve(response(false, { error: 'Nope' }));
  await tick();
  assert.deepEqual(h.calls.go, []);
  assert.equal(h.el('pg-edit-error').textContent, 'Nope');
  assert.ok(!/disabled/.test(h.el('pg-edit-panel').innerHTML.match(/id="pg-edit-save"[^>]*>/)[0]));
});
