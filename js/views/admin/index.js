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

    container.innerHTML = `
      <div class="admin-page">
        <header class="admin-header">
          <button class="admin-back" id="admin-back">← Back</button>
          <h1>Admin Panel</h1>
          <span class="admin-user">${escapeHtml(Auth.getUsername() || '')}</span>
        </header>
        <nav class="admin-tabs">
          <button class="admin-tab active" data-tab="users">Users</button>
          <button class="admin-tab" data-tab="moderation">Moderation</button>
          <button class="admin-tab" data-tab="cms">CMS</button>
          <button class="admin-tab" data-tab="config">Config</button>
          <button class="admin-tab" data-tab="audit">Audit Log</button>
          <button class="admin-tab" data-tab="overview">Overview</button>
        </nav>
        <section id="admin-tab-host" class="admin-tab-host"></section>
      </div>
    `;

    document.getElementById('admin-back').addEventListener('click', () => Router.go('/'));

    const host = document.getElementById('admin-tab-host');
    const tabs = container.querySelectorAll('.admin-tab');
    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        tabs.forEach(b => b.classList.toggle('active', b === btn));
        AdminView._mountTab(btn.dataset.tab, host);
      });
    });

    AdminView._mountTab(AdminView._activeTabKey, host);
  },

  _mountTab(key, host) {
    if (AdminView._activeTab && AdminView._activeTab.unmount) {
      try { AdminView._activeTab.unmount(); } catch {}
    }
    host.innerHTML = '';
    AdminView._activeTabKey = key;
    const tab = AdminView._tabs[key];
    if (tab) {
      AdminView._activeTab = tab;
      tab.mount(host);
    } else {
      host.textContent = 'Tab not implemented yet.';
    }
  },

  unmount() {
    if (AdminView._activeTab && AdminView._activeTab.unmount) {
      try { AdminView._activeTab.unmount(); } catch {}
    }
    AdminView._activeTab = null;
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
    Auth.logout();
    throw new Error('Session expired');
  }
  if (res.status === 403) {
    Router.go('/');
    throw new Error('Forbidden');
  }
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    throw new Error((body && body.error) || `HTTP ${res.status}`);
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
