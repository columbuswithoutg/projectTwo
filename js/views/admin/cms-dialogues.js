/************************************************
 * ADMIN — CMS DIALOGUES EDITOR
 *
 * Three sections in one editor (the dialogue model is a singleton doc):
 *   - pairs                — character-pair conversations
 *   - villainDefeatLines   — lines shown when villain HP hits zero
 *   - villainVictoryLines  — lines shown when villain wins
 *
 * Pair keys are "id1|id2" with ids in alphabetical order — the runtime
 * (walker-dialogues.js getKey) sorts before lookup, so admin entries
 * with non-canonical order would silently never trigger.
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;

  // Same values as DIALOG_LINES_MAX / DIALOG_LINE_MAX in
  // server/admin-sanitize.js, which refuses anything longer — so it is
  // blocked here before sending.
  const LINES_MAX = 12;
  const LINE_MAX = 600;
  // Lines of one exchange / one villain → the problem in words, or ''.
  function linesProblem(lines) {
    if (lines.length > LINES_MAX) return `${lines.length} lines — at most ${LINES_MAX}.`;
    const i = lines.findIndex(l => l.length > LINE_MAX);
    return i >= 0 ? `Line ${i + 1} is ${lines[i].length} characters — at most ${LINE_MAX}.` : '';
  }
  const linesOf = (text) => text.split('\n').map(l => l.trim()).filter(l => l);
  // Live "n/12 lines" under a textarea, plus the problem if there is one.
  function showLineCount(countEl, errEl, lines) {
    countEl.textContent = `${lines.length}/${LINES_MAX} lines`;
    errEl.textContent = linesProblem(lines);
  }

  const Editor = {
    _data: { pairs: {}, villainDefeatLines: {}, villainVictoryLines: {} },
    _projects: [],
    _characters: [],
    _container: null,
    _section: 'pairs',
    // JSON of _data as last loaded/saved. Apply on a pair only edits _data
    // locally ("Save all" persists), so an applied-but-unsaved pair is real
    // unsaved work and must hold the sub-tab / tab / router guards.
    _saved: null,
    _pairForm: null,   // { isDirty() } while a pair form is open

    // ctx (index.js): sub = the section (pairs | defeat | victory), kept in
    // the address so a reload lands on it.
    async mount(container, ctx) {
      Editor._container = container;
      Editor._ctx = ctx || null;
      Editor._section = ctx && ['pairs', 'defeat', 'victory'].includes(ctx.sub) ? ctx.sub : 'pairs';
      container.innerHTML = '<div class="admin-empty">Loading dialogues…</div>';
      try {
        const [d, p, c] = await Promise.all([
          AdminView.api('/content/dialogues'),
          AdminView.api('/content/projects'),
          AdminView.api('/content/characters')
        ]);
        Editor._data = {
          pairs: d.pairs || {},
          villainDefeatLines: d.villainDefeatLines || {},
          villainVictoryLines: d.villainVictoryLines || {}
        };
        Editor._saved = JSON.stringify(Editor._data);
        Editor._projects = p.items || [];
        Editor._characters = c.items || [];
        Editor.renderShell();
      } catch (e) {
        container.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    renderShell() {
      Editor._container.innerHTML = `
        <div class="admin-cms-dialogues">
          <div class="admin-subnav">
            <div class="admin-subtabs" role="tablist" aria-label="Dialogue sections">
              <button class="admin-subtab" role="tab" data-sec="pairs">Pair conversations (${Object.keys(Editor._data.pairs).length})</button>
              <button class="admin-subtab" role="tab" data-sec="defeat">Villain defeat lines (${Object.keys(Editor._data.villainDefeatLines).length})</button>
              <button class="admin-subtab" role="tab" data-sec="victory">Villain victory lines (${Object.keys(Editor._data.villainVictoryLines).length})</button>
            </div>
            <div class="admin-subnav-save">
              <span class="admin-subnav-note">One save covers all three sections — switching sections keeps your edits.</span>
              <button class="admin-btn admin-btn-primary" id="admin-dialog-save">Save all</button>
            </div>
          </div>
          <div id="admin-cms-dialog-host"></div>
        </div>
      `;
      const subtabs = Editor._container.querySelectorAll('.admin-subtab');
      const LABEL = { pairs: 'Pair conversations', defeat: 'Villain defeat lines', victory: 'Villain victory lines' };
      const setActive = (sec) => {
        Editor._section = sec;
        subtabs.forEach(b => {
          b.classList.toggle('active', b.dataset.sec === sec);
          b.setAttribute('aria-selected', b.dataset.sec === sec ? 'true' : 'false');
        });
        if (Editor._ctx) {
          Editor._ctx.sync({ sub: sec === 'pairs' ? '' : sec });
          Editor._ctx.crumbs([{ label: LABEL[sec] }]);
        }
        if (sec === 'pairs') Editor.renderPairs();
        else if (sec === 'defeat') Editor.renderVillainLines('villainDefeatLines');
        else if (sec === 'victory') Editor.renderVillainLines('villainVictoryLines');
      };
      subtabs.forEach(b => b.addEventListener('click', () => setActive(b.dataset.sec)));
      setActive(Editor._section || 'pairs');

      document.getElementById('admin-dialog-save').addEventListener('click', Editor.save);
    },

    // Guards (cms.js, index.js): edits applied to _data but not saved, or an
    // open pair form with unapplied changes.
    isDirty() {
      return !!((Editor._saved !== null && JSON.stringify(Editor._data) !== Editor._saved) ||
                (Editor._pairForm && Editor._pairForm.isDirty()));
    },
    discard() {
      // The next mount() reloads from the server; just stop reporting.
      Editor._saved = null;
      Editor._pairForm = null;
    },

    renderPairs() {
      Editor._pairForm = null;
      const host = document.getElementById('admin-cms-dialog-host');
      const keys = Object.keys(Editor._data.pairs).sort();
      host.innerHTML = `
        <div class="admin-toolbar">
          <input id="admin-dialog-pair-search" type="text" placeholder="Filter pairs..." class="admin-input" />
          <button id="admin-dialog-pair-add" class="admin-btn">+ Add pair</button>
        </div>
        <div id="admin-dialog-pair-list" class="admin-list"></div>
      `;
      const search = document.getElementById('admin-dialog-pair-search');
      const list = document.getElementById('admin-dialog-pair-list');

      function renderList() {
        const q = search.value.trim().toLowerCase();
        const filtered = keys.filter(k => !q || k.toLowerCase().includes(q));
        if (!filtered.length) {
          list.innerHTML = '<div class="admin-empty">No pairs match.</div>';
          return;
        }
        list.innerHTML = filtered.map(k => `
          <div class="admin-row" data-key="${esc(k)}">
            <div class="admin-row-main">
              <span class="admin-username">${esc(k)}</span>
              <span class="admin-row-meta">${Editor._data.pairs[k].length} exchange${Editor._data.pairs[k].length === 1 ? '' : 's'}</span>
            </div>
            <button class="admin-btn admin-dialog-pair-edit">Edit</button>
            <button class="admin-btn admin-btn-danger admin-dialog-pair-del">Delete</button>
          </div>
        `).join('');
        list.querySelectorAll('.admin-dialog-pair-edit').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const key = e.target.closest('.admin-row').dataset.key;
            Editor.openPairForm(key);
          });
        });
        list.querySelectorAll('.admin-dialog-pair-del').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const key = e.target.closest('.admin-row').dataset.key;
            const ok = await confirmDialog({
              title: `Delete all exchanges for "${key}"?`,
              confirmLabel: 'Delete',
              danger: true
            });
            if (!ok) return;
            delete Editor._data.pairs[key];
            keys.splice(keys.indexOf(key), 1);
            renderList();
            AdminView.toast('Pair deleted (remember to Save)', 'info');
          });
        });
      }
      search.addEventListener('input', renderList);
      document.getElementById('admin-dialog-pair-add').addEventListener('click', () => Editor.openPairForm(null));
      renderList();
    },

    canonicalKey(a, b) {
      return [a, b].sort().join('|');
    },

    openPairForm(existingKey) {
      const host = document.getElementById('admin-cms-dialog-host');
      const isNew = !existingKey;
      const exchanges = isNew ? [] : JSON.parse(JSON.stringify(Editor._data.pairs[existingKey] || []));
      let charA = '', charB = '';
      if (existingKey) [charA, charB] = existingKey.split('|');

      const wrap = document.createElement('div');
      wrap.className = 'admin-cms-form';
      wrap.innerHTML = `<h3 class="admin-h3">${isNew ? 'New pair conversation' : 'Edit ' + esc(existingKey)}</h3>`;

      const charOptions = [{ value: '', label: '—' }, ...Editor._characters.map(c => ({ value: c.id, label: `${c.id} — ${c.name}` }))];

      const charAField = AdminView._cmsField('Character A', 'select', charA, { options: charOptions, disabled: !isNew });
      charAField.set(charA);
      const charBField = AdminView._cmsField('Character B', 'select', charB, { options: charOptions, disabled: !isNew });
      charBField.set(charB);
      wrap.append(charAField.wrap, charBField.wrap);

      const exWrap = document.createElement('div');
      exWrap.className = 'admin-cms-stages';
      exWrap.innerHTML = '<span class="admin-cms-flabel">Exchanges (each is a separate conversation that triggers when its required project is watched)</span>';
      const exList = document.createElement('div');
      exWrap.appendChild(exList);
      wrap.appendChild(exWrap);

      const projOptions = [{ value: '', label: '—' }, ...Editor._projects.map(p => ({ value: p.id, label: `${p.id} — ${p.title}` }))];

      // "Starts with" offers the pair's two characters — refilled when
      // Character A / B change, so a new pair can pick one before Apply.
      let startSels = [];
      function fillStarts(startsSel, ex) {
        const a = charAField.get(), b = charBField.get();
        if (ex.startsWith && ex.startsWith !== a && ex.startsWith !== b) delete ex.startsWith;
        startsSel.innerHTML = '';
        const startOpts = [{ value: '', label: 'auto (alphabetical)' }];
        if (a) startOpts.push({ value: a, label: a });
        if (b && b !== a) startOpts.push({ value: b, label: b });
        startOpts.forEach(o => {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = 'Starts with: ' + o.label;
          if (o.value === (ex.startsWith || '')) opt.selected = true;
          startsSel.appendChild(opt);
        });
      }
      const refillStarts = () => startSels.forEach(s => fillStarts(s.sel, exchanges[s.idx]));
      charAField.input.addEventListener('change', refillStarts);
      charBField.input.addEventListener('change', refillStarts);

      function renderExchanges() {
        exList.innerHTML = '';
        startSels = [];
        exchanges.forEach((ex, idx) => {
          const row = document.createElement('div');
          row.className = 'admin-cms-exchange';

          const reqSel = document.createElement('select');
          reqSel.className = 'admin-cms-input';
          projOptions.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            if (o.value === ex.requires) opt.selected = true;
            reqSel.appendChild(opt);
          });
          reqSel.addEventListener('change', () => { exchanges[idx].requires = reqSel.value; });

          const startsSel = document.createElement('select');
          startsSel.className = 'admin-cms-input';
          fillStarts(startsSel, ex);
          startSels.push({ sel: startsSel, idx });
          startsSel.addEventListener('change', () => {
            if (startsSel.value) exchanges[idx].startsWith = startsSel.value;
            else delete exchanges[idx].startsWith;
          });

          const linesArea = document.createElement('textarea');
          linesArea.className = 'admin-cms-input';
          linesArea.rows = Math.max(3, (ex.lines || []).length);
          linesArea.placeholder = 'One line per row, alternating speakers';
          linesArea.value = (ex.lines || []).join('\n');
          const countEl = document.createElement('p');
          countEl.className = 'admin-cms-hint';
          const errEl = document.createElement('span');
          errEl.className = 'admin-cms-error';
          showLineCount(countEl, errEl, ex.lines || []);
          linesArea.addEventListener('input', () => {
            exchanges[idx].lines = linesOf(linesArea.value);
            showLineCount(countEl, errEl, exchanges[idx].lines);
          });

          const removeBtn = document.createElement('button');
          removeBtn.className = 'admin-btn admin-btn-danger';
          removeBtn.textContent = 'Remove exchange';
          removeBtn.addEventListener('click', () => {
            exchanges.splice(idx, 1);
            renderExchanges();
          });

          row.append(reqSel, startsSel, linesArea, countEl, errEl, removeBtn);
          exList.appendChild(row);
        });
        const addBtn = document.createElement('button');
        addBtn.className = 'admin-btn';
        addBtn.textContent = '+ Add exchange';
        addBtn.addEventListener('click', () => {
          exchanges.push({ requires: '', lines: [] });
          renderExchanges();
        });
        exList.appendChild(addBtn);
      }
      renderExchanges();

      const collect = () => JSON.stringify({ a: charAField.get(), b: charBField.get(), exchanges });
      const snapshot = collect();
      Editor._pairForm = { isDirty: () => collect() !== snapshot, apply: () => applyBtn.click() };

      const actions = document.createElement('div');
      actions.className = 'admin-cms-actions';
      const applyBtn = document.createElement('button');
      applyBtn.className = 'admin-btn';
      applyBtn.textContent = isNew ? 'Apply (then Save all)' : 'Apply changes';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'admin-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => Editor.renderPairs());
      actions.append(applyBtn, cancelBtn);
      wrap.appendChild(actions);

      applyBtn.addEventListener('click', () => {
        const a = charAField.get();
        const b = charBField.get();
        if (!a || !b || a === b) {
          AdminView.toast('Pick two different characters', 'error');
          return;
        }
        const key = Editor.canonicalKey(a, b);
        if (isNew && Editor._data.pairs[key]) {
          AdminView.toast('That pair already exists — edit it instead', 'error');
          return;
        }
        // Too long is refused, not cut short by the server (the message
        // is already under the exchange's textarea).
        const tooLong = exchanges.findIndex(e => linesProblem(e.lines || []));
        if (tooLong >= 0) {
          AdminView.toast(`Exchange ${tooLong + 1}: ${linesProblem(exchanges[tooLong].lines)}`, 'error');
          return;
        }
        const cleaned = exchanges.filter(e => e.requires && Array.isArray(e.lines) && e.lines.length >= 2);
        if (!cleaned.length) {
          AdminView.toast('At least one exchange with a project + 2+ lines is required', 'error');
          return;
        }
        if (existingKey && existingKey !== key) delete Editor._data.pairs[existingKey];
        Editor._data.pairs[key] = cleaned;
        AdminView.toast('Pair updated locally — Save all to persist', 'info');
        Editor.renderPairs();
      });

      host.innerHTML = '';
      host.appendChild(wrap);
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    renderVillainLines(field) {
      Editor._pairForm = null;
      const host = document.getElementById('admin-cms-dialog-host');
      const data = Editor._data[field];
      const villainIds = Object.keys(data).sort();
      host.innerHTML = `
        <div class="admin-toolbar">
          <input id="admin-dialog-villain-add-id" type="text" placeholder="villain id (e.g. thanos)" class="admin-input" />
          <button id="admin-dialog-villain-add" class="admin-btn">+ Add villain</button>
        </div>
        <div id="admin-dialog-villain-list" class="admin-list"></div>
      `;

      const list = document.getElementById('admin-dialog-villain-list');
      function renderList() {
        list.innerHTML = villainIds.map(id => `
          <div class="admin-cms-villain" data-id="${esc(id)}">
            <div class="admin-cms-villain-head">
              <b>${esc(id)}</b>
              <button class="admin-btn admin-btn-danger admin-villain-del" data-id="${esc(id)}">Delete</button>
            </div>
            <textarea class="admin-cms-input admin-villain-lines" data-id="${esc(id)}" rows="${Math.max(3, data[id].length)}" placeholder="No lines yet — type one line per row (a villain with none is not saved)">${esc(data[id].join('\n'))}</textarea>
            <p class="admin-cms-hint"></p>
            <span class="admin-cms-error"></span>
          </div>
        `).join('') || '<div class="admin-empty">No villain lines yet.</div>';

        list.querySelectorAll('.admin-villain-lines').forEach(area => {
          const countEl = area.parentElement.querySelector('.admin-cms-hint');
          const errEl = area.parentElement.querySelector('.admin-cms-error');
          showLineCount(countEl, errEl, linesOf(area.value));
          area.addEventListener('input', () => {
            const id = area.dataset.id;
            data[id] = linesOf(area.value);
            showLineCount(countEl, errEl, data[id]);
          });
        });
        list.querySelectorAll('.admin-villain-del').forEach(btn => {
          btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const ok = await confirmDialog({
              title: `Delete all ${field === 'villainDefeatLines' ? 'defeat' : 'victory'} lines for "${id}"?`,
              confirmLabel: 'Delete',
              danger: true
            });
            if (!ok) return;
            delete data[id];
            villainIds.splice(villainIds.indexOf(id), 1);
            renderList();
          });
        });
      }
      renderList();

      document.getElementById('admin-dialog-villain-add').addEventListener('click', () => {
        const idInput = document.getElementById('admin-dialog-villain-add-id');
        const id = (idInput.value || '').trim();
        if (!/^[a-z0-9_-]{1,80}$/i.test(id)) {
          AdminView.toast('Villain id must match [a-z0-9_-]', 'error');
          return;
        }
        if (data[id]) {
          AdminView.toast('That villain id already exists', 'error');
          return;
        }
        data[id] = [];   // not [''] — an untouched villain would save one blank line
        villainIds.push(id);
        villainIds.sort();
        idInput.value = '';
        renderList();
      });
    },

    save: async function () {
      // An open pair form with edits is applied first (Save bar / Save all);
      // if Apply refused it (a toast says why), nothing is sent.
      if (Editor._pairForm && Editor._pairForm.isDirty() && Editor._pairForm.apply) {
        Editor._pairForm.apply();
        if (Editor._pairForm && Editor._pairForm.isDirty()) return;
      }
      const btn = document.getElementById('admin-dialog-save');
      // Blank villain lines play as empty bubbles in-game (the server keeps
      // them), and too many / too long ones would be cut — drop the former,
      // refuse the latter.
      const payload = { pairs: Editor._data.pairs };
      for (const [field, name] of [['villainDefeatLines', 'Defeat'], ['villainVictoryLines', 'Victory']]) {
        payload[field] = {};
        for (const [id, lines] of Object.entries(Editor._data[field])) {
          const kept = (Array.isArray(lines) ? lines : []).map(l => String(l).trim()).filter(l => l);
          const problem = linesProblem(kept);
          if (problem) {
            AdminView.toast(`${name} lines for "${id}": ${problem}`, 'error');
            return;
          }
          payload[field][id] = kept;
        }
      }
      btn.disabled = true;
      try {
        const updated = await AdminView.api('/content/dialogues', {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        Editor._data = {
          pairs: updated.pairs || {},
          villainDefeatLines: updated.villainDefeatLines || {},
          villainVictoryLines: updated.villainVictoryLines || {}
        };
        Editor._saved = JSON.stringify(Editor._data);
        AdminView.toast('Dialogues saved. Refresh /map to see changes.', 'success');
        Editor.renderShell();
      } catch (e) {
        AdminView.toast(e.message, 'error');
        btn.disabled = false;
      }
    },

    unmount() {
      Editor._pairForm = null;
      Editor._container = null;
      Editor._ctx = null;
    }
  };

  AdminView._cms.dialogues = Editor;
})();
