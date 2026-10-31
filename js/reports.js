/************************************************
 * REPORTS API + "REPORT A BUG / SUGGESTION" DIALOG
 *
 * The dialog is reachable from the nav drawers and /profile; the list of
 * a user's own reports (with the admin's replies) is the /reports view.
 ************************************************/
const Reports = (() => {
  // Authorization is added by Auth.fetch.
  const headers = (json) => (json ? { 'Content-Type': 'application/json' } : {});

  // A dead session (no token / 401) is Auth.fetch's job: one logout +
  // redirect to /login; everything else throws the server's error.
  async function call(path, opts = {}) {
    const res = await Auth.fetch(`${API}/reports${path}`, opts);
    let body = null;
    try { body = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
    return body;
  }

  return {
    create: (report) => call('/', { method: 'POST', headers: headers(true), body: JSON.stringify(report) }),
    mine: (page = 1) => call(`/mine?page=${page}`, { headers: headers() }),
    get: (id) => call(`/${encodeURIComponent(id)}`, { headers: headers() }),
    reply: (id, text) => call(`/${encodeURIComponent(id)}/replies`, { method: 'POST', headers: headers(true), body: JSON.stringify({ text }) }),
    withdraw: (id) => call(`/${encodeURIComponent(id)}/withdraw`, { method: 'POST', headers: headers() })
  };
})();

// After a report or request is sent from /reports, show it in the list.
function refreshReportsView() {
  if (location.pathname === '/reports' && typeof ReportsView !== 'undefined' && ReportsView.refresh) {
    try { ReportsView.refresh(); } catch (_) {}
  }
}

// "Ask the admin" — a request to change something on the account (kind
// 'request', js/messaging-logic.js validateRequest). The admin approves or
// rejects it from the admin Reports tab; the outcome lands in Messages.
// opts.type preselects a request type.
async function showRequestDialog(opts = {}) {
  const L = MessagingLogic;
  try { await state.ensureLoaded(); } catch (_) {}
  const all = (Array.isArray(window.projects) ? window.projects : []).filter(p => p && p.id);
  const byRelease = (a, b) => String(a.release || '').localeCompare(String(b.release || '')) || String(a.title).localeCompare(String(b.title));
  const watchedList = all.filter(p => state.isWatched(p.id)).sort(byRelease);
  const unwatched = all.filter(p => !state.isWatched(p.id)).sort(byRelease);
  // Unwatched titles grouped by phase, in phase order.
  const phases = new Map();
  unwatched.forEach(p => {
    const n = state.parsePhase(p.phase);
    if (!phases.has(n)) phases.set(n, []);
    phases.get(n).push(p);
  });
  const phaseOrder = [...phases.keys()].sort((a, b) => a - b);
  const type0 = L.isRequestType(opts.type) ? opts.type : 'mark-watched';
  const titleOptions = (list) => list.map(p => `<option value="${esc(p.id)}">${esc(p.title)}${state.getCount(p.id) > 1 ? ` (×${state.getCount(p.id)})` : ''}</option>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Ask the admin');
  overlay.innerHTML = `
    <form class="confirm-box report-box request-box" novalidate>
      <h3 class="confirm-title">Ask the admin</h3>
      <p class="confirm-message">An admin reviews your request and replies in your Messages.</p>
      <div class="report-field">
        <label for="request-type">What do you need?</label>
        <select id="request-type">
          ${L.REQUEST_TYPES.map(t => `<option value="${t}"${t === type0 ? ' selected' : ''}>${esc(L.REQUEST_LABEL[t])}</option>`).join('')}
        </select>
      </div>

      <div class="request-pane" data-type="mark-watched">
        <p class="request-hint">Already watched some of these elsewhere? Tick them and an admin can add them to your list — the watch timer and the “watch X first” locks don’t apply.</p>
        ${unwatched.length ? `
          <input type="search" class="request-search" placeholder="Filter titles" aria-label="Filter titles" autocomplete="off" />
          <div class="request-picker" role="group" aria-label="Titles you haven’t watched">
            ${phaseOrder.map(n => `
              <fieldset class="request-phase" data-phase="${n}">
                <legend>
                  <span>Phase ${n}</span>
                  <button type="button" class="request-phase-all">Select all</button>
                </legend>
                ${phases.get(n).map(p => `
                  <label class="request-item" data-name="${esc(String(p.title).toLowerCase())}">
                    <input type="checkbox" value="${esc(p.id)}" />
                    <span>${esc(p.title)}</span>
                    ${p.release ? `<span class="request-year">${esc(String(p.release).slice(0, 4))}</span>` : ''}
                  </label>`).join('')}
              </fieldset>`).join('')}
          </div>
          <p class="request-count" aria-live="polite">0 selected</p>`
        : '<p class="request-hint">You’ve watched every title on the board.</p>'}
      </div>

      <div class="request-pane" data-type="undo-watch" hidden>
        ${watchedList.length ? `
          <div class="report-field">
            <label for="request-undo-title">Title</label>
            <select id="request-undo-title">${titleOptions(watchedList)}</select>
          </div>
          <p class="request-hint">It comes off your watched list along with its memory photos. Titles you watched after it stay watched.</p>`
        : '<p class="request-hint">Nothing on your watched list yet.</p>'}
      </div>

      <div class="request-pane" data-type="fix-count" hidden>
        ${watchedList.length ? `
          <div class="report-field">
            <label for="request-count-title">Title</label>
            <select id="request-count-title">${titleOptions(watchedList)}</select>
          </div>
          <div class="report-field">
            <label for="request-count-value">Times you’ve watched it</label>
            <input id="request-count-value" type="number" min="1" max="${L.C.WATCH_COUNT_MAX}" step="1" inputmode="numeric" />
          </div>`
        : '<p class="request-hint">Nothing on your watched list yet.</p>'}
      </div>

      <div class="request-pane" data-type="add-title" hidden>
        <div class="report-field">
          <label for="request-add-title">Title to add</label>
          <input id="request-add-title" type="text" maxlength="${L.C.SUGGEST_TITLE_MAX}" placeholder="e.g. a Marvel One-Shot or a new series" autocomplete="off" />
        </div>
      </div>

      <div class="request-pane" data-type="rename" hidden>
        <div class="report-field">
          <label for="request-new-name">New username</label>
          <input id="request-new-name" type="text" maxlength="30" autocomplete="off" placeholder="3–30 letters, numbers, _ or -" />
        </div>
        <p class="request-hint">Friends see the new name everywhere. You’ll sign in again with it once it’s approved.</p>
      </div>

      <div class="request-pane" data-type="delete-account" hidden>
        <p class="request-hint request-warn">Your account, progress, posts, photos, messages and friends are removed for good once an admin approves this. It can’t be undone.</p>
        <label class="request-confirm"><input type="checkbox" id="request-delete-ok" /> I understand — delete my account</label>
      </div>

      <div class="report-field">
        <label for="request-note">Note for the admin <span class="request-optional">(optional)</span></label>
        <textarea id="request-note" rows="2" maxlength="${L.C.DESC_MAX}" placeholder="Anything that helps, e.g. “saw these in cinemas”"></textarea>
      </div>
      <p class="report-error" role="alert" hidden></p>
      <div class="confirm-actions">
        <button type="button" class="confirm-btn confirm-cancel">Cancel</button>
        <button type="submit" class="confirm-btn confirm-ok">Send request</button>
      </div>
    </form>
  `;
  document.body.appendChild(overlay);

  const $ = (sel) => overlay.querySelector(sel);
  const typeEl = $('#request-type');
  const noteEl = $('#request-note');
  const errEl = $('.report-error');
  const sendBtn = $('.confirm-ok');
  const boxes = () => [...overlay.querySelectorAll('.request-picker input[type=checkbox]')];
  const picked = () => boxes().filter(b => b.checked).map(b => b.value);

  const showError = (msg) => { errEl.textContent = msg; errEl.hidden = !msg; };
  const countEl = $('.request-count');
  const paintCount = () => {
    if (countEl) countEl.textContent = `${picked().length} selected`;
    overlay.querySelectorAll('.request-phase').forEach(fs => {
      const shown = [...fs.querySelectorAll('.request-item')].filter(l => !l.hidden).map(l => l.querySelector('input'));
      const btn = fs.querySelector('.request-phase-all');
      btn.textContent = shown.length && shown.every(b => b.checked) ? 'Clear' : 'Select all';
    });
  };
  const showPane = () => {
    overlay.querySelectorAll('.request-pane').forEach(p => { p.hidden = p.dataset.type !== typeEl.value; });
    sendBtn.textContent = typeEl.value === 'delete-account' ? 'Request deletion' : 'Send request';
    sendBtn.classList.toggle('danger', typeEl.value === 'delete-account');
    showError('');
  };
  typeEl.addEventListener('change', showPane);
  showPane();

  overlay.querySelectorAll('.request-picker input').forEach(b => b.addEventListener('change', paintCount));
  overlay.querySelectorAll('.request-phase-all').forEach(btn => btn.addEventListener('click', () => {
    const shown = [...btn.closest('.request-phase').querySelectorAll('.request-item')].filter(l => !l.hidden).map(l => l.querySelector('input'));
    const on = !shown.every(b => b.checked);
    shown.forEach(b => { b.checked = on; });
    paintCount();
  }));
  const search = $('.request-search');
  if (search) search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    overlay.querySelectorAll('.request-phase').forEach(fs => {
      let any = false;
      fs.querySelectorAll('.request-item').forEach(l => { l.hidden = !!q && !l.dataset.name.includes(q); any = any || !l.hidden; });
      fs.hidden = !any;
    });
    paintCount();
  });
  // Fix count starts from the current number for the chosen title.
  const countTitle = $('#request-count-title');
  const countValue = $('#request-count-value');
  const syncCount = () => { if (countTitle && countValue) countValue.value = String(Math.max(1, state.getCount(countTitle.value))); };
  if (countTitle) countTitle.addEventListener('change', syncCount);
  syncCount();

  let sent = false;
  const dirty = () => picked().length || noteEl.value.trim()
    || ($('#request-add-title') && $('#request-add-title').value.trim())
    || ($('#request-new-name') && $('#request-new-name').value.trim());
  const close = wireModalDismiss(overlay, () => { if (overlay.parentNode) overlay.remove(); }, {
    initialFocus: typeEl,
    canClose: async () => sent || !dirty() || confirmDialog({
      title: 'Discard this request?',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      danger: true
    })
  });
  $('.confirm-cancel').addEventListener('click', close.request);

  let busy = false;
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const type = typeEl.value;
    const raw = { kind: 'request', type, note: noteEl.value, page: location.pathname + location.search, userAgent: navigator.userAgent };
    if (type === 'mark-watched') raw.projectIds = picked();
    if (type === 'undo-watch') raw.projectId = $('#request-undo-title') && $('#request-undo-title').value;
    if (type === 'fix-count') { raw.projectId = countTitle && countTitle.value; raw.count = countValue && countValue.value; }
    if (type === 'add-title') raw.title = $('#request-add-title').value;
    if (type === 'rename') raw.newUsername = $('#request-new-name').value;
    if (type === 'delete-account') raw.confirm = $('#request-delete-ok').checked;
    const v = L.validateRequest(raw);
    if (!v.ok) { showError(L.errorText(v.error)); return; }
    busy = true;
    sendBtn.disabled = true;
    showError('');
    try {
      await Reports.create({ ...raw, count: raw.count !== undefined ? Number(raw.count) : undefined });
      sent = true;
      toast('Request sent — the admin’s answer lands in your Messages.', 'success');
      close();
      refreshReportsView();
    } catch (err) {
      showError(err.message || 'Could not send the request.');
      busy = false;
      sendBtn.disabled = false;
    }
  });
}

// Change your password while signed in (POST /api/auth/password). Other
// devices are signed out; this tab keeps going on the fresh token.
function showPasswordDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Change password');
  overlay.innerHTML = `
    <form class="confirm-box report-box" novalidate>
      <h3 class="confirm-title">Change password</h3>
      <p class="confirm-message">You’ll stay signed in here; other devices are signed out.</p>
      <div class="report-field">
        <label for="pw-current">Current password</label>
        <input id="pw-current" type="password" autocomplete="current-password" />
      </div>
      <div class="report-field">
        <label for="pw-new">New password</label>
        <input id="pw-new" type="password" autocomplete="new-password" minlength="8" />
      </div>
      <div class="report-field">
        <label for="pw-again">New password again</label>
        <input id="pw-again" type="password" autocomplete="new-password" minlength="8" />
      </div>
      <p class="report-error" role="alert" hidden></p>
      <div class="confirm-actions">
        <button type="button" class="confirm-btn confirm-cancel">Cancel</button>
        <button type="submit" class="confirm-btn confirm-ok">Change password</button>
      </div>
    </form>
  `;
  document.body.appendChild(overlay);
  const $ = (sel) => overlay.querySelector(sel);
  const cur = $('#pw-current'), next = $('#pw-new'), again = $('#pw-again');
  const errEl = $('.report-error');
  const btn = $('.confirm-ok');
  const showError = (msg, focus) => { errEl.textContent = msg; errEl.hidden = !msg; if (focus) focus.focus(); };
  const close = wireModalDismiss(overlay, () => { if (overlay.parentNode) overlay.remove(); }, { initialFocus: cur });
  $('.confirm-cancel').addEventListener('click', close.request);

  let busy = false;
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!cur.value) return showError('Enter your current password.', cur);
    if (next.value.length < 8) return showError('The new password needs at least 8 characters.', next);
    if (next.value !== again.value) return showError('The new passwords don’t match.', again);
    busy = true;
    btn.disabled = true;
    showError('');
    try {
      const res = await Auth.fetch(`${API}/auth/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: cur.value, newPassword: next.value })
      });
      let body = null;
      try { body = await res.json(); } catch (_) {}
      if (!res.ok) throw Object.assign(new Error((body && body.error) || `HTTP ${res.status}`), { field: body && body.field });
      if (body && body.token) Auth.setToken(body.token);
      toast('Password changed.', 'success');
      close();
    } catch (err) {
      showError(err.message || 'Could not change the password.', err.field === 'current' ? cur : err.field === 'new' ? next : null);
      busy = false;
      btn.disabled = false;
    }
  });
}

