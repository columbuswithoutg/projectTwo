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
    const unlocked = characters.filter(c => isCharUnlocked(c, watchedIds));

    const countEl = document.getElementById('unlocked-count');
    if (countEl) countEl.textContent = `${unlocked.length} of ${characters.length} unlocked`;

    const renderGrid = (filter = '') => {
      const grid = document.getElementById('characters-grid');
      if (!grid) return;

      const filtered = unlocked.filter(c =>
        c.name.toLowerCase().includes(filter.toLowerCase())
      );

      if (!filtered.length) {
        grid.innerHTML = `<p class="characters-empty">
          ${filter ? 'No characters match your search.' : 'No characters unlocked yet. Start watching!'}
        </p>`;
        return;
      }

      grid.innerHTML = filtered.map(c => {
        const img = typeof getCharImage === 'function' ? getCharImage(c, watchedIds) : c.image;
        return `
          <div class="character-card">
            <div class="character-avatar">${PosterArt.charHtml(c, img)}</div>
            <p class="character-name">${esc(c.name)}</p>
          </div>`;
      }).join('');
    };

    renderGrid();

    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        renderGrid(e.target.value);
        const visible = unlocked.filter(c =>
          c.name.toLowerCase().includes(e.target.value.toLowerCase())
        ).length;
        const el = document.getElementById('unlocked-count');
        if (el) {
          el.textContent = e.target.value
            ? `${visible} result${visible !== 1 ? 's' : ''}`
            : `${unlocked.length} of ${characters.length} unlocked`;
        }
      });
    }
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
