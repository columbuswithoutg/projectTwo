// Auth guard
if (!localStorage.getItem('mcu_token')) {
    window.location.href = '/index.html';
}

const API = window.location.origin + "/api";

// Read watched progress from MongoDB if logged in, otherwise localStorage
async function getWatchedIds() {
    const token = localStorage.getItem('mcu_token');
    
    if (token) {
        // User is logged in - fetch from API
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
            console.warn("Failed to load from API, falling back to localStorage:", e);
        }
    }
    
    // Fallback to localStorage
    try {
        const saved = JSON.parse(localStorage.getItem('watchProgress_v2') || '{}');
        const ids = new Set();
        Object.entries(saved).forEach(([id, val]) => {
            if (val === true) ids.add(id);
            else if (val && typeof val === 'object' && val.count > 0) ids.add(id);
        });
        return ids;
    } catch (e) {
        return new Set();
    }
}

// Initialize with async function
async function init() {
    const watchedIds = await getWatchedIds();
    const unlocked = characters.filter(c => watchedIds.has(c.debut));

    // Update count
    document.getElementById('unlocked-count').textContent =
        `${unlocked.length} of ${characters.length} unlocked`;

    // Render grid
    function renderGrid(filter = '') {
        const grid = document.getElementById('characters-grid');
        const filtered = unlocked.filter(c =>
            c.name.toLowerCase().includes(filter.toLowerCase())
        );

        if (!filtered.length) {
            grid.innerHTML = `<p class="characters-empty">
          ${filter ? 'No characters match your search.' : 'No characters unlocked yet. Start watching!'}
        </p>`;
            return;
        }

        grid.innerHTML = filtered.map(c => `
      <div class="character-card">
        ${c.image
                ? `<img
               class="character-avatar-img"
               src="assets/characters/${c.image}"
               alt="${c.name}"
               onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'"
             />
             <div class="character-avatar" style="display:none">
               ${c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
             </div>`
                : `<div class="character-avatar">
               ${c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
             </div>`
            }
        <p class="character-name">${c.name}</p>
      </div>
    `).join('');
    }

    renderGrid();

    // Search
    document.getElementById('search-input').addEventListener('input', (e) => {
        renderGrid(e.target.value);
        const visible = unlocked.filter(c =>
            c.name.toLowerCase().includes(e.target.value.toLowerCase())
        ).length;
        document.getElementById('unlocked-count').textContent =
            e.target.value
                ? `${visible} result${visible !== 1 ? 's' : ''}`
                : `${unlocked.length} of ${characters.length} unlocked`;
    });
}

// Start the app
init();