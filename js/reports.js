/************************************************
 * REPORTS API + "REPORT A BUG / SUGGESTION" DIALOG
 *
 * The dialog is reachable from the nav drawers and /profile; the list of
 * a user's own reports (with the admin's replies) is the /reports view.
 ************************************************/
const Reports = (() => {
  const headers = (json) => ({
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${Auth.getToken()}`
  });

  async function call(path, opts = {}) {
    const res = await fetch(`${API}/reports${path}`, opts);
    let body = null;
    try { body = await res.json(); } catch (_) {}
    if (res.status === 401) { Auth.logout(); throw new Error('Session expired'); }
    if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
    return body;
  }

  return {
    create: (report) => call('/', { method: 'POST', headers: headers(true), body: JSON.stringify(report) }),
    mine: (page = 1) => call(`/mine?page=${page}`, { headers: headers() }),
    get: (id) => call(`/${encodeURIComponent(id)}`, { headers: headers() }),
    reply: (id, text) => call(`/${encodeURIComponent(id)}/replies`, { method: 'POST', headers: headers(true), body: JSON.stringify({ text }) })
  };
})();

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

  const close = wireModalDismiss(overlay, () => { if (overlay.parentNode) overlay.remove(); }, { initialFocus: titleEl });
  overlay.querySelector('.confirm-cancel').addEventListener('click', close);

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
      toast('Report sent — thanks! Replies land in your Messages.', 'success');
      close();
    } catch (err) {
      showError(err.message || 'Could not send the report.');
      busy = false;
      sendBtn.disabled = false;
    }
  });
}
