/************************************************
 * ADMIN — REPORTS TAB
 * Bug reports, suggestions and requests filed by users: filter, triage
 * (status), reply (also pushed to the user's Messages inbox), delete.
 * A request also gets Approve / Reject (POST /reports/:id/resolve), which
 * makes the change on the user's account.
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;
  const L = MessagingLogic;
  const STATUS_LABEL = {
    'open': 'Open', 'in-progress': 'In progress', 'fixed': 'Fixed', 'wontfix': 'Won’t fix', 'closed': 'Closed'
  };

  const AdminReports = {
    // drafts: report id → unsent reply text. Every action re-renders the
    // whole list (textarea included), so the typed reply lives here, not in
    // the DOM — opening another report or "Set status" used to wipe it.
    // busy: report id → a reply / status request is in flight (its buttons
    // stay disabled even if the list re-renders meanwhile).
    _state: { page: 1, total: 0, items: [], kind: '', status: 'open', q: '', openId: null, drafts: {}, busy: {} },

    mount(container) {
      const s = AdminReports._state;
      container.innerHTML = `
        <div class="admin-reports">
          <div class="admin-toolbar">
            <select id="admin-reports-kind" class="admin-input">
              <option value="">All types</option>
              <option value="bug"${s.kind === 'bug' ? ' selected' : ''}>Bugs</option>
              <option value="suggestion"${s.kind === 'suggestion' ? ' selected' : ''}>Suggestions</option>
              <option value="request"${s.kind === 'request' ? ' selected' : ''}>Requests</option>
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
        const ta = row.querySelector('.admin-report-text');
        ta.value = s.drafts[id] || '';
        ta.addEventListener('input', () => {
          if (ta.value) s.drafts[id] = ta.value; else delete s.drafts[id];
        });
        AdminReports._setBusy(row, !!s.busy[id]);
        row.querySelector('.admin-report-reply').addEventListener('click', () => AdminReports.reply(r, row));
        row.querySelector('.admin-report-setstatus').addEventListener('click', () => AdminReports.setStatus(r, row));
        row.querySelector('.admin-report-delete').addEventListener('click', () => AdminReports.remove(r));
        const approve = row.querySelector('.admin-request-approve');
        if (approve) approve.addEventListener('click', () => AdminReports.resolve(r, row, 'approved'));
        const reject = row.querySelector('.admin-request-reject');
        if (reject) reject.addEventListener('click', () => AdminReports.resolve(r, row, 'rejected'));
        const all = row.querySelector('.admin-request-all');
        if (all) all.addEventListener('click', () => {
          const boxes = [...row.querySelectorAll('.admin-request-pick input')];
          const on = !boxes.every(b => b.checked);
          boxes.forEach(b => { b.checked = on; });
          AdminReports._paintPick(row);
        });
        row.querySelectorAll('.admin-request-pick input').forEach(b => b.addEventListener('change', () => AdminReports._paintPick(row)));
      });
    },

    _titleOf(id) {
      const p = (Array.isArray(window.projects) ? window.projects : []).find(x => x && x.id === id);
      return p ? p.title : id;
    },

    // Approve button names how many ticked titles it will add.
    _paintPick(row) {
      const boxes = [...row.querySelectorAll('.admin-request-pick input')];
      const n = boxes.filter(b => b.checked).length;
      const btn = row.querySelector('.admin-request-approve');
      if (btn) btn.textContent = `Approve ${n} title${n === 1 ? '' : 's'}`;
      const all = row.querySelector('.admin-request-all');
      if (all) all.textContent = boxes.every(b => b.checked) ? 'Untick all' : 'Tick all';
    },

    // The request panel: what was asked, and Approve / Reject while open.
    requestPanel(r) {
      const rq = r.request;
      if (!rq) return '';
      const t = AdminReports._titleOf;
      const res = rq.resolution && rq.resolution.outcome ? rq.resolution : null;
      const handled = res || r.status === 'closed';
      let body = '';
      switch (rq.type) {
        case 'mark-watched': {
          const ids = rq.projectIds || [];
          const added = new Set((res && res.added) || []);
          body = handled
            ? `<ul class="request-titles">${ids.map(id => `<li class="${added.has(id) ? 'is-added' : 'is-left'}">${esc(t(id))}${res ? (added.has(id) ? ' — added' : ' — not added') : ''}</li>`).join('')}</ul>`
            : `<p class="admin-row-meta">Untick anything you don’t want to add. Locks and the watch timer don’t apply.</p>
               <div class="admin-request-pick">
                 ${ids.map(id => `<label><input type="checkbox" value="${esc(id)}" checked /> ${esc(t(id))}</label>`).join('')}
               </div>
               ${ids.length > 1 ? '<button type="button" class="admin-btn admin-request-all">Untick all</button>' : ''}`;
          break;
        }
        case 'undo-watch':
          body = `<p>Remove <strong>${esc(t(rq.projectId))}</strong> from their watched list (its memory photos go with it; later titles stay watched).</p>`;
          break;
        case 'fix-count':
          body = `<p>Set <strong>${esc(t(rq.projectId))}</strong> to <strong>${esc(String(rq.count))}</strong> watch${rq.count === 1 ? '' : 'es'}.</p>`;
          break;
        case 'add-title':
          body = `<p>Add <strong>${esc(rq.title || '')}</strong> to the board. Approving only tells them it’s coming — add it in Content → Projects.</p>`;
          break;
        case 'rename':
          body = `<p>Rename <strong>${esc(rq.oldUsername || r.username)}</strong> → <strong>${esc(rq.newUsername || '')}</strong>. Co-watcher tags follow; they sign in again with the new name.</p>`;
          break;
        case 'delete-account':
          body = `<p class="admin-request-warn">Delete <strong>${esc(r.username)}</strong>’s account and everything in it. This can’t be undone.</p>`;
          break;
      }
      const approveLabel = rq.type === 'mark-watched'
        ? `Approve ${(rq.projectIds || []).length} title${(rq.projectIds || []).length === 1 ? '' : 's'}`
        : rq.type === 'delete-account' ? 'Approve & delete account' : 'Approve';
      return `
        <div class="admin-request">
          <p class="admin-row-meta"><strong>${esc(L.REQUEST_LABEL[rq.type] || 'Request')}</strong>${res ? ` · ${res.outcome === 'approved' ? 'Approved' : 'Rejected'} by ${esc(res.by || 'admin')} · ${AdminView.formatDate(res.at)}` : r.status === 'closed' ? ' · Withdrawn' : ''}</p>
          ${body}
          ${handled ? '' : `
            <div class="admin-report-actions">
              <button class="admin-btn admin-btn-primary admin-request-approve${rq.type === 'delete-account' ? ' admin-btn-danger' : ''}">${esc(approveLabel)}</button>
              <button class="admin-btn admin-request-reject">Reject</button>
              <span class="admin-row-meta">The reply box below is sent with it (a rejection reason, or a note).</span>
            </div>`}
        </div>`;
    },

    async resolve(r, row, outcome) {
      const s = AdminReports._state;
      const id = String(r._id);
      if (s.busy[id]) return;
      const rq = r.request;
      const text = row.querySelector('.admin-report-text').value.trim();
      const body = { outcome, text: text || undefined };
      if (outcome === 'approved' && rq.type === 'mark-watched') {
        body.projectIds = [...row.querySelectorAll('.admin-request-pick input')].filter(b => b.checked).map(b => b.value);
        if (!body.projectIds.length) { AdminView.toast('Tick at least one title, or reject the request', 'error'); return; }
      }
      if (outcome === 'approved' && (rq.type === 'delete-account' || rq.type === 'rename' || rq.type === 'undo-watch')) {
        const ok = await confirmDialog({
          title: rq.type === 'delete-account' ? `Delete ${r.username}’s account?` : rq.type === 'rename' ? `Rename ${r.username} to ${rq.newUsername}?` : `Undo ${AdminReports._titleOf(rq.projectId)} for ${r.username}?`,
          message: rq.type === 'delete-account' ? 'Their progress, posts, photos, messages and friends are removed permanently.' : rq.type === 'undo-watch' ? 'Its memory photos are removed with it.' : 'They’ll be signed out and sign in again with the new name.',
          confirmLabel: rq.type === 'delete-account' ? 'Delete account' : 'Approve',
          danger: rq.type === 'delete-account'
        });
        if (!ok) return;
      }
      s.busy[id] = true;
      AdminReports._setBusy(row, true);
      try {
        await AdminView.api(`/reports/${r._id}/resolve`, { method: 'POST', body: JSON.stringify(body) });
        delete s.drafts[id];
        AdminView.toast(outcome === 'approved' ? 'Approved — they’ve been told in Messages' : 'Rejected — they’ve been told in Messages', 'success');
        AdminView.refreshAttention();
        await AdminReports.fetch();
      } catch (e) {
        AdminView.toast(e.message, 'error');
      } finally {
        delete s.busy[id];
        const cur = AdminReports._rowFor(id);
        if (cur) AdminReports._setBusy(cur, false);
      }
    },

    detail(r) {
      return `
        <div class="admin-detail admin-report-detail">
          ${r.description ? `<p class="admin-report-desc">${esc(r.description)}</p>` : ''}
          ${AdminReports.requestPanel(r)}
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

    // Reply + Set status are off while either request is in flight, so a
    // double click can't send the same reply twice.
    _setBusy(row, busy) {
      row.querySelectorAll('.admin-report-reply, .admin-report-setstatus, .admin-request-approve, .admin-request-reject').forEach(b => { b.disabled = busy; });
    },

    // The row the list currently shows for a report (a re-render replaces
    // the one a click came from).
    _rowFor(id) {
      const list = document.getElementById('admin-reports-list');
      return list ? list.querySelector(`.admin-report-row[data-id="${CSS.escape(id)}"]`) : null;
    },

    async reply(r, row) {
      const s = AdminReports._state;
      const id = String(r._id);
      if (s.busy[id]) return;
      const ta = row.querySelector('.admin-report-text');
      const v = L.validateReply({ text: ta.value });
      if (!v.ok) { AdminView.toast(L.errorText(v.error), 'error'); return; }
      const status = row.querySelector('.admin-report-status').value;
      s.busy[id] = true;
      AdminReports._setBusy(row, true);
      try {
        await AdminView.api(`/reports/${r._id}/replies`, {
          method: 'POST',
          body: JSON.stringify({ text: v.text, status: status !== r.status ? status : undefined })
        });
        delete s.drafts[id];
        AdminView.toast('Reply sent to ' + r.username, 'success');
        if (status !== r.status) AdminView.refreshAttention();
        // Awaited: the buttons stay off until the refreshed list (with the
        // draft gone) replaces this row, so the sent text can't go twice.
        await AdminReports.fetch();
      } catch (e) {
        AdminView.toast(e.message, 'error');
      } finally {
        delete s.busy[id];
        const cur = AdminReports._rowFor(id);
        if (cur) AdminReports._setBusy(cur, false);
      }
    },

    async setStatus(r, row) {
      const s = AdminReports._state;
      const id = String(r._id);
      if (s.busy[id]) return;
      const status = row.querySelector('.admin-report-status').value;
      if (status === r.status) { AdminView.toast('Status unchanged', 'info'); return; }
      s.busy[id] = true;
      AdminReports._setBusy(row, true);
      try {
        await AdminView.api(`/reports/${r._id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
        AdminView.toast(`Marked ${STATUS_LABEL[status] || status}`, 'success');
        AdminView.refreshAttention();
        await AdminReports.fetch();
      } catch (e) {
        AdminView.toast(e.message, 'error');
      } finally {
        delete s.busy[id];
        const cur = AdminReports._rowFor(id);
        if (cur) AdminReports._setBusy(cur, false);
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
        AdminView.refreshAttention();
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
