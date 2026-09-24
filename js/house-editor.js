/************************************************
 * HOUSE EDITOR — the decorate-a-house panel, shared by /world (the island
 * keeper's house) and /home (each of the owner's rooms).
 *
 *   HouseEditor.open({
 *     projectId, title, subtitle, unit: 'house' | 'room',
 *     doorTitle, doorToast,          // wording for the fixed door cells
 *     maxProps: () => number,        // prop cap
 *     saveUrl, savedToast,           // PUT target for the validated house
 *     onSaved(house, data), onSaveFailed(data), onClose()
 *   }) → cancel()                    // restores the saved house + closes
 *
 * Previews go through Playground3D.applyHouse / setHouseShowcase; the door
 * cells come from Playground3D.getHouseLayout. Styles: .world-house* rules.
 ************************************************/
const HouseEditor = (() => {
  // Colour swatches + sign + a top-down prop grid. Every change previews
  // live in the engine (only locally); Save PUTs, Cancel / Escape restores.
  // Returns a cancel function (restore + close), or null if unavailable.
  function open(opts) {
    if (typeof WorldHouseLogic === 'undefined') return null;
    const projectId = opts.projectId;
    const unit = opts.unit || 'house';
    const L = WorldHouseLogic;
    const saved = (Playground3D.getHouse && Playground3D.getHouse(projectId)) || L.defaultHouse();
    // A stored house that no longer validates (e.g. a portrait URL the rules
    // now reject) must not break the editor: drop the offending field, and as
    // a last resort start from defaults.
    const v0 = L.validateHouse(saved);
    const v1 = v0.ok ? v0 : L.validateHouse({ ...saved, portrait: '' });
    const draft = v1.ok ? v1.house : L.defaultHouse();
    const hex = (n) => '#' + ('000000' + (n >>> 0).toString(16)).slice(-6);
    const GLYPH = { chair: '🪑', table: '🛋️', frame: '🖼️', plant: '🪴', lamp: '💡', rug: '🟫', bookshelf: '📚', crate: '📦', bed: '🛏️', window: '🪟' };
    const maxProps = () => opts.maxProps();
    const SLOTS = [['wallColor', 'Walls'], ['roofColor', 'Roof'], ['trimColor', 'Trim'], ['lampColor', 'Lamps']];
    // Shape / finish rows: [field, label, [[value, caption, title], …]].
    const STYLE_ROWS = [
      ['roofStyle', 'Roof', [['flat', 'Flat', 'A flat slab roof'], ['gable', 'Gable', 'A pitched roof with a ridge'], ['hip', 'Hip', 'A pyramid roof sloping on all four sides']]],
      ['wallStyle', 'Walls', [['plaster', 'Plaster', 'Smooth stucco'], ['brick', 'Brick', 'Brick courses'], ['stone', 'Stone', 'Rough stone blocks'], ['timber', 'Timber', 'Wooden planks'], ['glass', 'Glass', 'See-through glass walls — the whole wall is a window, so none are carved']]],
      ['windowStyle', 'Windows', [['cross', 'Cross', 'Four panes'], ['grid', 'Grid', 'Six small panes'], ['plain', 'Plain', 'One clear pane'], ['shutters', 'Shutters', 'A plain pane with trim-coloured shutters']]]
    ];
    const CELL = 32, N = L.C.GRID_MAX, RING = N + 2;   // 12×12: interior 1..10 + the wall ring
    // The fixed door: openings per side straight from the engine (roads decide
    // them, never the house). Drawn as locked wall cells; a window can't go there.
    const layout = (Playground3D.getHouseLayout && Playground3D.getHouseLayout(projectId)) || null;
    const doorCells = {};
    for (const side of L.SIDES) doorCells[side] = layout ? L.openingsToCells(layout[side]) : [];
    const isDoorCell = (side, pos) => doorCells[side].some(([a, b]) => pos >= a && pos <= b);
    // Wall-ring cell → which wall and how far along it (top row is north).
    const ringCell = (gx, gy) => {
      if (gy === 0 && gx >= 1 && gx <= N) return { side: 'N', pos: gx };
      if (gy === RING - 1 && gx >= 1 && gx <= N) return { side: 'S', pos: gx };
      if (gx === 0 && gy >= 1 && gy <= N) return { side: 'W', pos: gy };
      if (gx === RING - 1 && gy >= 1 && gy <= N) return { side: 'E', pos: gy };
      return null;
    };
    const ringXY = (side, along) => {   // (side, offset along the wall) → SVG centre
      if (side === 'N') return [along * CELL, CELL / 2];
      if (side === 'S') return [along * CELL, (RING - 0.5) * CELL];
      if (side === 'W') return [CELL / 2, along * CELL];
      return [(RING - 0.5) * CELL, along * CELL];
    };
    let selectedKind = 'chair';     // a prop kind, or 'window'
    let selectedProp = -1;          // index into draft.props
    let selectedWindow = -1;        // index into draft.windows (explicit mode only)

    const overlay = document.createElement('div');
    overlay.className = 'world-house';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `Edit ${unit}`);
    const swatchRows = SLOTS.map(([slot, name]) => `
      <div class="world-house-row" data-slot="${slot}">
        <span class="world-house-label">${name}</span>
        <div class="world-house-swatches">
          <button type="button" class="world-house-swatch default" data-idx="" title="Default">Auto</button>
          ${L.PALETTE.map((c, i) => `<button type="button" class="world-house-swatch" data-idx="${i}" style="background:${hex(c)}" title="Colour ${i + 1}"></button>`).join('')}
        </div>
      </div>`).join('');
    const styleRows = STYLE_ROWS.map(([field, name, opts]) => `
      <div class="world-house-row" data-style="${field}">
        <span class="world-house-label">${name}</span>
        <div class="world-house-chips">
          ${opts.map(([v, cap, title]) => `<button type="button" class="world-house-chip" data-value="${v}" title="${esc(title)}">${cap}</button>`).join('')}
          ${field === 'roofStyle' ? `
            <span class="world-house-chipsep" aria-hidden="true"></span>
            <button type="button" class="world-house-chip" data-dir="0" title="Ridge runs east–west">Ridge E–W</button>
            <button type="button" class="world-house-chip" data-dir="1" title="Ridge runs north–south">Ridge N–S</button>
            <button type="button" class="world-house-chip" data-chimney title="A brick chimney on the roof">Chimney</button>` : ''}
          ${field === 'windowStyle' ? `
            <span class="world-house-chipsep" aria-hidden="true"></span>
            <button type="button" class="world-house-chip" data-winauto title="Let the house pick: one window on each long stretch of wall">Auto</button>` : ''}
        </div>
      </div>`).join('');
    overlay.innerHTML = `
      <div class="world-house-panel">
        <button class="popup-close" aria-label="Close">✕</button>
        <h3>🏠 ${esc(opts.title)}</h3>
        <p class="world-house-sub">${esc(opts.subtitle)}</p>
        <button type="button" class="world-house-tool world-house-peek" data-peek="on" title="Hide the panel to look at the ${unit}">👁 Look at the ${unit}</button>
        <div class="world-house-styles">${styleRows}</div>
        <div class="world-house-colors">${swatchRows}</div>
        <label class="world-house-signrow">
          <span class="world-house-label">Sign</span>
          <input type="text" id="world-house-sign" maxlength="${L.C.SIGN_MAX}" placeholder="Name over the door" autocomplete="off" />
        </label>
        <div class="world-house-portraitrow">
          <span class="world-house-label">Portrait</span>
          <span class="world-house-portrait-thumb" id="world-house-portrait-thumb" aria-hidden="true"></span>
          <label class="world-house-tool world-house-upload">
            <span id="world-house-upload-text">Upload photo</span>
            <input type="file" id="world-house-portrait-file" accept="image/*" hidden />
          </label>
          <button type="button" class="world-house-tool" id="world-house-portrait-remove" title="Remove the portrait">🗑</button>
          <span class="world-house-portrait-hint" id="world-house-portrait-hint"></span>
        </div>
        <div class="world-house-props">
          <div class="world-house-kinds">
            ${L.PROP_KINDS.map(k => `<button type="button" class="world-house-kind" data-kind="${k}" title="${k}">${GLYPH[k] || '▪'} ${k}</button>`).join('')}
            <button type="button" class="world-house-kind world-house-kind-window" data-kind="window" title="Place a window on the wall ring">${GLYPH.window} window</button>
          </div>
          <div class="world-house-tools">
            <button type="button" class="world-house-tool" data-tool="rotate" title="Rotate the selected prop">↻ Rotate</button>
            <button type="button" class="world-house-tool" data-tool="remove" title="Remove the selected prop or window">Remove</button>
            <span class="world-house-count" id="world-house-count"></span>
          </div>
          <p class="world-house-hint">Tap an empty floor cell to place the chosen prop; tap a prop to select it. Frames hang on the nearest wall; anything on an edge cell stands against that wall (a bookshelf, chair or bed turns its back to it), and bookshelves side by side join into one run. A bed takes two cells. The outer ring is the wall: pick 🪟 and tap it to place windows — side-by-side cells join into one wide window. 🚪 ${unit === 'room' ? 'marks a doorway to the next room' : 'is the door'} — it's fixed. Top of the plan is north.</p>
          <svg class="world-house-grid" viewBox="0 0 ${RING * CELL} ${RING * CELL}" role="img" aria-label="House floor plan with walls"></svg>
        </div>
        <div class="world-house-actions">
          <button type="button" class="world-house-cancel">Cancel</button>
          <button type="button" class="world-house-save">Save</button>
        </div>
      </div>
    `;
    const peekPill = document.createElement('button');
    peekPill.type = 'button';
    peekPill.className = 'world-house-peekpill';
    peekPill.setAttribute('data-peek', 'off');
    peekPill.textContent = '✏️ Back to editing';
    overlay.appendChild(peekPill);
    document.body.appendChild(overlay);
    // Show the house from outside while editing (the keeper is standing
    // inside it, where its roof is hidden). Cleared on close.
    if (Playground3D.setHouseShowcase) Playground3D.setHouseShowcase(projectId);

    const grid = overlay.querySelector('.world-house-grid');
    const signInput = overlay.querySelector('#world-house-sign');
    const countEl = overlay.querySelector('#world-house-count');
    signInput.value = draft.sign || '';

    function preview() {
      // An over-cap legacy house (the admin lowered the cap) still previews;
      // Save refuses until enough props are removed.
      const v = L.validateHouse(draft, { maxProps: Math.max(maxProps(), draft.props.length) });
      if (v.ok && Playground3D.applyHouse) Playground3D.applyHouse(projectId, v.house);
    }
    function renderSwatches() {
      overlay.querySelectorAll('.world-house-row').forEach((row) => {
        const slot = row.getAttribute('data-slot');
        const cur = draft[slot];
        row.querySelectorAll('.world-house-swatch').forEach((b) => {
          const idx = b.getAttribute('data-idx');
          b.classList.toggle('active', (idx === '' && cur == null) || (idx !== '' && Number(idx) === cur));
        });
      });
    }
    function renderChips() {
      overlay.querySelectorAll('.world-house-row[data-style]').forEach((row) => {
        const field = row.getAttribute('data-style');
        row.querySelectorAll('.world-house-chip[data-value]').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-value') === draft[field]);
        });
      });
      const gable = draft.roofStyle === 'gable';
      overlay.querySelectorAll('.world-house-chip[data-dir]').forEach((b) => {
        b.hidden = !gable;
        b.classList.toggle('active', gable && Number(b.getAttribute('data-dir')) === (draft.roofDir || 0));
      });
      const chimney = overlay.querySelector('.world-house-chip[data-chimney]');
      if (chimney) chimney.classList.toggle('active', !!draft.chimney);
      const auto = overlay.querySelector('.world-house-chip[data-winauto]');
      if (auto) auto.classList.toggle('active', draft.windows == null);
      // Glass walls are see-through already: the window controls go dim.
      const glass = draft.wallStyle === 'glass';
      const winRow = overlay.querySelector('.world-house-row[data-style="windowStyle"]');
      if (winRow) { winRow.classList.toggle('dimmed', glass); winRow.title = glass ? 'Glass walls are see-through — pick another wall finish to carve windows.' : ''; }
      const winKind = overlay.querySelector('.world-house-kind[data-kind="window"]');
      if (winKind) winKind.classList.toggle('dimmed', glass);
    }
    function renderKinds() {
      overlay.querySelectorAll('.world-house-kind').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-kind') === selectedKind);
      });
      const n = draft.props.length;
      const w = draft.windows == null ? 'auto' : `${draft.windows.length}/${L.C.MAX_WINDOWS}`;
      countEl.textContent = `${n}/${maxProps()} props · ${w} windows`;
      countEl.classList.toggle('over', n > maxProps());
      const hasSel = selectedProp >= 0 || selectedWindow >= 0;
      overlay.querySelectorAll('.world-house-tool').forEach((b) => { b.disabled = !hasSel; });
    }
    function renderGrid() {
      const cells = [];
      // Wall ring (12×12 outer cells): the fixed door, then free wall / corners.
      for (let gy = 0; gy < RING; gy++) {
        for (let gx = 0; gx < RING; gx++) {
          const inner = gx >= 1 && gx <= N && gy >= 1 && gy <= N;
          const x = gx * CELL, y = gy * CELL;
          if (inner) {
            cells.push(`<rect class="world-house-cell" data-gx="${gx}" data-gy="${gy}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" />`);
            continue;
          }
          const rc = ringCell(gx, gy);
          if (!rc) { cells.push(`<rect class="world-house-corner" x="${x}" y="${y}" width="${CELL}" height="${CELL}" />`); continue; }
          if (isDoorCell(rc.side, rc.pos)) {
            cells.push(`<g class="world-house-wall locked" data-side="${rc.side}" data-pos="${rc.pos}">
              <title>${esc(opts.doorTitle)}</title>
              <rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" />
              <text x="${x + CELL / 2}" y="${y + CELL / 2 + 1}" text-anchor="middle" dominant-baseline="middle" font-size="16">🚪</text>
            </g>`);
          } else {
            cells.push(`<rect class="world-house-wall" data-side="${rc.side}" data-pos="${rc.pos}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" />`);
          }
        }
      }
      // Windows: the keeper's own (selectable) or, in auto mode, a greyed
      // preview of where the house puts them by itself.
      let windows = '';
      if (draft.windows != null) {
        windows = draft.windows.map((w, i) => {
          const [wx, wy] = ringXY(w.side, w.pos + 0.5);
          const sel = i === selectedWindow ? ' selected' : '';
          return `<g class="world-house-window${sel}" data-w="${i}" transform="translate(${wx} ${wy})">
            <rect x="${-CELL / 2 + 2}" y="${-CELL / 2 + 2}" width="${CELL - 4}" height="${CELL - 4}" rx="5" />
            <text x="0" y="1" text-anchor="middle" dominant-baseline="middle" font-size="16">🪟</text>
          </g>`;
        }).join('');
      } else if (layout) {
        for (const side of L.SIDES) {
          for (const c of L.autoWindowCentres(layout[side])) {
            const [wx, wy] = ringXY(side, c);
            windows += `<g class="world-house-window auto" transform="translate(${wx} ${wy})"><title>Auto window</title>
              <text x="0" y="1" text-anchor="middle" dominant-baseline="middle" font-size="16">🪟</text></g>`;
          }
        }
      }
      // Bookshelves side by side render as one run of shelving: a joined
      // outline behind them, and no per-cell box.
      const runs = L.propRuns(draft.props, 'bookshelf').filter(r => r.cells > 1);
      const inRun = new Set();
      const runRects = runs.map((r) => {
        for (const i of r.indices) inRun.add(i);
        const x0 = Math.min(r.from[0], r.to[0]), y0 = Math.min(r.from[1], r.to[1]);
        const x1 = Math.max(r.from[0], r.to[0]), y1 = Math.max(r.from[1], r.to[1]);
        return `<rect class="world-house-run" x="${x0 * CELL + 2}" y="${y0 * CELL + 2}" width="${(x1 - x0 + 1) * CELL - 4}" height="${(y1 - y0 + 1) * CELL - 4}" rx="6" />`;
      }).join('');
      const props = draft.props.map((p, i) => {
        const cx = (p.gx + 0.5) * CELL, cy = (p.gy + 0.5) * CELL;
        const sel = i === selectedProp ? ' selected' : '';
        const run = inRun.has(i) ? ' in-run' : '';
        // Multi-cell props (bed): the box spans every cell, glyph + arrow on the anchor.
        const cells = L.propCells(p);
        const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
        const bx = (Math.min(...xs) - p.gx) * CELL - CELL / 2 + 2, by = (Math.min(...ys) - p.gy) * CELL - CELL / 2 + 2;
        const bw = (Math.max(...xs) - Math.min(...xs) + 1) * CELL - 4, bh = (Math.max(...ys) - Math.min(...ys) + 1) * CELL - 4;
        return `<g class="world-house-prop${sel}${run}" data-i="${i}" transform="translate(${cx} ${cy})">
          <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="5" />
          <text x="0" y="1" text-anchor="middle" dominant-baseline="middle" font-size="18">${GLYPH[p.kind] || '▪'}</text>
          <path d="M0,-${CELL / 2 - 3} l4,5 h-8 z" transform="rotate(${(p.rot || 0) * 90})" />
        </g>`;
      }).join('');
      const propsSvg = runRects + props;
      grid.innerHTML = `<rect class="world-house-floor" x="${CELL}" y="${CELL}" width="${N * CELL}" height="${N * CELL}" />${cells.join('')}${windows}${propsSvg}`;
    }
    // Portrait: a photo the keeper uploads (same /upload route as memories),
    // shown inside every Frame prop. Uploading auto-places a frame if there
    // is none yet, so the picture is visible straight away.
    const thumb = overlay.querySelector('#world-house-portrait-thumb');
    const fileInput = overlay.querySelector('#world-house-portrait-file');
    const uploadText = overlay.querySelector('#world-house-upload-text');
    const removeBtn = overlay.querySelector('#world-house-portrait-remove');
    const portraitHint = overlay.querySelector('#world-house-portrait-hint');
    function renderPortrait() {
      const url = draft.portrait || '';
      thumb.style.backgroundImage = url ? `url("${url.replace(/"/g, '%22')}")` : '';
      thumb.classList.toggle('empty', !url);
      removeBtn.disabled = !url;
      const frames = draft.props.filter(p => p.kind === 'frame').length;
      portraitHint.textContent = !url ? 'Shown inside your Frame props.'
        : (frames ? `Hanging in ${frames} frame${frames > 1 ? 's' : ''}.` : 'Place a Frame prop to hang it.');
    }
    function ensureFrame() {
      if (draft.props.some(p => p.kind === 'frame') || draft.props.length >= maxProps()) return;
      const taken = new Set(draft.props.map(p => `${p.gx},${p.gy}`));
      // Wall cells, north wall first (the picture then faces the room).
      for (const [gx, gy] of [[4, 1], [7, 1], [3, 1], [8, 1], [1, 5], [10, 5], [4, 10], [7, 10]]) {
        if (!taken.has(`${gx},${gy}`)) { draft.props.push({ kind: 'frame', ...L.snapFrameToWall(gx, gy) }); return; }
      }
    }
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) { if (typeof toast === 'function') toast('Please choose an image.', 'warn'); return; }
      uploadText.textContent = 'Uploading…';
      fileInput.disabled = true;
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${API}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${Auth.getToken()}` }, body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
        draft.portrait = data.url;
        ensureFrame();
        renderPortrait(); renderKinds(); renderGrid(); preview();
      } catch (e) {
        if (typeof toast === 'function') toast(e.message || 'Upload failed', 'error');
      } finally {
        uploadText.textContent = 'Upload photo';
        fileInput.disabled = false;
      }
    });
    removeBtn.addEventListener('click', () => { draft.portrait = ''; renderPortrait(); preview(); });

    function renderAll() { renderSwatches(); renderChips(); renderKinds(); renderGrid(); renderPortrait(); }
    renderAll();
    preview();

    overlay.addEventListener('click', (e) => {
      // Peek: hide the panel (and the dark backdrop) so the whole house is
      // visible; the pill brings the panel back. Nothing else is dismissed.
      const peek = e.target.closest('[data-peek]');
      if (peek) { overlay.classList.toggle('peeking', peek.getAttribute('data-peek') === 'on'); return; }
      const sw = e.target.closest('.world-house-swatch');
      if (sw) {
        const slot = sw.closest('.world-house-row').getAttribute('data-slot');
        const idx = sw.getAttribute('data-idx');
        draft[slot] = idx === '' ? null : Number(idx);
        renderSwatches(); preview();
        return;
      }
      // Shape / finish chips.
      const chip = e.target.closest('.world-house-chip');
      if (chip) {
        if (chip.hasAttribute('data-value')) {
          draft[chip.closest('.world-house-row').getAttribute('data-style')] = chip.getAttribute('data-value');
        } else if (chip.hasAttribute('data-dir')) {
          draft.roofDir = Number(chip.getAttribute('data-dir'));
        } else if (chip.hasAttribute('data-chimney')) {
          draft.chimney = !draft.chimney;
        } else if (chip.hasAttribute('data-winauto')) {
          draft.windows = null;
          selectedWindow = -1;
        }
        renderChips(); renderKinds(); renderGrid(); preview();
        return;
      }
      const kind = e.target.closest('.world-house-kind');
      if (kind) { selectedKind = kind.getAttribute('data-kind'); selectedProp = -1; selectedWindow = -1; renderKinds(); renderGrid(); return; }
      const tool = e.target.closest('.world-house-tool');
      if (tool && selectedWindow >= 0 && draft.windows && draft.windows[selectedWindow]) {
        if (tool.getAttribute('data-tool') === 'rotate') {
          if (typeof toast === 'function') toast('Windows face out from their wall — move it to another spot instead.', 'info');
          return;
        }
        draft.windows.splice(selectedWindow, 1);
        selectedWindow = -1;
        renderKinds(); renderGrid(); preview();
        return;
      }
      if (tool && selectedProp >= 0 && draft.props[selectedProp]) {
        if (tool.getAttribute('data-tool') === 'rotate') {
          // A frame's facing is fixed by the wall it hangs on.
          const sp = draft.props[selectedProp];
          if (sp.kind === 'frame') {
            if (typeof toast === 'function') toast('Frames face into the room from their wall — move it to another wall instead.', 'info');
            return;
          }
          // A bookshelf / chair / bed on an edge cell keeps its back to that wall.
          if (L.wallBackedRot(sp.kind, sp.gx, sp.gy) != null) {
            if (typeof toast === 'function') toast(`A ${sp.kind} against the wall keeps its back to it — place it a cell further in to turn it.`, 'info');
            return;
          }
          // Turn to the next facing whose cells are free (a bed needs the
          // cell in front of it); refuse if none of the other three fit.
          let turned = false;
          for (let k = 1; k <= 3 && !turned; k++) {
            const r = L.canPlaceProp(draft.props, { ...sp, rot: ((sp.rot || 0) + k) % 4 }, { maxProps: Math.max(maxProps(), draft.props.length), skipIndex: selectedProp });
            if (r.ok) { draft.props[selectedProp] = r.placed; turned = true; }
          }
          if (!turned) {
            if (typeof toast === 'function') toast('No room to turn it here — the cell in front is taken.', 'warn');
            return;
          }
        } else {
          draft.props.splice(selectedProp, 1);
          selectedProp = -1;
        }
        renderKinds(); renderGrid(); renderPortrait(); preview();
        return;
      }
      const propEl = e.target.closest('.world-house-prop');
      if (propEl) { selectedProp = Number(propEl.getAttribute('data-i')); selectedWindow = -1; renderKinds(); renderGrid(); return; }
      const winEl = e.target.closest('.world-house-window');
      if (winEl && winEl.hasAttribute('data-w')) { selectedWindow = Number(winEl.getAttribute('data-w')); selectedProp = -1; renderKinds(); renderGrid(); return; }
      // The wall ring: windows only (and never on the door).
      const wall = e.target.closest('.world-house-wall');
      if (wall) {
        const side = wall.getAttribute('data-side'), pos = Number(wall.getAttribute('data-pos'));
        if (wall.classList.contains('locked')) {
          if (typeof toast === 'function') toast(opts.doorToast, 'info');
          return;
        }
        if (selectedKind !== 'window') {
          if (typeof toast === 'function') toast('That\'s the wall — pick 🪟 window to put a window there.', 'info');
          return;
        }
        if (draft.wallStyle === 'glass') {
          if (typeof toast === 'function') toast('Glass walls are already see-through — pick another wall finish to add windows.', 'info');
          return;
        }
        const current = draft.windows == null ? [] : draft.windows;
        const can = L.canPlaceWindow(current, side, pos, layout ? layout[side] : []);
        if (!can.ok) { if (typeof toast === 'function') toast(can.error, 'warn'); return; }
        draft.windows = [...current, { side, pos }];   // leaving auto mode keeps only what you place
        selectedWindow = draft.windows.length - 1;
        selectedProp = -1;
        renderChips(); renderKinds(); renderGrid(); preview();
        return;
      }
      const cell = e.target.closest('.world-house-cell');
      if (cell) {
        const gx = Number(cell.getAttribute('data-gx')), gy = Number(cell.getAttribute('data-gy'));
        if (selectedKind === 'window') {
          if (typeof toast === 'function') toast('Windows go on the wall — tap the outer ring.', 'info');
          return;
        }
        if (draft.props.length >= maxProps()) {
          if (typeof toast === 'function') toast(`That's the limit — ${maxProps()} props per ${unit}.`, 'warn');
          return;
        }
        // canPlaceProp snaps frames to the nearest wall, turns wall-backed
        // props (bookshelf / chair / bed) on an edge cell to face the room,
        // and checks every cell a prop covers (a bed takes two).
        const r = L.canPlaceProp(draft.props, { kind: selectedKind, gx, gy, rot: 0 }, { maxProps: maxProps() });
        if (!r.ok) {
          const msg = /share cell/.test(r.error) ? (selectedKind === 'frame' ? 'That wall spot is taken — tap nearer a free stretch of wall.' : 'That spot is taken.')
            : /cell in front/.test(r.error) ? 'A bed needs the cell in front of it too — tap a spot with room.'
            : r.error;
          if (typeof toast === 'function') toast(msg, 'warn');
          return;
        }
        draft.props.push(r.placed);
        selectedProp = draft.props.length - 1;
        renderKinds(); renderGrid(); renderPortrait(); preview();
      }
    });
    signInput.addEventListener('input', () => { draft.sign = L.sanitizeSign(signInput.value); preview(); });

    // Every way out (✕, Cancel, Escape, backdrop, a failed save) puts the
    // saved house back unless the draft was just saved.
    let closed = false, didSave = false;
    const restore = () => { if (Playground3D.applyHouse) Playground3D.applyHouse(projectId, saved); };
    const close = wireModalDismiss(overlay, () => {
      if (closed) return;
      closed = true;
      if (!didSave) restore();
      overlay.remove();
      if (Playground3D.clearHouseShowcase) Playground3D.clearHouseShowcase();
      if (opts.onClose) opts.onClose();
    }, { initialFocus: overlay.querySelector('.popup-close') });
    overlay.querySelector('.popup-close').addEventListener('click', close);
    overlay.querySelector('.world-house-cancel').addEventListener('click', close);
    overlay.querySelector('.world-house-save').addEventListener('click', async () => {
      if (draft.props.length > maxProps()) {
        if (typeof toast === 'function') toast(`The limit is now ${maxProps()} props — remove ${draft.props.length - maxProps()} first.`, 'warn');
        return;
      }
      const v = L.validateHouse(draft, { maxProps: maxProps() });
      if (!v.ok) { if (typeof toast === 'function') toast(v.error, 'warn'); return; }
      const btn = overlay.querySelector('.world-house-save');
      btn.disabled = true;
      try {
        const res = await fetch(opts.saveUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Auth.getToken()}` },
          body: JSON.stringify(v.house)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (opts.onSaveFailed) opts.onSaveFailed(data);
          if (typeof toast === 'function') toast(data.error || `Couldn’t save the ${unit}.`, 'error');
          close();
          return;
        }
        didSave = true;
        if (Playground3D.applyHouse) Playground3D.applyHouse(projectId, data.house || v.house);
        if (opts.onSaved) opts.onSaved(data.house || v.house, data);
        if (typeof toast === 'function') toast(opts.savedToast, 'success');
        close();
      } catch (_) {
        if (typeof toast === 'function') toast(`Couldn’t save the ${unit} — check your connection.`, 'error');
        btn.disabled = false;
      }
    });
    return close;
  }

  return { open };
})();
