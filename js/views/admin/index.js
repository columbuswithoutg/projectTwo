/************************************************
 * ADMIN VIEW (shell)
 * Grouped left sidebar (a slide-in drawer on phones), breadcrumbs, a URL per
 * view and a sticky Save bar. Gates on Auth.isAdmin() (UX only; the server
 * enforces).
 *
 * One registry (ADMIN_NAV) maps every sidebar entry to a pane. A pane is an
 * object with mount(host, ctx) / unmount() and, when it holds edits,
 * isDirty() / discard() (+ optional dirtyNote(), save()). Panes still
 * register on AdminView._tabs (or AdminView._cms for the Content editors).
 *
 * URL: /admin?tab=<entry>&sub=<in-pane view>&id=<drilled-into item>. The
 * router keeps the query and remounts this view when it changes, so every
 * navigation goes through Router.go — replacing the entry for a sidebar or
 * sub-view switch, pushing it for a drill-down (Back goes up one level).
 * In-pane state that must survive (Dialogues sections, List/Board, an open
 * form) only rewrites the address with history.replaceState (syncUrl).
 ************************************************/

// Sidebar entries. `pane` is looked up lazily: the pane files load after
// this one. `group: null` = no heading (Overview, the landing page).
const ADMIN_NAV = [
  { group: null, items: [
    { key: 'overview', label: 'Overview', pane: () => AdminView._tabs.overview }
  ] },
  { group: 'People', items: [
    { key: 'users', label: 'Users', pane: () => AdminView._tabs.users },
    { key: 'moderation', label: 'Moderation', pane: () => AdminView._tabs.moderation, badge: 'friends' },
    { key: 'reports', label: 'Reports', pane: () => AdminView._tabs.reports, badge: 'reports' },
    { key: 'suggestions', label: 'Quote suggestions', pane: () => AdminView._tabs.suggestions, badge: 'suggestions' }
  ] },
  { group: 'Content', items: [
    { key: 'projects', label: 'Projects', pane: () => AdminView._cms.projects },
    { key: 'characters', label: 'Characters', pane: () => AdminView._cms.characters },
    { key: 'locations', label: 'Locations', pane: () => AdminView._cms.locations },
    { key: 'dialogues', label: 'Dialogues', pane: () => AdminView._cms.dialogues }
  ] },
  { group: 'Minigames', items: [
    { key: 'scene-guess', label: 'Scene Guess', pane: () => AdminView._tabs['scene-guess'] },
    { key: 'quote-guess', label: 'Quote Guess', pane: () => AdminView._tabs['quote-guess'] }
  ] },
  { group: 'World settings', items: [
    { key: 'physics', label: 'Physics & limits', pane: () => AdminView._tabs.physics },
    { key: 'defaults', label: 'Defaults', pane: () => AdminView._tabs.defaults },
    { key: 'npcs', label: 'NPC bodies', pane: () => AdminView._tabs.npcs },
    { key: 'event', label: 'World event', pane: () => AdminView._tabs.event }
  ] },
  { group: 'System', items: [
    { key: 'audit', label: 'Audit log', pane: () => AdminView._tabs.audit }
  ] }
];

// Old ?tab= values (bookmarks from the tabbed panel) → their new home.
const ADMIN_LEGACY_TABS = { cms: 'projects', config: 'physics', scenes: 'scene-guess', quotes: 'quote-guess' };

