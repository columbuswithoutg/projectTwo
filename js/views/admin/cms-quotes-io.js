/************************************************
 * ADMIN — CMS QUOTES → Import / export
 *
 * Import: drop or pick CSV / JSON files (or paste), check them here with
 * QuoteGuessLogic.planImport against the live project list and the bank's
 * existing lines (GET /quotes/keys), review the preview — new, duplicate,
 * error, per island — then commit. Rows go up in chunks (the JSON body limit
 * is 64 KB) and the server validates every row again. A commit gets one
 * import id, so the whole import can be undone.
 *
 * Export: the bank (one island or all, by status) as CSV or as JSON in the
 * same shape the importer reads — a backup that re-imports cleanly.
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;
  const Q = () => window.QuoteGuessLogic;
  const Shared = AdminView._quotes = AdminView._quotes || {};
  const MAX_FILE = 5 * 1024 * 1024;

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function newImportId() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `imp-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${Math.random().toString(36).slice(2, 6)}`;
  }

  // POST one chunk, waiting out the admin rate limiter (60/min) on a 429.
  async function commitChunk(body, isLive) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await AdminView.api('/quotes/import/commit', { method: 'POST', body: JSON.stringify(body) });
      } catch (e) {
        if (e.status !== 429 || attempt >= 5 || !isLive()) throw e;
        await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
      }
    }
  }

  const IO = {
    _host: null,
    _ctx: null,
    _rows: [],          // parsed rows from every file / the paste box
    _sources: [],       // [{ name, rows, error }]
    _plan: null,
    _busy: false,
    _run: 0,            // token of the running commit; cancel() bumps it
    _done: false,       // the staged sources went in (replan() clears it)

    isBusy() { return IO._busy; },
    // Unsaved: a running import, or files / pasted text staged and not
    // imported yet (leaving would drop them).
    _pasted() {
      const ta = IO._host && IO._host.querySelector('.qte-paste-text');
      return !!(ta && String(ta.value || '').trim());
    },
    isDirty() {
      if (IO._busy) return true;
      return !!IO._host && ((IO._sources.length > 0 && !IO._done) || IO._pasted());
    },
    dirtyNote() {
      if (IO._busy) return 'An import is still running. Leaving stops it after the chunk being sent now; lines already saved stay saved.';
      if (!IO._host) return null;
      if (IO._sources.length && !IO._done) return 'Files staged for import have not been imported. Leaving drops them.';
      if (IO._pasted()) return 'Pasted text has not been added or imported. Leaving drops it.';
      return null;
    },
    cancel() { IO._run++; IO._busy = false; },
    discard() {
      IO.cancel();
      IO._sources = [];
      IO._rows = [];
      IO._plan = null;
      IO._done = false;
      const ta = IO._host && IO._host.querySelector('.qte-paste-text');
      if (ta) ta.value = '';
    },
    unmount() { IO.discard(); IO._host = null; },

    mount(host, ctx) {
      IO._host = host;
      IO._ctx = ctx || {};
      IO._rows = [];
      IO._sources = [];
      IO._plan = null;
      const projects = (Array.isArray(window.projects) ? window.projects : []).slice().sort((a, b) => String(a.title).localeCompare(String(b.title)));
      host.innerHTML = `
        <div class="qte-io">
          <section class="qte-io-card">
            <h3 class="admin-h3">Import lines</h3>
            <p class="admin-config-help">CSV with a header row, or JSON (<code>{ "projectId", "lines": [...] }</code>, a list of those, or a list of rows).
              Columns: <code>${Q().CSV_COLUMNS.join(', ')}</code>. A row names its island by id or exact title; episodes are 1-based.
              Nothing is saved until you press <b>Import</b>.</p>
            <label class="scn-drop qte-drop" tabindex="0">
              <input type="file" accept=".csv,.json,text/csv,application/json" multiple hidden>
              <span class="scn-drop-main">Drop CSV / JSON files here or <u>choose files</u></span>
              <span class="scn-drop-sub">Up to ${MAX_FILE / 1024 / 1024} MB each · ${Q().C.IMPORT_MAX_ROWS.toLocaleString()} lines per import</span>
            </label>
            <details class="qte-paste">
              <summary>…or paste</summary>
              <textarea class="admin-cms-input qte-paste-text" rows="6" placeholder="Paste CSV or JSON"></textarea>
              <button type="button" class="admin-btn qte-paste-add">Add pasted lines</button>
            </details>
            <div class="qte-io-sources"></div>
            <div class="qte-io-preview"></div>
            <div class="qte-io-tools">
              <button type="button" class="admin-btn qte-template">Download CSV template</button>
            </div>
          </section>
          <section class="qte-io-card">
            <h3 class="admin-h3">Export</h3>
            <div class="qte-form-row">
              <label class="qte-f qte-f-grow"><span class="qte-fl">Island</span>
                <select class="admin-input qte-ex-proj"><option value="">All islands</option>
                  ${projects.map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}
                </select></label>
              <label class="qte-f"><span class="qte-fl">Lines</span>
                <select class="admin-input qte-ex-status">
                  <option value="approved">Approved</option><option value="pending">Pending</option>
                  <option value="rejected">Rejected</option><option value="all">All</option>
                </select></label>
              <label class="qte-f"><span class="qte-fl">Format</span>
                <select class="admin-input qte-ex-fmt"><option value="csv">CSV</option><option value="json">JSON (re-importable)</option></select></label>
            </div>
            <button type="button" class="admin-btn qte-btn-primary qte-export">Export</button>
          </section>
        </div>`;
      const drop = host.querySelector('.qte-drop');
      const input = drop.querySelector('input');
      input.addEventListener('change', () => { IO.addFiles(input.files); input.value = ''; });
      drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('is-over');
        if (e.dataTransfer && e.dataTransfer.files) IO.addFiles(e.dataTransfer.files);
      });
      host.querySelector('.qte-paste-add').addEventListener('click', () => {
        const ta = host.querySelector('.qte-paste-text');
        if (!ta.value.trim()) return;
        IO.addText('Pasted', ta.value);
        ta.value = '';
      });
      host.querySelector('.qte-template').addEventListener('click', IO.template);
      host.querySelector('.qte-export').addEventListener('click', IO.exportBank);
    },

    async addFiles(list) {
      for (const file of Array.from(list || [])) {
        if (file.size > MAX_FILE) { IO._sources.push({ name: file.name, rows: [], error: 'Too large (max 5 MB).' }); continue; }
        IO.addText(file.name, await file.text(), true);
      }
      IO.replan();
    },

    // JSON when the name says so or the text starts with { or [; CSV otherwise.
    addText(name, text, deferPlan) {
      const json = /\.json$/i.test(name) || /^\s*[[{]/.test(text);
      const r = json ? Q().rowsFromJson(text) : Q().rowsFromCsv(text);
      IO._sources.push({ name, rows: r.rows, error: r.error });
      if (!deferPlan) IO.replan();
    },

    async replan() {
      const host = IO._host;
      if (!host) return;
      IO._done = false;
      IO._rows = IO._sources.flatMap(s => s.rows);
      const srcEl = host.querySelector('.qte-io-sources');
      srcEl.innerHTML = IO._sources.map((s, i) => `
        <div class="qte-io-src ${s.error ? 'is-bad' : ''}">
          <span>📄 ${esc(s.name)}</span>
          <span>${s.error ? esc(s.error) : `${s.rows.length} line${s.rows.length === 1 ? '' : 's'}`}</span>
          <button type="button" class="admin-btn qte-io-drop" data-i="${i}" aria-label="Remove ${esc(s.name)}">✕</button>
        </div>`).join('');
      srcEl.querySelectorAll('.qte-io-drop').forEach(b => b.addEventListener('click', () => { IO._sources.splice(+b.dataset.i, 1); IO.replan(); }));
      const prev = host.querySelector('.qte-io-preview');
      if (!IO._rows.length) { IO._plan = null; prev.innerHTML = ''; return; }
      if (IO._rows.length > Q().C.IMPORT_MAX_ROWS) {
        IO._plan = null;
        prev.innerHTML = `<div class="admin-error">That's ${IO._rows.length.toLocaleString()} lines — split it into imports of up to ${Q().C.IMPORT_MAX_ROWS.toLocaleString()}.</div>`;
        return;
      }
      prev.innerHTML = '<div class="admin-empty">Checking…</div>';
      try {
        const projects = Array.isArray(window.projects) ? window.projects : [];
        const ids = new Set();
        for (const r of IO._rows) {
          const ref = Q().cleanText(r.projectId);
          const p = projects.find(x => x.id === ref) || projects.find(x => Q().norm(x.title) === Q().norm(ref));
          if (p) ids.add(p.id);
        }
        const keys = ids.size ? (await AdminView.api('/quotes/keys?projectIds=' + encodeURIComponent([...ids].join(',')))).keys : [];
        IO._plan = Q().planImport(IO._rows, { projects, existingKeys: new Set(keys), characters: window.characters || [] });
        IO.renderPreview();
      } catch (e) {
        prev.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    renderPreview() {
      const host = IO._host;
      const plan = IO._plan;
      const prev = host.querySelector('.qte-io-preview');
      const title = (id) => (Shared.projectById(id) || {}).title || id;
      const islands = Object.entries(plan.byProject).sort((a, b) => String(title(a[0])).localeCompare(String(title(b[0]))));
      const errors = plan.rows.filter(r => r.status === 'error');
      const dupes = plan.rows.filter(r => r.status === 'dupe-db');
      prev.innerHTML = `
        <div class="qte-io-sum">
          <span class="qte-io-stat is-ok"><b>${plan.counts.ok}</b> new</span>
          <span class="qte-io-stat is-dupe"><b>${plan.counts.dupe}</b> already there</span>
          <span class="qte-io-stat is-bad"><b>${plan.counts.error}</b> with problems</span>
        </div>
        <table class="qte-io-table">
          <thead><tr><th>Island</th><th>New</th><th>Already there</th><th>Problems</th></tr></thead>
          <tbody>${islands.map(([pid, c]) => `
            <tr><td>${esc(title(pid))}</td><td>${c.ok || ''}</td><td>${c.dupe || ''}</td><td class="${c.error ? 'is-bad' : ''}">${c.error || ''}</td></tr>`).join('')}
          </tbody>
        </table>
        ${errors.length ? `
        <details class="qte-io-errs" open>
          <summary>${errors.length} line${errors.length === 1 ? '' : 's'} with problems (they're skipped)</summary>
          <ul>${errors.slice(0, 100).map(r => `
            <li><b>Line ${r.index + 1}</b> · ${esc(r.projectId ? title(r.projectId) : '?')} — ${esc(Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`).join(' · '))}
              ${IO._rows[r.index] && IO._rows[r.index].text ? `<br><i>“${esc(String(IO._rows[r.index].text).slice(0, 120))}”</i>` : ''}</li>`).join('')}
          </ul>${errors.length > 100 ? `<p>…and ${errors.length - 100} more.</p>` : ''}
        </details>` : ''}
        <div class="qte-io-go">
          <label class="qte-io-mode"><input type="radio" name="qte-mode" value="skip" checked> Skip lines already in the bank</label>
          <label class="qte-io-mode"><input type="radio" name="qte-mode" value="update" ${dupes.length ? '' : 'disabled'}> Update them with these versions (${dupes.length})</label>
          <button type="button" class="admin-btn qte-btn-primary qte-commit" ${plan.counts.ok || dupes.length ? '' : 'disabled'}>Import</button>
          <div class="qte-io-progress" hidden><span></span></div>
          <span class="qte-form-msg" role="status"></span>
        </div>
        <div class="qte-io-result"></div>`;
      prev.querySelector('.qte-commit').addEventListener('click', IO.commit);
    },

    async commit() {
      const host = IO._host;
      const plan = IO._plan;
      if (!plan || IO._busy) return;
      const mode = host.querySelector('input[name="qte-mode"]:checked').value;
      const send = plan.rows.filter(r => r.status === 'ok' || (mode === 'update' && r.status === 'dupe-db')).map(r => IO._rows[r.index]);
      if (!send.length) return;
      const ok = await confirmDialog({
        title: `Import ${send.length} line${send.length === 1 ? '' : 's'}?`,
        message: `${plan.counts.ok} new${mode === 'update' ? `, ${send.length - plan.counts.ok} updated` : ''}. They go live straight away on islands that are switched on. You can undo the whole import afterwards.`,
        confirmLabel: 'Import'
      });
      if (!ok) return;
      const run = ++IO._run;
      const isLive = () => run === IO._run;
      IO._busy = true;
      const importId = newImportId();
      const chunks = Q().chunkRows(send);
      const bar = host.querySelector('.qte-io-progress');
      const msg = host.querySelector('.qte-io-go .qte-form-msg');
      const btn = host.querySelector('.qte-commit');
      btn.disabled = true;
      bar.hidden = false;
      // Rows with problems never leave the page; the server may find more.
      const total = { inserted: 0, updated: 0, skipped: 0, failed: plan.counts.error };
      let failed = false;
      try {
        for (let i = 0; i < chunks.length; i++) {
          if (!isLive()) {
            // Left mid-import: the id is the only handle on what went in.
            if (total.inserted || total.updated) AdminView.toast(`Import stopped: ${total.inserted} added, ${total.updated} updated (import id ${importId})`, 'info');
            return;
          }
          msg.textContent = `Sending ${i + 1} of ${chunks.length}…`;
          const r = await commitChunk({ rows: chunks[i], mode, importId, origin: 'admin' }, isLive);
          total.inserted += r.inserted; total.updated += r.updated; total.skipped += r.skipped; total.failed += (r.failed || []).length;
          bar.firstElementChild.style.width = `${Math.round(100 * (i + 1) / chunks.length)}%`;
          // Lines are live from the first chunk on: show the import id now,
          // not only at the end (leaving or a failure would lose it).
          if (i === 0 && chunks.length > 1) AdminView.toast(`Import ${importId} started`, 'info');
          if (i < chunks.length - 1 && isLive()) IO.showResult(importId, total, null, true);
        }
        msg.textContent = '';
        if (isLive()) IO._done = true;
        IO.showResult(importId, total);
        AdminView.toast(`Imported ${total.inserted} new line${total.inserted === 1 ? '' : 's'}`, 'success');
      } catch (e) {
        failed = true;
        msg.textContent = e.message;
        IO.showResult(importId, total, e.message);
      } finally {
        // After a failed chunk the admin can try again (lines already in are
        // skipped as duplicates, or updated again in Update mode).
        if (failed && isLive()) btn.disabled = false;
        if (isLive()) IO._busy = false;
        if (IO._ctx.onChange) IO._ctx.onChange();
      }
    },

    // running: the import is still sending — show the id, but no Undo yet.
    showResult(importId, t, error, running) {
      const host = IO._host;
      if (!host) return;
      const el = host.querySelector('.qte-io-result');
      if (running) {
        el.innerHTML = `
        <div class="scn-banner">
          <b>Importing…</b> ${t.inserted} added · ${t.updated} updated so far. Import id <code>${esc(importId)}</code>
        </div>`;
        return;
      }
      el.innerHTML = `
        <div class="scn-banner ${error ? '' : 'is-on'}">
          ${error ? `<b>Stopped:</b> ${esc(error)}<br>` : '<b>Done.</b> '}
          ${t.inserted} added · ${t.updated} updated · ${t.skipped} skipped · ${t.failed} left out for problems.
          ${t.inserted ? `<br>Import id <code>${esc(importId)}</code> — <button type="button" class="admin-btn admin-btn-danger qte-undo">Undo this import</button>` : ''}
        </div>`;
      const undo = el.querySelector('.qte-undo');
      if (undo) undo.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Undo this import?',
          message: `Every line added by ${importId} is deleted (edits made to them since are lost). Lines that were only updated keep their new text.`,
          confirmLabel: 'Undo import',
          danger: true
        });
        if (!ok) return;
        try {
          const r = await AdminView.api('/quotes/import/' + encodeURIComponent(importId), { method: 'DELETE' });
          AdminView.toast(`Import undone — ${r.removed} line${r.removed === 1 ? '' : 's'} removed`, 'success');
          if (IO._ctx.onChange) IO._ctx.onChange();
          IO.replan();
        } catch (e) { AdminView.toast(e.message, 'error'); }
      });
    },

    template() {
      const sample = [
        { projectId: 'avengers1', speaker: { name: 'Loki' }, text: 'I have an army.', reply: { speaker: { name: 'Tony Stark' }, text: 'We have a Hulk.' }, note: 'to Tony · Stark Tower penthouse', episode: null, timeSec: null, source: '', decoys: { speakers: [], replies: [] } },
        { projectId: 'wandavision', speaker: { name: 'Vision' }, text: 'What is grief, if not love persevering?', reply: null, note: 'to Wanda · a flashback', episode: 7, timeSec: null, source: '', decoys: { speakers: [], replies: [] } }
      ];
      download('quote-guess-template.csv', Q().toCsv(sample), 'text/csv;charset=utf-8');
    },

    async exportBank() {
      const host = IO._host;
      const pid = host.querySelector('.qte-ex-proj').value;
      const status = host.querySelector('.qte-ex-status').value;
      const fmt = host.querySelector('.qte-ex-fmt').value;
      const btn = host.querySelector('.qte-export');
      btn.disabled = true;
      try {
        const q = new URLSearchParams({ status });
        if (pid) q.set('projectId', pid);
        const r = await AdminView.api('/quotes/export?' + q);
        const lines = r.items || [];
        if (!lines.length) { AdminView.toast('Nothing to export', 'info'); return; }
        const stamp = new Date().toISOString().slice(0, 10);
        const base = `quotes-${pid || 'all'}-${status}-${stamp}`;
        if (fmt === 'json') download(base + '.json', JSON.stringify(Q().toSeedJson(lines), null, 2), 'application/json');
        else download(base + '.csv', Q().toCsv(lines), 'text/csv;charset=utf-8');
        AdminView.toast(`Exported ${lines.length} line${lines.length === 1 ? '' : 's'}`, 'success');
      } catch (e) {
        AdminView.toast(e.message, 'error');
      } finally {
        btn.disabled = false;
      }
    }
  };

  Shared.io = IO;
})();
