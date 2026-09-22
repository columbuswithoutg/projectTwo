/************************************************
 * REPORTS VIEW — /reports ("My reports")
 *
 * The user's own bug reports and suggestions, each with its status and the
 * reply thread with the admin. Deep link: /reports?report=<id> expands one.
 ************************************************/
const ReportsView = (() => {
  let _root = null;
  let _seq = 0;
  let _page = 1;
  let _total = 0;
  let _items = [];
  let _open = new Set();

  const STATUS_LABEL = {
    'open': 'Open', 'in-progress': 'In progress', 'fixed': 'Fixed', 'wontfix': 'Won’t fix', 'closed': 'Closed'
  };
  const q = (sel) => _root && _root.querySelector(sel);

  function stamp(date) {
    return new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  async function load() {
    const seq = ++_seq;
    const list = q('#reports-list');
    list.innerHTML = '<div class="msg-empty">Loading…</div>';
    try {
      const data = await Reports.mine(_page);
      if (seq !== _seq) return;
      _items = data.items || [];
      _total = data.total || 0;
      render();
    } catch (err) {
      if (seq !== _seq) return;
      list.innerHTML = `<div class="msg-empty">${esc(err.message)}</div>`;
    }
  }

  function card(r) {
    const open = _open.has(r.id);
    const closed = r.status === 'closed';
    return `
      <article class="report-card${open ? ' open' : ''}" data-id="${esc(r.id)}" id="report-${esc(r.id)}">
        <button type="button" class="report-card-head" aria-expanded="${open}">
          <span class="report-pill report-kind-${esc(r.kind)}">${r.kind === 'bug' ? 'Bug' : 'Suggestion'}</span>
          <span class="report-title">${esc(r.title)}</span>
          <span class="report-pill report-status-${esc(r.status)}">${esc(STATUS_LABEL[r.status] || r.status)}</span>
          <span class="report-date">${esc(stamp(r.createdAt))}</span>
        </button>
        <div class="report-card-body" ${open ? '' : 'hidden'}>
          <p class="report-desc">${esc(r.description)}</p>
          ${r.page ? `<p class="report-meta">Page: <code>${esc(r.page)}</code></p>` : ''}
          <div class="report-thread">
            ${r.replies.length
              ? r.replies.map(rep => `
                <div class="report-reply${rep.isAdmin ? ' admin' : ''}">
                  <span class="report-reply-from">${esc(rep.isAdmin ? 'Admin' : 'You')}</span>
                  <span class="report-reply-text">${esc(rep.text)}</span>
                  <span class="report-reply-time">${esc(stamp(rep.createdAt))}</span>
                </div>`).join('')
              : '<p class="report-noreply">No replies yet — an admin will get back to you here and in your Messages.</p>'}
          </div>
          ${closed
            ? '<p class="report-noreply">This report is closed.</p>'
            : `<form class="report-form">
                 <textarea rows="2" maxlength="${MessagingLogic.C.REPLY_MAX}" placeholder="Add a reply…"></textarea>
                 <button type="submit" class="msg-btn">Reply</button>
               </form>`}
        </div>
      </article>`;
  }

  function render() {
    const list = q('#reports-list');
    const pager = q('#reports-pager');
    const last = Math.max(1, Math.ceil(_total / 20));
    pager.hidden = last <= 1;
    q('#reports-page').textContent = `Page ${_page} / ${last}`;
    q('#reports-prev').disabled = _page <= 1;
    q('#reports-next').disabled = _page >= last;

    if (!_items.length) {
      list.innerHTML = `<div class="msg-empty">You haven’t sent any reports yet.</div>`;
      return;
    }
    list.innerHTML = _items.map(card).join('');

    list.querySelectorAll('.report-card').forEach(el => {
      const id = el.dataset.id;
      el.querySelector('.report-card-head').addEventListener('click', () => {
        const body = el.querySelector('.report-card-body');
        const nowOpen = body.hidden;
        body.hidden = !nowOpen;
        el.classList.toggle('open', nowOpen);
        el.querySelector('.report-card-head').setAttribute('aria-expanded', String(nowOpen));
        if (nowOpen) _open.add(id); else _open.delete(id);
      });
      const form = el.querySelector('.report-form');
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const ta = form.querySelector('textarea');
          const v = MessagingLogic.validateReply({ text: ta.value });
          if (!v.ok) { toast(MessagingLogic.errorText(v.error), 'warn'); return; }
          const btn = form.querySelector('button');
          btn.disabled = true;
          try {
            const data = await Reports.reply(id, v.text);
            const idx = _items.findIndex(r => r.id === id);
            if (idx !== -1 && data.report) _items[idx] = data.report;
            _open.add(id);
            render();
          } catch (err) {
            toast(err.message || 'Reply not sent', 'error');
            btn.disabled = false;
          }
        });
      }
    });
  }

  function mount(container) {
    if (!Auth.isLoggedIn()) { Router.go('/login'); return; }
    _root = container;
    _page = 1;
    _open = new Set();
    container.innerHTML = `
      <header id="header">
        <button id="back-btn">← Back</button>
        <h1>My Reports</h1>
        <div style="width:48px"></div>
      </header>
      <main id="reports-wrapper">
        <div class="msg-column">
          <div class="msg-toolbar">
            <button type="button" class="msg-new-btn" id="reports-new-btn">＋ Report a bug or idea</button>
            <a href="/messages?admin=1" data-link class="reports-inbox-link">Admin replies in Messages</a>
          </div>
          <div id="reports-list" class="report-list"></div>
          <div class="admin-pager" id="reports-pager" hidden>
            <button class="msg-btn msg-btn-ghost" id="reports-prev">‹ Prev</button>
            <span id="reports-page">Page 1</span>
            <button class="msg-btn msg-btn-ghost" id="reports-next">Next ›</button>
          </div>
        </div>
      </main>
    `;
    container.querySelector('#back-btn').addEventListener('click', () => Router.go('/'));
    container.querySelector('#reports-new-btn').addEventListener('click', () => showReportDialog());
    container.querySelector('#reports-prev').addEventListener('click', () => { if (_page > 1) { _page--; load(); } });
    container.querySelector('#reports-next').addEventListener('click', () => { _page++; load(); });

    const focus = new URLSearchParams(location.search).get('report');
    if (focus) _open.add(focus);
    load().then(() => {
      if (!focus) return;
      const el = container.querySelector(`#report-${CSS.escape(focus)}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function unmount() {
    _seq++;
    _root = null;
  }

  return { title: 'My Reports — MCU Tracker', mount, unmount, refresh: load };
})();
