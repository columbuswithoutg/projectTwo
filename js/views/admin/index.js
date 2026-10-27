/************************************************
 * ADMIN VIEW (shell)
 * Tabbed admin panel — gates on Auth.isAdmin() (UX only; server enforces).
 ************************************************/
const AdminView = {
  title: 'Admin — MCU Tracker',
  _activeTab: null,
  _activeTabKey: 'users',

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

    // The last tab survives a remount (_activeTabKey), so the highlighted
    // button is derived from it instead of hard-coded to Users.
    const on = (key) => AdminView._activeTabKey === key ? ' active' : '';
    container.innerHTML = `
      <div class="admin-page">
        <header class="admin-header">
          <button class="admin-back" id="admin-back">← Back</button>
          <h1>Admin Panel</h1>
          <span class="admin-user">${escapeHtml(Auth.getUsername() || '')}</span>
        </header>
        <nav class="admin-tabs">
          <button class="admin-tab${on('users')}" data-tab="users">Users</button>
          <button class="admin-tab${on('moderation')}" data-tab="moderation">Moderation</button>
          <button class="admin-tab${on('reports')}" data-tab="reports">Reports</button>
          <button class="admin-tab${on('cms')}" data-tab="cms">CMS</button>
          <button class="admin-tab${on('config')}" data-tab="config">Config</button>
          <button class="admin-tab${on('audit')}" data-tab="audit">Audit Log</button>
          <button class="admin-tab${on('overview')}" data-tab="overview">Overview</button>
        </nav>
        <section id="admin-tab-host" class="admin-tab-host"></section>
      </div>
    `;

    document.getElementById('admin-back').addEventListener('click', () => Router.go('/'));

    const host = document.getElementById('admin-tab-host');
    const tabs = container.querySelectorAll('.admin-tab');
    tabs.forEach(btn => {
      btn.addEventListener('click', async () => {
        // Highlight only once the switch happened — "Keep editing" leaves
        // the current tab both shown and highlighted.
        if (!(await AdminView._mountTab(btn.dataset.tab, host))) return;
        tabs.forEach(b => b.classList.toggle('active', b === btn));
      });
    });

    AdminView._mountTab(AdminView._activeTabKey, host);
  },

  // → false when the admin chose to keep editing the current tab.
  async _mountTab(key, host) {
    const cur = AdminView._activeTab;
    if (cur && cur.isDirty && cur.isDirty()) {
      if (!(await AdminView._confirmDiscard())) return false;
      // The page may have been left while the dialog was up.
      if (!host.isConnected || AdminView._activeTab !== cur) return false;
      if (cur.discard) cur.discard();
    }
    if (cur && cur.unmount) {
      try { cur.unmount(); } catch {}
    }
    host.innerHTML = '';
    AdminView._activeTabKey = key;
    const tab = AdminView._tabs[key];
    if (tab) {
      AdminView._activeTab = tab;
      tab.mount(host);
    } else {
      AdminView._activeTab = null;
      host.textContent = 'Tab not implemented yet.';
    }
    return true;
  },

  unmount() {
    if (AdminView._activeTab && AdminView._activeTab.unmount) {
      try { AdminView._activeTab.unmount(); } catch {}
    }
    AdminView._activeTab = null;
  },

  // Router leave guard: unsaved board moves (they survive tab switches in
  // module state), an edited, unsaved project form, or whatever the active
  // tab reports (Config values, the active CMS sub-tab's form or pending
  // work — see their isDirty()).
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
  // A tab may describe its unsaved state better than "edits" (dirtyNote(),
  // e.g. an upload still running in CMS → Scene stills).
  _tabDirtyNote() {
    const tab = AdminView._activeTab;
    try { return (tab && tab.dirtyNote && tab.dirtyNote()) || null; } catch { return null; }
  },

  async canLeave() {
    if (!AdminView.isDirty()) return true;
    const ok = await Router.confirmLeave(AdminView._projectsDirty()
      ? 'You have unsaved project changes — board moves or an open project form.'
      : (AdminView._tabDirtyNote() || 'You have unsaved changes on this admin tab.'));
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

  // Shared "throw these edits away?" for a tab or CMS sub-tab switch —
  // same wording as the project form's own guard (cms-projects.js).
  _confirmDiscard() {
    return confirmDialog({
      title: 'Discard unsaved changes?',
      message: AdminView._tabDirtyNote() || 'Your edits on this tab haven’t been saved.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      danger: true
    });
  },

  // Populated by individual tab files which assign into AdminView._tabs.
  _tabs: {}
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
