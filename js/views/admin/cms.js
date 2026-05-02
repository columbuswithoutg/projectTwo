/************************************************
 * ADMIN — CMS SHELL (Phase 3)
 * Sub-tabs for projects / characters / locations / dialogues. Each
 * sub-tab is registered on AdminView._cms by its own module file.
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;

  AdminView._cms = AdminView._cms || {};

  const CMS = {
    _activeKey: 'projects',
    _activeSub: null,

    mount(container) {
      container.innerHTML = `
        <div class="admin-cms">
          <div class="admin-subtabs">
            <button class="admin-subtab active" data-cms="projects">Projects</button>
            <button class="admin-subtab" data-cms="characters">Characters</button>
            <button class="admin-subtab" data-cms="locations">Locations</button>
            <button class="admin-subtab" data-cms="dialogues">Dialogues</button>
          </div>
          <div id="admin-cms-host"></div>
        </div>
      `;
      container.querySelectorAll('.admin-subtab').forEach(btn => {
        btn.addEventListener('click', () => {
          container.querySelectorAll('.admin-subtab').forEach(b => b.classList.toggle('active', b === btn));
          CMS._mountSub(btn.dataset.cms);
        });
      });
      CMS._mountSub(CMS._activeKey);
    },

    _mountSub(key) {
      if (CMS._activeSub && CMS._activeSub.unmount) {
        try { CMS._activeSub.unmount(); } catch {}
      }
      CMS._activeKey = key;
      const host = document.getElementById('admin-cms-host');
      host.innerHTML = '';
      const sub = AdminView._cms[key];
      if (sub && typeof sub.mount === 'function') {
        CMS._activeSub = sub;
        sub.mount(host);
      } else {
        host.innerHTML = '<div class="admin-empty">Editor not loaded.</div>';
      }
    },

    unmount() {
      if (CMS._activeSub && CMS._activeSub.unmount) {
        try { CMS._activeSub.unmount(); } catch {}
      }
      CMS._activeSub = null;
    }
  };

  AdminView._tabs.cms = CMS;

  // Shared helpers used by every CMS sub-editor.
  AdminView._cmsListView = function listView(opts) {
    // opts = { items, columns: [{key, label, fmt?}], onPick(item), onAdd(), search?(q) }
    const list = document.createElement('div');
    list.className = 'admin-cms-list';

    const toolbar = document.createElement('div');
    toolbar.className = 'admin-toolbar';
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Filter...';
    search.className = 'admin-input';
    const count = document.createElement('span');
    count.className = 'admin-count';
    const addBtn = document.createElement('button');
    addBtn.className = 'admin-btn';
    addBtn.textContent = '+ Add new';
    addBtn.addEventListener('click', () => opts.onAdd && opts.onAdd());
    toolbar.append(search, count, addBtn);

    const rows = document.createElement('div');
    rows.className = 'admin-list';

    list.append(toolbar, rows);

    function render(filtered) {
      count.textContent = `${filtered.length} of ${opts.items.length}`;
      if (!filtered.length) {
        rows.innerHTML = `<div class="admin-empty">No matches.</div>`;
        return;
      }
      rows.innerHTML = filtered.map(item => `
        <div class="admin-row admin-cms-row" data-id="${esc(item.id || '')}">
          <div class="admin-row-main">
            ${opts.columns.map(c => `<span class="admin-cms-col"><b>${esc(c.label)}:</b> ${esc(c.fmt ? c.fmt(item[c.key], item) : (item[c.key] ?? '—'))}</span>`).join('')}
          </div>
          <button class="admin-btn admin-cms-edit">Edit</button>
        </div>
      `).join('');
      rows.querySelectorAll('.admin-cms-edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.closest('.admin-cms-row').dataset.id;
          const item = opts.items.find(i => (i.id || '') === id);
          if (item && opts.onPick) opts.onPick(item);
        });
      });
    }

    function filterItems() {
      const q = search.value.trim().toLowerCase();
      if (!q) return opts.items;
      return opts.items.filter(item =>
        opts.columns.some(c => {
          const v = c.fmt ? c.fmt(item[c.key], item) : item[c.key];
          return v != null && String(v).toLowerCase().includes(q);
        })
      );
    }

    search.addEventListener('input', () => render(filterItems()));
    render(filterItems());

    return list;
  };

  AdminView._cmsField = function field(label, type, value, opts = {}) {
    // Shared form-field renderer. Returns { wrap, get(), set(v) }.
    const wrap = document.createElement('label');
    wrap.className = 'admin-cms-field';
    wrap.innerHTML = `<span class="admin-cms-flabel">${esc(label)}${opts.required ? ' *' : ''}</span>`;

    let input;
    if (type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = opts.rows || 3;
    } else if (type === 'select') {
      input = document.createElement('select');
      (opts.options || []).forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        input.appendChild(opt);
      });
    } else if (type === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      if (opts.step != null) input.step = opts.step;
    } else {
      input = document.createElement('input');
      input.type = type || 'text';
    }
    input.className = 'admin-cms-input';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.disabled) input.disabled = true;
    if (value != null) input.value = value;

    wrap.appendChild(input);

    const errorEl = document.createElement('span');
    errorEl.className = 'admin-cms-error';
    wrap.appendChild(errorEl);

    return {
      wrap,
      input,
      get() {
        if (type === 'number') return input.value === '' ? null : parseFloat(input.value);
        return input.value;
      },
      set(v) { input.value = v == null ? '' : v; },
      setError(msg) { errorEl.textContent = msg || ''; }
    };
  };
})();
