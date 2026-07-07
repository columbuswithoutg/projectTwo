/************************************************
 * ADMIN — CMS CHARACTERS EDITOR
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;

  const Editor = {
    _items: [],
    _projects: [],
    _container: null,

    async mount(container) {
      Editor._container = container;
      container.innerHTML = '<div class="admin-empty">Loading characters…</div>';
      try {
        const [chars, projs] = await Promise.all([
          AdminView.api('/content/characters'),
          AdminView.api('/content/projects')
        ]);
        Editor._items = chars.items || [];
        Editor._projects = projs.items || [];
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
          { key: 'name', label: 'Name' },
          { key: 'debut', label: 'Debut' },
          { key: 'stages', label: 'Stages', fmt: (v) => Array.isArray(v) ? v.length : 0 }
        ],
        onPick: (item) => Editor.openForm(item, false),
        onAdd: () => Editor.openForm({}, true)
      });
      Editor._container.appendChild(list);
    },

    projectOptions() {
      return [{ value: '', label: '—' }, ...Editor._projects.map(p => ({ value: p.id, label: `${p.id} — ${p.title}` }))];
    },

    openForm(item, isNew) {
      const wrap = document.createElement('div');
      wrap.className = 'admin-cms-form';

      const idField = AdminView._cmsField('ID (slug)', 'text', item.id || '', { disabled: !isNew, required: true, placeholder: 'e.g. ironman' });
      const nameField = AdminView._cmsField('Name', 'text', item.name || '', { required: true });
      const debutField = AdminView._cmsField('Debut project', 'select', item.debut || '', { options: Editor.projectOptions() });
      debutField.set(item.debut || '');
      const imageField = AdminView._cmsField('Image filename', 'text', item.image || '', { placeholder: 'e.g. ironman.jpg' });

      // Stages: dynamic list of {after, image, look} sub-forms.
      const stagesWrap = document.createElement('div');
      stagesWrap.className = 'admin-cms-stages';
      stagesWrap.innerHTML = '<span class="admin-cms-flabel">Stages (additional looks unlocked after specific projects)</span>';
      const stagesList = document.createElement('div');
      stagesList.className = 'admin-cms-stages-list';
      stagesWrap.appendChild(stagesList);

      const stagesData = JSON.parse(JSON.stringify(item.stages || []));

      function renderStages() {
        stagesList.innerHTML = '';
        stagesData.forEach((stage, idx) => {
          const row = document.createElement('div');
          row.className = 'admin-cms-stage-row';

          const afterSel = document.createElement('select');
          afterSel.className = 'admin-cms-input';
          Editor.projectOptions().forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            if (o.value === stage.after) opt.selected = true;
            afterSel.appendChild(opt);
          });
          afterSel.addEventListener('change', () => { stagesData[idx].after = afterSel.value; });

          const imgInput = document.createElement('input');
          imgInput.className = 'admin-cms-input';
          imgInput.type = 'text';
          imgInput.placeholder = 'image filename';
          imgInput.value = stage.image || '';
          imgInput.addEventListener('input', () => { stagesData[idx].image = imgInput.value; });

          const lookInput = document.createElement('input');
          lookInput.className = 'admin-cms-input';
          lookInput.type = 'text';
          lookInput.placeholder = 'look description';
          lookInput.value = stage.look || '';
          lookInput.addEventListener('input', () => { stagesData[idx].look = lookInput.value; });

          const removeBtn = document.createElement('button');
          removeBtn.className = 'admin-btn admin-btn-danger';
          removeBtn.textContent = 'Remove';
          removeBtn.addEventListener('click', () => {
            stagesData.splice(idx, 1);
            renderStages();
          });

          row.append(afterSel, imgInput, lookInput, removeBtn);
          stagesList.appendChild(row);
        });
        const addStageBtn = document.createElement('button');
        addStageBtn.className = 'admin-btn';
        addStageBtn.textContent = '+ Add stage';
        addStageBtn.addEventListener('click', () => {
          stagesData.push({ after: '', image: '', look: '' });
          renderStages();
        });
        stagesList.appendChild(addStageBtn);
      }
      renderStages();

      wrap.append(idField.wrap, nameField.wrap, debutField.wrap, imageField.wrap, stagesWrap);

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
          name: nameField.get().trim(),
          debut: debutField.get(),
          image: imageField.get().trim(),
          stages: stagesData.filter(s => s.after) // drop empty stage rows
        };
        saveBtn.disabled = true;
        try {
          if (isNew) {
            await AdminView.api('/content/characters', { method: 'POST', body: JSON.stringify(payload) });
            AdminView.toast('Character created', 'success');
          } else {
            await AdminView.api('/content/characters/' + encodeURIComponent(item.id), { method: 'PUT', body: JSON.stringify(payload) });
            AdminView.toast('Character saved', 'success');
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
        title: `Permanently delete character "${item.id}"?`,
        message: 'Walker selections referencing this id will silently fail.',
        confirmLabel: 'Delete',
        danger: true
      });
      if (!ok) return;
      try {
        await AdminView.api('/content/characters/' + encodeURIComponent(item.id), { method: 'DELETE' });
        AdminView.toast('Character deleted', 'success');
        await Editor.refresh();
      } catch (e) {
        AdminView.toast(e.message, 'error');
      }
    },

    async refresh() {
      const data = await AdminView.api('/content/characters');
      Editor._items = data.items || [];
      Editor.renderList();
    },

    unmount() {
      Editor._container = null;
    }
  };

  AdminView._cms.characters = Editor;
})();
