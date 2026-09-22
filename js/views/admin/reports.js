/************************************************
 * ADMIN — REPORTS TAB
 * Bug reports & suggestions filed by users: filter, triage (status),
 * reply (also pushed to the user's Messages inbox), delete.
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;
  const L = MessagingLogic;
  const STATUS_LABEL = {
    'open': 'Open', 'in-progress': 'In progress', 'fixed': 'Fixed', 'wontfix': 'Won’t fix', 'closed': 'Closed'
  };

  const AdminReports = {
    _state: { page: 1, total: 0, items: [], kind: '', status: 'open', q: '', openId: null },

    mount(container) {
      const s = AdminReports._state;
      container.innerHTML = `
        <div class="admin-reports">
          <div class="admin-toolbar">
            <select id="admin-reports-kind" class="admin-input">
              <option value="">All types</option>
              <option value="bug"${s.kind === 'bug' ? ' selected' : ''}>Bugs</option>
              <option value="suggestion"${s.kind === 'suggestion' ? ' selected' : ''}>Suggestions</option>
            </select>
            <select id="admin-reports-status" class="admin-input">
              <option value="">All statuses</option>
              ${L.REPORT_STATUSES.map(st => `<option value="${st}"${s.status === st ? ' selected' : ''}>${esc(STATUS_LABEL[st])}</option>`).join('')}
            </select>
            <input id="admin-reports-q" class="admin-input" type="search" placeholder="Search title or user" value="${esc(s.q)}" />
            <span id="admin-reports-count" class="admin-count">—</span>
          </div>
          <div id="admin-reports-list" class="admin-list">Loading…</div>
          <div class="admin-pager">
            <button class="admin-btn" id="admin-reports-prev">‹ Prev</button>
            <span id="admin-reports-page">Page 1</span>
            <button class="admin-btn" id="admin-reports-next">Next ›</button>
          </div>
        </div>
      `;
      const rerun = () => { s.page = 1; AdminReports.fetch(); };
      document.getElementById('admin-reports-kind').addEventListener('change', (e) => { s.kind = e.target.value; rerun(); });
      document.getElementById('admin-reports-status').addEventListener('change', (e) => { s.status = e.target.value; rerun(); });
      let t = null;
      document.getElementById('admin-reports-q').addEventListener('input', (e) => {
        clearTimeout(t);
        t = setTimeout(() => { s.q = e.target.value.trim(); rerun(); }, 300);
      });
      document.getElementById('admin-reports-prev').addEventListener('click', () => {
        if (s.page > 1) { s.page--; AdminReports.fetch(); }
      });
      document.getElementById('admin-reports-next').addEventListener('click', () => {
        const last = Math.max(1, Math.ceil(s.total / 25));
        if (s.page < last) { s.page++; AdminReports.fetch(); }
      });
      AdminReports.fetch();
    },

    async fetch() {
      const s = AdminReports._state;
      const list = document.getElementById('admin-reports-list');
      list.innerHTML = 'Loading…';
      try {
        const params = new URLSearchParams({ page: String(s.page), limit: '25' });
        if (s.kind) params.set('kind', s.kind);
        if (s.status) params.set('status', s.status);
        if (s.q) params.set('q', s.q);
        const data = await AdminView.api('/reports?' + params.toString());
        s.total = data.total;
        s.items = data.items;
        AdminReports.render();
      } catch (e) {
        list.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    render() {
      const s = AdminReports._state;
      const list = document.getElementById('admin-reports-list');
      document.getElementById('admin-reports-count').textContent = `${s.total} report${s.total === 1 ? '' : 's'}`;
      document.getElementById('admin-reports-page').textContent = `Page ${s.page} / ${Math.max(1, Math.ceil(s.total / 25))}`;
      if (!s.items.length) {
        list.innerHTML = '<div class="admin-empty">No reports match.</div>';
        return;
      }
      list.innerHTML = s.items.map(r => {
        const id = String(r._id);
        const open = s.openId === id;
        return `
          <div class="admin-row admin-report-row${open ? ' open' : ''}" data-id="${esc(id)}">
            <div class="admin-row-main">
              <span class="admin-username">
                <span class="admin-pill admin-pill-${esc(r.kind)}">${esc(r.kind)}</span>
                <span class="admin-pill admin-pill-status-${esc(r.status)}">${esc(STATUS_LABEL[r.status] || r.status)}</span>
                <button type="button" class="admin-report-title">${esc(r.title)}</button>
              </span>
              <span class="admin-row-meta">
                ${esc(r.username)} · ${AdminView.formatDate(r.createdAt)}
                ${r.replies && r.replies.length ? ` · ${r.replies.length} repl${r.replies.length === 1 ? 'y' : 'ies'}` : ''}
                ${r.page ? ` · ${esc(r.page)}` : ''}
              </span>
            </div>
            ${open ? AdminReports.detail(r) : ''}
          </div>`;
      }).join('');

      list.querySelectorAll('.admin-report-row').forEach(row => {
        const id = row.dataset.id;
        row.querySelector('.admin-report-title').addEventListener('click', () => {
          s.openId = s.openId === id ? null : id;
          AdminReports.render();
        });
        if (s.openId !== id) return;
        const r = s.items.find(x => String(x._id) === id);
        row.querySelector('.admin-report-reply').addEventListener('click', () => AdminReports.reply(r, row));
        row.querySelector('.admin-report-setstatus').addEventListener('click', () => AdminReports.setStatus(r, row));
        row.querySelector('.admin-report-delete').addEventListener('click', () => AdminReports.remove(r));
      });
    },

    detail(r) {
      return `
        <div class="admin-detail admin-report-detail">
          <p class="admin-report-desc">${esc(r.description)}</p>
          <div class="admin-row-meta">
            ${r.page ? `Page: <code>${esc(r.page)}</code><br>` : ''}
            ${r.userAgent ? `Browser: <code>${esc(r.userAgent)}</code>` : ''}
          </div>
          <div class="admin-reports-thread">
            ${(r.replies || []).map(rep => `
              <div class="report-reply${rep.isAdmin ? ' admin' : ''}">
                <span class="report-reply-from">${esc(rep.isAdmin ? (rep.authorUsername || 'Admin') + ' (admin)' : rep.authorUsername || r.username)}</span>
                <span class="report-reply-text">${esc(rep.text)}</span>
                <span class="report-reply-time">${AdminView.formatDate(rep.createdAt)}</span>
              </div>`).join('') || '<div class="admin-empty">No replies yet.</div>'}
          </div>
          <textarea class="admin-input admin-report-text" rows="3" maxlength="${L.C.REPLY_MAX}" placeholder="Reply to ${esc(r.username)} — also lands in their Messages inbox"></textarea>
          <div class="admin-report-actions">
            <select class="admin-input admin-report-status">
              ${L.REPORT_STATUSES.map(st => `<option value="${st}"${r.status === st ? ' selected' : ''}>${esc(STATUS_LABEL[st])}</option>`).join('')}
            </select>
            <button class="admin-btn admin-report-setstatus">Set status</button>
            <button class="admin-btn admin-report-reply">Reply</button>
            <button class="admin-btn admin-btn-danger admin-report-delete">Delete</button>
          </div>
        </div>`;
    },

    async reply(r, row) {
      const ta = row.querySelector('.admin-report-text');
      const v = L.validateReply({ text: ta.value });
      if (!v.ok) { AdminView.toast(L.errorText(v.error), 'error'); return; }
      const status = row.querySelector('.admin-report-status').value;
      try {
        await AdminView.api(`/reports/${r._id}/replies`, {
          method: 'POST',
          body: JSON.stringify({ text: v.text, status: status !== r.status ? status : undefined })
        });
        AdminView.toast('Reply sent to ' + r.username, 'success');
        AdminReports.fetch();
      } catch (e) {
        AdminView.toast(e.message, 'error');
      }
    },

    async setStatus(r, row) {
      const status = row.querySelector('.admin-report-status').value;
      if (status === r.status) { AdminView.toast('Status unchanged', 'info'); return; }
      try {
        await AdminView.api(`/reports/${r._id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
        AdminView.toast(`Marked ${STATUS_LABEL[status] || status}`, 'success');
        AdminReports.fetch();
      } catch (e) {
        AdminView.toast(e.message, 'error');
      }
    },

    async remove(r) {
      const ok = await confirmDialog({
        title: 'Delete this report?',
        message: `“${r.title}” from ${r.username} will be removed permanently.`,
        confirmLabel: 'Delete',
        danger: true
      });
      if (!ok) return;
      try {
        await AdminView.api(`/reports/${r._id}`, { method: 'DELETE' });
        AdminView.toast('Report deleted', 'success');
        if (AdminReports._state.openId === String(r._id)) AdminReports._state.openId = null;
        AdminReports.fetch();
      } catch (e) {
        AdminView.toast(e.message, 'error');
      }
    },

    unmount() {}
  };

  AdminView._tabs.reports = AdminReports;
})();
