/************************************************
 * Admin sidebar "needs attention" badges (js/views/admin/index.js) stay in
 * step when the admin clears items: a report's status change, a reply that
 * changes the status, or a delete in Reports (js/views/admin/reports.js),
 * and deleting a pending friend request in Moderation
 * (js/views/admin/moderation.js). Before, the 30 s cached count stayed on.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');

function el(tag) {
  const listeners = {};
  const qs = new Map();
  const e = {
    tagName: tag, value: '', textContent: '', hidden: false, disabled: false, dataset: {}, innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    querySelector(s) { if (!qs.has(s)) qs.set(s, el('q')); return qs.get(s); },
    querySelectorAll() { return []; }
  };
  return e;
}

function setup() {
  const byId = new Map();
  const db = {
    reports: [{ _id: 'r1', status: 'open' }, { _id: 'r2', status: 'open' }, { _id: 'r3', status: 'open' }],
    friends: 2
  };
  const ctx = {
    console, setTimeout, clearTimeout, URLSearchParams,
    CSS: { escape: (s) => s },
    document: { createElement: el, getElementById: (id) => { if (!byId.has(id)) byId.set(id, el('div')); return byId.get(id); }, body: el('body') },
    location: { pathname: '/admin', search: '' },
    history: { state: null, replaceState() {} },
    Router: { go() {}, replaceUrl() { return true; } },
    confirmDialog: async () => true
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['messaging-logic.js', 'views/admin/index.js', 'views/admin/reports.js', 'views/admin/moderation.js']) vm.runInContext(read(f), ctx);
  vm.runInContext('this.AdminView = AdminView;', ctx);
  const AdminView = ctx.AdminView;
  AdminView.toast = () => {};
  const open = () => db.reports.filter(r => r.status === 'open');
  AdminView.api = async (p, o) => {
    const method = (o && o.method) || 'GET';
    const body = o && o.body ? JSON.parse(o.body) : {};
    let m;
    if (p === '/quotes/summary') return { pendingTotal: 0 };
    if (p.startsWith('/friends/pending')) return { total: db.friends, items: [] };
    if ((m = p.match(/^\/friends\/(\w+)$/)) && method === 'DELETE') { db.friends--; return { ok: true }; }
    if (p.startsWith('/reports?')) {
      const status = new URLSearchParams(p.split('?')[1]).get('status');
      const items = status ? db.reports.filter(r => r.status === status) : db.reports;
      return { total: items.length, items };
    }
    if ((m = p.match(/^\/reports\/(\w+)\/replies$/))) {
      const r = db.reports.find(x => x._id === m[1]);
      if (body.status) r.status = body.status;
      return { ok: true };
    }
    if ((m = p.match(/^\/reports\/(\w+)$/))) {
      if (method === 'DELETE') db.reports = db.reports.filter(x => x._id !== m[1]);
      else db.reports.find(x => x._id === m[1]).status = body.status;
      return { ok: true };
    }
    throw new Error('unexpected ' + method + ' ' + p);
  };
  const side = ctx.document.getElementById('admin-side');
  const badge = (key) => side.querySelector(`.admin-nav-badge[data-badge="${key}"]`).textContent;
  return { ctx, AdminView, db, badge };
}
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };
// The pane's copy of a report (the server's JSON), not the fake DB's record.
const copy = (r) => Object.assign({}, r);
const row = (status) => { const r = el('div'); r.querySelector('.admin-report-status').value = status; r.querySelector('.admin-report-text').value = 'Thanks, fixed.'; return r; };

test('Reports: a status change, a reply that changes it, and a delete repaint the sidebar count at once', async () => {
  const { AdminView, db, badge } = setup();
  await AdminView._paintAttention();
  assert.equal(badge('reports'), '3');
  const Reports = AdminView._tabs.reports;
  Reports.mount(el('div'));
  await settle();

  await Reports.setStatus(copy(db.reports[0]), row('fixed'));
  await settle();
  assert.equal(badge('reports'), '2', 'marked Fixed: one fewer open');

  await Reports.reply(copy(db.reports[1]), row('closed'));
  await settle();
  assert.equal(badge('reports'), '1', 'a reply that closes it');

  await Reports.remove(copy(db.reports[2]));
  await settle();
  assert.equal(badge('reports'), '', 'deleted the last open one: the badge goes away');
  // The cache now holds the fresh count, so a remount within 30 s agrees.
  assert.equal((await AdminView.attention()).reports, 0);
});

test('Moderation: deleting a pending friend request updates the friends badge', async () => {
  const { AdminView, db, badge } = setup();
  await AdminView._paintAttention();
  assert.equal(badge('friends'), '2');
  const Mod = AdminView._tabs.moderation;
  Mod.mount(el('div'), { sub: 'friends', sync() {}, crumbs() {} });
  await settle();
  await Mod.deleteFriend('f1');
  await settle();
  assert.equal(db.friends, 1);
  assert.equal(badge('friends'), '1');
  assert.equal((await AdminView.attention()).friends, 1, 'and the cached count agrees');
});
