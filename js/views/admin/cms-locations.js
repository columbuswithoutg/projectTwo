/************************************************
 * ADMIN — CMS LOCATIONS EDITOR
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;

  const Editor = {
    _items: [],
    _container: null,
    _form: null,     // { isDirty() } while a location form is open

    async mount(container) {
      Editor._container = container;
      container.innerHTML = '<div class="admin-empty">Loading locations…</div>';
      try {
        const data = await AdminView.api('/content/locations');
        Editor._items = data.items || [];
        Editor.renderList();
      } catch (e) {
        container.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    renderList() {
      Editor._form = null;
      Editor._container.innerHTML = '';
      const list = AdminView._cmsListView({
        items: Editor._items,
        columns: [
          { key: 'id', label: 'ID' },
          { key: 'label', label: 'Label' },
          { key: 'region', label: 'Region' },
          { key: 'worldX', label: 'X', fmt: (v, item) => `${v}, ${item.worldY}` }
        ],
        onPick: (item) => Editor.openForm(item, false),
        onAdd: () => Editor.openForm({}, true)
      });
      Editor._container.appendChild(list);
    },

    // CMS sub-tab / admin tab / router leave guards (cms.js, index.js): an
    // open form whose fields differ from what it opened with.
    isDirty() {
      return !!(Editor._form && Editor._form.isDirty());
    },
    discard() {
      Editor._form = null;
    },

    openForm(item, isNew) {
      const wrap = document.createElement('div');
      wrap.className = 'admin-cms-form';

      const idField = AdminView._cmsField('ID (slug)', 'text', item.id || '', { disabled: !isNew, required: true, placeholder: 'e.g. nyc', hint: isNew ? AdminView._cmsIdHint : '' });
      const labelField = AdminView._cmsField('Label', 'text', item.label || '', { required: true });
      const worldXField = AdminView._cmsField('World X', 'number', item.worldX != null ? item.worldX : 0);
      const worldYField = AdminView._cmsField('World Y', 'number', item.worldY != null ? item.worldY : 0);
      const widthField = AdminView._cmsField('Width', 'number', item.width != null ? item.width : 280);
      const heightField = AdminView._cmsField('Height', 'number', item.height != null ? item.height : 200);
      const clusterField = AdminView._cmsField('Cluster radius', 'number', item.clusterRadius != null ? item.clusterRadius : 100);
      const regionField = AdminView._cmsField('Region', 'text', item.region || '', { placeholder: 'e.g. nyc, europe, cosmos' });

      wrap.append(
        idField.wrap, labelField.wrap, regionField.wrap,
        worldXField.wrap, worldYField.wrap,
        widthField.wrap, heightField.wrap, clusterField.wrap
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

      // Raw field values — the basis of the leave guard.
      const fields = [idField, labelField, worldXField, worldYField, widthField, heightField, clusterField, regionField];
      const collect = () => JSON.stringify(fields.map(fl => fl.input.value));
      const snapshot = collect();
      Editor._form = { isDirty: () => collect() !== snapshot };

      saveBtn.addEventListener('click', async () => {
        const payload = {
          id: idField.get().trim(),
          label: labelField.get().trim(),
          worldX: worldXField.get(),
          worldY: worldYField.get(),
          width: widthField.get(),
          height: heightField.get(),
          clusterRadius: clusterField.get(),
          region: regionField.get().trim()
        };
        const byName = { id: idField, label: labelField };
        AdminView._cmsApplyFieldErrors(byName, null);   // clear the last attempt's
        if (isNew && !AdminView._cmsCheckId(idField)) return;
        // An empty number box reads null, which the server quietly turns
        // into 0 (or a default) — ask for a value instead.
        const numFields = { worldX: worldXField, worldY: worldYField, width: widthField, height: heightField, clusterRadius: clusterField };
        const empty = Object.keys(numFields).filter(k => !Number.isFinite(payload[k]));
        empty.forEach(k => numFields[k].setError('Required.'));
        if (empty.length) {
          numFields[empty[0]].input.focus();
          AdminView.toast('Fill in every number field', 'error');
          return;
        }
        saveBtn.disabled = true;
        try {
          if (isNew) {
            await AdminView.api('/content/locations', { method: 'POST', body: JSON.stringify(payload) });
            AdminView.toast('Location created', 'success');
          } else {
            await AdminView.api('/content/locations/' + encodeURIComponent(item.id), { method: 'PUT', body: JSON.stringify(payload) });
            AdminView.toast('Location saved', 'success');
          }
          await Editor.refresh();
        } catch (e) {
          AdminView._cmsApplyFieldErrors(byName, e);
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
        title: `Permanently delete location "${item.id}"?`,
        message: 'Projects placed here will lose their map placement.',
        confirmLabel: 'Delete',
        danger: true
      });
      if (!ok) return;
      try {
        await AdminView.api('/content/locations/' + encodeURIComponent(item.id), { method: 'DELETE' });
        AdminView.toast('Location deleted', 'success');
        await Editor.refresh();
      } catch (e) {
        AdminView.toast(e.message, 'error');
      }
    },

    async refresh() {
      const data = await AdminView.api('/content/locations');
      Editor._items = data.items || [];
      Editor.renderList();
    },

    unmount() {
      Editor._form = null;
      Editor._container = null;
    }
  };

  AdminView._cms.locations = Editor;
})();