const AdminView = {
  title: 'Admin — MCU Tracker',
  _activeTab: null,     // the mounted pane object
  _state: { tab: 'overview', sub: '', id: '' },
  _extraCrumbs: [],
  _lastPush: null,      // { parent, child } URLs of the last drill-down (crumb "up" = history.back)
  _sideScroll: 0,
  _barTimer: null,
  _cleanup: [],

  _findItem(key) {
    for (const g of ADMIN_NAV) {
      const it = g.items.find(i => i.key === key);
      if (it) return { item: it, group: g.group };
    }
    return null;
  },

  // location.search → { tab, sub, id } (unknown tab → Overview).
  _parse(search) {
    const q = new URLSearchParams(search || '');
    let tab = q.get('tab') || 'overview';
    if (ADMIN_LEGACY_TABS[tab]) tab = ADMIN_LEGACY_TABS[tab];
    if (!AdminView._findItem(tab)) tab = 'overview';
    return { tab, sub: q.get('sub') || '', id: q.get('id') || '' };
  },

  url(state) {
    const q = new URLSearchParams();
    if (state.tab && state.tab !== 'overview') q.set('tab', state.tab);
    if (state.sub) q.set('sub', state.sub);
    if (state.id) q.set('id', state.id);
    const s = q.toString();
    return '/admin' + (s ? '?' + s : '');
  },

  // Navigate inside admin. opts.push → a new history entry (drill-down).
  go(state, opts) {
    const url = AdminView.url(state);
    if (opts && opts.push) AdminView._lastPush = { parent: location.pathname + location.search, child: url };
    return Router.go(url, { replace: !(opts && opts.push) });
  },

  // Up to a parent view (breadcrumb / "← All …"): Back when the parent is
  // the entry the current drill-down was pushed from, else a replace.
  up(state) {
    const url = AdminView.url(state);
    const lp = AdminView._lastPush;
    if (lp && lp.parent === url && lp.child === location.pathname + location.search) {
      AdminView._lastPush = null;
      history.back();
      return Promise.resolve();
    }
    return AdminView.go(state);
  },

  // Rewrite the address for in-pane state without remounting.
  syncUrl(state) {
    const next = Object.assign({ tab: AdminView._state.tab, sub: '', id: '' }, state);
    AdminView._state = next;
    const url = AdminView.url(next);
    if (location.pathname + location.search !== url) {
      try { history.replaceState(history.state, '', url); } catch (_) {}
    }
  },

  // Panes add trail entries below their sidebar entry: [{ label, state? }].
  setCrumbs(extra) {
    AdminView._extraCrumbs = Array.isArray(extra) ? extra : [];
    AdminView._renderCrumbs();
  },

  _ctx() {
    const s = AdminView._state;
    return {
      tab: s.tab, sub: s.sub, id: s.id,
      go: (part, opts) => AdminView.go(Object.assign({ tab: s.tab }, part), opts),
      up: (part) => AdminView.up(Object.assign({ tab: s.tab }, part)),
      sync: (part) => AdminView.syncUrl(Object.assign({ tab: AdminView._state.tab }, part)),
      crumbs: (extra) => AdminView.setCrumbs(extra)
    };
  },

  mount(container) {
    if (!Auth.isLoggedIn()) {
      Router.go('/login');
      return;
    }
    if (!Auth.isAdmin()) {
      // Non-admins should not see the admin shell. Server will 403 on every
      // /api/admin/* call anyway, but skipping the render avoids a flash.
      Router.go('/');
      return;
    }

    AdminView._state = AdminView._parse(location.search);
    const esc = AdminView._escapeHtml;
    const cur = AdminView._state.tab;
    const nav = ADMIN_NAV.map(g => `
      <div class="admin-nav-group">
        ${g.group ? `<h2 class="admin-nav-heading">${esc(g.group)}</h2>` : ''}
        ${g.items.map(it => `
          <a class="admin-nav-item${it.key === cur ? ' active' : ''}" href="${esc(AdminView.url({ tab: it.key }))}"
             data-tab="${esc(it.key)}"${it.key === cur ? ' aria-current="page"' : ''}>
            <span class="admin-nav-label">${esc(it.label)}</span>
            ${it.badge ? `<span class="admin-nav-badge" data-badge="${esc(it.badge)}" hidden></span>` : ''}
            <span class="admin-nav-dot" aria-hidden="true"></span>
          </a>`).join('')}
      </div>`).join('');

    container.innerHTML = `
      <div class="admin-shell">
        <aside class="admin-side" id="admin-side" aria-label="Admin sections">
          <div class="admin-side-head">
            <span class="admin-side-title">Admin</span>
            <span class="admin-user">${esc(Auth.getUsername() || '')}</span>
          </div>
          <nav class="admin-nav">${nav}</nav>
        </aside>
        <div class="admin-scrim" id="admin-scrim" hidden></div>
        <div class="admin-page">
          <header class="admin-header">
            <button type="button" class="admin-menu-btn" id="admin-menu" aria-controls="admin-side" aria-expanded="false" aria-label="Open admin menu">☰</button>
            <h1 id="admin-title">Admin</h1>
            <button class="admin-back" id="admin-back">← Site</button>
          </header>
          <nav class="admin-crumbs" id="admin-crumbs" aria-label="Breadcrumb"></nav>
          <section id="admin-tab-host" class="admin-tab-host"></section>
          <div class="admin-savebar" id="admin-savebar" role="region" aria-label="Unsaved changes" hidden>
            <span class="admin-savebar-dot" aria-hidden="true"></span>
            <span class="admin-savebar-msg">You have unsaved changes</span>
            <button type="button" class="admin-btn" data-bar="discard">Discard</button>
            <button type="button" class="admin-btn admin-btn-primary" data-bar="save">Save</button>
          </div>
        </div>
      </div>
    `;

    const shell = container.querySelector('.admin-shell');
    const side = document.getElementById('admin-side');
    const menuBtn = document.getElementById('admin-menu');
    const scrim = document.getElementById('admin-scrim');
    side.scrollTop = AdminView._sideScroll;
    side.addEventListener('scroll', () => { AdminView._sideScroll = side.scrollTop; }, { passive: true });

    const setDrawer = (open) => {
      shell.classList.toggle('nav-open', open);
      scrim.hidden = !open;
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        // After the slide-in: a hidden (visibility) drawer can't take focus.
        let done = false;
        const focusItem = () => {
          if (done) return;
          done = true;
          const a = side.querySelector('.admin-nav-item.active') || side.querySelector('.admin-nav-item');
          if (a && shell.classList.contains('nav-open')) a.focus({ preventScroll: true });
        };
        side.addEventListener('transitionend', focusItem, { once: true });
        setTimeout(focusItem, 400);
      }
    };
    menuBtn.addEventListener('click', () => setDrawer(!shell.classList.contains('nav-open')));
    scrim.addEventListener('click', () => setDrawer(false));
    const onKey = (e) => { if (e.key === 'Escape' && shell.classList.contains('nav-open')) setDrawer(false); };
    document.addEventListener('keydown', onKey);
    AdminView._cleanup.push(() => document.removeEventListener('keydown', onKey));

    document.getElementById('admin-back').addEventListener('click', () => Router.go('/'));

    side.querySelectorAll('.admin-nav-item').forEach(a => {
      a.addEventListener('click', (e) => {
        // Let the browser handle new-tab / new-window clicks.
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        setDrawer(false);
        const s = AdminView._state;
        if (a.dataset.tab === s.tab && !s.sub && !s.id) return;
        AdminView._lastPush = null;
        AdminView.go({ tab: a.dataset.tab });
      });
    });

    document.getElementById('admin-crumbs').addEventListener('click', (e) => {
      const a = e.target.closest('a[data-crumb]');
      if (!a) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      const c = AdminView._crumbList()[parseInt(a.dataset.crumb, 10)];
      if (c && c.state) AdminView.up(c.state);
    });

    const bar = document.getElementById('admin-savebar');
    bar.querySelector('[data-bar="save"]').addEventListener('click', AdminView._barSave);
    bar.querySelector('[data-bar="discard"]').addEventListener('click', AdminView._barDiscard);
    // Edits show the bar at once; the 300 ms poll catches the rest (a
    // dialog's answer, an async load, an upload finishing).
    const page = container.querySelector('.admin-page');
    const kick = () => setTimeout(AdminView._syncSaveBar, 0);
    ['input', 'change', 'click'].forEach(t => page.addEventListener(t, kick, true));
    clearInterval(AdminView._barTimer);
    AdminView._barTimer = setInterval(AdminView._syncSaveBar, 300);

    AdminView._mountPane();
    AdminView._paintAttention();
    const board = AdminView._projectsBoard;
    AdminView.setNavBadge('projects', !!(board && board.isDirty && board.isDirty()));
  },

  // Mount the pane for AdminView._state into the host (also the Save bar's
  // Discard: a fresh mount re-reads everything from the server).
  _mountPane() {
    const host = document.getElementById('admin-tab-host');
    if (!host) return;
    const cur = AdminView._activeTab;
    if (cur && cur.unmount) { try { cur.unmount(); } catch {} }
    host.innerHTML = '';
    AdminView._extraCrumbs = [];
    const found = AdminView._findItem(AdminView._state.tab);
    const label = found ? found.item.label : 'Admin';
    document.getElementById('admin-title').textContent = label;
    document.title = (found && found.item.key !== 'overview' ? label + ' · ' : '') + AdminView.title;
    AdminView._renderCrumbs();
    const pane = found && found.item.pane();
    if (pane && typeof pane.mount === 'function') {
      AdminView._activeTab = pane;
      pane.mount(host, AdminView._ctx());
    } else {
      AdminView._activeTab = null;
      host.innerHTML = '<div class="admin-empty">This section is not loaded.</div>';
    }
    AdminView._syncSaveBar();
  },

  refresh() {
    AdminView._state = AdminView._parse(location.search);
    AdminView._mountPane();
  },

  _crumbList() {
    const s = AdminView._state;
    const found = AdminView._findItem(s.tab);
    const list = [{ label: 'Admin', state: { tab: 'overview' } }];
    if (found && found.item.key !== 'overview') {
      if (found.group) list.push({ label: found.group });
      list.push({ label: found.item.label, state: { tab: found.item.key } });
    }
    return list.concat(AdminView._extraCrumbs || []);
  },

  _renderCrumbs() {
    const el = document.getElementById('admin-crumbs');
    if (!el) return;
    const esc = AdminView._escapeHtml;
    const list = AdminView._crumbList();
    el.innerHTML = '<ol>' + list.map((c, i) => {
      if (i === list.length - 1) return `<li><span aria-current="page">${esc(c.label)}</span></li>`;
      if (c.state) return `<li><a href="${esc(AdminView.url(c.state))}" data-crumb="${i}">${esc(c.label)}</a></li>`;
      return `<li><span class="admin-crumb-plain">${esc(c.label)}</span></li>`;
    }).join('') + '</ol>';
  },

  // ── sidebar badges ("needs attention") ────────────────────────────────

  // Counts the panes already fetch: open reports, quote suggestions waiting,
  // pending friend requests. Cached 30 s across remounts; a failed call just
  // leaves its count null.
  _att: { t: 0, p: null },
  attention(force) {
    const a = AdminView._att;
    if (!force && a.p && Date.now() - a.t < 30000) return a.p;
    a.t = Date.now();
    const total = (p, key) => AdminView.api(p).then(r => (r && Number.isFinite(r[key]) ? r[key] : null)).catch(() => null);
    a.p = Promise.all([
      total('/reports?status=open&limit=1', 'total'),
      total('/quotes/summary', 'pendingTotal'),
      total('/friends/pending?limit=1', 'total')
    ]).then(([reports, suggestions, friends]) => ({ reports, suggestions, friends }));
    return a.p;
  },
  async _paintAttention() {
    const counts = await AdminView.attention();
    for (const [k, v] of Object.entries(counts)) AdminView.setNavBadge(k, v);
  },
  // A count (number) or a dot (true/false) on a sidebar entry. `key` is the
  // entry's badge name (reports / suggestions / friends) for a count, or its
  // tab key for a dot (Projects: unsaved board moves).
  setNavBadge(key, value) {
    if (Number.isInteger(value) && AdminView._att.p) {
      // Keep the cache honest when a pane learns a fresher count.
      AdminView._att.p = AdminView._att.p.then(c => Object.assign({}, c, { [key]: value }));
    }
    const side = document.getElementById('admin-side');
    if (!side) return;
    if (typeof value === 'boolean') {
      const item = side.querySelector(`.admin-nav-item[data-tab="${key}"]`);
      if (item) item.classList.toggle('has-pending', value);
      return;
    }
    const b = side.querySelector(`.admin-nav-badge[data-badge="${key}"]`);
    if (!b) return;
    b.hidden = !value;
    b.textContent = value > 99 ? '99+' : String(value || '');
  },

  // ── sticky Save bar ───────────────────────────────────────────────────

  _barDirty() {
    const p = AdminView._activeTab;
    try {
      if (!p) return false;
      if (p.saveBarDirty) return !!p.saveBarDirty();
      return !!(p.isDirty && p.isDirty());
    } catch { return false; }
  },
  _syncSaveBar() {
    const bar = document.getElementById('admin-savebar');
    if (!bar) return;
    const dirty = AdminView._barDirty();
    bar.hidden = !dirty;
    if (!dirty) return;
    const p = AdminView._activeTab;
    bar.querySelector('.admin-savebar-msg').textContent = AdminView._tabDirtyNote() || 'You have unsaved changes';
    bar.querySelector('[data-bar="save"]').hidden = !(p && typeof p.save === 'function');
  },
  async _barSave() {
    const p = AdminView._activeTab;
    const bar = document.getElementById('admin-savebar');
    if (!p || typeof p.save !== 'function' || !bar) return;
    const btns = bar.querySelectorAll('button');
    btns.forEach(b => { b.disabled = true; });
    try { await p.save(); } catch (e) { AdminView.toast(e.message || 'Could not save', 'error'); }
    finally {
      btns.forEach(b => { b.disabled = false; });
      AdminView._syncSaveBar();
    }
  },
  async _barDiscard() {
    const p = AdminView._activeTab;
    if (!p) return;
    if (!(await AdminView._confirmDiscard())) return;
    if (AdminView._activeTab !== p) return;
    try { if (p.barDiscard) p.barDiscard(); else if (p.discard) p.discard(); } catch {}
    AdminView.refresh();
  },

  unmount() {
    clearInterval(AdminView._barTimer);
    AdminView._barTimer = null;
    AdminView._cleanup.splice(0).forEach(fn => { try { fn(); } catch {} });
    if (AdminView._activeTab && AdminView._activeTab.unmount) {
      try { AdminView._activeTab.unmount(); } catch {}
    }
    AdminView._activeTab = null;
  },

  // Router leave guard: unsaved board moves (they survive pane switches in
  // module state), an edited, unsaved project form, or whatever the active
  // pane reports (Config values, a CMS form, pending uploads — see their
  // isDirty()).
  _projectsDirty() {
    const board = AdminView._projectsBoard;
    const editor = AdminView._cms && AdminView._cms.projects;
    return !!((board && board.isDirty && board.isDirty()) ||
              (editor && editor.isFormDirty && editor.isFormDirty()));
  },
  _tabDirty() {
    const tab = AdminView._activeTab;
    try { return !!(tab && tab.isDirty && tab.isDirty()); } catch { return false; }
  },
  isDirty() {
    return AdminView._projectsDirty() || AdminView._tabDirty();
  },
  // A pane may describe its unsaved state better than "edits" (dirtyNote(),
  // e.g. an upload still running in Scene Guess).
  _tabDirtyNote() {
    const tab = AdminView._activeTab;
    try { return (tab && tab.dirtyNote && tab.dirtyNote()) || null; } catch { return null; }
  },

  async canLeave(ctx) {
    const to = ctx && typeof ctx.to === 'string' ? ctx.to : '';
    // Moving between admin views: only the active pane's edits are at stake
    // (board moves stay in module state and survive, as before).
    if (/^\/admin(\?|#|$)/.test(to)) {
      if (!AdminView._tabDirty()) return true;
      const cur = AdminView._activeTab;
      const ok = await AdminView._confirmDiscard();
      if (ok && cur && cur.discard) { try { cur.discard(); } catch {} }
      return ok;
    }
    if (!AdminView.isDirty()) return true;
    const ok = await Router.confirmLeave(AdminView._projectsDirty()
      ? 'You have unsaved project changes — board moves or an open project form.'
      : (AdminView._tabDirtyNote() || 'You have unsaved changes on this admin page.'));
    if (ok) {
      const board = AdminView._projectsBoard;
      const editor = AdminView._cms && AdminView._cms.projects;
      const tab = AdminView._activeTab;
      if (board && board.discardAll) board.discardAll();
      if (editor && editor.forgetForm) editor.forgetForm();
      if (tab && tab.discard) { try { tab.discard(); } catch {} }
    }
    return ok;
  },

  // Shared "throw these edits away?" for a pane or sub-view switch — same
  // wording as the project form's own guard (cms-projects.js).
  _confirmDiscard() {
    return confirmDialog({
      title: 'Discard unsaved changes?',
      message: AdminView._tabDirtyNote() || 'Your edits on this page haven’t been saved.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      danger: true
    });
  },

  // Populated by the pane files: AdminView._tabs.<key> = pane.
  _tabs: {},
  // Content editors (cms-*.js) register here.
  _cms: {}
};

