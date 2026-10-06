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
    _source: 'db',   // 'fallback' = the collection is empty; the site serves projects.js
    _container: null,
    _mode: 'list', // 'list' | 'board'
    _form: null,     // { isDirty() } while a project form is open

    async mount(container) {
      Editor._container = container;
      container.innerHTML = '<div class="admin-empty">Loading projects…</div>';
      try {
        const data = await AdminView.api('/content/projects');
        Editor._items = data.items || [];
        Editor._source = data.source || 'db';
        Editor.render();
      } catch (e) {
        container.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    render() {
      if (!Editor._container) return;
      Editor._form = null;
      Editor._container.innerHTML = '';
      // Board mode uses the full window width.
      const page = Editor._container.closest('.admin-page');
      if (page) page.classList.toggle('is-wide', Editor._mode === 'board');
      if (Editor._source === 'fallback') {
        const note = document.createElement('div');
        note.className = 'admin-cms-banner';
        note.textContent = 'The project database is empty, so the site is showing the built-in list. Your first change copies that list into the database.';
        Editor._container.appendChild(note);
      }
      Editor._container.appendChild(Editor._modeBar());
      const host = document.createElement('div');
      Editor._container.appendChild(host);
      if (Editor._mode === 'board') {
        AdminView._projectsBoard.mount(host, Editor._items);
      } else {
        host.appendChild(Editor._buildList());
      }
    },

    // Router leave guard (AdminView.canLeave).
    isFormDirty() {
      return !!(Editor._form && Editor._form.isDirty());
    },
    forgetForm() {
      Editor._form = null;
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
        btn.addEventListener('click', async () => {
          if (!(await Editor._confirmDiscardForm())) return;
          Editor._mode = btn.dataset.mode;
          Editor.render();
        });
      });
      return bar;
    },

    // An open, edited form asks before it is thrown away.
    async _confirmDiscardForm() {
      if (!Editor.isFormDirty()) return true;
      const ok = await confirmDialog({
        title: 'Discard changes to this project?',
        message: 'Your edits in the form haven’t been saved.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        danger: true
      });
      if (ok) Editor._form = null;
      return ok;
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

    // coords: optional { gridX, gridY } — set when opened from the board (an
    // empty-cell click for a new project). "+ Add new" from the list gets the
    // first free cell below the board instead of (0,0), which could sit on
    // top of another project and block saving the board layout.
    async openForm(item, isNew, coords) {
      if (!(await Editor._confirmDiscardForm())) return;
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

      // Position is owned by the Board tab — shown read-only here so the
      // form still says where the project sits.
      let cell = coords
        ? { gx: coords.gridX, gy: coords.gridY }
        : isNew
          ? ProjectLogic.defaultNewCell(Editor._items)
          : { gx: item.gridX != null ? item.gridX : 0, gy: item.gridY != null ? item.gridY : 0 };
      const posField = AdminView._cmsField('Board position', 'text', `${cell.gx}, ${cell.gy}`, { disabled: true });
      const posHint = document.createElement('p');
      posHint.className = 'admin-cms-hint';
      posHint.textContent = !isNew ? 'Move it on the Board tab.'
        : coords ? 'The empty cell you clicked on the board.'
        : 'The first free cell below the board — drag it into place on the Board tab.';
      posField.wrap.appendChild(posHint);

      // Locations dropdown — fetch from the existing window.LOCATIONS or
      // fall back to a free-text input if locations haven't loaded yet.
      const locOptions = [{ value: '', label: '—' }];
      if (Array.isArray(window.LOCATIONS)) {
        for (const l of window.LOCATIONS) locOptions.push({ value: l.id, label: `${l.label} (${l.id})` });
      }
      const locationField = AdminView._cmsField('Location', 'select', item.location || '', { options: locOptions });
      locationField.set(item.location || '');

      const imageField = AdminView._cmsField('Image filename', 'text', item.image || '', { placeholder: 'e.g. ironman.png' });

      // Prerequisites: chips of only the chosen projects + a search box
      // (js/views/admin/prereq-picker.js). Required ones lock the project;
      // recommended ones are only suggested (dashed road + "optional" list).
      const prereqs = AdminView._prereqField({
        selfId: isNew ? null : item.id,
        items: Editor._items,
        required: item.prerequisites,
        recommended: item.recommendedPrerequisites,
        hidden: item.hiddenPrerequisites,
        onOpen: (p) => Editor.openForm(p, false)
      });

      const runtime = Editor._runtimeFields(item);

      wrap.append(
        idField.wrap, titleField.wrap, releaseField.wrap, phaseField.wrap,
        runtime.wrap,
        posField.wrap, locationField.wrap, imageField.wrap,
        prereqs.wrap
      );

      const actions = document.createElement('div');
      actions.className = 'admin-cms-actions';
      const saveBtn = document.createElement('button');
      saveBtn.className = 'admin-btn';
      saveBtn.textContent = isNew ? 'Create' : 'Save changes';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'admin-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', async () => {
        if (await Editor._confirmDiscardForm()) Editor.render();
      });
      actions.append(saveBtn, cancelBtn);
      if (!isNew) {
        const delBtn = document.createElement('button');
        delBtn.className = 'admin-btn admin-btn-danger';
        delBtn.textContent = 'Delete…';
        delBtn.addEventListener('click', () => Editor.deleteItem(item));
        actions.append(delBtn);
      }
      wrap.appendChild(actions);

      // Everything the form would send — also the basis of the leave guard.
      const collect = () => {
        const rt = runtime.value();
        const lists = prereqs.value();
        return {
          rtError: rt.error || null,
          runtime: rt.runtime,
          episodes: rt.episodes,
          id: idField.get().trim(),
          title: titleField.get().trim(),
          release: releaseField.get().trim(),
          phase: phaseField.get(),
          location: locationField.get(),
          image: imageField.get().trim(),
          prerequisites: lists.required,
          recommendedPrerequisites: lists.recommended
        };
      };
      const snapshot = JSON.stringify(collect());
      Editor._form = { isDirty: () => JSON.stringify(collect()) !== snapshot };
      const titleOf = (id) => ((Editor._items.find(p => p.id === id) || {}).title) || id;

      saveBtn.addEventListener('click', async () => {
        const payload = collect();
        if (payload.rtError) { AdminView.toast(payload.rtError, 'error'); return; }
        delete payload.rtError;
        // Only a brand-new project carries an explicit position. Editing an
        // existing project through this form must NOT send gridX/gridY —
        // routes/admin.js omits absent keys, leaving the board-owned
        // position untouched.
        if (isNew) {
          payload.gridX = cell.gx;
          payload.gridY = cell.gy;
        }
        // Lock loops are refused by the server too; catching them here
        // names the titles before a round trip.
        const edit = Object.assign({}, isNew ? {} : item, payload, { id: payload.id || item.id });
        const loop = ProjectLogic.findPrereqCycle(Editor._items, edit,
          { phaseUnlockers: typeof PHASE_UNLOCKERS !== 'undefined' ? PHASE_UNLOCKERS : undefined });
        if (loop) {
          prereqs.showProblem({ cycle: loop.map(s => s.id) });
          AdminView.toast(ProjectLogic.errorText({ code: 'cycle', path: loop }, titleOf), 'error');
          return;
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
          Editor._form = null;
          await Editor.refresh();
        } catch (e) {
          if (e.status === 409 && e.body && e.body.suggested) {
            cell = { gx: e.body.suggested.gridX, gy: e.body.suggested.gridY };
            posField.set(`${cell.gx}, ${cell.gy}`);
            posHint.textContent = 'That cell was taken — moved to the nearest free one. Press Create again.';
          }
          if (e.body) prereqs.showProblem(e.body);
          AdminView.toast(e.message, 'error');
          saveBtn.disabled = false;
        }
      });

      Editor._container.innerHTML = '';
      Editor._container.appendChild(wrap);
      wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    async deleteItem(item) {
      const linked = Editor._items
        .filter(p => p.id !== item.id && ['prerequisites', 'recommendedPrerequisites', 'hiddenPrerequisites']
          .some(k => (p[k] || []).includes(item.id)))
        .map(p => p.title || p.id);
      const ok = await confirmDialog({
        title: `Permanently delete project "${item.id}"?`,
        message: linked.length
          ? `It is removed from the prerequisites of: ${linked.join(', ')} — they no longer wait on it.`
          : 'No other project lists it as a prerequisite.',
        confirmLabel: 'Delete',
        danger: true
      });
      if (!ok) return;
      try {
        await AdminView.api('/content/projects/' + encodeURIComponent(item.id), { method: 'DELETE' });
        AdminView.toast('Project deleted', 'success');
        Editor._form = null;
        await Editor.refresh();
      } catch (e) {
        AdminView.toast(e.message, 'error');
      }
    },

    // Adopt a fresh item list already fetched by the caller (the board's
    // bulk-save response returns the authoritative post-write list) so we
    // don't need a second GET round trip. Unsaved board moves survive a form
    // save or delete; the board's own save passes { keepMoves: false }.
    adoptItems(items, opts) {
      Editor._items = items || [];
      if (AdminView._projectsBoard && AdminView._projectsBoard.reseed) {
        AdminView._projectsBoard.reseed(Editor._items, !(opts && opts.keepMoves === false));
      }
      Editor.render();
    },

    async refresh() {
      const data = await AdminView.api('/content/projects');
      Editor._source = data.source || 'db';
      Editor.adoptItems(data.items || []);
    },

    unmount() {
      if (AdminView._projectsBoard && AdminView._projectsBoard.unmount) {
        AdminView._projectsBoard.unmount();
      }
      const page = Editor._container && Editor._container.closest('.admin-page');
      if (page) page.classList.remove('is-wide');
      Editor._form = null;
      Editor._container = null;
    }
  };

  AdminView._cms.projects = Editor;
})();
