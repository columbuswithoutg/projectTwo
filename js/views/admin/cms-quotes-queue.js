/************************************************
 * ADMIN — People → Quote suggestions (the review queue)
 *
 * Lines players suggested from /world, oldest first. Each card shows the
 * line, the reply, the scene note and — big — the time the player gave, so
 * the admin can jump there on Disney+ and check it. Approve, edit & approve,
 * or reject with a reason. Lines that look alike (word overlap) are listed
 * under each card so a near-duplicate is easy to spot.
 *
 * Server: GET /quotes/queue, POST /quotes/line/:id/approve|reject.
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;
  const Shared = AdminView._quotes = AdminView._quotes || {};

  const Queue = {
    _host: null,
    _ctx: null,
    _items: [],
    _total: 0,
    _project: '',
    _open: new Map(),       // item id → { form, el }: open "Edit & approve" forms (dirty guard)

    async mount(host, ctx) {
      Queue._host = host;
      Queue._ctx = ctx || {};
      Queue._open.clear();
      host.innerHTML = '<div class="admin-empty">Loading suggestions…</div>';
      await Queue.load();
    },

    async load(more) {
      const host = Queue._host;
      const q = new URLSearchParams();
      if (Queue._project) q.set('projectId', Queue._project);
      if (more && Queue._items.length) q.set('before', Queue._items[Queue._items.length - 1].createdAt);
      try {
        const r = await AdminView.api('/quotes/queue' + (q.toString() ? '?' + q : ''));
        Queue._items = more ? Queue._items.concat(r.items || []) : (r.items || []);
        Queue._total = r.total || 0;
        if (Queue._ctx.onChange) Queue._ctx.onChange(Queue._total);
        Queue.render();
      } catch (e) {
        host.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    render() {
      const host = Queue._host;
      const projects = [...new Map(Queue._items.map(i => [i.projectId, i.projectTitle])).entries()];
      const sel = Queue._project && !projects.some(([id]) => id === Queue._project)
        ? projects.concat([[Queue._project, (Shared.projectById(Queue._project) || {}).title || Queue._project]])
        : projects;
      host.innerHTML = `
        <div class="qte-queue">
          <div class="qte-queue-head">
            <p class="admin-config-help">Lines players suggested. Each one has the time they gave — check it on Disney+, then approve (it joins the game straight away and they get credit) or reject.</p>
            <label class="qte-queue-filter">
              <span class="qte-fl">Island</span>
              <select class="admin-input qte-queue-proj">
                <option value="">All islands</option>
                ${sel.map(([id, title]) => `<option value="${esc(id)}" ${Queue._project === id ? 'selected' : ''}>${esc(title)}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="qte-queue-list"></div>
          ${Queue._items.length < Queue._total && !Queue._project ? '<button type="button" class="admin-btn qte-queue-more">Load more</button>' : ''}
        </div>`;
      host.querySelector('.qte-queue-proj').addEventListener('change', async (e) => {
        const sel = e.target;
        // Another island's list drops the open edit forms: ask first.
        if (Queue.isDirty()) {
          if (!(await AdminView._confirmDiscard())) { sel.value = Queue._project; return; }
          Queue.discard();
        }
        Queue._project = sel.value;
        Queue.load();
      });
      const more = host.querySelector('.qte-queue-more');
      if (more) more.addEventListener('click', () => Queue.load(true));
      const list = host.querySelector('.qte-queue-list');
      if (!Queue._items.length) {
        list.innerHTML = `<div class="admin-empty qte-queue-empty">🎉 Nothing to review${Queue._project ? ' on this island' : ''}.</div>`;
        return;
      }
      // An open edit form goes back in place (Load more re-renders the list).
      Queue._items.forEach(item => {
        const open = Queue._open.get(item.id);
        list.appendChild(open ? open.el : Queue.card(item));
      });
      for (const [id, o] of Queue._open) if (!o.el.isConnected) Queue._open.delete(id);
    },

    // The pane's unsaved-changes guard (index.js): open "Edit & approve"
    // forms with edits.
    isDirty() {
      for (const o of Queue._open.values()) if (o.form.isDirty()) return true;
      return false;
    },
    discard() { Queue._open.clear(); },
    async save() {
      await Promise.all([...Queue._open.values()].filter(o => o.form.isDirty()).map(o => o.form.save()));
    },

    card(item) {
      const el = document.createElement('article');
      el.className = 'qte-sug';
      const when = Shared.when(item);
      el.innerHTML = `
        <header class="qte-sug-head">
          <span class="qte-sug-island">${esc(item.projectTitle)}</span>
          <span class="qte-sug-by">💬 @${esc(item.suggestedByName || 'player')} · ${esc(AdminView.formatDate(item.createdAt))}</span>
        </header>
        <div class="qte-sug-body">
          <div class="qte-sug-when" title="The time the player gave — check it on Disney+">
            <span class="qte-sug-when-l">Check at</span>
            <b>${esc(when || '—')}</b>
          </div>
          <div class="qte-sug-line">
            ${Shared.lineHtml(item)}
            ${item.note ? `<p class="qte-note">${esc(item.note)}</p>` : ''}
          </div>
        </div>
        ${item.alike && item.alike.length ? `
        <div class="qte-sug-alike">
          <span class="qte-fl">Looks like</span>
          ${item.alike.map(a => `<span class="qte-alike">“${esc(a.text)}” — ${esc(a.speaker)}${a.status === 'pending' ? ' <i>(pending)</i>' : ''}</span>`).join('')}
        </div>` : ''}
        <div class="qte-sug-actions">
          <button type="button" class="admin-btn qte-btn-primary qte-approve">Approve</button>
          <button type="button" class="admin-btn qte-edit-approve">Edit & approve</button>
          <span class="qte-sug-reject">
            <input class="admin-input qte-reason" maxlength="200" placeholder="Reason (optional)">
            <button type="button" class="admin-btn admin-btn-danger qte-reject">Reject</button>
          </span>
        </div>`;
      el.querySelector('.qte-approve').addEventListener('click', () => Queue.decide(item, el, 'approve'));
      el.querySelector('.qte-reject').addEventListener('click', () => Queue.decide(item, el, 'reject'));
      el.querySelector('.qte-reason').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); Queue.decide(item, el, 'reject'); } });
      el.querySelector('.qte-edit-approve').addEventListener('click', () => Queue.edit(item, el));
      return el;
    },

    edit(item, el) {
      const project = { id: item.projectId, title: item.projectTitle, runtime: item.runtime, episodes: item.episodes || [] };
      const form = Shared.lineForm({
        project,
        line: item,
        submitLabel: 'Save & approve',
        compact: true,
        onCancel: () => { Queue._open.delete(item.id); el.replaceWith(Queue.card(item)); },
        onSubmit: async (row) => {
          await AdminView.api('/quotes/line/' + encodeURIComponent(item.id) + '/approve', { method: 'POST', body: JSON.stringify({ edits: row }) });
          Queue._open.delete(item.id);
          Queue._done(item, el, 'Approved with your edits');
        }
      });
      Queue._open.set(item.id, { form, el });
      const body = el.querySelector('.qte-sug-body');
      body.replaceWith(form.el);
      el.querySelector('.qte-sug-actions').hidden = true;
      const alike = el.querySelector('.qte-sug-alike');
      if (alike) alike.hidden = true;
      form.focus();
    },

    async decide(item, el, action) {
      const btns = el.querySelectorAll('button');
      btns.forEach(b => { b.disabled = true; });
      try {
        const body = action === 'reject' ? { reason: el.querySelector('.qte-reason').value } : {};
        await AdminView.api('/quotes/line/' + encodeURIComponent(item.id) + '/' + action, { method: 'POST', body: JSON.stringify(body) });
        Queue._done(item, el, action === 'approve' ? 'Approved — it’s in the game now' : 'Rejected');
      } catch (e) {
        btns.forEach(b => { b.disabled = false; });
        AdminView.toast(e.message, 'error');
      }
    },

    _done(item, el, msg) {
      Queue._items = Queue._items.filter(x => x !== item);
      Queue._total = Math.max(0, Queue._total - 1);
      if (Queue._ctx.onChange) Queue._ctx.onChange(Queue._total);
      el.classList.add('is-done');
      setTimeout(() => { el.remove(); if (!Queue._items.length) Queue.load(); }, 250);
      AdminView.toast(msg, 'success');
    }
  };

  Shared.queue = Queue;

  // Its own sidebar entry (People → Quote suggestions, index.js). The
  // count it loads feeds the sidebar badge.
  AdminView._tabs.suggestions = {
    mount(host) {
      host.innerHTML = `
        <div class="admin-sugg">
          <p class="admin-config-help admin-sugg-where">Suggestions are switched on or off, game-wide and per island, in
            <a href="/admin?tab=quote-guess" data-go="quote-guess">Minigames → Quote Guess</a>.</p>
          <div class="admin-sugg-host"></div>
        </div>`;
      host.querySelector('[data-go="quote-guess"]').addEventListener('click', (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        AdminView.go({ tab: 'quote-guess' });
      });
      Queue.mount(host.querySelector('.admin-sugg-host'), { onChange: (n) => AdminView.setNavBadge('suggestions', n || 0) });
    },
    // A load still in flight renders into the detached host, harmlessly.
    unmount() { Queue._ctx = {}; Queue._open.clear(); },
    // Unsaved "Edit & approve" forms: the leave guard, Save bar and
    // beforeunload ask the active pane (index.js).
    isDirty() { return Queue.isDirty(); },
    discard() { Queue.discard(); },
    save() { return Queue.save(); }
  };
})();
