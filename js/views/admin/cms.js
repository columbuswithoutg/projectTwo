/************************************************
 * ADMIN — CMS HELPERS
 * Shared list / field / id / error helpers for the Content editors
 * (cms-*.js). The old CMS sub-tab shell is gone: each editor is its own
 * sidebar entry in js/views/admin/index.js (ADMIN_NAV).
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;

  AdminView._cms = AdminView._cms || {};

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

    if (opts.hint) {
      const hint = document.createElement('p');
      hint.className = 'admin-cms-hint';
      hint.textContent = opts.hint;
      wrap.appendChild(hint);
    }

    const errorEl = document.createElement('span');
    errorEl.className = 'admin-cms-error';
    wrap.appendChild(errorEl);
    // A field error describes the value that was rejected — editing it
    // makes the message stale, so it goes away on the next keystroke.
    input.addEventListener('input', () => { errorEl.textContent = ''; });
    input.addEventListener('change', () => { errorEl.textContent = ''; });

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

  // The id rule routes/admin.js enforces (ID_REGEX, shared via
  // ProjectLogic) in words, shown under every "ID (slug)" field.
  AdminView._cmsIdHint = 'Letters, digits, - and _ only (no spaces), up to 80 characters. It can’t be changed later.';

  // Client pre-check of a new item's id, so a bad slug is named on the field
  // instead of coming back from the server as a bare "Validation failed".
  AdminView._cmsCheckId = function checkId(field) {
    if (ProjectLogic.ID_REGEX.test(String(field.get() || '').trim())) return true;
    field.setError(AdminView._cmsIdHint);
    field.input.focus();
    return false;
  };

  // A 400 from a content save carries { error, fields: { name: message } }
  // (badRequest() in routes/admin.js). Put each message under its field —
  // `byName` maps the server's field names to _cmsField handles — and
  // clear the others. Returns how many fields got a message, so the caller
  // can still toast a summary. The server's words are terse codes
  // ('invalid id', 'required', 'duplicate'); spell them out.
  AdminView._cmsApplyFieldErrors = function applyFieldErrors(byName, e) {
    const fields = (e && e.body && e.body.fields && typeof e.body.fields === 'object') ? e.body.fields : {};
    let shown = 0;
    for (const [name, f] of Object.entries(byName)) {
      if (!f) continue;
      const raw = fields[name];
      if (raw == null) { f.setError(''); continue; }
      const msg = raw === 'invalid id' ? AdminView._cmsIdHint
        : raw === 'required' ? 'Required.'
        : raw === 'duplicate' ? (e.message || 'Already in use.')
        : String(raw);
      f.setError(msg);
      shown++;
    }
    return shown;
  };
})();
