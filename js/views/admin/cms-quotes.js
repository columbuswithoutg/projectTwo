/************************************************
 * ADMIN — CMS QUOTES (Quote Guess minigame)
 *
 * Minigames → Quote Guess (under its Game settings card, index.js
 * _minigamePane), two in-pane views:
 *   Islands      — per project: the quote bank (add / edit / hide / delete),
 *                  the island's two switches (game on, suggestions on), what
 *                  it still needs to be playable, and its board. An island
 *                  page is a drill-down (?id=, a pushed history entry).
 *   Import       — bulk CSV / JSON import with a preview, and export
 *                  (?sub=io, js/views/admin/cms-quotes-io.js).
 * Players' suggestions waiting for review have their own sidebar entry,
 * People → Quote suggestions (js/views/admin/cms-quotes-queue.js); the
 * view switch here links to it.
 *
 * Server: routes/admin-quotes.js (/api/admin/quotes/…). Every form is
 * checked here with the same QuoteGuessLogic.validateLine the server uses,
 * so mistakes show up per field before anything is sent.
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;
  const Q = () => window.QuoteGuessLogic;
  const S = () => window.SceneGuessLogic;

  // ── shared helpers (also used by the queue and import views) ──────────

  const Shared = AdminView._quotes = AdminView._quotes || {};

  Shared.projectById = (id) => (Array.isArray(window.projects) ? window.projects : []).find(p => p.id === id) || null;

  function charById(id) {
    return id && Array.isArray(window.characters) ? window.characters.find(c => c.id === id) || null : null;
  }
  Shared.charIndex = () => Q().characterIndex(Array.isArray(window.characters) ? window.characters : []);

  // A round portrait for a linked character, else the speaker's initials.
  Shared.portrait = (speaker, size) => {
    const px = size || 28;
    const c = speaker && charById(speaker.characterId);
    const name = speaker ? speaker.name || '' : '';
    if (c && c.image && typeof assetUrl === 'function') {
      return `<img class="qte-face" style="width:${px}px;height:${px}px" src="${esc(assetUrl('assets/characters/' + c.image))}" alt="" loading="lazy">`;
    }
    const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
    return `<span class="qte-face qte-face-ini" style="width:${px}px;height:${px}px">${esc(ini)}</span>`;
  };

  // "E3 · 12:34" on a series, "1:02:13" on a film, '' without a time.
  Shared.when = (line) => {
    const ep = Number.isInteger(line.episode) ? Q().episodeLabel(line.episode) : '';
    const t = Number.isInteger(line.timeSec) ? S().formatTime(line.timeSec) : '';
    return [ep, t].filter(Boolean).join(' · ');
  };

  Shared.originBadge = (line) => {
    if (line.origin === 'suggestion') return `<span class="qte-badge qte-badge-sug" title="Suggested by a player">💬 @${esc(line.suggestedByName || 'player')}</span>`;
    if (line.origin === 'seed') return '<span class="qte-badge" title="From the starting quote bank">Seed</span>';
    return '<span class="qte-badge">Admin</span>';
  };

  Shared.statusBadge = (line) => {
    if (line.status === 'pending') return '<span class="qte-badge qte-badge-pend">Pending</span>';
    if (line.status === 'rejected') return `<span class="qte-badge qte-badge-rej" title="${esc(line.rejectReason || '')}">Rejected</span>`;
    if (!line.active) return '<span class="qte-badge qte-badge-off">Hidden</span>';
    return '';
  };

  // The line as it reads in a list: speaker + line, then the reply.
  Shared.lineHtml = (l) => `
    <div class="qte-say">
      ${Shared.portrait(l.speaker)}
      <div class="qte-say-main">
        <span class="qte-who">${esc(l.speaker ? l.speaker.name : '')}</span>
        <q class="qte-text">${esc(l.text)}</q>
      </div>
    </div>
    ${l.reply ? `
    <div class="qte-say qte-say-reply">
      ${Shared.portrait(l.reply.speaker, 24)}
      <div class="qte-say-main">
        <span class="qte-who">${esc(l.reply.speaker ? l.reply.speaker.name : '')}</span>
        <q class="qte-text">${esc(l.reply.text)}</q>
      </div>
    </div>` : ''}`;

  // The add / edit form for one line. A plain form: per-field errors from
  // QuoteGuessLogic.validateLine before sending, then from the server.
  //   opts: { project, line?, speakers: [name], submitLabel, onSubmit(row) → Promise, onCancel?, compact? }
  // → { el, isDirty(), save() → Promise<boolean>, focus(), reset() }
  Shared.lineForm = (opts) => {
    const p = opts.project;
    const series = Array.isArray(p.episodes) && p.episodes.length > 0;
    const row = opts.line ? Q().lineToForm(Object.assign({ projectId: p.id }, opts.line)) : {};
    const idx = Shared.charIndex();
    const listId = 'qte-names-' + Math.random().toString(36).slice(2, 8);
    const names = [...new Set((opts.speakers || []).concat((window.characters || []).map(c => c.name)))].sort();
    const C = Q().C;

    const el = document.createElement('form');
    el.className = 'qte-form' + (opts.compact ? ' is-compact' : '');
    el.noValidate = true;
    el.innerHTML = `
      <datalist id="${listId}">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="qte-form-pair">
        <label class="qte-f qte-f-who">
          <span class="qte-fl">Who says it *</span>
          <span class="qte-who-input">
            <span class="qte-face-slot" data-face="speaker"></span>
            <input class="admin-cms-input" name="speaker" list="${listId}" maxlength="${C.MAX_SPEAKER}" autocomplete="off" placeholder="e.g. Tony Stark">
          </span>
          <span class="admin-cms-error" data-err="speaker"></span>
        </label>
        <label class="qte-f qte-f-text">
          <span class="qte-fl">The line * <i class="qte-count" data-count="text"></i></span>
          <textarea class="admin-cms-input" name="text" rows="2" maxlength="${C.MAX_TEXT}" placeholder="Exactly as said — one or two sentences"></textarea>
          <span class="admin-cms-error" data-err="text"></span>
        </label>
      </div>
      <div class="qte-form-pair">
        <label class="qte-f qte-f-who">
          <span class="qte-fl">Who replies</span>
          <span class="qte-who-input">
            <span class="qte-face-slot" data-face="reply"></span>
            <input class="admin-cms-input" name="replySpeaker" list="${listId}" maxlength="${C.MAX_SPEAKER}" autocomplete="off" placeholder="optional">
          </span>
          <span class="admin-cms-error" data-err="replySpeaker"></span>
        </label>
        <label class="qte-f qte-f-text">
          <span class="qte-fl">The reply <i class="qte-count" data-count="replyText"></i></span>
          <textarea class="admin-cms-input" name="replyText" rows="2" maxlength="${C.MAX_REPLY}" placeholder="Optional — the line said straight back (makes “What’s the reply?” rounds)"></textarea>
          <span class="admin-cms-error" data-err="replyText"></span>
        </label>
      </div>
      <div class="qte-form-row">
        <label class="qte-f qte-f-grow">
          <span class="qte-fl">Scene note <i class="qte-count" data-count="note"></i></span>
          <input class="admin-cms-input" name="note" maxlength="${C.MAX_NOTE}" placeholder="Shown at the reveal — e.g. to Loki · Stark Tower">
          <span class="admin-cms-error" data-err="note"></span>
        </label>
        ${series ? `
        <label class="qte-f">
          <span class="qte-fl">Episode</span>
          <select class="admin-cms-input" name="episode">
            <option value="">—</option>
            ${p.episodes.map((_, i) => `<option value="${i + 1}">E${i + 1}</option>`).join('')}
          </select>
          <span class="admin-cms-error" data-err="episode"></span>
        </label>` : ''}
        <label class="qte-f qte-f-time">
          <span class="qte-fl">Time</span>
          <input class="admin-cms-input" name="time" inputmode="numeric" placeholder="1:02:13">
          <span class="admin-cms-error" data-err="time"></span>
        </label>
      </div>
      <details class="qte-more">
        <summary>Source and wrong answers <span class="qte-more-sub">optional</span></summary>
        <label class="qte-f">
          <span class="qte-fl">Source link</span>
          <input class="admin-cms-input" name="source" maxlength="${C.MAX_SOURCE}" placeholder="Where you checked it (only admins see this)">
          <span class="admin-cms-error" data-err="source"></span>
        </label>
        <label class="qte-f">
          <span class="qte-fl">Wrong names to offer first</span>
          <input class="admin-cms-input" name="decoySpeakers" list="${listId}" placeholder="Name | Name | Name">
          <span class="admin-cms-hint">Separate with |. Otherwise other people from this island are used.</span>
          <span class="admin-cms-error" data-err="decoySpeakers"></span>
        </label>
        <label class="qte-f">
          <span class="qte-fl">Wrong replies to offer first</span>
          <textarea class="admin-cms-input" name="decoyReplies" rows="2" placeholder="One per line"></textarea>
          <span class="admin-cms-hint">Otherwise other lines from this island of a similar length are used.</span>
          <span class="admin-cms-error" data-err="decoyReplies"></span>
        </label>
      </details>
      <div class="qte-form-actions">
        <button type="submit" class="admin-btn qte-btn-primary">${esc(opts.submitLabel || 'Save')}</button>
        ${opts.onCancel ? '<button type="button" class="admin-btn qte-cancel">Cancel</button>' : ''}
        <span class="qte-form-msg" role="status"></span>
      </div>
    `;
    const f = (n) => el.elements.namedItem(n);
    const set = (n, v) => { const x = f(n); if (x) x.value = v == null ? '' : String(v); };
    for (const k of ['speaker', 'text', 'replySpeaker', 'replyText', 'note', 'episode', 'time', 'source', 'decoySpeakers']) set(k, row[k]);
    set('decoyReplies', String(row.decoyReplies || '').split('|').filter(Boolean).join('\n'));
    // Hand-picked portraits survive an edit unless the name changes.
    const picked = { speaker: row.speakerCharacterId || '', reply: row.replyCharacterId || '' };
    const startNames = { speaker: row.speaker || '', reply: row.replySpeaker || '' };
    if ((row.decoySpeakers || row.decoyReplies || row.source)) el.querySelector('.qte-more').open = true;

    const values = () => {
      const v = {};
      for (const k of ['speaker', 'text', 'replySpeaker', 'replyText', 'note', 'time', 'source', 'decoySpeakers']) v[k] = f(k) ? f(k).value : '';
      v.episode = f('episode') ? f('episode').value : '';
      v.decoyReplies = (f('decoyReplies').value || '').split('\n').map(s => s.trim()).filter(Boolean).join('|');
      if (picked.speaker && v.speaker === startNames.speaker) v.speakerCharacterId = picked.speaker;
      if (picked.reply && v.replySpeaker === startNames.reply) v.replyCharacterId = picked.reply;
      return v;
    };
    const initial = JSON.stringify(values());
    let dirty = false;

    function faces() {
      const v = values();
      const sp = { name: v.speaker, characterId: v.speakerCharacterId || Q().linkCharacter(v.speaker, idx) };
      const rp = { name: v.replySpeaker, characterId: v.replyCharacterId || Q().linkCharacter(v.replySpeaker, idx) };
      el.querySelector('[data-face="speaker"]').innerHTML = v.speaker ? Shared.portrait(sp, 30) : '';
      el.querySelector('[data-face="reply"]').innerHTML = v.replySpeaker ? Shared.portrait(rp, 30) : '';
      for (const [k, max] of [['text', C.MAX_TEXT], ['replyText', C.MAX_REPLY], ['note', C.MAX_NOTE]]) {
        const n = (f(k).value || '').length;
        const c = el.querySelector(`[data-count="${k}"]`);
        c.textContent = n ? `${n}/${max}` : '';
        c.classList.toggle('is-near', n > max * 0.9);
      }
    }
    function showErrors(errs) {
      el.querySelectorAll('[data-err]').forEach(s => { s.textContent = (errs && errs[s.dataset.err]) || ''; });
      el.querySelectorAll('.admin-cms-input').forEach(i => i.classList.toggle('is-bad', !!(errs && errs[i.name])));
      if (errs && (errs.source || errs.decoySpeakers || errs.decoyReplies)) el.querySelector('.qte-more').open = true;
      const first = errs && el.querySelector('.is-bad');
      if (first) first.focus();
    }
    el.addEventListener('input', () => { dirty = JSON.stringify(values()) !== initial; faces(); });
    el.addEventListener('change', faces);
    faces();

    const msg = el.querySelector('.qte-form-msg');
    // One submit at a time: the form's button and the sticky Save bar both
    // land here, and a second call while one is in flight gets the same
    // promise (a double click used to POST twice). Resolves true when saved.
    let inflight = null;
    async function submit() {
      const v = values();
      const check = Q().validateLine(v, { project: p, mode: 'admin' });
      if (!check.ok) { showErrors(check.errors); return false; }
      showErrors(null);
      const btn = el.querySelector('button[type="submit"]');
      btn.disabled = true;
      msg.textContent = 'Saving…';
      try {
        await opts.onSubmit(v);
        dirty = false;
        msg.textContent = '';
        return true;
      } catch (err) {
        msg.textContent = err.message || 'Could not save';
        if (err.body && err.body.fields) showErrors(err.body.fields);
        return false;
      } finally {
        btn.disabled = false;
      }
    }
    const run = () => {
      if (!inflight) inflight = submit().finally(() => { inflight = null; });
      return inflight;
    };
    el.addEventListener('submit', (e) => { e.preventDefault(); run(); });
    const cancel = el.querySelector('.qte-cancel');
    if (cancel) cancel.addEventListener('click', () => { dirty = false; opts.onCancel(); });

    return {
      el,
      isDirty: () => dirty,
      save: run,   // the sticky Save bar (index.js) → Promise<boolean saved>
      focus: () => f('speaker').focus(),
      reset: () => { el.reset(); picked.speaker = picked.reply = ''; dirty = false; showErrors(null); faces(); }
    };
  };

  // ── the editor ────────────────────────────────────────────────────────

  const Editor = {
    _container: null,
    _view: 'islands',       // 'islands' | 'io'
    _ctx: null,             // index.js nav context while mounted
    _items: [],
    _globals: {},
    _detail: null,          // GET /quotes/:projectId
    _board: [],
    _forms: new Set(),      // open line forms (dirty guard)
    _filter: { q: '', status: 'live' },

    // ctx (index.js): sub 'io' → Import / export; id → that island's page.
    async mount(container, ctx) {
      Editor._container = container;
      Editor._ctx = ctx || null;
      Editor._detail = null;
      Editor._forms.clear();
      // The old Suggestions view has its own sidebar entry now.
      if (ctx && ctx.sub === 'queue') { AdminView.go({ tab: 'suggestions' }); return; }
      if (ctx) Editor._view = ctx.sub === 'io' ? 'io' : 'islands';
      container.innerHTML = `
        <div class="qte">
          <div class="qte-views" role="tablist" aria-label="Quote Guess views">
            <button type="button" class="qte-view" data-view="islands" role="tab">Islands</button>
            <button type="button" class="qte-view" data-view="io" role="tab">Import / export</button>
            <a class="qte-view qte-view-link" href="/admin?tab=suggestions" data-go="suggestions">Suggestions <b class="qte-pending" hidden></b> <span aria-hidden="true">→</span></a>
          </div>
          <div class="qte-host"></div>
        </div>`;
      container.querySelectorAll('button.qte-view').forEach(b => b.addEventListener('click', () => Editor.show(b.dataset.view)));
      container.querySelector('[data-go="suggestions"]').addEventListener('click', (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        AdminView.go({ tab: 'suggestions' });
      });
      if (ctx && ctx.id && Editor._view === 'islands') {
        Editor._markView('islands');
        Editor.refreshPending();
        return Editor.openProject(ctx.id);
      }
      await Editor.show(Editor._view, true);
    },

    _markView(view) {
      Editor._container.querySelectorAll('button.qte-view').forEach(b => {
        const on = b.dataset.view === view;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    },

    // Sticky Save bar (index.js): submit every open line form with edits and
    // wait for them, so the bar stays disabled until the requests settle.
    async save() {
      await Promise.all([...Editor._forms].filter(f => f.isDirty() && f.save).map(f => f.save()));
    },
    // Only line forms can be saved; a running import alone can't (index.js
    // then shows the bar with Discard only).
    canSave() {
      for (const f of Editor._forms) if (f.isDirty()) return true;
      return false;
    },

    unmount() {
      Editor._forms.clear();
      Editor._detail = null;
      Editor._ctx = null;
      if (Shared.io && Shared.io.unmount) Shared.io.unmount();
    },

    isDirty() {
      for (const f of Editor._forms) if (f.isDirty()) return true;
      // Import / export: a running import, or files / pasted text not imported yet.
      const io = Shared.io;
      return !!(io && (io.isDirty ? io.isDirty() : io.isBusy && io.isBusy()));
    },
    dirtyNote() {
      return (Shared.io && Shared.io.dirtyNote && Shared.io.dirtyNote()) || null;
    },
    discard() {
      Editor._forms.clear();
      if (Shared.io && Shared.io.discard) Shared.io.discard();
    },

    _host() { return Editor._container && Editor._container.querySelector('.qte-host'); },

    async show(view, force) {
      if (!force && view === Editor._view && view !== 'islands') return;
      if (!force && Editor.isDirty()) {
        if (!(await AdminView._confirmDiscard())) return;
        Editor.discard();
      }
      if (view === 'queue') return AdminView.go({ tab: 'suggestions' });
      Editor._view = view;
      Editor._forms.clear();
      Editor._markView(view);
      if (Editor._ctx) {
        Editor._ctx.sync({ sub: view === 'io' ? 'io' : '' });
        Editor._ctx.crumbs(view === 'io' ? [{ label: 'Import / export' }] : []);
      }
      const host = Editor._host();
      if (view === 'io' && Shared.io) return Shared.io.mount(host, { onChange: Editor.refreshPending });
      return Editor.loadList();
    },

    // The "Suggestions (n)" count on the view switch (and the sidebar).
    refreshPending(n) {
      const set = (count) => {
        AdminView.setNavBadge('suggestions', count || 0);
        const b = Editor._container && Editor._container.querySelector('.qte-pending');
        if (!b) return;
        b.hidden = !count;
        b.textContent = count > 99 ? '99+' : String(count);
      };
      if (Number.isInteger(n)) return set(n);
      AdminView.api('/quotes/summary').then(r => { Editor._items = r.items || []; Editor._globals = r; set(r.pendingTotal || 0); }).catch(() => {});
    },

    async loadList() {
      const host = Editor._host();
      Editor._detail = null;
      host.innerHTML = '<div class="admin-empty">Loading islands…</div>';
      try {
        const r = await AdminView.api('/quotes/summary');
        Editor._items = r.items || [];
        Editor._globals = r;
        Editor.refreshPending(r.pendingTotal || 0);
        Editor.renderList();
      } catch (e) {
        host.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    _banner() {
      const g = Editor._globals;
      const el = document.createElement('div');
      el.className = 'scn-banner' + (g.globalEnabled ? ' is-on' : '');
      el.innerHTML = g.globalEnabled
        ? `<b>Quote Guess is ON for players.</b> Only islands switched on below (with a playable bank) show the game.
           Suggestions are <b>${g.suggestEnabled ? 'open' : 'closed'}</b> (Game settings above).`
        : '<b>Quote Guess is OFF for everyone</b> — players see no trace of it. Build the banks here, then switch it on in <b>Game settings</b> above.';
      return el;
    },

    _statusText(it) {
      const need = it.needs || { lines: 0, speakers: 0 };
      const missing = [need.lines ? `${need.lines} more line${need.lines === 1 ? '' : 's'}` : '', need.speakers ? `${need.speakers} more speaker${need.speakers === 1 ? '' : 's'}` : ''].filter(Boolean).join(' + ');
      if (!it.enabled) return missing ? `Off · needs ${missing}` : 'Off · ready to switch on';
      if (missing) return `On · waiting for ${missing}`;
      return Editor._globals.globalEnabled ? 'Live' : 'On · live when the game is switched on';
    },

    renderList() {
      const host = Editor._host();
      host.innerHTML = '';
      const g = Editor._globals;
      const help = document.createElement('p');
      help.className = 'admin-config-help';
      help.innerHTML = `The <b>Quote Guess</b> bank: lines players identify (“Who said it?”) or answer (“What’s the reply?”).
        An island shows the game when <b>you switch it on</b> and it has <b>${g.minPool || 10}</b> live lines from at least
        <b>${g.minSpeakers || 4}</b> different speakers. Lines with a reply also make reply rounds.`;
      const list = AdminView._cmsListView({
        items: Editor._items,
        columns: [
          { key: 'title', label: 'Project' },
          { key: 'kind', label: 'Type', fmt: (v, it) => v === 'series' ? `Series · ${it.episodes} ep` : 'Movie' },
          { key: 'lines', label: 'Lines', fmt: (v, it) => `${v} · ${it.speakers} speakers · ${it.replies} replies` },
          { key: 'pending', label: 'Pending', fmt: (v) => v ? String(v) : '—' },
          { key: 'enabled', label: 'Island', fmt: (v, it) => Editor._statusText(it) }
        ],
        onPick: (item) => (Editor._ctx ? Editor._ctx.go({ id: item.id }, { push: true }) : Editor.openProject(item.id))
      });
      const addBtn = list.querySelector('.admin-toolbar .admin-btn');
      if (addBtn) addBtn.remove();
      host.append(Editor._banner(), help, list);
      list.querySelectorAll('.admin-cms-row').forEach(rowEl => {
        const it = Editor._items.find(i => i.id === rowEl.dataset.id);
        if (it && it.enabled && it.playable) rowEl.classList.add('scn-row-playable');
        if (it && it.pending) rowEl.classList.add('qte-row-pending');
      });
    },

    async openProject(id) {
      const host = Editor._host();
      Editor._forms.clear();
      host.innerHTML = '<div class="admin-empty">Loading lines…</div>';
      try {
        const pid = encodeURIComponent(id);
        const [detail, board] = await Promise.all([
          AdminView.api('/quotes/' + pid),
          AdminView.api('/quotes/' + pid + '/board')
        ]);
        Editor._detail = detail;
        Editor._board = board.items || [];
        Editor._globals = Object.assign({}, Editor._globals, { globalEnabled: detail.globalEnabled, suggestEnabled: detail.suggestEnabled });
        Editor.renderProject();
      } catch (e) {
        host.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    async _backToList() {
      // Up a level: Back to the list (the shell's leave guard asks about
      // open line forms); the breadcrumb does the same.
      if (Editor._ctx) { Editor._ctx.up({}); return; }
      if (Editor.isDirty()) {
        if (!(await AdminView._confirmDiscard())) return;
      }
      Editor._forms.clear();
      Editor.loadList();
    },

    _speakers() {
      const d = Editor._detail;
      const out = new Set();
      for (const l of d.lines) { if (l.speaker) out.add(l.speaker.name); if (l.reply && l.reply.speaker) out.add(l.reply.speaker.name); }
      return [...out];
    },

    // ── island page ─────────────────────────────────────────────────────

    renderProject() {
      const d = Editor._detail;
      const host = Editor._host();
      const series = d.project.episodes.length > 0;
      host.innerHTML = `
        <div class="scn qte-island">
          <div class="scn-head">
            <button type="button" class="admin-btn qte-back">← All islands</button>
            <div class="scn-title">
              <h3 class="admin-h3">${esc(d.project.title)}</h3>
              <span class="scn-sub">${series ? `Series · ${d.project.episodes.length} episodes` : 'Movie'}${d.project.runtime ? ' · ' + esc(S().formatTime(d.project.runtime * 60)) : ''}</span>
            </div>
            <span class="scn-status qte-status"></span>
          </div>
          <div class="qte-switches">
            <label class="scn-switch">
              <input type="checkbox" class="qte-sw" data-key="enabled" ${d.enabled ? 'checked' : ''}>
              <span class="scn-switch-main">Show the game on this island</span>
              <span class="scn-switch-sub">Live once the bank is playable and Quote Guess is on (Game settings above).</span>
            </label>
            <label class="scn-switch">
              <input type="checkbox" class="qte-sw" data-key="acceptSuggestions" ${d.acceptSuggestions ? 'checked' : ''}>
              <span class="scn-switch-main">Take player suggestions here</span>
              <span class="scn-switch-sub">Players who watched it can suggest lines (with a time) for you to review.</span>
            </label>
          </div>
          <ul class="qte-checks" aria-label="What this island needs"></ul>
          <section class="qte-add">
            <button type="button" class="admin-btn qte-btn-primary qte-add-open">+ Add a line</button>
            <div class="qte-add-host"></div>
          </section>
          <div class="qte-lines-head">
            <h3 class="admin-h3">Lines <span class="qte-lines-count"></span></h3>
            <div class="qte-filters">
              <input type="search" class="admin-input qte-q" placeholder="Search lines or speakers…" value="${esc(Editor._filter.q)}">
              <select class="admin-input qte-st">
                ${[['live', 'Live'], ['hidden', 'Hidden'], ['pending', 'Pending'], ['rejected', 'Rejected'], ['all', 'All']]
                  .map(([v, l]) => `<option value="${v}" ${Editor._filter.status === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="qte-lines"></div>
          <h3 class="admin-h3">Island board</h3>
          <div class="scn-board qte-board"></div>
        </div>`;
      host.querySelector('.qte-island').prepend(Editor._banner());
      if (Editor._ctx) Editor._ctx.crumbs([{ label: d.project.title }]);
      host.querySelector('.qte-back').addEventListener('click', () => Editor._backToList());
      host.querySelectorAll('.qte-sw').forEach(sw => sw.addEventListener('change', () => Editor._toggle(sw)));
      host.querySelector('.qte-add-open').addEventListener('click', () => Editor.openAdd());
      const q = host.querySelector('.qte-q');
      let t = null;
      q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { Editor._filter.q = q.value; Editor.renderLines(); }, 200); });
      host.querySelector('.qte-st').addEventListener('change', (e) => { Editor._filter.status = e.target.value; Editor.renderLines(); });
      Editor.renderChecks();
      Editor.renderLines();
      Editor.renderBoard();
    },

    async _toggle(sw) {
      const d = Editor._detail;
      const key = sw.dataset.key;
      sw.disabled = true;
      try {
        const r = await AdminView.api('/quotes/' + encodeURIComponent(d.project.id) + '/island', { method: 'PUT', body: JSON.stringify({ [key]: sw.checked }) });
        d.enabled = r.enabled;
        d.acceptSuggestions = r.acceptSuggestions;
        AdminView.toast(key === 'enabled'
          ? (r.enabled ? 'Switched on for this island' : 'Switched off — the island shows no Quote Guess')
          : (r.acceptSuggestions ? 'Players can suggest lines here' : 'Suggestions closed for this island'), 'success');
      } catch (e) {
        sw.checked = !sw.checked;
        AdminView.toast(e.message, 'error');
      } finally {
        sw.disabled = false;
        Editor.renderChecks();
      }
    },

    // Recount from the loaded lines and show what's still missing.
    renderChecks() {
      const d = Editor._detail;
      const host = Editor._host();
      const live = d.lines.filter(l => l.status === 'approved' && l.active);
      const st = Q().poolStats(live);
      d.stats = st;
      d.playable = Q().playable(st);
      const C = Q().C;
      const item = (ok, text) => `<li class="${ok ? 'is-ok' : 'is-todo'}"><span aria-hidden="true">${ok ? '✓' : '○'}</span> ${text}</li>`;
      host.querySelector('.qte-checks').innerHTML = [
        item(st.n >= C.MIN_POOL, `<b>${st.n}</b> live line${st.n === 1 ? '' : 's'} <i>(needs ${C.MIN_POOL})</i>`),
        item(st.speakers >= C.MIN_SPEAKERS, `<b>${st.speakers}</b> different speakers <i>(needs ${C.MIN_SPEAKERS})</i>`),
        item(st.replies >= C.REPLY_MIN, `<b>${st.replies}</b> with a reply <i>(${C.REPLY_MIN}+ gives every game reply rounds)</i>`),
        item(d.enabled, d.enabled ? 'Switched on' : 'Switched off')
      ].join('');
      const status = host.querySelector('.qte-status');
      const live2 = d.enabled && d.playable && Editor._globals.globalEnabled;
      status.textContent = live2 ? 'Live' : d.playable ? 'Playable' : `${st.n}/${C.MIN_POOL} lines`;
      status.classList.toggle('is-on', d.playable);
      const row = Editor._items.find(i => i.id === d.project.id);
      if (row) Object.assign(row, { lines: st.n, speakers: st.speakers, replies: st.replies, enabled: d.enabled, playable: d.playable, needs: Q().needs(st), pending: d.lines.filter(l => l.status === 'pending').length });
    },

    openAdd() {
      const d = Editor._detail;
      const host = Editor._host().querySelector('.qte-add-host');
      const btn = Editor._host().querySelector('.qte-add-open');
      if (host.firstChild) { host.querySelector('textarea, input').focus(); return; }
      btn.hidden = true;
      const form = Shared.lineForm({
        project: d.project,
        speakers: Editor._speakers(),
        submitLabel: 'Add line',
        onCancel: () => { Editor._forms.delete(form); host.innerHTML = ''; btn.hidden = false; },
        onSubmit: async (row) => {
          const line = await AdminView.api('/quotes/' + encodeURIComponent(d.project.id), { method: 'POST', body: JSON.stringify(row) });
          d.lines.push(line);
          form.reset();
          form.focus();
          Editor.renderChecks();
          Editor.renderLines();
          AdminView.toast('Line added', 'success');
        }
      });
      Editor._forms.add(form);
      host.appendChild(form.el);
      form.focus();
    },

    // Open line edit forms by line id: renderLines puts them back in their
    // cards, so a re-render (search, filter, Hide, another form's Save) keeps
    // the edits the Save bar counts.
    _openEdits() {
      const open = new Map();
      for (const f of Editor._forms) if (f.lineId) open.set(f.lineId, f);
      return open;
    },

    _visible() {
      const d = Editor._detail;
      const q = Q().norm(Editor._filter.q);
      const st = Editor._filter.status;
      const open = Editor._openEdits();
      return d.lines.filter(l => {
        if (open.has(l.id)) return true;     // being edited: stays on screen whatever the filter
        if (st === 'live' && !(l.status === 'approved' && l.active)) return false;
        if (st === 'hidden' && !(l.status === 'approved' && !l.active)) return false;
        if ((st === 'pending' || st === 'rejected') && l.status !== st) return false;
        if (!q) return true;
        const hay = Q().norm([l.text, l.speaker && l.speaker.name, l.reply && l.reply.text, l.reply && l.reply.speaker && l.reply.speaker.name, l.note].filter(Boolean).join(' '));
        return hay.includes(q);
      }).slice().reverse();     // newest first
    },

    renderLines() {
      const d = Editor._detail;
      const host = Editor._host().querySelector('.qte-lines');
      const open = Editor._openEdits();
      // An open form whose line is gone (deleted) has nothing to save.
      for (const [id, f] of open) if (!d.lines.some(x => x.id === id)) { Editor._forms.delete(f); open.delete(id); }
      const list = Editor._visible();
      Editor._host().querySelector('.qte-lines-count').textContent = `(${list.length} of ${d.lines.length})`;
      if (!list.length) {
        host.innerHTML = `<div class="admin-empty">${d.lines.length ? 'No lines match.' : 'No lines yet — add one above, or use Import / export.'}</div>`;
        return;
      }
      host.innerHTML = list.map(l => `
        <article class="qte-line${l.active && l.status === 'approved' ? '' : ' is-off'}" data-id="${esc(l.id)}">
          <div class="qte-line-body">
            ${Shared.lineHtml(l)}
            <div class="qte-meta">
              ${Shared.statusBadge(l)}
              ${Shared.originBadge(l)}
              ${Shared.when(l) ? `<span class="qte-badge qte-badge-time">⏱ ${esc(Shared.when(l))}</span>` : ''}
              ${l.note ? `<span class="qte-note">${esc(l.note)}</span>` : ''}
              ${Q().isWebLink(l.source) ? `<a class="qte-src" href="${esc(l.source)}" target="_blank" rel="noopener noreferrer">source ↗</a>` : ''}
            </div>
          </div>
          <div class="qte-line-actions">
            <button type="button" class="admin-btn qte-edit">Edit</button>
            ${l.status === 'approved' ? `<button type="button" class="admin-btn qte-hide">${l.active ? 'Hide' : 'Show'}</button>` : ''}
            <button type="button" class="admin-btn admin-btn-danger qte-del" aria-label="Delete line">Delete</button>
          </div>
        </article>`).join('');
      host.querySelectorAll('.qte-line').forEach(card => {
        const l = d.lines.find(x => x.id === card.dataset.id);
        const form = open.get(l.id);
        if (form) { Editor._showForm(card, form); return; }
        card.querySelector('.qte-edit').addEventListener('click', () => Editor.editLine(card, l));
        const hide = card.querySelector('.qte-hide');
        if (hide) hide.addEventListener('click', () => Editor._patch(l, { active: !l.active }, l.active ? 'Hidden from games' : 'Back in games'));
        card.querySelector('.qte-del').addEventListener('click', () => Editor.deleteLine(l));
      });
    },

    editLine(card, l) {
      const d = Editor._detail;
      const form = Shared.lineForm({
        project: d.project,
        line: l,
        speakers: Editor._speakers(),
        submitLabel: l.status === 'pending' ? 'Save & approve' : 'Save',
        compact: true,
        onCancel: () => { Editor._forms.delete(form); Editor.renderLines(); },
        onSubmit: async (row) => {
          const after = l.status === 'pending'
            ? await AdminView.api('/quotes/line/' + encodeURIComponent(l.id) + '/approve', { method: 'POST', body: JSON.stringify({ edits: row }) })
            : await AdminView.api('/quotes/line/' + encodeURIComponent(l.id), { method: 'PATCH', body: JSON.stringify(row) });
          Object.assign(l, after);
          Editor._forms.delete(form);
          Editor.renderChecks();
          Editor.renderLines();
          AdminView.toast('Saved', 'success');
        }
      });
      form.lineId = l.id;
      Editor._forms.add(form);
      Editor._showForm(card, form);
      form.focus();
    },

    _showForm(card, form) {
      card.innerHTML = '';
      card.classList.add('is-editing');
      card.appendChild(form.el);
    },

    async _patch(l, body, okMsg) {
      try {
        const after = await AdminView.api('/quotes/line/' + encodeURIComponent(l.id), { method: 'PATCH', body: JSON.stringify(body) });
        Object.assign(l, after);
        Editor.renderChecks();
        Editor.renderLines();
        AdminView.toast(okMsg, 'success');
      } catch (e) { AdminView.toast(e.message, 'error'); }
    },

    async deleteLine(l) {
      const d = Editor._detail;
      const ok = await confirmDialog({
        title: 'Delete this line?',
        message: `“${l.text.length > 90 ? l.text.slice(0, 90) + '…' : l.text}” is removed from the bank for good. Hide it instead to keep it out of games but on file.`,
        confirmLabel: 'Delete',
        danger: true
      });
      if (!ok) return;
      try {
        await AdminView.api('/quotes/line/' + encodeURIComponent(l.id), { method: 'DELETE' });
        d.lines = d.lines.filter(x => x !== l);
        Editor.renderChecks();
        Editor.renderLines();
        AdminView.toast('Line deleted', 'success');
      } catch (e) { AdminView.toast(e.message, 'error'); }
    },

    renderBoard() {
      const d = Editor._detail;
      const host = Editor._host().querySelector('.qte-board');
      if (!Editor._board.length) {
        host.innerHTML = '<div class="admin-empty">Nobody has finished a game here yet.</div>';
        return;
      }
      host.innerHTML = `
        <div class="admin-list">
          ${Editor._board.map(r => `
            <div class="admin-row" data-user="${esc(r.userId || '')}">
              <span class="scn-rank">${r.rank === 1 ? '🌿' : '#' + r.rank}</span>
              <div class="admin-row-main">
                <span class="admin-username">${esc(r.username)}</span>
                <span class="admin-row-meta">${esc(r.best.toLocaleString())} pts · ${esc(AdminView.formatDate(r.achievedAt))} · ${esc(r.plays)} game${r.plays === 1 ? '' : 's'}</span>
              </div>
              ${r.userId ? '<button type="button" class="admin-btn admin-btn-danger qte-board-del">Remove</button>' : ''}
            </div>`).join('')}
        </div>
        <div class="admin-cms-actions">
          <button type="button" class="admin-btn admin-btn-danger qte-board-reset">Reset this island's board</button>
        </div>`;
      const pid = encodeURIComponent(d.project.id);
      host.querySelectorAll('.qte-board-del').forEach(btn => btn.addEventListener('click', async () => {
        const r = Editor._board.find(x => x.userId === btn.closest('.admin-row').dataset.user);
        const ok = await confirmDialog({
          title: `Remove ${r.username}'s score?`,
          message: `Their best (${r.best.toLocaleString()}) is deleted from this island's board${r.rank === 1 ? ' and the laurels pass to the next player' : ''}. Logged in the audit trail.`,
          confirmLabel: 'Remove',
          danger: true
        });
        if (!ok) return;
        try {
          await AdminView.api(`/quotes/${pid}/board/${encodeURIComponent(r.userId)}`, { method: 'DELETE' });
          Editor._board = (await AdminView.api(`/quotes/${pid}/board`)).items || [];
          Editor.renderBoard();
          AdminView.toast('Score removed', 'success');
        } catch (e) { AdminView.toast(e.message, 'error'); }
      }));
      host.querySelector('.qte-board-reset').addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: `Reset the ${d.project.title} board?`,
          message: 'Every Quote Guess score on this island is deleted and nobody holds the laurels until the next game. Logged in the audit trail.',
          confirmLabel: 'Reset board',
          danger: true
        });
        if (!ok) return;
        try {
          await AdminView.api(`/quotes/${pid}/board`, { method: 'DELETE' });
          Editor._board = [];
          Editor.renderBoard();
          AdminView.toast('Board reset', 'success');
        } catch (e) { AdminView.toast(e.message, 'error'); }
      });
    }
  };

  AdminView._cms.quotes = Editor;
  // Minigames → Quote Guess: its settings card (Config 'quote') over this editor.
  AdminView._tabs['quote-guess'] = AdminView._minigamePane('quote', () => Editor);
})();