// Modal form: Bug / Suggestion, title, description. The current page and
// browser are attached automatically so the admin can reproduce. Built on
// the same overlay + wireModalDismiss contract as confirmDialog.
function showReportDialog(opts = {}) {
  const L = MessagingLogic;
  const kind = L.isKind(opts.kind) ? opts.kind : 'bug';
  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Report a bug or suggestion');
  overlay.innerHTML = `
    <form class="confirm-box report-box" novalidate>
      <h3 class="confirm-title">Report a bug or idea</h3>
      <p class="confirm-message">Tell us what broke or what you’d love to see. An admin will reply in your Messages.</p>
      <div class="report-field">
        <label for="report-kind">Type</label>
        <select id="report-kind" name="kind">
          <option value="bug"${kind === 'bug' ? ' selected' : ''}>Bug — something is broken</option>
          <option value="suggestion"${kind === 'suggestion' ? ' selected' : ''}>Suggestion — an idea or improvement</option>
        </select>
      </div>
      <div class="report-field">
        <label for="report-title">Title</label>
        <input id="report-title" name="title" type="text" maxlength="${L.C.TITLE_MAX}" placeholder="Short summary" autocomplete="off" />
      </div>
      <div class="report-field">
        <label for="report-desc">Details</label>
        <textarea id="report-desc" name="description" rows="5" maxlength="${L.C.DESC_MAX}" placeholder="What happened? What did you expect?"></textarea>
        <span class="report-counter" aria-live="polite">0 / ${L.C.DESC_MAX}</span>
      </div>
      <p class="report-error" role="alert" hidden></p>
      <p class="report-meta">Page: <code>${esc(location.pathname + location.search)}</code> · attached automatically</p>
      <div class="confirm-actions">
        <button type="button" class="confirm-btn confirm-cancel">Cancel</button>
        <button type="submit" class="confirm-btn confirm-ok">Send</button>
      </div>
    </form>
  `;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('form');
  const titleEl = overlay.querySelector('#report-title');
  const descEl = overlay.querySelector('#report-desc');
  const counter = overlay.querySelector('.report-counter');
  const errEl = overlay.querySelector('.report-error');
  const sendBtn = overlay.querySelector('.confirm-ok');

  let sent = false;
  const close = wireModalDismiss(overlay, () => { if (overlay.parentNode) overlay.remove(); }, {
    initialFocus: titleEl,
    // A half-written report asks before Escape / the backdrop / Cancel throw it away.
    canClose: async () => sent || !(titleEl.value.trim() || descEl.value.trim()) || confirmDialog({
      title: 'Discard this report?',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep writing',
      danger: true
    })
  });
  overlay.querySelector('.confirm-cancel').addEventListener('click', close.request);

  const showError = (msg) => { errEl.textContent = msg; errEl.hidden = !msg; };
  descEl.addEventListener('input', () => { counter.textContent = `${descEl.value.length} / ${L.C.DESC_MAX}`; });

  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const raw = {
      kind: overlay.querySelector('#report-kind').value,
      title: titleEl.value,
      description: descEl.value,
      page: location.pathname + location.search,
      userAgent: navigator.userAgent
    };
    const v = L.validateReport(raw);
    if (!v.ok) {
      showError(L.errorText(v.error));
      (v.field === 'description' ? descEl : titleEl).focus();
      return;
    }
    busy = true;
    sendBtn.disabled = true;
    showError('');
    try {
      await Reports.create(v.report);
      sent = true;
      toast('Report sent — thanks! Replies land in your Messages.', 'success');
      close();
      // Filed from the reports page: show it in "My reports" right away.
      if (location.pathname === '/reports' && typeof ReportsView !== 'undefined' && ReportsView.refresh) {
        try { ReportsView.refresh(); } catch (_) {}
      }
    } catch (err) {
      showError(err.message || 'Could not send the report.');
      busy = false;
      sendBtn.disabled = false;
    }
  });
}
