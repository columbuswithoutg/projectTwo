/************************************************
 * Router + admin shell (js/router.js, js/views/admin/index.js): a pane that
 * rewrites the address for in-pane state (an open form's ?id=, a sub-view)
 * goes through Router.replaceUrl, so the Router's current URL follows it.
 * Before, a sidebar / breadcrumb Router.go() back to the URL the view
 * mounted with was skipped as "already there" (a dead click), and a vetoed
 * Back put the stale address back. Also the Save bar's canSave() rule.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));

// A tab's history with a location that follows it; back() fires popstate.
function browser(start) {
  const entries = [{ state: null, url: start }];
  let i = 0;
  const listeners = {};
  const location = {};
  const sync = () => {
    const u = new URL(entries[i].url, 'http://app.test');
    Object.assign(location, { pathname: u.pathname, search: u.search, hash: u.hash, href: u.href });
  };
  sync();
  const history = {
    get state() { return entries[i].state; },
    get length() { return entries.length; },
    pushState(state, _t, url) { entries.splice(i + 1); entries.push({ state, url: String(url) }); i++; sync(); },
    replaceState(state, _t, url) { entries[i] = { state, url: String(url) }; sync(); },
    back() { if (i > 0) { i--; sync(); (listeners.popstate || []).forEach(f => f()); } }
  };
  const window = { addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); } };
  const app = { innerHTML: '', setAttribute() {} };
  const document = { title: '', getElementById: (id) => (id === 'app' ? app : null), addEventListener() {} };
  return { history, location, window, document, entries: () => entries.map(e => e.url), index: () => i };
}

function setup(start) {
  const b = browser(start);
  const ctx = { console, setTimeout, clearTimeout, URLSearchParams, history: b.history, location: b.location, window: b.window, document: b.document };
  vm.createContext(ctx);
  vm.runInContext(read('router.js'), ctx);
  vm.runInContext(read('views/admin/index.js'), ctx);
  vm.runInContext('this.Router = Router; this.AdminView = AdminView;', ctx);
  // A stand-in for the admin view: records each mount's query; canLeave is
  // set per test.
  const mounts = [];
  const view = { mount() { mounts.push(b.location.search); }, unmount() {}, canLeave: null };
  ctx.Router.register('/admin', view);
  ctx.Router.register('/', { mount() {}, unmount() {} });
  ctx.Router.init('app');
  return { ...ctx, b, view, mounts };
}

test('Router.replaceUrl adopts the URL: a go() back to the mounted URL remounts instead of being skipped', async () => {
  const { Router, b, mounts } = setup('/admin?tab=characters');
  await tick();
  assert.deepEqual(mounts, ['?tab=characters']);
  assert.equal(Router.replaceUrl('/admin?tab=characters&id=ironman'), true);
  assert.equal(b.location.search, '?tab=characters&id=ironman');
  assert.equal(Router._debug.currentUrl(), '/admin?tab=characters&id=ironman');
  assert.equal(b.entries().length, 1, 'replaced, not pushed');
  assert.equal(b.history.state.idx, 0, 'keeps the entry\'s position');
  await Router.go('/admin?tab=characters', { replace: true });
  assert.deepEqual(mounts, ['?tab=characters', '?tab=characters'], 'the sidebar / crumb click lands');
  assert.equal(b.location.search, '?tab=characters');
  // Same URL as now is still a no-op.
  await Router.go('/admin?tab=characters', { replace: true });
  assert.equal(mounts.length, 2);
});

test('Router.replaceUrl refuses another path (that is a navigation)', async () => {
  const { Router, b } = setup('/admin');
  await tick();
  assert.equal(Router.replaceUrl('/profile'), false);
  assert.equal(b.location.pathname, '/admin');
  assert.equal(Router._debug.currentUrl(), '/admin');
});

test('a vetoed Back puts the adopted URL back, not the one the view mounted with', async () => {
  const { Router, b, view, mounts } = setup('/admin');
  await tick();
  await Router.go('/admin?tab=characters');                 // pushed
  Router.replaceUrl('/admin?tab=characters&id=ironman');    // form opened
  view.canLeave = async () => false;                        // "Keep editing"
  b.history.back();
  await tick(); await tick();
  assert.equal(b.location.search, '?tab=characters&id=ironman');
  assert.equal(b.history.state.idx, 1);
  assert.deepEqual(mounts, ['', '?tab=characters'], 'nothing remounted');
});

test('AdminView.syncUrl goes through the Router, so the sidebar entry of the same tab works after a form opened', async () => {
  const { Router, AdminView, b, mounts } = setup('/admin?tab=characters');
  await tick();
  AdminView._state = AdminView._parse(b.location.search);
  AdminView.syncUrl({ id: 'ironman' });
  assert.equal(b.location.search, '?tab=characters&id=ironman');
  assert.equal(Router._debug.currentUrl(), '/admin?tab=characters&id=ironman');
  assert.deepEqual(Object.assign({}, AdminView._state), { tab: 'characters', sub: '', id: 'ironman' });
  await AdminView.go({ tab: 'characters' });
  assert.deepEqual(mounts, ['?tab=characters', '?tab=characters']);
  // Sub-view switches (Projects board, Quote Guess import) take the same path.
  AdminView._state = AdminView._parse('?tab=quote-guess');
  AdminView.syncUrl({ sub: 'io' });
  assert.equal(Router._debug.currentUrl(), '/admin?tab=quote-guess&sub=io');
});

test('Save bar: Save shows only when the pane can save (an import still running alone cannot)', () => {
  const { AdminView } = setup('/admin');
  assert.equal(AdminView._canBarSave(null), false);
  assert.equal(AdminView._canBarSave({}), false, 'no save()');
  assert.equal(AdminView._canBarSave({ save() {} }), true, 'no canSave() → can');
  assert.equal(AdminView._canBarSave({ save() {}, canSave: () => false }), false);
  assert.equal(AdminView._canBarSave({ save() {}, canSave: () => { throw new Error('x'); } }), false);

  // The Minigames pane: the editor's canSave() unless the settings card has edits.
  const cfg = { dirty: false, isDirty() { return this.dirty; }, mount() {}, unmount() {}, discard() {}, save() {} };
  AdminView._configSection = () => cfg;
  const editor = { busy: true, isDirty() { return this.busy; }, canSave() { return !this.busy; }, save() {} };
  const pane = AdminView._minigamePane('quote', () => editor);
  assert.equal(pane.isDirty(), true);
  assert.equal(AdminView._canBarSave(pane), false, 'import running, nothing else to save');
  cfg.dirty = true;
  assert.equal(AdminView._canBarSave(pane), true, 'the settings card can still be saved');
  cfg.dirty = false; editor.busy = false;
  assert.equal(AdminView._canBarSave(pane), true);
  // An editor without canSave() (Scene Guess) keeps Save.
  assert.equal(AdminView._canBarSave(AdminView._minigamePane('scene', () => ({ isDirty: () => true, save() {} }))), true);
});

// ── the URL scheme, breadcrumbs and up() (ADM2-15 / TOOL2-06) ──────────────
// The pure parts come from the real file's module.exports guard.
const Shell = require('../js/views/admin/index.js');

test('legacy ?tab= bookmarks land on their new sidebar entry', () => {
  assert.deepEqual(Object.assign({}, Shell.ADMIN_LEGACY_TABS),
    { cms: 'projects', config: 'physics', scenes: 'scene-guess', quotes: 'quote-guess' });
  for (const [old, now] of Object.entries(Shell.ADMIN_LEGACY_TABS)) {
    assert.ok(Shell.AdminView._findItem(now), `${old} → ${now} is not a sidebar entry`);
    assert.deepEqual(Shell._parse(`?tab=${old}&sub=io&id=x1`), { tab: now, sub: 'io', id: 'x1' });
    assert.equal(Shell.url(Shell._parse(`?tab=${old}`)), `/admin?tab=${now}`);
  }
});

test('an unknown or missing tab falls back to Overview', () => {
  assert.deepEqual(Shell._parse(''), { tab: 'overview', sub: '', id: '' });
  assert.deepEqual(Shell._parse(null), { tab: 'overview', sub: '', id: '' });
  assert.deepEqual(Shell._parse('?tab=nope&sub=s&id=7'), { tab: 'overview', sub: 's', id: '7' });
  assert.deepEqual(Shell._parse('?tab=__proto__'), { tab: 'overview', sub: '', id: '' });
  assert.equal(Shell.url({ tab: 'overview' }), '/admin');
  assert.equal(Shell.url({}), '/admin');
});

test('url() and _parse() round-trip for every sidebar entry, sub-view and id', () => {
  const keys = Shell.ADMIN_NAV.flatMap(g => g.items.map(i => i.key));
  assert.equal(new Set(keys).size, keys.length, 'sidebar keys are unique');
  for (const tab of keys) {
    for (const sub of ['', 'board', 'io']) {
      for (const id of ['', 'ironman', 'a b&c=d/é']) {
        const st = { tab, sub, id };
        const url = Shell.url(st);
        assert.ok(url.startsWith('/admin'), url);
        assert.deepEqual(Shell._parse(url.slice('/admin'.length)), st, url);
        assert.equal(Shell.url(Shell._parse(url.slice('/admin'.length))), url);
      }
    }
  }
  assert.equal(Shell.url({ tab: 'characters', id: 'ironman' }), '/admin?tab=characters&id=ironman');
});

test('breadcrumbs: Admin › group › entry for each group; Overview is just Admin; pane crumbs follow', () => {
  const A = Shell.AdminView;
  const saved = { s: A._state, x: A._extraCrumbs };
  try {
    A._extraCrumbs = [];
    A._state = { tab: 'overview', sub: '', id: '' };
    assert.deepEqual(JSON.parse(JSON.stringify(Shell._crumbList())), [{ label: 'Admin', state: { tab: 'overview' } }]);
    for (const g of Shell.ADMIN_NAV) {
      for (const it of g.items) {
        if (it.key === 'overview') { assert.equal(g.group, null); continue; }
        assert.ok(g.group, `${it.key} sits under a heading`);
        A._state = { tab: it.key, sub: '', id: '' };
        assert.deepEqual(JSON.parse(JSON.stringify(Shell._crumbList())), [
          { label: 'Admin', state: { tab: 'overview' } },
          { label: g.group },                                   // a heading, not a link
          { label: it.label, state: { tab: it.key } }
        ], it.key);
      }
    }
    A._state = { tab: 'characters', sub: '', id: 'ironman' };
    A._extraCrumbs = [{ label: 'Iron Man' }];
    assert.deepEqual(Shell._crumbList().map(c => c.label), ['Admin', 'Content', 'Characters', 'Iron Man']);
  } finally { A._state = saved.s; A._extraCrumbs = saved.x; }
});

test('_upAction: Back only from the pushed child to its own parent, else replace', () => {
  const lastPush = { parent: '/admin?tab=characters', child: '/admin?tab=characters&id=ironman' };
  const up = (o) => Shell._upAction(Object.assign({ lastPush, here: lastPush.child, target: lastPush.parent }, o));
  assert.equal(up({}), 'back');
  assert.equal(up({ lastPush: null }), 'replace', 'deep link: nothing was pushed');
  assert.equal(up({ here: '/admin?tab=characters&id=thor' }), 'replace', 'moved on since the push');
  assert.equal(up({ target: '/admin' }), 'replace', 'up to another level (Admin crumb)');
});

test('AdminView.up(): history.back after a drill-down, a replace on a deep link', async () => {
  {
    const { AdminView, b } = setup('/admin?tab=characters');
    await tick();
    await AdminView.go({ tab: 'characters', id: 'ironman' }, { push: true });
    assert.equal(b.entries().length, 2, 'the drill-down pushed');
    assert.equal(b.index(), 1);
    assert.equal(b.location.search, '?tab=characters&id=ironman');
    await AdminView.up({ tab: 'characters' });
    await tick();
    assert.equal(b.index(), 0, 'went Back');
    assert.equal(b.location.search, '?tab=characters');
    assert.equal(AdminView._lastPush, null);
  }
  {
    const { AdminView, b } = setup('/admin?tab=characters&id=ironman');
    await tick();
    await AdminView.up({ tab: 'characters' });
    assert.equal(b.entries().length, 1, 'replaced in place');
    assert.equal(b.location.search, '?tab=characters');
    assert.equal(b.index(), 0);
  }
});
