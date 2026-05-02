/************************************************
 * ADMIN — USERS TAB
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;

  const ONLINE_WINDOW_MS = 5 * 60 * 1000;

  function isOnline(lastActiveAt) {
    if (!lastActiveAt) return false;
    const t = new Date(lastActiveAt).getTime();
    return Number.isFinite(t) && (Date.now() - t) < ONLINE_WINDOW_MS;
  }

  // Compact relative-time formatter: "just now" / "3m ago" / "2h ago" /
  // "yesterday" / fallback to absolute. Avoids pulling in a date lib.
  function relativeTime(lastActiveAt) {
    if (!lastActiveAt) return 'never active';
    const t = new Date(lastActiveAt).getTime();
    if (!Number.isFinite(t)) return 'never active';
    const diff = Date.now() - t;
    if (diff < 60 * 1000) return 'active just now';
    if (diff < 60 * 60 * 1000) return 'active ' + Math.floor(diff / 60000) + 'm ago';
    if (diff < 24 * 60 * 60 * 1000) return 'active ' + Math.floor(diff / 3600000) + 'h ago';
    if (diff < 48 * 60 * 60 * 1000) return 'active yesterday';
    if (diff < 30 * 24 * 60 * 60 * 1000) return 'active ' + Math.floor(diff / 86400000) + 'd ago';
    return 'last seen ' + AdminView.formatDate(lastActiveAt);
  }

  const Users = {
    _state: { page: 1, q: '', total: 0, items: [] },
    _searchTimer: null,

    mount(container) {
      container.innerHTML = `
        <div class="admin-users">
          <div class="admin-toolbar">
            <input id="admin-users-search" type="text" placeholder="Search username..." class="admin-input" />
            <span id="admin-users-count" class="admin-count">—</span>
          </div>
          <div id="admin-users-list" class="admin-list">Loading…</div>
          <div class="admin-pager">
            <button id="admin-users-prev" class="admin-btn">‹ Prev</button>
            <span id="admin-users-page">Page 1</span>
            <button id="admin-users-next" class="admin-btn">Next ›</button>
          </div>
          <div id="admin-user-detail" class="admin-detail" hidden></div>
        </div>
      `;

      const search = document.getElementById('admin-users-search');
      search.addEventListener('input', () => {
        clearTimeout(Users._searchTimer);
        Users._searchTimer = setTimeout(() => {
          Users._state.q = search.value.trim();
          Users._state.page = 1;
          Users.fetch();
        }, 250);
      });

      document.getElementById('admin-users-prev').addEventListener('click', () => {
        if (Users._state.page > 1) { Users._state.page--; Users.fetch(); }
      });
      document.getElementById('admin-users-next').addEventListener('click', () => {
        const last = Math.max(1, Math.ceil(Users._state.total / 25));
        if (Users._state.page < last) { Users._state.page++; Users.fetch(); }
      });

      Users.fetch();
    },

    async fetch() {
      const list = document.getElementById('admin-users-list');
      list.innerHTML = 'Loading…';
      try {
        const params = new URLSearchParams({
          page: String(Users._state.page),
          limit: '25'
        });
        if (Users._state.q) params.set('q', Users._state.q);
        const data = await AdminView.api('/users?' + params.toString());
        Users._state.items = data.items;
        Users._state.total = data.total;
        Users.render();
      } catch (e) {
        list.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    render() {
      const list = document.getElementById('admin-users-list');
      const count = document.getElementById('admin-users-count');
      const pageLabel = document.getElementById('admin-users-page');
      count.textContent = `${Users._state.total} user${Users._state.total === 1 ? '' : 's'}`;
      pageLabel.textContent = `Page ${Users._state.page} / ${Math.max(1, Math.ceil(Users._state.total / 25))}`;

      if (!Users._state.items.length) {
        list.innerHTML = `<div class="admin-empty">No users match.</div>`;
        return;
      }

      list.innerHTML = Users._state.items.map(u => `
        <div class="admin-row" data-id="${u._id}">
          <div class="admin-row-main">
            <span class="admin-username">
              ${isOnline(u.lastActiveAt) ? '<span class="admin-online-dot" title="online"></span>' : ''}
              ${esc(u.username)}
              ${u.isAdmin ? '<span class="admin-pill admin-pill-admin">admin</span>' : ''}
              ${u.banned ? '<span class="admin-pill admin-pill-banned">banned</span>' : ''}
            </span>
            <span class="admin-row-meta">
              ${esc(relativeTime(u.lastActiveAt))} · ${u.watchedCount} watched · ${u.memoryCount} memories · joined ${AdminView.formatDate(u.createdAt)}
            </span>
          </div>
          <button class="admin-btn admin-btn-view" data-id="${u._id}">View</button>
        </div>
      `).join('');

      list.querySelectorAll('.admin-btn-view').forEach(btn => {
        btn.addEventListener('click', () => Users.openDetail(btn.dataset.id));
      });
    },

    async openDetail(id) {
      const detail = document.getElementById('admin-user-detail');
      detail.hidden = false;
      detail.innerHTML = 'Loading…';
      // body has overflow:hidden so document.scrollIntoView is a no-op —
      // the admin-page is the scroll container, scroll it directly.
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
      try {
        const { user, friendCount, pendingCount } = await AdminView.api('/users/' + id);
        detail.innerHTML = `
          <div class="admin-detail-head">
            <h3>${esc(user.username)}</h3>
            <button class="admin-btn admin-btn-close" id="admin-detail-close">Close</button>
          </div>
          <div class="admin-detail-grid">
            <div><b>ID</b><span>${esc(user._id)}</span></div>
            <div><b>Joined</b><span>${AdminView.formatDate(user.createdAt)}</span></div>
            <div><b>Active</b><span>${isOnline(user.lastActiveAt) ? '<span class="admin-online-dot"></span> online — ' : ''}${esc(relativeTime(user.lastActiveAt))}</span></div>
            <div><b>Admin</b><span>${user.isAdmin ? 'yes' : 'no'}</span></div>
            <div><b>Banned</b><span>${user.banned ? 'yes' : 'no'}</span></div>
            <div><b>Watched</b><span>${(user.watchedProjects || []).length}</span></div>
            <div><b>Memories</b><span>${(user.watchedProjects || []).reduce((s, e) => s + (e.memories?.length || 0), 0)}</span></div>
            <div><b>Friends</b><span>${friendCount}</span></div>
            <div><b>Pending requests</b><span>${pendingCount}</span></div>
            ${user.banned ? `<div class="admin-detail-full"><b>Ban reason</b><span>${esc(user.banReason || '—')}</span></div>` : ''}
          </div>
          <div class="admin-detail-actions">
            ${user.banned
              ? `<button class="admin-btn" id="admin-act-unban">Unban</button>`
              : `<button class="admin-btn" id="admin-act-ban">Ban…</button>`}
            <button class="admin-btn" id="admin-act-pwd">Reset password…</button>
            <button class="admin-btn admin-btn-danger" id="admin-act-del">Delete user…</button>
          </div>
        `;
        document.getElementById('admin-detail-close').addEventListener('click', () => {
          detail.hidden = true;
          detail.innerHTML = '';
        });
        const banBtn = document.getElementById('admin-act-ban');
        if (banBtn) banBtn.addEventListener('click', () => Users.banPrompt(user));
        const unbanBtn = document.getElementById('admin-act-unban');
        if (unbanBtn) unbanBtn.addEventListener('click', () => Users.unban(user));
        document.getElementById('admin-act-pwd').addEventListener('click', () => Users.resetPwdPrompt(user));
        document.getElementById('admin-act-del').addEventListener('click', () => Users.deletePrompt(user));
      } catch (e) {
        detail.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    async banPrompt(user) {
      const reason = window.prompt(`Ban "${user.username}"?\n\nOptional reason (shown to user):`, '');
      if (reason === null) return;
      try {
        await AdminView.api(`/users/${user._id}/ban`, {
          method: 'POST',
          body: JSON.stringify({ reason })
        });
        AdminView.toast('User banned', 'success');
        Users.fetch();
        Users.openDetail(user._id);
      } catch (e) {
        AdminView.toast(e.message, 'error');
      }
    },

    async unban(user) {
      if (!window.confirm(`Unban "${user.username}"?`)) return;
      try {
        await AdminView.api(`/users/${user._id}/unban`, { method: 'POST' });
        AdminView.toast('User unbanned', 'success');
        Users.fetch();
        Users.openDetail(user._id);
      } catch (e) {
        AdminView.toast(e.message, 'error');
      }
    },

    async resetPwdPrompt(user) {
      const pwd = window.prompt(`Set new password for "${user.username}" (8–128 chars):`, '');
      if (pwd == null) return;
      try {
        await AdminView.api(`/users/${user._id}/password`, {
          method: 'POST',
          body: JSON.stringify({ password: pwd })
        });
        AdminView.toast('Password updated; user logged out everywhere', 'success');
      } catch (e) {
        AdminView.toast(e.message, 'error');
      }
    },

    async deletePrompt(user) {
      const ok = window.confirm(`PERMANENTLY DELETE "${user.username}"?\n\nThis removes the user, all watch progress, all memory metadata, and all friend records. The Cloudinary uploads themselves remain (delete them via the Moderation tab first).\n\nThis cannot be undone.`);
      if (!ok) return;
      try {
        await AdminView.api(`/users/${user._id}`, { method: 'DELETE' });
        AdminView.toast('User deleted', 'success');
        document.getElementById('admin-user-detail').hidden = true;
        Users.fetch();
      } catch (e) {
        AdminView.toast(e.message, 'error');
      }
    },

    unmount() {
      clearTimeout(Users._searchTimer);
    }
  };

  AdminView._tabs.users = Users;
})();
