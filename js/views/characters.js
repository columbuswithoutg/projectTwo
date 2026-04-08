/************************************************
 * CHARACTERS VIEW
 ************************************************/
const CharactersView = {
  title: 'MCU Characters',

  mount(container) {
    if (!Auth.isLoggedIn()) {
      Router.go('/');
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
          <input id="search-input" type="text" placeholder="Search characters..." />
          <p id="unlocked-count"></p>
        </div>
        <div id="characters-grid"></div>
      </div>
    `;

    document.getElementById('back-btn').addEventListener('click', () => Router.go('/app'));

    this._load();
  },

  async _load() {
    const watchedIds = await this._getWatchedIds();
    const unlocked = characters.filter(c => watchedIds.has(c.debut));

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
            ${img
              ? `<img class="character-avatar-img" src="assets/characters/${img}" alt="${c.name}" loading="lazy"
                   onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'" />
                 <div class="character-avatar" style="display:none">
                   ${c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                 </div>`
              : `<div class="character-avatar">
                   ${c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                 </div>`
            }
            <p class="character-name">${c.name}</p>
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

  async _getWatchedIds() {
    const token = Auth.getToken();
    if (token) {
      try {
        const res = await fetch(`${API}/progress/load`, {
          headers: { Authorization: `Bearer ${token}` }
        });
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
    try {
      const saved = JSON.parse(localStorage.getItem('watchProgress_v2') || '{}');
      const ids = new Set();
      Object.entries(saved).forEach(([id, val]) => {
        if (val === true) ids.add(id);
        else if (val && typeof val === 'object' && val.count > 0) ids.add(id);
      });
      return ids;
    } catch {
      return new Set();
    }
  },

  unmount() {}
};
