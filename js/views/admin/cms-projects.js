/************************************************
 * ADMIN — CMS PROJECTS EDITOR
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;
  const PHASES = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5', 'Phase 6'];

  const Editor = {
    _items: [],
    _container: null,

    async mount(container) {
      Editor._container = container;
      container.innerHTML = '<div class="admin-empty">Loading projects…</div>';
      try {
        const data = await AdminView.api('/content/projects');
        Editor._items = data.items || [];
        Editor.renderList();
      } catch (e) {
        container.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    renderList() {
      Editor._container.innerHTML = '';
      const list = AdminView._cmsListView({
        items: Editor._items,
        columns: [
          { key: 'id', label: 'ID' },
          { key: 'title', label: 'Title' },
          { key: 'release', label: 'Release' },
          { key: 'phase', label: 'Phase' }
        ],
        onPick: (item) => Editor.openForm(item, false),
        onAdd: () => Editor.openForm({}, true)
      });
      Editor._container.appendChild(list);
    },

    openForm(item, isNew) {
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
      const gridXField = AdminView._cmsField('Grid X', 'number', item.gridX != null ? item.gridX : 0);
      const gridYField = AdminView._cmsField('Grid Y', 'number', item.gridY != null ? item.gridY : 0);

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

      wrap.append(
        idField.wrap, titleField.wrap, releaseField.wrap, phaseField.wrap,
        gridXField.wrap, gridYField.wrap, locationField.wrap, imageField.wrap,
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
      cancelBtn.addEventListener('click', () => Editor.renderList());
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
        const payload = {
          id: idField.get().trim(),
          title: titleField.get().trim(),
          release: releaseField.get().trim(),
          phase: phaseField.get(),
          gridX: gridXField.get(),
          gridY: gridYField.get(),
          location: locationField.get(),
          image: imageField.get().trim(),
          prerequisites: Array.from(prereqSelect.selectedOptions).map(o => o.value)
        };
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
      if (!window.confirm(`Permanently delete project "${item.id}"? Anything that lists it as a prerequisite will silently lose that link.`)) return;
      try {
        await AdminView.api('/content/projects/' + encodeURIComponent(item.id), { method: 'DELETE' });
        AdminView.toast('Project deleted', 'success');
        await Editor.refresh();
      } catch (e) {
        AdminView.toast(e.message, 'error');
      }
    },

    async refresh() {
      const data = await AdminView.api('/content/projects');
      Editor._items = data.items || [];
      Editor.renderList();
    },

    unmount() {
      Editor._container = null;
    }
  };

  AdminView._cms.projects = Editor;
})();
