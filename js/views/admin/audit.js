/************************************************
 * ADMIN — AUDIT LOG TAB
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;

  const ACTIONS = [
    'ban', 'unban', 'deleteUser', 'deleteMemory',
    'resetPassword', 'configChange', 'contentEdit', 'deleteFriendRequest'
  ];

  const Audit = {
    _state: { page: 1, total: 0, items: [], action: '' },

    mount(container) {
      container.innerHTML = `
        <div class="admin-audit">
          <div class="admin-toolbar">
            <select id="admin-audit-action" class="admin-input">
              <option value="">All actions</option>
              ${ACTIONS.map(a => `<option value="${a}">${a}</option>`).join('')}
            </select>
            <span id="admin-audit-count" class="admin-count">—</span>
          </div>
          <div id="admin-audit-list" class="admin-list">Loading…</div>
          <div class="admin-pager">
            <button class="admin-btn" id="admin-audit-prev">‹ Prev</button>
            <span id="admin-audit-page">Page 1</span>
            <button class="admin-btn" id="admin-audit-next">Next ›</button>
          </div>
        </div>
      `;

      const sel = document.getElementById('admin-audit-action');
      sel.addEventListener('change', () => {
        Audit._state.action = sel.value;
        Audit._state.page = 1;
        Audit.fetch();
      });
      document.getElementById('admin-audit-prev').addEventListener('click', () => {
        if (Audit._state.page > 1) { Audit._state.page--; Audit.fetch(); }
      });
      document.getElementById('admin-audit-next').addEventListener('click', () => {
        const last = Math.max(1, Math.ceil(Audit._state.total / 25));
        if (Audit._state.page < last) { Audit._state.page++; Audit.fetch(); }
      });
      Audit.fetch();
    },

    async fetch() {
      const list = document.getElementById('admin-audit-list');
      list.innerHTML = 'Loading…';
      try {
        const params = new URLSearchParams({ page: String(Audit._state.page), limit: '25' });
        if (Audit._state.action) params.set('action', Audit._state.action);
        const data = await AdminView.api('/audit?' + params.toString());
        Audit._state.total = data.total;
        Audit._state.items = data.items;
        Audit.render();
      } catch (e) {
        list.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    render() {
      const list = document.getElementById('admin-audit-list');
      const count = document.getElementById('admin-audit-count');
      const pageLabel = document.getElementById('admin-audit-page');
      count.textContent = `${Audit._state.total} entr${Audit._state.total === 1 ? 'y' : 'ies'}`;
      pageLabel.textContent = `Page ${Audit._state.page} / ${Math.max(1, Math.ceil(Audit._state.total / 25))}`;

      if (!Audit._state.items.length) {
        list.innerHTML = '<div class="admin-empty">No audit entries.</div>';
        return;
      }

      list.innerHTML = Audit._state.items.map(e => `
        <div class="admin-row admin-audit-row">
          <div class="admin-row-main">
            <span class="admin-username">
              <span class="admin-pill admin-pill-${esc(e.action)}">${esc(e.action)}</span>
              ${esc(e.actorUsername)}
            </span>
            <span class="admin-row-meta">
              ${AdminView.formatDate(e.createdAt)}${e.ip ? ' · ' + esc(e.ip) : ''}
            </span>
          </div>
          <details class="admin-audit-meta">
            <summary>details</summary>
            <pre>${esc(JSON.stringify({ target: e.target, meta: e.meta }, null, 2))}</pre>
          </details>
        </div>
      `).join('');
    },

    unmount() {}
  };

  AdminView._tabs.audit = Audit;
})();