// Shared helpers used by every tab. Hoisted onto AdminView so each tab
// file stays self-contained.
AdminView.api = async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = Auth.getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(`${API}/admin${path}`, { ...opts, headers });
  if (res.status === 401) {
    Auth.logout({ next: location.pathname + location.search });   // back here after signing in
    throw new Error('Session expired');
  }
  if (res.status === 403) {
    Router.go('/');
    throw new Error('Forbidden');
  }
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    // status + body ride along so a form can react to details (a 409's
    // suggested cell, the ids in a prerequisite loop).
    const err = new Error((body && body.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
};

AdminView.toast = function toast(msg, kind = 'info') {
  const el = document.createElement('div');
  el.className = 'admin-toast admin-toast-' + kind;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.classList.add('show'); }, 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 2400);
};

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Expose so each tab file (loaded after this) can use it.
AdminView._escapeHtml = escapeHtml;

AdminView.formatDate = function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date)) return '—';
  return date.toLocaleString();
};

// A Minigames page: the game's own settings card (flag + round time, from
// AdminConfig via the Config section `cfgKey`, config.js) on top, then its
// content editor. One pane to the shell: dirty / save / discard cover both.
AdminView._minigamePane = function minigamePane(cfgKey, editorOf) {
  const cfg = () => AdminView._configSection(cfgKey);
  return {
    mount(host, ctx) {
      host.innerHTML = '<div class="admin-mg"><section class="admin-mg-settings" aria-label="Game settings"></section><div class="admin-mg-body"></div></div>';
      cfg().mount(host.querySelector('.admin-mg-settings'), Object.assign({}, ctx, {
        // A flag change alters the editor's banners and statuses: remount
        // (the URL keeps the view), unless the editor holds edits.
        onSaved: () => { if (!editorOf().isDirty()) AdminView.refresh(); }
      }));
      editorOf().mount(host.querySelector('.admin-mg-body'), ctx);
    },
    unmount() {
      try { cfg().unmount(); } catch {}
      try { editorOf().unmount(); } catch {}
    },
    isDirty() { return cfg().isDirty() || !!editorOf().isDirty(); },
    dirtyNote() { const e = editorOf(); return (e.dirtyNote && e.dirtyNote()) || null; },
    discard() { cfg().discard(); const e = editorOf(); if (e.discard) e.discard(); },
    async save() {
      const e = editorOf();
      if (e.isDirty() && typeof e.save === 'function') await e.save();
      if (cfg().isDirty()) await cfg().save();
    }
  };
};
