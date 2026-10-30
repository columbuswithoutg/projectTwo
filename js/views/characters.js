/************************************************
 * CHARACTERS VIEW
 ************************************************/
const CharactersView = {
  title: 'MCU Characters',

  mount(container) {
    if (!Auth.isLoggedIn()) {
      Router.go('/login');
      return;
    }

    container.innerHTML = `
      <header id="header">
        <button id="back-btn">← Back</button>
        <h1>Characters</h1>
        <div style="width:48px"></div>
      </header>

      <div id="characters-wrapper">
        <div id="characters-filter">
          <label class="visually-hidden" for="search-input">Search characters</label>
          <input id="search-input" type="search" placeholder="Search characters…" autocomplete="off" />
          <p id="unlocked-count"></p>
        </div>
        <div id="characters-grid"></div>
      </div>
    `;

    document.getElementById('back-btn').addEventListener('click', () => Router.back('/'));

    this._load();
  },

  async _load() {
    const watchedIds = await this._getWatchedIds();
    // Shared bodies (Hulk / Bruce Banner) are separate cards on this page.
    const entries = characterPageEntries(characters);
    const unlocked = entries.filter(c => isCharUnlocked(c, watchedIds));
    const byId = new Map(unlocked.map(c => [c.id, c]));
    const totalText = `${unlocked.length} of ${entries.length} unlocked`;

    const countEl = document.getElementById('unlocked-count');
    if (countEl) countEl.textContent = totalText;

    const renderGrid = (filter = '') => {
      const grid = document.getElementById('characters-grid');
      if (!grid) return [];

      const filtered = characterSearch(unlocked, filter);

      if (!filtered.length) {
        grid.innerHTML = `<p class="characters-empty">
          ${filter ? 'No characters match your search.' : 'No characters unlocked yet. Start watching!'}
        </p>`;
        return filtered;
      }

      grid.innerHTML = filtered.map(c => `
          <button type="button" class="character-card" data-id="${esc(c.id)}" aria-haspopup="dialog">
            <span class="character-avatar">${PosterArt.charHtml(c, getCharImage(c, watchedIds), { alt: '' })}</span>
            <span class="character-name">${esc(c.name)}</span>
          </button>`).join('');
      return filtered;
    };

    renderGrid();

    const grid = document.getElementById('characters-grid');
    if (grid) {
      grid.addEventListener('click', (e) => {
        const card = e.target.closest('.character-card');
        const c = card && byId.get(card.dataset.id);
        if (c) this._openDetail(c, byId, watchedIds);
      });
    }

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const visible = renderGrid(e.target.value).length;
        const el = document.getElementById('unlocked-count');
        if (el) {
          el.textContent = e.target.value.trim()
            ? `${visible} result${visible !== 1 ? 's' : ''}`
            : totalText;
        }
      });
    }
  },

  // Detail sheet: summary, the looks unlocked so far (oldest first, the
  // newest is the one on the card) and links to anyone sharing the body.
  _openDetail(c, byId, watchedIds) {
    const overlay = document.createElement('div');
    overlay.className = 'char-detail-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'char-detail-name');
    document.body.appendChild(overlay);

    const projectLabel = (id) => {
      const p = Array.isArray(projects) ? projects.find(x => x.id === id) : null;
      if (!p) return '';
      const year = PosterArt.yearOf(p);
      return `${esc(p.title)}${year ? ` <span class="char-detail-year">(${year})</span>` : ''}`;
    };

    const render = (ch) => {
      const looks = getCharStages(ch, watchedIds);
      const lockedCount = (ch.stages || []).length + 1 - looks.length;
      const summary = characterSummary(ch);
      const debut = projectLabel(ch.debut);
      const mates = (ch.body || []).map(id => byId.get(id)).filter(Boolean);

      overlay.innerHTML = `
        <div class="char-detail">
          <button type="button" class="popup-close" aria-label="Close">✕</button>
          <div class="char-detail-hero">
            <span class="character-avatar char-detail-avatar">${PosterArt.charHtml(ch, getCharImage(ch, watchedIds), { alt: '', lazy: false })}</span>
            <div>
              <h2 id="char-detail-name">${esc(ch.name)}</h2>
              ${debut ? `<p class="char-detail-debut">First seen in ${debut}</p>` : ''}
            </div>
          </div>
          ${summary ? `<p class="char-detail-summary">${esc(summary)}</p>` : ''}
          ${mates.length ? `
            <section class="char-detail-section">
              <h3>Shares a body with</h3>
              <div class="char-detail-mates">
                ${mates.map(m => `
                  <button type="button" class="char-detail-mate" data-id="${esc(m.id)}">
                    <span class="character-avatar">${PosterArt.charHtml(m, getCharImage(m, watchedIds), { alt: '' })}</span>
                    <span>${esc(m.name)}</span>
                  </button>`).join('')}
              </div>
            </section>` : ''}
          <section class="char-detail-section">
            <h3>Versions</h3>
            <ol class="char-detail-looks">
              ${looks.map((l, i) => `
                <li class="char-detail-look${i === looks.length - 1 ? ' is-current' : ''}">
                  <span class="character-avatar">${PosterArt.charHtml(ch, l.image, { alt: '' })}</span>
                  <span class="char-detail-look-text">
                    <span class="char-detail-look-label">${esc(l.label === 'Default' ? 'Original look' : l.label)}</span>
                    ${projectLabel(l.after) ? `<span class="char-detail-look-from">${projectLabel(l.after)}</span>` : ''}
                  </span>
                  ${i === looks.length - 1 && looks.length > 1 ? '<span class="char-detail-badge">Current</span>' : ''}
                </li>`).join('')}
            </ol>
            ${lockedCount > 0 ? `<p class="char-detail-locked">${lockedCount} more version${lockedCount !== 1 ? 's' : ''} to unlock as you keep watching.</p>` : ''}
          </section>
        </div>`;

      overlay.querySelector('.popup-close').addEventListener('click', () => close());
      overlay.querySelectorAll('.char-detail-mate').forEach(btn => {
        btn.addEventListener('click', () => {
          const next = byId.get(btn.dataset.id);
          if (!next) return;
          render(next);
          overlay.querySelector('.popup-close').focus();
        });
      });
    };

    render(c);
    const close = wireModalDismiss(overlay, () => overlay.remove());
  },

  // Every view is behind the auth gate, so there is no guest copy to read.
  async _getWatchedIds() {
    if (Auth.getToken()) {
      try {
        const res = await Auth.fetch(`${API}/progress/load`);
        if (res.ok) {
          const { watchedProjects } = await res.json();
          const ids = new Set();
          watchedProjects.forEach(entry => {
            if (entry.count > 0) ids.add(entry.projectId);
          });
          return ids;
        }
      } catch (e) {
        console.warn('Failed to load from API:', e);
      }
    }
    return new Set();
  },

  unmount() {}
};
