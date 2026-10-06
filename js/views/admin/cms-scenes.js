/************************************************
 * ADMIN — CMS SCENE STILLS (Scene Guess minigame)
 *
 * Per project: upload stills and type the moment each one happens, as shown
 * on the Disney+ player (series: pick the episode too). An island's game
 * switches on once it has SceneGuessLogic.C.MIN_POOL active stills. Also the
 * island's board (top scores) with remove / reset.
 *
 * Server: routes/admin-scenes.js (/api/admin/scenes/…). Times are checked
 * here with the same SceneGuessLogic the server uses, so a typo shows up
 * before anything is uploaded.
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;
  const L = () => window.SceneGuessLogic;
  const NEAR_S = 5;   // warn when two stills are this close on the line

  // POST one still, retrying while the admin rate limiter (60/min) says 429
  // — a long batch can run into it.
  async function uploadWithRetry(projectId, item, onProgress) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await uploadStill(projectId, item, onProgress);
      } catch (e) {
        if (e.status !== 429 || attempt >= 5) throw e;
        await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
      }
    }
  }

  // POST one still: the time/episode fields go BEFORE the file so the server
  // can refuse a bad time before uploading anything (see admin-scenes.js).
  function uploadStill(projectId, item, onProgress) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append('time', item.time.trim());
      if (item.episode != null) fd.append('episode', String(item.episode));
      fd.append('file', item.file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API}/admin/scenes/${encodeURIComponent(projectId)}`);
      xhr.setRequestHeader('Authorization', `Bearer ${Auth.getToken()}`);
      xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) onProgress(ev.loaded / ev.total); };
      xhr.onload = () => {
        let json = {};
        try { json = JSON.parse(xhr.responseText || '{}'); } catch {}
        if (xhr.status >= 200 && xhr.status < 300 && json.id) return resolve(json);
        const err = new Error(json.error || (xhr.status === 429 ? 'Too many requests — retrying…' : `Upload failed (HTTP ${xhr.status})`));
        err.status = xhr.status;
        reject(err);
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(fd);
    });
  }

  let _seq = 0;

  const Editor = {
    _container: null,
    _items: [],
    _minPool: 10,
    _detail: null,      // { project, timeline, stills, minPool, maxBytes }
    _board: [],
    _pending: [],       // [{ key, file, url, time, episode, state: 'ready'|'uploading'|'error', error, progress }]
    _uploading: false,

    async mount(container) {
      Editor._container = container;
      Editor._detail = null;
      container.innerHTML = '<div class="admin-empty">Loading projects…</div>';
      try {
        const res = await AdminView.api('/scenes/summary');
        Editor._items = res.items || [];
        Editor._minPool = res.minPool || 10;
        Editor._globalEnabled = !!res.globalEnabled;
        Editor.renderList();
      } catch (e) {
        container.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    unmount() {
      Editor._clearPending();
      Editor._detail = null;
    },

    _clearPending() {
      for (const p of Editor._pending) { try { URL.revokeObjectURL(p.url); } catch {} }
      Editor._pending = [];
    },

    renderList() {
      const c = Editor._container;
      c.innerHTML = '';
      const help = document.createElement('p');
      help.className = 'admin-config-help';
      help.innerHTML = `Add stills for the <b>Scene Guess</b> minigame. Type each still's time <b>as shown on the Disney+ player</b>.
        An island shows the game only when <b>you switch it on</b> here and it has <b>${Editor._minPool}</b> active stills
        (more stills mean games repeat less). Islands that are off show nothing at all.`;
      const min = Editor._minPool;
      const list = AdminView._cmsListView({
        items: Editor._items,
        columns: [
          { key: 'title', label: 'Project' },
          { key: 'kind', label: 'Type', fmt: (v, it) => v === 'series' ? `Series · ${it.episodes} ep` : (v === 'movie' ? 'Movie' : 'No runtime') },
          { key: 'active', label: 'Stills', fmt: (v, it) => it.stills === v ? String(v) : `${v} active / ${it.stills}` },
          { key: 'enabled', label: 'Island', fmt: (v, it) => Editor._statusText(it, min) }
        ],
        onPick: (item) => Editor.openProject(item.id)
      });
      // Nothing to "add" here — projects come from CMS → Projects.
      const addBtn = list.querySelector('.admin-toolbar .admin-btn');
      if (addBtn) addBtn.remove();
      c.append(Editor._globalBanner(), help, list);
      // Mark live / ready rows so they read at a glance.
      list.querySelectorAll('.admin-cms-row').forEach(row => {
        const it = Editor._items.find(i => i.id === row.dataset.id);
        if (it && it.enabled && it.playable) row.classList.add('scn-row-playable');
      });
    },

    // "Scene Guess is off for everyone" — shown on both pages while the
    // master switch (Config) is off; islands can still be prepared.
    _globalBanner() {
      const el = document.createElement('div');
      el.className = 'scn-banner' + (Editor._globalEnabled ? ' is-on' : '');
      el.innerHTML = Editor._globalEnabled
        ? '<b>Scene Guess is ON for players.</b> Only islands switched on below (with enough stills) show the game.'
        : '<b>Scene Guess is OFF for everyone</b> — players see no trace of it. Prepare islands here, then turn it on in <b>Config → Scene Guess minigame enabled</b>.';
      return el;
    },

    _statusText(it, min) {
      const need = Math.max(0, min - it.active);
      if (!it.enabled) return need ? `Off · needs ${need} more stills` : 'Off · ready to switch on';
      if (need) return `On · waiting for ${need} more stills`;
      return Editor._globalEnabled ? 'Live' : 'On · live when the game is switched on';
    },

    async openProject(id) {
      const c = Editor._container;
      Editor._clearPending();
      c.innerHTML = '<div class="admin-empty">Loading stills…</div>';
      try {
        const [detail, board] = await Promise.all([
          AdminView.api('/scenes/' + encodeURIComponent(id)),
          AdminView.api('/scenes/' + encodeURIComponent(id) + '/board')
        ]);
        Editor._detail = detail;
        Editor._board = board.items || [];
        Editor._globalEnabled = !!detail.globalEnabled;
        Editor.renderProject();
      } catch (e) {
        c.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    // ── project page ────────────────────────────────────────────────────

    renderProject() {
      const d = Editor._detail;
      const tl = d.timeline;
      const c = Editor._container;
      const active = d.stills.filter(s => s.active).length;
      const playable = active >= d.minPool;
      const lengthText = !tl ? 'No runtime set — add one in CMS → Projects first.'
        : tl.kind === 'series'
          ? `Series · ${tl.segments.length} episodes (${tl.segments.map(s => `${s.label} ${Math.round(s.len / 60)}m`).join(' · ')})`
          : `Movie · ${L().formatTime(tl.total)}`;

      c.innerHTML = `
        <div class="scn">
          <div class="scn-head">
            <button type="button" class="admin-btn scn-back">← All projects</button>
            <div class="scn-title">
              <h3 class="admin-h3">${esc(d.project.title)}</h3>
              <span class="scn-sub">${esc(lengthText)}</span>
            </div>
            <span class="scn-status ${playable ? 'is-on' : ''}">${playable ? 'Playable' : `${active}/${d.minPool} stills`}</span>
          </div>
          <label class="scn-switch">
            <input type="checkbox" class="scn-island" ${d.enabled ? 'checked' : ''} ${tl ? '' : 'disabled'}>
            <span class="scn-switch-main">Show the game on this island</span>
            <span class="scn-switch-sub"></span>
          </label>
          ${tl ? '<div class="scn-strip" aria-hidden="true"></div>' : ''}
          ${tl ? `
          <div class="scn-add">
            <label class="scn-drop" tabindex="0">
              <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>
              <span class="scn-drop-main">Drop screenshots here or <u>choose files</u></span>
              <span class="scn-drop-sub">JPG, PNG or WebP · max ${Math.round(d.maxBytes / 1024 / 1024)} MB each · then type each one's time${tl.kind === 'series' ? ' and episode' : ''}</span>
            </label>
            <div class="scn-pending"></div>
          </div>` : ''}
          <h3 class="admin-h3">Stills (${d.stills.length})</h3>
          <div class="scn-grid scn-saved"></div>
          <h3 class="admin-h3">Island board</h3>
          <div class="scn-board"></div>
        </div>
      `;
      c.querySelector('.scn').prepend(Editor._globalBanner());
      c.querySelector('.scn-back').addEventListener('click', () => { Editor._clearPending(); Editor.mount(c); });
      const sw = c.querySelector('.scn-island');
      sw.addEventListener('change', async () => {
        sw.disabled = true;
        try {
          const r = await AdminView.api('/scenes/' + encodeURIComponent(d.project.id) + '/island', { method: 'PUT', body: JSON.stringify({ enabled: sw.checked }) });
          d.enabled = !!r.enabled;
          const row = Editor._items.find(i => i.id === d.project.id);
          if (row) row.enabled = d.enabled;
          AdminView.toast(d.enabled ? 'Switched on for this island' : 'Switched off — the island shows nothing', 'success');
        } catch (e) {
          sw.checked = !sw.checked;
          AdminView.toast(e.message, 'error');
        } finally {
          sw.disabled = false;
          Editor._refreshCounts();
        }
      });
      if (tl) {
        const drop = c.querySelector('.scn-drop');
        const input = drop.querySelector('input');
        input.addEventListener('change', () => { Editor.addFiles(input.files); input.value = ''; });
        drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
        drop.addEventListener('drop', (e) => {
          e.preventDefault();
          drop.classList.remove('is-over');
          if (e.dataTransfer && e.dataTransfer.files) Editor.addFiles(e.dataTransfer.files);
        });
      }
      Editor.renderStrip();
      Editor.renderPending();
      Editor.renderSaved();
      Editor.renderBoard();
      Editor._refreshCounts();
    },

    // The whole line with a tick per still (episode boundaries on a series).
    renderStrip() {
      const d = Editor._detail, tl = d.timeline;
      const el = Editor._container.querySelector('.scn-strip');
      if (!el || !tl) return;
      const pct = (at) => (100 * at / tl.total).toFixed(3) + '%';
      const segs = tl.kind === 'series'
        ? tl.segments.map(s => `<span class="scn-strip-seg" style="left:${pct(s.start)};width:${pct(s.len)}"><em>${esc(s.label)}</em></span>`).join('')
        : L().ticks(tl).map(t => `<span class="scn-strip-tick" style="left:${pct(t.at)}"><em>${esc(t.label)}</em></span>`).join('');
      const dots = d.stills.map(s => `<span class="scn-strip-dot${s.active ? '' : ' is-off'}" style="left:${pct(s.at)}" title="${esc(s.label)}"></span>`).join('');
      el.innerHTML = `<div class="scn-strip-line">${segs}${dots}</div>`;
    },

    // Times already taken (saved stills + other pending ones) for the
    // "close to another still" warning.
    _nearOther(at, selfKey) {
      const d = Editor._detail;
      if (d.stills.some(s => Math.abs(s.at - at) <= NEAR_S)) return true;
      return Editor._pending.some(p => p.key !== selfKey && p.at != null && Math.abs(p.at - at) <= NEAR_S);
    },

    // Validate one pending item's fields → sets p.at / p.error.
    _check(p) {
      const tl = Editor._detail.timeline;
      const t = L().parseTime(p.time);
      if (!p.time.trim()) { p.at = null; p.error = ''; return false; }
      if (t == null) { p.at = null; p.error = 'Use h:mm:ss, m:ss or seconds'; return false; }
      const ep = tl.kind === 'series' ? p.episode : null;
      if (tl.kind === 'series' && ep == null) { p.at = null; p.error = 'Pick the episode'; return false; }
      const v = L().validStill(tl, { timeSec: t, episode: ep });
      if (!v.ok) { p.at = null; p.error = v.error; return false; }
      p.at = L().toGlobal(tl, ep, t);
      p.error = '';
      return true;
    },

    addFiles(fileList) {
      const d = Editor._detail;
      for (const file of Array.from(fileList || [])) {
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { AdminView.toast(`${file.name}: images only (JPG, PNG, WebP)`, 'error'); continue; }
        if (file.size > d.maxBytes) { AdminView.toast(`${file.name}: too large`, 'error'); continue; }
        Editor._pending.push({ key: ++_seq, file, url: URL.createObjectURL(file), time: '', episode: null, at: null, state: 'ready', error: '', progress: 0 });
      }
      Editor.renderPending();
      const first = Editor._container.querySelector('.scn-pending .scn-time');
      if (first) first.focus();
    },

    renderPending() {
      const host = Editor._container.querySelector('.scn-pending');
      if (!host) return;
      const tl = Editor._detail.timeline;
      if (!Editor._pending.length) { host.innerHTML = ''; return; }
      const epOptions = (sel) => tl.kind === 'series'
        ? `<select class="admin-cms-input scn-ep" aria-label="Episode">
             <option value="">Episode…</option>
             ${tl.segments.map((s, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(s.label)} (${Math.round(s.len / 60)}m)</option>`).join('')}
           </select>`
        : '';
      host.innerHTML = `
        <div class="scn-grid">
          ${Editor._pending.map(p => `
            <figure class="scn-card scn-card-pending ${p.state === 'error' ? 'is-error' : ''}" data-key="${p.key}">
              <img src="${esc(p.url)}" alt="">
              <figcaption>
                <div class="scn-fields">
                  ${epOptions(p.episode)}
                  <input class="admin-cms-input scn-time" type="text" inputmode="numeric" placeholder="1:02:13"
                    value="${esc(p.time)}" aria-label="Time on Disney+ (h:mm:ss)" ${p.state === 'uploading' ? 'disabled' : ''}>
                  <button type="button" class="admin-btn scn-drop-one" aria-label="Remove" ${p.state === 'uploading' ? 'disabled' : ''}>✕</button>
                </div>
                <span class="scn-hint"></span>
                ${p.state === 'uploading' ? `<span class="scn-progress"><span style="width:${Math.round(p.progress * 100)}%"></span></span>` : ''}
              </figcaption>
            </figure>`).join('')}
        </div>
        <div class="admin-cms-actions">
          <button type="button" class="admin-btn scn-upload-all" ${Editor._uploading ? 'disabled' : ''}>Upload ${Editor._pending.length} still${Editor._pending.length === 1 ? '' : 's'}</button>
          <button type="button" class="admin-btn admin-btn-danger scn-clear" ${Editor._uploading ? 'disabled' : ''}>Discard all</button>
        </div>
      `;
      host.querySelectorAll('.scn-card-pending').forEach(card => {
        const p = Editor._pending.find(x => x.key === +card.dataset.key);
        const time = card.querySelector('.scn-time');
        const ep = card.querySelector('.scn-ep');
        const hint = card.querySelector('.scn-hint');
        const show = () => {
          const ok = Editor._check(p);
          hint.classList.toggle('is-bad', !!p.error);
          hint.classList.toggle('is-warn', ok && Editor._nearOther(p.at, p.key));
          hint.textContent = p.error || (ok
            ? (L().formatGuess(tl, p.at) + (Editor._nearOther(p.at, p.key) ? ' · close to another still' : ''))
            : (p.state === 'error' ? '' : (tl.kind === 'series' ? 'Episode + time' : 'Time on Disney+')));
          if (p.state === 'error' && p.uploadError) { hint.textContent = p.uploadError; hint.classList.add('is-bad'); }
        };
        time.addEventListener('input', () => { p.time = time.value; p.state = p.state === 'error' ? 'ready' : p.state; p.uploadError = ''; show(); });
        time.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const all = [...host.querySelectorAll('.scn-time')];
          const next = all[all.indexOf(time) + 1];
          if (next) next.focus(); else host.querySelector('.scn-upload-all').focus();
        });
        if (ep) ep.addEventListener('change', () => { p.episode = ep.value === '' ? null : parseInt(ep.value, 10); show(); });
        card.querySelector('.scn-drop-one').addEventListener('click', () => {
          URL.revokeObjectURL(p.url);
          Editor._pending = Editor._pending.filter(x => x !== p);
          Editor.renderPending();
        });
        show();
      });
      host.querySelector('.scn-upload-all').addEventListener('click', Editor.uploadAll);
      host.querySelector('.scn-clear').addEventListener('click', () => { Editor._clearPending(); Editor.renderPending(); });
    },

    async uploadAll() {
      if (Editor._uploading) return;
      const d = Editor._detail;
      const bad = Editor._pending.filter(p => !Editor._check(p));
      if (bad.length) {
        Editor.renderPending();
        AdminView.toast(`${bad.length} still${bad.length === 1 ? ' needs' : 's need'} a valid ${d.timeline.kind === 'series' ? 'episode and time' : 'time'}`, 'error');
        return;
      }
      Editor._uploading = true;
      let done = 0;
      for (const p of Editor._pending.slice()) {
        p.state = 'uploading';
        p.progress = 0;
        Editor.renderPending();
        const card = () => Editor._container.querySelector(`.scn-card-pending[data-key="${p.key}"] .scn-progress span`);
        try {
          const saved = await uploadWithRetry(d.project.id, p, (f) => {
            p.progress = f;
            const bar = card();
            if (bar) bar.style.width = Math.round(f * 100) + '%';
          });
          URL.revokeObjectURL(p.url);
          Editor._pending = Editor._pending.filter(x => x !== p);
          d.stills.push(saved);
          d.stills.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
          done++;
        } catch (e) {
          p.state = 'error';
          p.uploadError = e.message;
        }
      }
      Editor._uploading = false;
      Editor._refreshCounts();
      Editor.renderPending();
      Editor.renderSaved();
      Editor.renderStrip();
      if (done) AdminView.toast(`Uploaded ${done} still${done === 1 ? '' : 's'}`, 'success');
    },

    // Keep the header chip + the list counts in step after changes.
    _refreshCounts() {
      const d = Editor._detail;
      const active = d.stills.filter(s => s.active).length;
      const chip = Editor._container.querySelector('.scn-status');
      if (chip) {
        chip.classList.toggle('is-on', active >= d.minPool);
        chip.textContent = active >= d.minPool ? 'Playable' : `${active}/${d.minPool} stills`;
      }
      const h = Editor._container.querySelectorAll('.scn > .admin-h3')[0];
      if (h) h.textContent = `Stills (${d.stills.length})`;
      const row = Editor._items.find(i => i.id === d.project.id);
      if (row) {
        row.stills = d.stills.length;
        row.active = active;
        row.playable = active >= d.minPool;
      }
      const sub = Editor._container.querySelector('.scn-switch-sub');
      if (sub) {
        sub.textContent = Editor._statusText({ enabled: d.enabled, active }, d.minPool);
        sub.closest('.scn-switch').classList.toggle('is-live', d.enabled && active >= d.minPool && Editor._globalEnabled);
      }
    },

    renderSaved() {
      const d = Editor._detail, tl = d.timeline;
      const host = Editor._container.querySelector('.scn-saved');
      if (!host) return;
      if (!d.stills.length) {
        host.innerHTML = '<div class="admin-empty">No stills yet.</div>';
        return;
      }
      host.innerHTML = d.stills.map(s => {
        const near = d.stills.some(o => o !== s && Math.abs(o.at - s.at) <= NEAR_S);
        return `
          <figure class="scn-card ${s.active ? '' : 'is-off'}" data-id="${esc(s.id)}">
            <img src="${esc(s.imageUrl)}" alt="" loading="lazy">
            <figcaption>
              <div class="scn-saved-row">
                <b class="scn-label">${esc(s.label)}</b>
                ${near ? '<span class="scn-tag is-warn" title="Within 5 seconds of another still">close</span>' : ''}
                ${s.valid === false ? '<span class="scn-tag is-bad" title="Past the end of the runtime / episode — never drawn until fixed">out of range</span>' : ''}
                ${s.active ? '' : '<span class="scn-tag">hidden</span>'}
              </div>
              <div class="scn-edit" hidden>
                ${tl && tl.kind === 'series' ? `<select class="admin-cms-input scn-ep" aria-label="Episode">${tl.segments.map((g, i) => `<option value="${i}" ${s.episode === i ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select>` : ''}
                <input class="admin-cms-input scn-time" type="text" value="${esc(L().formatTime(s.timeSec))}" aria-label="Time">
                <button type="button" class="admin-btn scn-save">Save</button>
                <button type="button" class="admin-btn scn-cancel">Cancel</button>
              </div>
              <div class="scn-actions">
                <button type="button" class="admin-btn scn-edit-btn">Edit time</button>
                <label class="scn-active"><input type="checkbox" ${s.active ? 'checked' : ''}> In the game</label>
                <button type="button" class="admin-btn admin-btn-danger scn-del">Delete</button>
              </div>
            </figcaption>
          </figure>`;
      }).join('');

      host.querySelectorAll('.scn-card').forEach(card => {
        const s = d.stills.find(x => x.id === card.dataset.id);
        const edit = card.querySelector('.scn-edit');
        const actions = card.querySelector('.scn-actions');
        card.querySelector('.scn-edit-btn').addEventListener('click', () => {
          edit.hidden = false;
          actions.hidden = true;
          edit.querySelector('.scn-time').focus();
        });
        card.querySelector('.scn-cancel').addEventListener('click', () => { edit.hidden = true; actions.hidden = false; });
        const save = async () => {
          const body = { time: edit.querySelector('.scn-time').value.trim() };
          const ep = edit.querySelector('.scn-ep');
          if (ep) body.episode = parseInt(ep.value, 10);
          try {
            const after = await AdminView.api('/scenes/still/' + encodeURIComponent(s.id), { method: 'PATCH', body: JSON.stringify(body) });
            Object.assign(s, after);
            d.stills.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
            Editor.renderSaved();
            Editor.renderStrip();
            AdminView.toast('Time updated', 'success');
          } catch (e) { AdminView.toast(e.message, 'error'); }
        };
        card.querySelector('.scn-save').addEventListener('click', save);
        edit.querySelector('.scn-time').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') { edit.hidden = true; actions.hidden = false; } });
        const activeBox = card.querySelector('.scn-active input');
        activeBox.addEventListener('change', async () => {
          try {
            const after = await AdminView.api('/scenes/still/' + encodeURIComponent(s.id), { method: 'PATCH', body: JSON.stringify({ active: activeBox.checked }) });
            Object.assign(s, after);
            Editor._refreshCounts();
            Editor.renderSaved();
            Editor.renderStrip();
          } catch (e) {
            activeBox.checked = !activeBox.checked;
            AdminView.toast(e.message, 'error');
          }
        });
        card.querySelector('.scn-del').addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: 'Delete this still?',
            message: `The ${s.label} still is removed from the game and its image is deleted. This can't be undone.`,
            confirmLabel: 'Delete',
            danger: true
          });
          if (!ok) return;
          try {
            await AdminView.api('/scenes/still/' + encodeURIComponent(s.id), { method: 'DELETE' });
            d.stills = d.stills.filter(x => x !== s);
            Editor._refreshCounts();
            Editor.renderSaved();
            Editor.renderStrip();
            AdminView.toast('Still deleted', 'success');
          } catch (e) { AdminView.toast(e.message, 'error'); }
        });
      });
    },

    renderBoard() {
      const d = Editor._detail;
      const host = Editor._container.querySelector('.scn-board');
      if (!host) return;
      if (!Editor._board.length) {
        host.innerHTML = '<div class="admin-empty">Nobody has finished a game here yet.</div>';
        return;
      }
      host.innerHTML = `
        <div class="admin-list">
          ${Editor._board.map(r => `
            <div class="admin-row" data-user="${esc(r.userId || '')}">
              <span class="scn-rank">${r.rank === 1 ? '👑' : '#' + r.rank}</span>
              <div class="admin-row-main">
                <span class="admin-username">${esc(r.username)}</span>
                <span class="admin-row-meta">${esc(r.best.toLocaleString())} pts · ${esc(AdminView.formatDate(r.achievedAt))} · ${esc(r.plays)} game${r.plays === 1 ? '' : 's'}</span>
              </div>
              ${r.userId ? '<button type="button" class="admin-btn admin-btn-danger scn-board-del">Remove</button>' : ''}
            </div>`).join('')}
        </div>
        <div class="admin-cms-actions">
          <button type="button" class="admin-btn admin-btn-danger scn-board-reset">Reset this island's board</button>
        </div>
      `;
      const pid = encodeURIComponent(d.project.id);
      host.querySelectorAll('.scn-board-del').forEach(btn => {
        btn.addEventListener('click', async () => {
          const row = btn.closest('.admin-row');
          const r = Editor._board.find(x => x.userId === row.dataset.user);
          const ok = await confirmDialog({
            title: `Remove ${r.username}'s score?`,
            message: `Their best (${r.best.toLocaleString()}) is deleted from this island's board${r.rank === 1 ? ' and the crown passes to the next player' : ''}. Logged in the audit trail.`,
            confirmLabel: 'Remove',
            danger: true
          });
          if (!ok) return;
          try {
            await AdminView.api(`/scenes/${pid}/board/${encodeURIComponent(r.userId)}`, { method: 'DELETE' });
            const board = await AdminView.api(`/scenes/${pid}/board`);
            Editor._board = board.items || [];
            Editor.renderBoard();
            AdminView.toast('Score removed', 'success');
          } catch (e) { AdminView.toast(e.message, 'error'); }
        });
      });
      host.querySelector('.scn-board-reset').addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: `Reset the ${d.project.title} board?`,
          message: 'Every score on this island is deleted and nobody holds the crown until the next game. Logged in the audit trail.',
          confirmLabel: 'Reset board',
          danger: true
        });
        if (!ok) return;
        try {
          await AdminView.api(`/scenes/${pid}/board`, { method: 'DELETE' });
          Editor._board = [];
          Editor.renderBoard();
          AdminView.toast('Board reset', 'success');
        } catch (e) { AdminView.toast(e.message, 'error'); }
      });
    }
  };

  AdminView._cms.scenes = Editor;
})();
