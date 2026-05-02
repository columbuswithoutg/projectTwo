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

  const Editor = {
    _data: { pairs: {}, villainDefeatLines: {}, villainVictoryLines: {} },
    _projects: [],
    _characters: [],
    _container: null,
    _section: 'pairs',

    async mount(container) {
      Editor._container = container;
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
          <div class="admin-subtabs">
            <button class="admin-subtab" data-sec="pairs">Pair conversations (${Object.keys(Editor._data.pairs).length})</button>
            <button class="admin-subtab" data-sec="defeat">Villain defeat lines (${Object.keys(Editor._data.villainDefeatLines).length})</button>
            <button class="admin-subtab" data-sec="victory">Villain victory lines (${Object.keys(Editor._data.villainVictoryLines).length})</button>
          </div>
          <p class="admin-config-help">All three sections share one save action — your edits apply on Save below.</p>
          <div id="admin-cms-dialog-host"></div>
          <div class="admin-cms-actions">
            <button class="admin-btn" id="admin-dialog-save">Save all dialogue changes</button>
          </div>
        </div>
      `;
      const subtabs = Editor._container.querySelectorAll('.admin-subtab');
      const setActive = (sec) => {
        Editor._section = sec;
        subtabs.forEach(b => b.classList.toggle('active', b.dataset.sec === sec));
        if (sec === 'pairs') Editor.renderPairs();
        else if (sec === 'defeat') Editor.renderVillainLines('villainDefeatLines');
        else if (sec === 'victory') Editor.renderVillainLines('villainVictoryLines');
      };
      subtabs.forEach(b => b.addEventListener('click', () => setActive(b.dataset.sec)));
      setActive('pairs');

      document.getElementById('admin-dialog-save').addEventListener('click', Editor.save);
    },

    renderPairs() {
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
          btn.addEventListener('click', (e) => {
            const key = e.target.closest('.admin-row').dataset.key;
            if (!window.confirm(`Delete all exchanges for "${key}"?`)) return;
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

      function renderExchanges() {
        exList.innerHTML = '';
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
          const startOpts = [{ value: '', label: 'auto (alphabetical)' }];
          if (charAField.get()) startOpts.push({ value: charAField.get(), label: charAField.get() });
          if (charBField.get()) startOpts.push({ value: charBField.get(), label: charBField.get() });
          startOpts.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = 'Starts with: ' + o.label;
            if (o.value === (ex.startsWith || '')) opt.selected = true;
            startsSel.appendChild(opt);
          });
          startsSel.addEventListener('change', () => {
            if (startsSel.value) exchanges[idx].startsWith = startsSel.value;
            else delete exchanges[idx].startsWith;
          });

          const linesArea = document.createElement('textarea');
          linesArea.className = 'admin-cms-input';
          linesArea.rows = Math.max(3, (ex.lines || []).length);
          linesArea.placeholder = 'One line per row, alternating speakers';
          linesArea.value = (ex.lines || []).join('\n');
          linesArea.addEventListener('input', () => {
            exchanges[idx].lines = linesArea.value.split('\n').map(l => l.trim()).filter(l => l);
          });

          const removeBtn = document.createElement('button');
          removeBtn.className = 'admin-btn admin-btn-danger';
          removeBtn.textContent = 'Remove exchange';
          removeBtn.addEventListener('click', () => {
            exchanges.splice(idx, 1);
            renderExchanges();
          });

          row.append(reqSel, startsSel, linesArea, removeBtn);
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

      const actions = document.createElement('div');
      actions.className = 'admin-cms-actions';
      const applyBtn = document.createElement('button');
      applyBtn.className = 'admin-btn';
      applyBtn.textContent = isNew ? 'Apply (Save below to persist)' : 'Apply changes';
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
        const cleaned = exchanges.filter(e => e.requires && Array.isArray(e.lines) && e.lines.length >= 2);
        if (!cleaned.length) {
          AdminView.toast('At least one exchange with a project + 2+ lines is required', 'error');
          return;
        }
        if (existingKey && existingKey !== key) delete Editor._data.pairs[existingKey];
        Editor._data.pairs[key] = cleaned;
        AdminView.toast('Pair updated locally — click Save All below to persist', 'info');
        Editor.renderPairs();
      });

      host.innerHTML = '';
      host.appendChild(wrap);
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    renderVillainLines(field) {
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
            <textarea class="admin-cms-input admin-villain-lines" data-id="${esc(id)}" rows="${Math.max(3, data[id].length)}" placeholder="One line per row">${esc(data[id].join('\n'))}</textarea>
          </div>
        `).join('') || '<div class="admin-empty">No villain lines yet.</div>';

        list.querySelectorAll('.admin-villain-lines').forEach(area => {
          area.addEventListener('input', () => {
            const id = area.dataset.id;
            data[id] = area.value.split('\n').map(l => l.trim()).filter(l => l);
          });
        });
        list.querySelectorAll('.admin-villain-del').forEach(btn => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            if (!window.confirm(`Delete all ${field === 'villainDefeatLines' ? 'defeat' : 'victory'} lines for "${id}"?`)) return;
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
        data[id] = [''];
        villainIds.push(id);
        villainIds.sort();
        idInput.value = '';
        renderList();
      });
    },

    save: async function () {
      const btn = document.getElementById('admin-dialog-save');
      btn.disabled = true;
      try {
        const updated = await AdminView.api('/content/dialogues', {
          method: 'PUT',
          body: JSON.stringify(Editor._data)
        });
        Editor._data = {
          pairs: updated.pairs || {},
          villainDefeatLines: updated.villainDefeatLines || {},
          villainVictoryLines: updated.villainVictoryLines || {}
        };
        AdminView.toast('Dialogues saved. Refresh /map to see changes.', 'success');
        Editor.renderShell();
      } catch (e) {
        AdminView.toast(e.message, 'error');
        btn.disabled = false;
      }
    },

    unmount() {
      Editor._container = null;
    }
  };

  AdminView._cms.dialogues = Editor;
})();
