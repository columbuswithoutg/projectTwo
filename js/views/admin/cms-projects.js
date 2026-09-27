/************************************************
 * ADMIN — CMS PROJECTS EDITOR
 *
 * Two modes on one tab: the plain filterable List (unchanged CRUD form),
 * and a visual Board (js/views/admin/cms-projects-board.js) for dragging
 * project nodes to a gridX/gridY cell instead of typing blind numbers.
 * The board owns position; the form only shows it read-only and only
 * sends coordinates when creating a brand-new project from an empty cell.
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;
  const PHASES = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5', 'Phase 6'];

  const Editor = {
    _items: [],
    _container: null,
    _mode: 'list', // 'list' | 'board'

    async mount(container) {
      Editor._container = container;
      container.innerHTML = '<div class="admin-empty">Loading projects…</div>';
      try {
        const data = await AdminView.api('/content/projects');
        Editor._items = data.items || [];
        Editor.render();
      } catch (e) {
        container.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    render() {
      Editor._container.innerHTML = '';
      Editor._container.appendChild(Editor._modeBar());
      const host = document.createElement('div');
      Editor._container.appendChild(host);
      if (Editor._mode === 'board') {
        AdminView._projectsBoard.mount(host, Editor._items);
      } else {
        host.appendChild(Editor._buildList());
      }
    },

    _modeBar() {
      const bar = document.createElement('div');
      bar.className = 'admin-cms-modes';
      const dirty = AdminView._projectsBoard && AdminView._projectsBoard.isDirty && AdminView._projectsBoard.isDirty();
      bar.innerHTML = `
        <button type="button" class="admin-cms-mode${Editor._mode === 'list' ? ' active' : ''}" data-mode="list">List</button>
        <button type="button" class="admin-cms-mode${Editor._mode === 'board' ? ' active' : ''}" data-mode="board">Board${dirty ? ' <span class="admin-board-badge" title="Unsaved moves"></span>' : ''}</button>
      `;
      bar.querySelectorAll('.admin-cms-mode').forEach(btn => {
        btn.addEventListener('click', () => {
          Editor._mode = btn.dataset.mode;
          Editor.render();
        });
      });
      return bar;
    },

    _buildList() {
      return AdminView._cmsListView({
        items: Editor._items,
        columns: [
          { key: 'id', label: 'ID' },
          { key: 'title', label: 'Title' },
          { key: 'release', label: 'Release' },
          { key: 'phase', label: 'Phase' },
          { key: 'runtime', label: 'Runtime', fmt: (_, item) => Editor._runtimeSummary(item) }
        ],
        onPick: (item) => Editor.openForm(item, false),
        onAdd: () => Editor.openForm({}, true)
      });
    },

    // "2h 6m" / "13 eps · 11h 55m" / "not set" — the watch-timer length.
    _runtimeSummary(item) {
      const eps = Array.isArray(item.episodes) ? item.episodes.filter(n => n > 0) : [];
      if (eps.length) {
        const total = eps.reduce((a, b) => a + b, 0);
        return `${eps.length} eps · ${WatchControls.fmtRuntime(total)}`;
      }
      return item.runtime > 0 ? WatchControls.fmtRuntime(item.runtime) : '⚠ not set';
    },

    // "53, 55, 51" → [53, 55, 51]; null if any entry isn't a positive number.
    _parseEpisodes(text) {
      const parts = String(text || '').split(/[\s,;]+/).filter(Boolean);
      const nums = parts.map(Number);
      if (nums.some(n => !Number.isFinite(n) || n <= 0 || n > 600)) return null;
      return nums.map(Math.round);
    },

    // Movie runtime / series episode runtimes. Drives the Start watching →
    // Mark as watched timer (server/watchRules.js), so it's worth a
    // dedicated block rather than two bare inputs.
    _runtimeFields(item) {
      const eps = Array.isArray(item.episodes) ? item.episodes : [];
      const isSeries = eps.length > 0;

      const box = document.createElement('fieldset');
      box.className = 'admin-cms-runtime';
      box.innerHTML = '<legend class="admin-cms-flabel">Watch runtime</legend>';

      const typeField = AdminView._cmsField('Type', 'select', isSeries ? 'series' : 'movie', {
        options: [{ value: 'movie', label: 'Movie / special' }, { value: 'series', label: 'Series (per episode)' }]
      });
      typeField.set(isSeries ? 'series' : 'movie');
      const runtimeField = AdminView._cmsField('Runtime (minutes)', 'number', item.runtime > 0 ? item.runtime : '', {
        placeholder: 'e.g. 126', step: 1
      });
      runtimeField.input.min = '1';
      runtimeField.input.max = '600';
      const epsField = AdminView._cmsField('Episode runtimes (minutes, in order)', 'textarea', eps.join(', '), {
        placeholder: 'e.g. 53, 55, 51, 55', rows: 3
      });
      const summary = document.createElement('p');
      summary.className = 'admin-cms-hint';

      const sync = () => {
        const series = typeField.get() === 'series';
        runtimeField.wrap.hidden = series;
        epsField.wrap.hidden = !series;
        if (series) {
          const parsed = Editor._parseEpisodes(epsField.get());
          summary.textContent = parsed === null
            ? 'Use positive numbers separated by commas.'
            : parsed.length
              ? `${parsed.length} episode${parsed.length !== 1 ? 's' : ''} · ${WatchControls.fmtRuntime(parsed.reduce((a, b) => a + b, 0))} total. Each episode unlocks "Mark as watched" at its runtime minus credits (10%, 2–10 min).`
              : 'Add one runtime per episode.';
        } else {
          const n = Number(runtimeField.get());
          summary.textContent = n > 0
            ? `"Mark as watched" unlocks ${WatchControls.fmtRuntime(Math.round(state.requiredMinutes({ runtime: Math.round(n) })))} after "Start watching" (runtime minus skippable credits).`
            : 'Without a runtime, "Mark as watched" unlocks immediately.';
        }
      };
      [typeField.input, runtimeField.input, epsField.input].forEach(el => el.addEventListener('input', sync));
      typeField.input.addEventListener('change', sync);
      sync();

      box.append(typeField.wrap, runtimeField.wrap, epsField.wrap, summary);
      return {
        wrap: box,
        // → { runtime, episodes } or { error }
        value() {
          if (typeField.get() === 'series') {
            const parsed = Editor._parseEpisodes(epsField.get());
            if (!parsed || !parsed.length) return { error: 'Enter at least one episode runtime (positive minutes).' };
            return { runtime: 0, episodes: parsed };
          }
          const raw = String(runtimeField.get()).trim();
          const n = raw === '' ? 0 : Number(raw);
          if (!Number.isFinite(n) || n < 0 || n > 600) return { error: 'Runtime must be between 1 and 600 minutes.' };
          return { runtime: Math.round(n), episodes: [] };
        }
      };
    },

    // coords: optional { gridX, gridY } — set when opened from the board
    // (an empty-cell click for a new project, or unused for an existing one
    // whose position already lives in item.gridX/gridY).
    openForm(item, isNew, coords) {
      const wrap = document.createElement('div');
      wrap.className = 'admin-cms-form';

      const idField = AdminView._cmsField('ID (slug)', 'text', item.id || '', {
        placeholder: 'e.g. ironman1',
        disabled: !isNew,
        required: true
      });
      const titleField = AdminView._cmsField('Title', 'text', item.title || '', { required: true });
      const releaseField = AdminView._cmsField('Release date', 'text', item.release || '', { placeholder: 'YYYY-MM-DD' });
      const phaseField = AdminView._cmsField('Phase', 'select', item.phase || '', {
        options: [{ value: '', label: '—' }, ...PHASES.map(p => ({ value: p, label: p }))]
      });
      phaseField.set(item.phase || '');

      // Position is owned by the Board tab now — show it read-only here so
      // the form still communicates where the project sits, without letting
      // an admin blind-edit a coordinate they can't see the result of.
      const gx = coords ? coords.gridX : (item.gridX != null ? item.gridX : 0);
      const gy = coords ? coords.gridY : (item.gridY != null ? item.gridY : 0);
      const posField = AdminView._cmsField('Board position', 'text', `${gx}, ${gy}`, {
        disabled: true,
        placeholder: coords ? '' : 'Set on the Board tab'
      });

      // Locations dropdown — fetch from the existing window.LOCATIONS or
      // fall back to a free-text input if locations haven't loaded yet.
      const locOptions = [{ value: '', label: '—' }];
      if (Array.isArray(window.LOCATIONS)) {
        for (const l of window.LOCATIONS) locOptions.push({ value: l.id, label: `${l.label} (${l.id})` });
      }
      const locationField = AdminView._cmsField('Location', 'select', item.location || '', { options: locOptions });
      locationField.set(item.location || '');

      const imageField = AdminView._cmsField('Image filename', 'text', item.image || '', { placeholder: 'e.g. ironman.png' });

      // Prerequisites: render as a multi-select of existing project IDs.
      const prereqWrap = document.createElement('label');
      prereqWrap.className = 'admin-cms-field';
      prereqWrap.innerHTML = '<span class="admin-cms-flabel">Prerequisites</span>';
      const prereqSelect = document.createElement('select');
      prereqSelect.multiple = true;
      prereqSelect.className = 'admin-cms-input admin-cms-multi';
      prereqSelect.size = Math.min(8, Math.max(3, Editor._items.length));
      Editor._items.forEach(p => {
        if (p.id === item.id) return; // can't depend on self
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.id} — ${p.title}`;
        if (Array.isArray(item.prerequisites) && item.prerequisites.includes(p.id)) opt.selected = true;
        prereqSelect.appendChild(opt);
      });
      prereqWrap.appendChild(prereqSelect);

      const runtime = Editor._runtimeFields(item);

      wrap.append(
        idField.wrap, titleField.wrap, releaseField.wrap, phaseField.wrap,
        runtime.wrap,
        posField.wrap, locationField.wrap, imageField.wrap,
        prereqWrap
      );

      const actions = document.createElement('div');
      actions.className = 'admin-cms-actions';
      const saveBtn = document.createElement('button');
      saveBtn.className = 'admin-btn';
      saveBtn.textContent = isNew ? 'Create' : 'Save changes';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'admin-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => Editor.render());
      actions.append(saveBtn, cancelBtn);
      if (!isNew) {
        const delBtn = document.createElement('button');
        delBtn.className = 'admin-btn admin-btn-danger';
        delBtn.textContent = 'Delete…';
        delBtn.addEventListener('click', () => Editor.deleteItem(item));
        actions.append(delBtn);
      }
      wrap.appendChild(actions);

      saveBtn.addEventListener('click', async () => {
        const rt = runtime.value();
        if (rt.error) { AdminView.toast(rt.error, 'error'); return; }
        const payload = {
          runtime: rt.runtime,
          episodes: rt.episodes,
          id: idField.get().trim(),
          title: titleField.get().trim(),
          release: releaseField.get().trim(),
          phase: phaseField.get(),
          location: locationField.get(),
          image: imageField.get().trim(),
          prerequisites: Array.from(prereqSelect.selectedOptions).map(o => o.value)
        };
        // Only a brand-new project (placed via an empty-cell click on the
        // board) carries an explicit position. Editing an existing project
        // through this form must NOT send gridX/gridY — routes/admin.js
        // omits absent keys, leaving the board-owned position untouched.
        if (isNew) {
          payload.gridX = gx;
          payload.gridY = gy;
        }
        saveBtn.disabled = true;
        try {
          if (isNew) {
            await AdminView.api('/content/projects', { method: 'POST', body: JSON.stringify(payload) });
            AdminView.toast('Project created', 'success');
          } else {
            await AdminView.api('/content/projects/' + encodeURIComponent(item.id), { method: 'PUT', body: JSON.stringify(payload) });
            AdminView.toast('Project saved', 'success');
          }
          await Editor.refresh();
        } catch (e) {
          AdminView.toast(e.message, 'error');
          saveBtn.disabled = false;
        }
      });

      Editor._container.innerHTML = '';
      Editor._container.appendChild(wrap);
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    async deleteItem(item) {
      const ok = await confirmDialog({
        title: `Permanently delete project "${item.id}"?`,
        message: 'Anything that lists it as a prerequisite will silently lose that link.',
        confirmLabel: 'Delete',
        danger: true
      });
      if (!ok) return;
      try {
        await AdminView.api('/content/projects/' + encodeURIComponent(item.id), { method: 'DELETE' });
        AdminView.toast('Project deleted', 'success');
        await Editor.refresh();
      } catch (e) {
        AdminView.toast(e.message, 'error');
      }
    },

    // Adopt a fresh item list already fetched by the caller (the board's
    // bulk-save response returns the authoritative post-write list) so we
    // don't need a second GET round trip.
    adoptItems(items) {
      Editor._items = items || [];
      if (AdminView._projectsBoard && AdminView._projectsBoard.reseed) {
        AdminView._projectsBoard.reseed(Editor._items, false);
      }
      Editor.render();
    },

    async refresh() {
      const data = await AdminView.api('/content/projects');
      Editor.adoptItems(data.items || []);
    },

    unmount() {
      if (AdminView._projectsBoard && AdminView._projectsBoard.unmount) {
        AdminView._projectsBoard.unmount();
      }
      Editor._container = null;
    }
  };

  AdminView._cms.projects = Editor;
})();
