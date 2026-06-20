/************************************************
 * HOME — CHARACTER BUILDER (modal overlay)
 *
 * Two-column ("Face" + "Outfit") selector grid with a live SVG preview
 * that re-renders on every change. Saves the chosen indices to
 * /api/profile/home-character. The Save callback receives the new
 * character so HomeView can hot-swap the playground sprite without
 * restarting the engine.
 ************************************************/
const HomeBuilder = (() => {

  const HAIR_STYLE_LABELS = [
    'Pixie', 'Bob', 'Spiky', 'Long', 'Bald', 'Cap', 'Ponytail', 'Mohawk', 'Afro', 'Curly',
    'Buzz', 'Side-part', 'Topknot', 'Undercut'
  ];
  const EYE_SHAPE_LABELS    = ['Round', 'Narrow', 'Wide', 'Sharp', 'Soft'];
  const FACIAL_HAIR_LABELS  = ['Clean', 'Stubble', 'Mustache', 'Goatee', 'Beard', 'Chinstrap'];
  const GLASSES_LABELS      = ['None', 'Round', 'Square', 'Aviator', 'Half-rim'];
  const HAT_LABELS          = ['None', 'Beanie', 'Cap', 'Top hat', 'Hood'];

  // If callers don't pass `initial`, fetch the saved character ourselves so
  // entry points outside HomeView (e.g. drawer buttons in /map or /) don't
  // each have to duplicate the request. Falls back to defaults on failure.
  async function _fetchSaved() {
    try {
      const res = await fetch(`${API}/profile/home-character`, {
        headers: { Authorization: `Bearer ${Auth.getToken()}` }
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.homeCharacter || null;
    } catch (_) {
      return null;
    }
  }

  async function open({ initial, onSave, onCancel } = {}) {
    const baseDefault = Playground.defaultCharacter();
    // If no `initial` was provided, fetch it now so the modal opens with the
    // user's saved look rather than the bare default.
    if (initial === undefined) {
      const fetched = await _fetchSaved();
      if (fetched && fetched.skin != null) initial = fetched;
    }
    // Fill any missing slots on an older saved character with defaults so
    // every fieldset has something to highlight as "active".
    const initialChar = initial ? { ...baseDefault, ...initial } : { ...baseDefault };
    let current = { ...initialChar };
    let previewHandle = null;

    const overlay = document.createElement('div');
    overlay.className = 'pg-modal-overlay';
    overlay.innerHTML = `
      <div class="pg-modal pg-builder-modal" role="dialog" aria-modal="true" aria-labelledby="pg-modal-title">
        <header class="pg-modal-head">
          <h2 id="pg-modal-title">Customize your character</h2>
          <button class="pg-modal-close" type="button" aria-label="Close">✕</button>
        </header>
        <div class="pg-modal-body">
          <div class="pg-presets" id="pg-builder-presets"></div>
          <div class="pg-modal-preview" id="pg-builder-preview"></div>
          <div class="pg-modal-controls two-col">
            <div class="pg-builder-col">
              <h3 class="pg-builder-coltitle">Face</h3>
              <fieldset class="pg-builder-group" data-key="skin">
                <legend>Skin</legend>
                <div class="pg-swatches" data-target="skin"></div>
              </fieldset>
              <fieldset class="pg-builder-group" data-key="eyeColor">
                <legend>Eye color</legend>
                <div class="pg-swatches" data-target="eyeColor"></div>
              </fieldset>
              <fieldset class="pg-builder-group" data-key="eyeShape">
                <legend>Eye shape</legend>
                <div class="pg-styles" data-target="eyeShape"></div>
              </fieldset>
              <fieldset class="pg-builder-group" data-key="facialHairStyle">
                <legend>Facial hair</legend>
                <div class="pg-styles" data-target="facialHairStyle"></div>
              </fieldset>
              <fieldset class="pg-builder-group" data-key="facialHairColor">
                <legend>Beard color</legend>
                <div class="pg-swatches" data-target="facialHairColor"></div>
              </fieldset>
              <fieldset class="pg-builder-group" data-key="glasses">
                <legend>Glasses</legend>
                <div class="pg-styles" data-target="glasses"></div>
              </fieldset>
            </div>
            <div class="pg-builder-col">
              <h3 class="pg-builder-coltitle">Hair &amp; outfit</h3>
              <fieldset class="pg-builder-group" data-key="hairStyle">
                <legend>Hair style</legend>
                <div class="pg-styles" data-target="hairStyle"></div>
              </fieldset>
              <fieldset class="pg-builder-group" data-key="hairColor">
                <legend>Hair color</legend>
                <div class="pg-swatches" data-target="hairColor"></div>
              </fieldset>
              <fieldset class="pg-builder-group" data-key="hat">
                <legend>Hat</legend>
                <div class="pg-styles" data-target="hat"></div>
              </fieldset>
              <fieldset class="pg-builder-group" data-key="shirtColor">
                <legend>Shirt</legend>
                <div class="pg-swatches" data-target="shirtColor"></div>
              </fieldset>
              <fieldset class="pg-builder-group" data-key="pantsColor">
                <legend>Pants</legend>
                <div class="pg-swatches" data-target="pantsColor"></div>
              </fieldset>
              <fieldset class="pg-builder-group" data-key="shoeColor">
                <legend>Shoes</legend>
                <div class="pg-swatches" data-target="shoeColor"></div>
              </fieldset>
              <fieldset class="pg-builder-group" data-key="build">
                <legend>Build</legend>
                <div class="pg-styles" data-target="build"></div>
              </fieldset>
              <fieldset class="pg-builder-group" data-key="gear">
                <legend>Gear</legend>
                <div class="pg-styles" data-target="gear"></div>
              </fieldset>
            </div>
          </div>
        </div>
        <footer class="pg-modal-foot">
          <button class="pg-btn pg-btn-cancel" type="button">Cancel</button>
          <button class="pg-btn pg-btn-save" type="button">Save</button>
        </footer>
      </div>
    `;
    document.body.appendChild(overlay);

    function renderSwatches(targetKey, palette) {
      const host = overlay.querySelector(`[data-target="${targetKey}"]`);
      host.innerHTML = palette.map((color, idx) => `
        <button type="button" class="pg-swatch" data-idx="${idx}" style="background:${color}"
                aria-label="${targetKey} ${idx + 1}"></button>
      `).join('');
      markActive(targetKey);
      host.querySelectorAll('.pg-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
          current[targetKey] = parseInt(btn.dataset.idx, 10);
          markActive(targetKey);
          updatePreview();
        });
      });
    }

    function renderLabels(targetKey, labels) {
      const host = overlay.querySelector(`[data-target="${targetKey}"]`);
      host.innerHTML = labels.map((label, idx) => `
        <button type="button" class="pg-style" data-idx="${idx}">${label}</button>
      `).join('');
      markActive(targetKey);
      host.querySelectorAll('.pg-style').forEach(btn => {
        btn.addEventListener('click', () => {
          current[targetKey] = parseInt(btn.dataset.idx, 10);
          markActive(targetKey);
          updatePreview();
        });
      });
    }

    // Preset chips — one-click "models" of the OG six Avengers. Clicking one
    // replaces every slot (filling new fields from defaults), re-marks all
    // groups, and refreshes the preview. The look stays fully tweakable after.
    function renderPresets() {
      const host = overlay.querySelector('#pg-builder-presets');
      const presets = Playground.CHARACTER_PRESETS || [];
      if (!host) return;
      if (!presets.length) { host.style.display = 'none'; return; }
      host.innerHTML = '<span class="pg-presets-label">Avengers</span>' +
        presets.map((p, i) => `<button type="button" class="pg-preset" data-preset="${i}">${p.name}</button>`).join('');
      host.querySelectorAll('.pg-preset').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = presets[parseInt(btn.dataset.preset, 10)];
          current = { ...baseDefault, ...p.char };
          overlay.querySelectorAll('[data-target]').forEach(h => markActive(h.dataset.target));
          updatePreview();
        });
      });
    }

    function markActive(key) {
      const host = overlay.querySelector(`[data-target="${key}"]`);
      if (!host) return;
      host.querySelectorAll('[data-idx]').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.idx, 10) === current[key]);
      });
    }

    function updatePreview() {
      const preview = overlay.querySelector('#pg-builder-preview');
      // 3D preview — instantiate once, then just swap the rig on changes.
      if (typeof Playground3D !== 'undefined' && Playground3D.createPreview) {
        if (!previewHandle) {
          preview.innerHTML = '';
          previewHandle = Playground3D.createPreview(preview, current);
        } else {
          previewHandle.setCharacter(current);
        }
        return;
      }
      // 2D fallback (if Playground3D isn't loaded for some reason).
      preview.innerHTML = '';
      const sprite = Playground.renderCharacter(current);
      sprite.classList.add('pg-builder-sprite');
      preview.appendChild(sprite);
    }

    // Face column
    renderSwatches('skin',            Playground.SKIN_TONES);
    renderSwatches('eyeColor',        Playground.EYE_COLORS);
    renderLabels  ('eyeShape',        EYE_SHAPE_LABELS);
    renderLabels  ('facialHairStyle', FACIAL_HAIR_LABELS);
    renderSwatches('facialHairColor', Playground.HAIR_COLORS);
    renderLabels  ('glasses',         GLASSES_LABELS);
    // Hair & outfit column
    renderLabels  ('hairStyle',       HAIR_STYLE_LABELS);
    renderSwatches('hairColor',       Playground.HAIR_COLORS);
    renderLabels  ('hat',             HAT_LABELS);
    renderSwatches('shirtColor',      Playground.SHIRT_COLORS);
    renderSwatches('pantsColor',      Playground.PANTS_COLORS);
    renderSwatches('shoeColor',       Playground.SHOE_COLORS);
    renderLabels  ('build',           (Playground.BUILDS || []).map(b => b.name));
    renderLabels  ('gear',            Playground.GEAR_LABELS || []);
    renderPresets();
    updatePreview();

    function close() {
      if (previewHandle) { try { previewHandle.destroy(); } catch (_) {} previewHandle = null; }
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    overlay.querySelector('.pg-modal-close').addEventListener('click', () => {
      close();
      if (onCancel) onCancel();
    });
    overlay.querySelector('.pg-btn-cancel').addEventListener('click', () => {
      close();
      if (onCancel) onCancel();
    });

    const saveBtn = overlay.querySelector('.pg-btn-save');
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const res = await fetch(`${API}/profile/home-character`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${Auth.getToken()}`
          },
          body: JSON.stringify(current)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        close();
        if (onSave) onSave(data.homeCharacter || current);
      } catch (e) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
        const err = overlay.querySelector('.pg-builder-error') || (() => {
          const el = document.createElement('p');
          el.className = 'pg-builder-error';
          overlay.querySelector('.pg-modal-foot').prepend(el);
          return el;
        })();
        err.textContent = e.message;
      }
    });
  }

  return { open };
})();
