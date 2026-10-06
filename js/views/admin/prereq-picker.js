/************************************************
 * ADMIN — PREREQUISITE PICKER (project form)
 *
 * Replaces the two native <select multiple> boxes. Those listed all 80+
 * projects as options with the chosen ones barely highlighted in the dark
 * theme — it looked as if every project were a prerequisite — and a plain
 * click replaced the whole selection.
 *
 * Two sections, Required (locks until watched) and Recommended (optional,
 * never locks), each showing ONLY the chosen projects as chips (title, year,
 * phase dot; ⇄ moves a chip to the other list, ✕ removes it, the title
 * opens that project), plus a searchable "Add…" combobox that follows the
 * ARIA combobox/listbox pattern (↑ ↓ Enter, Esc closes the list, Backspace
 * on an empty field removes the last chip). Candidates that would create a
 * lock loop stay listed but disabled, with the reason.
 *
 *   AdminView._prereqField({ selfId, items, required, recommended, hidden,
 *                            onOpen(item) })
 *   → { wrap, value() → { required, recommended }, isDirty(),
 *       showProblem(errorBody) }
 *
 * Pure rules: js/project-logic.js (ProjectLogic).
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;
  const L = window.ProjectLogic;
  const MAX = L.PREREQ_MAX;
  let uid = 0;

  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const yearOf = (p) => (p && p.release ? String(p.release).slice(0, 4) : '');
  const phaseOf = (p) => Math.min(6, Math.max(1, L.parsePhase(p && p.phase)));

  // Lower is better; Infinity = no match. Exact > title prefix > word prefix
  // > id prefix > substring > year.
  function rank(p, q) {
    if (!q) return 10;
    const t = norm(p.title), id = norm(p.id), y = yearOf(p);
    if (t === q || id === q) return 0;
    if (t.startsWith(q)) return 1;
    if (t.split(/[^a-z0-9]+/).some((w) => w && w.startsWith(q))) return 2;
    if (id.startsWith(q)) return 3;
    if (t.includes(q) || id.includes(q)) return 4;
    if (/^\d{2,4}$/.test(q) && y.startsWith(q)) return 5;
    return Infinity;
  }

  AdminView._prereqField = function prereqField(opts) {
    const items = opts.items || [];
    const byId = new Map(items.map((p) => [p.id, p]));
    const selfId = opts.selfId || null;
    const lists = {
      required: [...new Set(opts.required || [])],
      recommended: [...new Set(opts.recommended || [])].filter((id) => !(opts.required || []).includes(id))
    };
    const initial = JSON.stringify(lists);
    // Projects whose locks lead back to this one: requiring any of them
    // would close a loop.
    const loopers = selfId ? L.dependentsOf(items, selfId) : new Set();
    const titleOf = (id) => (byId.get(id) || {}).title || id;
    let problemIds = new Set();

    const wrap = document.createElement('div');
    wrap.className = 'prq';
    const live = document.createElement('div');
    live.className = 'visually-hidden';
    live.setAttribute('aria-live', 'polite');

    const sections = {
      required: buildSection('required', 'Required prerequisites', 'Lock this project until all are watched',
        'Add a required prerequisite…', 'None — available as soon as its phase unlocks.'),
      recommended: buildSection('recommended', 'Recommended prerequisites', 'Suggested first — never lock',
        'Add a recommended prerequisite…', 'None.')
    };
    const extra = document.createElement('div');
    extra.className = 'prq-extra';
    wrap.append(sections.required.el, sections.recommended.el, extra, live);

    const hidden = (opts.hidden || []).filter(Boolean);
    const dependants = selfId ? L.requiredBy(items, selfId) : [];
    const lines = [];
    if (hidden.length) {
      lines.push(`<p><span class="prq-extra-label">Also locked by (hidden, not drawn):</span> ${hidden.map((id) => esc(titleOf(id))).join(', ')}</p>`);
    }
    if (dependants.length) {
      lines.push(`<p><span class="prq-extra-label">Required by:</span> ${dependants.map((id) => esc(titleOf(id))).join(', ')}</p>`);
    }
    extra.innerHTML = lines.join('');
    extra.hidden = !lines.length;

    renderChips('required');
    renderChips('recommended');

    function announce(msg) {
      live.textContent = '';
      requestAnimationFrame(() => { live.textContent = msg; });
    }

    function other(name) { return name === 'required' ? 'recommended' : 'required'; }
    function labelOf(name) { return name === 'required' ? 'Required' : 'Recommended'; }

    function add(name, id) {
      if (!id || id === selfId) return;
      const o = other(name);
      const from = lists[o].indexOf(id);
      if (from !== -1) lists[o].splice(from, 1);
      if (!lists[name].includes(id)) {
        if (lists[name].length >= MAX) {
          AdminView.toast(`At most ${MAX} ${name} prerequisites`, 'error');
          return;
        }
        lists[name].push(id);
      }
      problemIds.delete(id);
      renderChips('required');
      renderChips('recommended');
      announce(from !== -1 ? `Moved ${titleOf(id)} to ${labelOf(name)}` : `Added ${titleOf(id)} to ${labelOf(name)}`);
    }

    function remove(name, id) {
      const i = lists[name].indexOf(id);
      if (i === -1) return;
      lists[name].splice(i, 1);
      problemIds.delete(id);
      renderChips(name);
      announce(`Removed ${titleOf(id)}`);
    }

    function buildSection(name, title, note, placeholder, emptyText) {
      const el = document.createElement('section');
      el.className = 'prq-section';
      el.dataset.list = name;
      const listId = `prq-opts-${++uid}`;
      el.innerHTML = `
        <header class="prq-head">
          <span class="admin-cms-flabel">${esc(title)}</span>
          <span class="prq-note">${esc(note)}</span>
          <span class="prq-count"></span>
        </header>
        <ul class="prq-chips" aria-label="${esc(title)}"></ul>
        <p class="prq-empty">${esc(emptyText)}</p>
        <div class="prq-add">
          <input type="text" class="admin-cms-input prq-input" role="combobox" autocomplete="off" spellcheck="false"
                 aria-autocomplete="list" aria-expanded="false" aria-controls="${listId}"
                 aria-label="${esc(placeholder)}" placeholder="${esc(placeholder)}">
          <ul class="prq-options" id="${listId}" role="listbox" hidden></ul>
        </div>`;
      const input = el.querySelector('.prq-input');
      const listbox = el.querySelector('.prq-options');
      const chips = el.querySelector('.prq-chips');
      let options = [];       // [{ id, disabled }]
      let active = -1;

      chips.addEventListener('click', (e) => {
        const chip = e.target.closest('.prq-chip');
        if (!chip) return;
        const id = chip.dataset.id;
        if (e.target.closest('.prq-chip-remove')) { remove(name, id); input.focus(); return; }
        if (e.target.closest('.prq-chip-move')) {
          if (name === 'recommended' && loopers.has(id)) {
            AdminView.toast(`${titleOf(id)} can’t be required: it already waits on this project`, 'error');
            return;
          }
          add(other(name), id);
          return;
        }
        if (e.target.closest('.prq-chip-title') && byId.has(id) && opts.onOpen) opts.onOpen(byId.get(id));
      });

      function close() {
        listbox.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        active = -1;
      }

      function setActive(i) {
        const opts2 = listbox.querySelectorAll('.prq-option');
        opts2.forEach((o, k) => o.classList.toggle('is-active', k === i));
        active = i;
        const el2 = opts2[i];
        if (el2) {
          input.setAttribute('aria-activedescendant', el2.id);
          el2.scrollIntoView({ block: 'nearest' });
        } else {
          input.removeAttribute('aria-activedescendant');
        }
      }

      function refresh() {
        const q = norm(input.value);
        const mine = new Set(lists[name]);
        const ranked = [];
        for (const p of items) {
          if (!p || p.id === selfId || mine.has(p.id)) continue;
          const r = rank(p, q);
          if (r === Infinity) continue;
          ranked.push({ p, r });
        }
        ranked.sort((a, b) => a.r - b.r || String(a.p.release || '').localeCompare(String(b.p.release || '')));
        const shown = ranked.slice(0, 40);
        options = shown.map(({ p }) => ({
          id: p.id,
          disabled: name === 'required' && loopers.has(p.id)
        }));
        if (!shown.length) {
          listbox.innerHTML = `<li class="prq-none" role="presentation">No matching project</li>`;
        } else {
          listbox.innerHTML = shown.map(({ p }, i) => {
            const o = options[i];
            const inOther = lists[other(name)].includes(p.id);
            const why = o.disabled ? 'Would create a loop — it already waits on this project' : (inOther ? `Moves it from ${labelOf(other(name))}` : '');
            return `<li class="prq-option${o.disabled ? ' is-disabled' : ''}" role="option" id="${listbox.id}-${i}"
                        data-i="${i}" aria-selected="false"${o.disabled ? ' aria-disabled="true"' : ''}>
                      <span class="prq-dot prq-dot-${phaseOf(p)}" aria-hidden="true"></span>
                      <span class="prq-option-title">${esc(p.title || p.id)}</span>
                      <span class="prq-option-meta">${esc(yearOf(p))}${yearOf(p) ? ' · ' : ''}${esc(p.id)}</span>
                      ${why ? `<span class="prq-option-why">${esc(why)}</span>` : ''}
                    </li>`;
          }).join('');
        }
        listbox.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        setActive(options.findIndex((o) => !o.disabled));
      }

      function pick(i) {
        const o = options[i];
        if (!o || o.disabled) return;
        add(name, o.id);
        input.value = '';
        refresh();
      }

      input.addEventListener('focus', refresh);
      input.addEventListener('input', refresh);
      input.addEventListener('blur', () => setTimeout(() => {
        if (document.activeElement !== input) close();
      }, 120));
      input.addEventListener('keydown', (e) => {
        const step = (dir) => {
          if (listbox.hidden) { refresh(); return; }
          if (!options.length) return;
          let i = active;
          for (let k = 0; k < options.length; k++) {
            i = (i + dir + options.length) % options.length;
            if (!options[i].disabled) break;
          }
          setActive(i);
        };
        if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); if (!listbox.hidden) pick(active); }
        else if (e.key === 'Escape') {
          // Close only the list — never the form around it.
          if (!listbox.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
        } else if (e.key === 'Tab') close();
        else if (e.key === 'Backspace' && !input.value && lists[name].length) {
          remove(name, lists[name][lists[name].length - 1]);
          refresh();
        }
      });
      // mousedown, not click: keep focus in the field so the list stays open.
      listbox.addEventListener('mousedown', (e) => {
        const li = e.target.closest('.prq-option');
        if (!li) return;
        e.preventDefault();
        pick(+li.dataset.i);
      });

      return { el, chips, refresh };
    }

    function renderChips(name) {
      const s = sections[name];
      const ids = lists[name];
      s.el.querySelector('.prq-count').textContent = `${ids.length} / ${MAX}`;
      s.el.querySelector('.prq-empty').hidden = ids.length > 0;
      s.chips.innerHTML = ids.map((id) => {
        const p = byId.get(id);
        const cls = ['prq-chip'];
        if (!p) cls.push('is-unknown');
        if (problemIds.has(id)) cls.push('is-problem');
        const t = p ? (p.title || p.id) : id;
        const moveTo = labelOf(other(name));
        return `<li class="${cls.join(' ')}" data-id="${esc(id)}">
            <span class="prq-dot prq-dot-${p ? phaseOf(p) : 0}" aria-hidden="true"></span>
            ${p
              ? `<button type="button" class="prq-chip-title" title="Open ${esc(t)}">${esc(t)}</button>
                 <span class="prq-chip-year">${esc(yearOf(p))}</span>
                 <button type="button" class="prq-chip-move" aria-label="Move ${esc(t)} to ${moveTo}" title="Move to ${moveTo}">⇄</button>`
              : `<span class="prq-chip-title">⚠ ${esc(id)} — no such project</span>`}
            <button type="button" class="prq-chip-remove" aria-label="Remove ${esc(t)}" title="Remove">✕</button>
          </li>`;
      }).join('');
    }

    return {
      wrap,
      value() { return { required: lists.required.slice(), recommended: lists.recommended.slice() }; },
      isDirty() { return JSON.stringify(lists) !== initial; },
      // Highlight the chips a server error names (unknown ids, a loop).
      showProblem(body) {
        const ids = new Set([...(body && body.cycle) || [], ...(body && body.ids) || []]);
        problemIds = ids;
        renderChips('required');
        renderChips('recommended');
      }
    };
  };
})();
