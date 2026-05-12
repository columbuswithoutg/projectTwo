/************************************************
 * HOME — CHARACTER BUILDER (modal overlay)
 *
 * Four selectors — skin tone, hair (style + color), shirt color, pants
 * color — with a live SVG preview that re-renders on every change.
 * Saves the chosen indices to /api/profile/home-character. The Save
 * callback receives the new character so HomeView can hot-swap the
 * playground sprite without restarting the engine.
 ************************************************/
const HomeBuilder = (() => {

  const HAIR_STYLE_LABELS = ['Pixie', 'Bob', 'Spiky', 'Long', 'Bald', 'Cap', 'Ponytail', 'Mohawk', 'Afro', 'Curly'];

  function open({ initial, onSave, onCancel }) {
    const initialChar = initial ? { ...initial } : Playground.defaultCharacter();
    let current = { ...initialChar };

    const overlay = document.createElement('div');
    overlay.className = 'pg-modal-overlay';
    overlay.innerHTML = `
      <div class="pg-modal" role="dialog" aria-modal="true" aria-labelledby="pg-modal-title">
        <header class="pg-modal-head">
          <h2 id="pg-modal-title">Customize your character</h2>
          <button class="pg-modal-close" type="button" aria-label="Close">✕</button>
        </header>
        <div class="pg-modal-body">
          <div class="pg-modal-preview" id="pg-builder-preview"></div>
          <div class="pg-modal-controls">
            <fieldset class="pg-builder-group" data-key="skin">
              <legend>Skin</legend>
              <div class="pg-swatches" data-target="skin"></div>
            </fieldset>
            <fieldset class="pg-builder-group" data-key="hairStyle">
              <legend>Hair style</legend>
              <div class="pg-styles" data-target="hairStyle"></div>
            </fieldset>
            <fieldset class="pg-builder-group" data-key="hairColor">
              <legend>Hair color</legend>
              <div class="pg-swatches" data-target="hairColor"></div>
            </fieldset>
            <fieldset class="pg-builder-group" data-key="shirtColor">
              <legend>Shirt</legend>
              <div class="pg-swatches" data-target="shirtColor"></div>
            </fieldset>
            <fieldset class="pg-builder-group" data-key="pantsColor">
              <legend>Pants</legend>
              <div class="pg-swatches" data-target="pantsColor"></div>
            </fieldset>
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

    function renderHairStyles() {
      const host = overlay.querySelector('[data-target="hairStyle"]');
      host.innerHTML = HAIR_STYLE_LABELS.map((label, idx) => `
        <button type="button" class="pg-style" data-idx="${idx}">${label}</button>
      `).join('');
      markActive('hairStyle');
      host.querySelectorAll('.pg-style').forEach(btn => {
        btn.addEventListener('click', () => {
          current.hairStyle = parseInt(btn.dataset.idx, 10);
          markActive('hairStyle');
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
      preview.innerHTML = '';
      // Render at 2× scale for visibility.
      const sprite = Playground.renderCharacter(current);
      sprite.classList.add('pg-builder-sprite');
      preview.appendChild(sprite);
    }

    renderSwatches('skin', Playground.SKIN_TONES);
    renderHairStyles();
    renderSwatches('hairColor', Playground.HAIR_COLORS);
    renderSwatches('shirtColor', Playground.SHIRT_COLORS);
    renderSwatches('pantsColor', Playground.PANTS_COLORS);
    updatePreview();

    function close() {
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
