/************************************************
 * ADMIN — USERS TAB
 *
 * A sortable table. Every column header but the actions one sorts the
 * WHOLE list on the server (GET /users?sort=&dir=; the allowlist and the
 * order live in js/admin-users-logic.js), so paging and the search box keep
 * working under a sort. Sort, search text and page survive a tab switch in
 * _state and are written back into the controls on remount.
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;

  const ONLINE_WINDOW_MS = 5 * 60 * 1000;
  const PAGE_SIZE = 25;

  // The sortable columns, in order; the actions column has no key.
  // `num` right-aligns the header and the cells.
  const COLUMNS = [
    { key: 'username',   label: 'Username' },
    { key: 'lastActive', label: 'Last active' },
    { key: 'watched',    label: 'Watched',  num: true },
    { key: 'memories',   label: 'Memories', num: true },
    { key: 'joined',     label: 'Joined' }
  ];

  function isOnline(lastActiveAt) {
    if (!lastActiveAt) return false;
    const t = new Date(lastActiveAt).getTime();
    return Number.isFinite(t) && (Date.now() - t) < ONLINE_WINDOW_MS;
  }

  // Compact relative-time formatter: "just now" / "3m ago" / "2h ago" /
  // "yesterday" / fallback to absolute. Avoids pulling in a date lib.
  // The detail panel gets the "active … / last seen …" wording; `bare`
  // drops the prefixes for a table cell ("6h ago", "8/30/2026", "never").
  function relativeTime(lastActiveAt, bare) {
    const p = bare ? '' : 'active ';
    if (!lastActiveAt) return bare ? 'never' : 'never active';
    const t = new Date(lastActiveAt).getTime();
    if (!Number.isFinite(t)) return bare ? 'never' : 'never active';
    const diff = Date.now() - t;
    if (diff < 60 * 1000) return p + 'just now';
    if (diff < 60 * 60 * 1000) return p + Math.floor(diff / 60000) + 'm ago';
    if (diff < 24 * 60 * 60 * 1000) return p + Math.floor(diff / 3600000) + 'h ago';
    if (diff < 48 * 60 * 60 * 1000) return p + 'yesterday';
    if (diff < 30 * 24 * 60 * 60 * 1000) return p + Math.floor(diff / 86400000) + 'd ago';
    return bare ? shortDate(lastActiveAt) : 'last seen ' + AdminView.formatDate(lastActiveAt);
  }

  // Date only, for a table cell; the full timestamp goes in the cell's title.
  function shortDate(d) {
    if (!d) return '—';
    const date = new Date(d);
    return isNaN(date) ? '—' : date.toLocaleDateString();
  }

  const Users = {
    _state: {
      page: 1, q: '',
      sort: AdminUsersLogic.DEFAULT_SORT, dir: AdminUsersLogic.DEFAULT_DIR,
      total: 0, items: []
    },
    _searchTimer: null,
    _fetchSeq: 0,

    mount(container) {
      // _state survives a tab switch (search text, sort and page are kept on
      // purpose), so the markup below writes q back into the box and
      // syncHeaders() puts the arrow on the sorted column — a filter or an
      // order the admin can't see would quietly hide users.
      container.innerHTML = `
        <div class="admin-users">
          <div class="admin-toolbar">
            <input id="admin-users-search" type="text" placeholder="Search username..." class="admin-input" value="${esc(Users._state.q)}" />
            <span id="admin-users-count" class="admin-count">—</span>
          </div>
          <div class="admin-table-wrap">
            <table class="admin-table admin-users-table">
              <thead>
                <tr>
                  ${COLUMNS.map(c => `
                  <th scope="col" class="admin-th${c.num ? ' admin-th-num' : ''}" data-sort="${c.key}">
                    <button type="button" class="admin-sort-btn" data-sort="${c.key}">
                      <span class="admin-sort-label">${esc(c.label)}</span>
                      <span class="admin-sort-arrow" aria-hidden="true"></span>
                    </button>
                  </th>`).join('')}
                  <th scope="col" class="admin-th admin-th-actions"><span class="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody id="admin-users-list"></tbody>
            </table>
          </div>
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

      container.querySelectorAll('.admin-sort-btn').forEach(btn => {
        btn.addEventListener('click', () => Users.setSort(btn.dataset.sort));
      });

      document.getElementById('admin-users-prev').addEventListener('click', () => {
        if (Users._state.page > 1) { Users._state.page--; Users.fetch(); }
      });
      document.getElementById('admin-users-next').addEventListener('click', () => {
        if (Users._state.page < Users.lastPage()) { Users._state.page++; Users.fetch(); }
      });

      Users.syncHeaders();
      Users.fetch();
    },

    lastPage() {
      return Math.max(1, Math.ceil(Users._state.total / PAGE_SIZE));
    },

    // A header click: a new column sorts ascending, the same column flips.
    // Back to page 1, since the whole order changes.
    setSort(key) {
      const next = AdminUsersLogic.nextSort(Users._state, key);
      Users._state.sort = next.sort;
      Users._state.dir = next.dir;
      Users._state.page = 1;
      Users.syncHeaders();
      Users.fetch();
    },

    // Arrow + aria-sort on the sorted column only (aria-sort belongs on at
    // most one header); the others get a faint ↕ so they read as clickable.
    syncHeaders() {
      const { sort, dir } = Users._state;
      const desc = dir === 'desc';
      document.querySelectorAll('.admin-users-table th[data-sort]').forEach(th => {
        const active = th.dataset.sort === sort;
        th.classList.toggle('admin-th-sorted', active);
        if (active) th.setAttribute('aria-sort', desc ? 'descending' : 'ascending');
        else th.removeAttribute('aria-sort');
        th.querySelector('.admin-sort-arrow').textContent = active ? (desc ? '▼' : '▲') : '↕';
        th.querySelector('.admin-sort-btn').title = active
          ? `Sorted ${desc ? 'descending' : 'ascending'} — click to flip`
          : 'Sort by this column';
      });
    },

    // One full-width row in the table body: loading / empty / error.
    setStatus(html) {
      const list = document.getElementById('admin-users-list');
      if (list) list.innerHTML = `<tr class="admin-table-status"><td colspan="${COLUMNS.length + 1}">${html}</td></tr>`;
    },

    async fetch() {
      // A slow earlier request must not paint over a newer one (two quick
      // header clicks, or typing while a page loads).
      const seq = ++Users._fetchSeq;
      Users.setStatus('Loading…');
      try {
        const params = new URLSearchParams({
          page: String(Users._state.page),
          limit: String(PAGE_SIZE),
          sort: Users._state.sort,
          dir: Users._state.dir
        });
        if (Users._state.q) params.set('q', Users._state.q);
        const data = await AdminView.api('/users?' + params.toString());
        if (seq !== Users._fetchSeq) return;
        Users._state.items = data.items;
        Users._state.total = data.total;
        Users.render();
      } catch (e) {
        if (seq !== Users._fetchSeq) return;
        Users.setStatus(`<div class="admin-error">${esc(e.message)}</div>`);
      }
    },

    render() {
      const list = document.getElementById('admin-users-list');
      const count = document.getElementById('admin-users-count');
      const pageLabel = document.getElementById('admin-users-page');
      count.textContent = `${Users._state.total} user${Users._state.total === 1 ? '' : 's'}`;
      pageLabel.textContent = `Page ${Users._state.page} / ${Users.lastPage()}`;

      if (!Users._state.items.length) {
        Users.setStatus('<div class="admin-empty">No users match.</div>');
        return;
      }

      list.innerHTML = Users._state.items.map(u => `
        <tr data-id="${esc(u._id)}">
          <td class="admin-td-user">
            <span class="admin-username">
              ${isOnline(u.lastActiveAt) ? '<span class="admin-online-dot" title="online"></span>' : ''}
              ${esc(u.username)}
              ${u.isAdmin ? '<span class="admin-pill admin-pill-admin">admin</span>' : ''}
              ${u.banned ? '<span class="admin-pill admin-pill-banned">banned</span>' : ''}
            </span>
          </td>
          <td class="admin-td-time" title="${esc(u.lastActiveAt ? AdminView.formatDate(u.lastActiveAt) : 'never active')}">${esc(relativeTime(u.lastActiveAt, true))}</td>
          <td class="admin-td-num">${Number(u.watchedCount) || 0}</td>
          <td class="admin-td-num">${Number(u.memoryCount) || 0}</td>
          <td class="admin-td-time" title="${esc(AdminView.formatDate(u.createdAt))}">${esc(shortDate(u.createdAt))}</td>
          <td class="admin-td-actions"><button class="admin-btn admin-btn-view" data-id="${esc(u._id)}">View</button></td>
        </tr>
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
            <button class="admin-btn" id="admin-act-watched" aria-expanded="false" aria-controls="admin-mw">Mark watched…</button>
            <button class="admin-btn admin-btn-danger" id="admin-act-del">Delete user…</button>
          </div>
          <div id="admin-mw" class="admin-mw" hidden></div>
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
        document.getElementById('admin-act-watched').addEventListener('click', () => Users.toggleMarkWatched(user));
        document.getElementById('admin-act-del').addEventListener('click', () => Users.deletePrompt(user));
      } catch (e) {
        detail.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    async banPrompt(user) {
      const reason = await promptDialog({
        title: `Ban "${user.username}"?`,
        message: 'They lose access everywhere at once; the reason is shown on their login screen.',
        label: 'Reason (optional, shown to the user)',
        placeholder: 'e.g. spam in chat',
        confirmLabel: 'Ban',
        danger: true,
        maxLength: 280
      });
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
      const ok = await confirmDialog({
        title: `Unban "${user.username}"?`,
        confirmLabel: 'Unban'
      });
      if (!ok) return;
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
      const pwd = await promptDialog({
        title: `New password for "${user.username}"`,
        message: 'They are signed out everywhere and must log in with it.',
        label: '8 characters or more',
        type: 'password',
        minLength: 8,
        maxLength: 72,
        required: true,
        confirmLabel: 'Set password'
      });
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

    // "Mark watched…": a searchable tick-list of every project. Titles the
    // user already has are shown ticked and locked. Marking skips the watch
    // timer — server/admin-watch.js has the rules.
    async toggleMarkWatched(user) {
      const panel = document.getElementById('admin-mw');
      const btn = document.getElementById('admin-act-watched');
      if (!panel.hidden) {
        panel.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        return;
      }
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      panel.innerHTML = 'Loading projects…';
      let items;
      try {
        ({ items } = await AdminView.api('/content/projects'));
      } catch (e) {
        panel.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
        return;
      }
      const watched = new Set((user.watchedProjects || []).map(e => e.projectId));
      const picked = new Set();
      panel.innerHTML = `
        <p class="admin-mw-note">Counts as a finished watch, so characters, rooms and phases unlock as usual. Nothing is posted to the feed; ${esc(user.username)} gets a note in their inbox.</p>
        <input type="search" class="admin-input admin-mw-search" placeholder="Search projects…" aria-label="Search projects" />
        <div class="admin-mw-list" role="group" aria-label="Projects">
          ${items.map(p => `
            <label class="admin-mw-row" data-search="${esc(`${p.title || ''} ${p.id} ${String(p.release || '').slice(0, 4)}`.toLowerCase())}">
              <input type="checkbox" value="${esc(p.id)}" ${watched.has(p.id) ? 'checked disabled' : ''} />
              <span class="admin-mw-title">${esc(p.title || p.id)}</span>
              <span class="admin-mw-year">${esc(String(p.release || '').slice(0, 4))}</span>
              ${watched.has(p.id) ? '<span class="admin-pill">watched</span>' : ''}
            </label>`).join('')}
        </div>
        <div class="admin-mw-foot">
          <span class="admin-count admin-mw-count" aria-live="polite">0 selected</span>
          <button class="admin-btn admin-mw-go" disabled>Mark watched</button>
        </div>
      `;
      const count = panel.querySelector('.admin-mw-count');
      const go = panel.querySelector('.admin-mw-go');
      const sync = () => {
        count.textContent = `${picked.size} selected`;
        go.disabled = picked.size === 0;
        go.textContent = picked.size ? `Mark ${picked.size} watched` : 'Mark watched';
      };
      panel.querySelector('.admin-mw-list').addEventListener('change', (e) => {
        const box = e.target.closest('input[type=checkbox]');
        if (!box) return;
        if (box.checked) picked.add(box.value); else picked.delete(box.value);
        sync();
      });
      panel.querySelector('.admin-mw-search').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        panel.querySelectorAll('.admin-mw-row').forEach(row => {
          row.hidden = !!q && !row.dataset.search.includes(q);
        });
      });
      go.addEventListener('click', () => Users.markWatched(user, [...picked], items));
    },

    async markWatched(user, ids, items) {
      if (!ids.length) return;
      const titleOf = (id) => (items.find(p => p.id === id) || {}).title || id;
      const names = ids.slice(0, 5).map(titleOf).join(', ') + (ids.length > 5 ? ` and ${ids.length - 5} more` : '');
      const ok = await confirmDialog({
        title: `Mark ${ids.length} project${ids.length === 1 ? '' : 's'} watched for "${user.username}"?`,
        message: `${names}. This skips the watch timer. Marked projects can't be un-marked.`,
        confirmLabel: 'Mark watched'
      });
      if (!ok) return;
      try {
        const { added } = await AdminView.api(`/users/${user._id}/watched`, {
          method: 'POST',
          body: JSON.stringify({ projectIds: ids })
        });
        AdminView.toast(`Marked ${added.length} project${added.length === 1 ? '' : 's'} watched`, 'success');
        Users.fetch();
        Users.openDetail(user._id);
      } catch (e) {
        AdminView.toast(e.message, 'error');
      }
    },

    async deletePrompt(user) {
      const ok = await confirmDialog({
        title: `Permanently delete "${user.username}"?`,
        message: 'This removes the user, their watch progress, posts, messages, uploads (the files too, unless another post still shows them) and friend records, and takes their name off friends’ “watched with” lists. Their bug reports are kept. This cannot be undone.',
        confirmLabel: 'Delete forever',
        danger: true
      });
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
