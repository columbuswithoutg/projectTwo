/************************************************
 * PROFILE VIEW
 ************************************************/
const ProfileView = {
  title: 'Profile',

  mount(container) {
    if (!Auth.isLoggedIn()) {
      Router.go('/login');
      return;
    }

    const adminLink = Auth.isAdmin()
      ? `<button id="admin-link-btn" class="admin-link-btn" title="Admin panel">⚙</button>`
      : `<div style="width:48px"></div>`;
    container.innerHTML = `
      <header id="header">
        <button id="back-btn">← Back</button>
        <h1>Profile</h1>
        ${adminLink}
      </header>

      <div id="profile-wrapper">
        <div id="profile-hero">
          <div id="profile-avatar-wrap">
            <img id="profile-avatar-img" src="" alt="" style="display:none" />
            <span id="profile-avatar-initials"></span>
            <button id="change-avatar-btn" title="Change avatar">✎</button>
          </div>
          <h2 id="profile-username"></h2>
        </div>

        <div id="profile-stats">
          <div class="stat-card">
            <span class="stat-value" id="stat-watched">—</span>
            <span class="stat-label">Watched</span>
          </div>
          <div class="stat-card">
            <span class="stat-value" id="stat-sessions">—</span>
            <span class="stat-label">Total Sessions</span>
          </div>
          <div class="stat-card">
            <span class="stat-value" id="stat-characters">—</span>
            <span class="stat-label">Characters Unlocked</span>
          </div>
          <div class="stat-card">
            <span class="stat-value" id="stat-memories">—</span>
            <span class="stat-label">Memories</span>
          </div>
        </div>

        <div id="profile-cowatcher" style="display:none">
          <p class="profile-section-label">Favourite Co-Watcher</p>
          <p id="cowatcher-name"></p>
        </div>

        <div id="profile-appearance">
          <p class="profile-section-label">Appearance</p>
          <div id="theme-toggle" role="radiogroup" aria-label="Theme">
            <button type="button" class="theme-option" data-mode="light">☀️ Light</button>
            <button type="button" class="theme-option" data-mode="dark">🌙 Dark</button>
            <button type="button" class="theme-option" data-mode="system">🖥️ System</button>
          </div>
        </div>

        <div id="avatar-picker" hidden>
          <p class="profile-section-label">Choose your hero</p>
          <p id="avatar-picker-empty" style="display:none">Watch more movies to unlock heroes!</p>
          <div id="avatar-picker-grid"></div>
        </div>
      </div>
    `;

    document.getElementById('back-btn').addEventListener('click', () => Router.go('/'));
    const adminLinkBtn = document.getElementById('admin-link-btn');
    if (adminLinkBtn) adminLinkBtn.addEventListener('click', () => Router.go('/admin'));

    // Appearance toggle — drives js/theme.js; active state mirrors the
    // SAVED mode ('system' when no explicit choice), not the resolved theme.
    const themeToggle = document.getElementById('theme-toggle');
    const syncThemeButtons = () => {
      const mode = Theme.get();
      themeToggle.querySelectorAll('.theme-option').forEach(b => {
        const on = b.dataset.mode === mode;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
        b.setAttribute('role', 'radio');
      });
    };
    themeToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.theme-option');
      if (!btn) return;
      Theme.set(btn.dataset.mode);
      syncThemeButtons();
    });
    syncThemeButtons();

    // DOM refs scoped to this mount
    const avatarImg      = document.getElementById('profile-avatar-img');
    const avatarInitials = document.getElementById('profile-avatar-initials');
    const usernameEl     = document.getElementById('profile-username');
    const statWatched    = document.getElementById('stat-watched');
    const statSessions   = document.getElementById('stat-sessions');
    const statChars      = document.getElementById('stat-characters');
    const statMemories   = document.getElementById('stat-memories');
    const coWatcherWrap  = document.getElementById('profile-cowatcher');
    const coWatcherName  = document.getElementById('cowatcher-name');
    const changeBtn      = document.getElementById('change-avatar-btn');
    const pickerWrap     = document.getElementById('avatar-picker');
    const pickerGrid     = document.getElementById('avatar-picker-grid');
    const pickerEmpty    = document.getElementById('avatar-picker-empty');

    function setAvatar(src, username) {
      if (src) {
        avatarImg.src = src;
        avatarImg.alt = username;
        avatarImg.style.display = 'block';
        avatarInitials.style.display = 'none';
      } else {
        avatarImg.style.display = 'none';
        avatarInitials.textContent = (username || '?')[0].toUpperCase();
        avatarInitials.style.display = 'flex';
      }
    }

    function buildAvatarPicker(watchedIds, currentPic) {
      const unlocked = characters.filter(c => watchedIds.has(c.debut));
      if (!unlocked.length) {
        pickerEmpty.style.display = 'block';
        return;
      }

      pickerGrid.innerHTML = '';
      unlocked.forEach(c => {
        const stages = typeof getCharStages === 'function'
          ? getCharStages(c, watchedIds)
          : [{ image: c.image, label: 'Default' }];

        stages.forEach(s => {
          const src = `assets/characters/${s.image}`;
          const btn = document.createElement('button');
          btn.className = 'avatar-option' + (src === currentPic ? ' selected' : '');
          btn.title = stages.length > 1 ? `${c.name} — ${s.label}` : c.name;

          const img = document.createElement('img');
          img.src = src;
          img.alt = c.name;
          img.loading = 'lazy';
          btn.appendChild(img);

          btn.onclick = async () => {
            const res = await fetch(`${API}/profile/picture`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${Auth.getToken()}`
              },
              body: JSON.stringify({ profilePicture: src })
            });
            const data = await res.json();
            if (data.error) return;

            setAvatar(src, usernameEl.textContent);
            pickerGrid.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
          };

          pickerGrid.appendChild(btn);
        });
      });
    }

    // Toggle picker
    changeBtn.addEventListener('click', () => {
      const willOpen = pickerWrap.hidden;
      pickerWrap.hidden = !willOpen;
      changeBtn.textContent = willOpen ? '✕' : '✎';
      if (willOpen) pickerWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    // Load profile data
    (async () => {
      try {
        const res = await fetch(`${API}/profile`, {
          headers: { Authorization: `Bearer ${Auth.getToken()}` }
        });
        const data = await res.json();
        if (data.error) return;

        usernameEl.textContent = data.username;
        setAvatar(data.profilePicture, data.username);

        statWatched.textContent  = data.stats.totalWatched;
        statSessions.textContent = data.stats.totalSessions;
        statMemories.textContent = data.stats.totalMemories;

        if (data.stats.topCoWatcher) {
          coWatcherName.textContent = data.stats.topCoWatcher;
          coWatcherWrap.style.display = 'block';
        }

        const progRes = await fetch(`${API}/progress/load`, {
          headers: { Authorization: `Bearer ${Auth.getToken()}` }
        });
        const prog = await progRes.json();
        const watchedIds = new Set(
          (prog.watchedProjects || []).filter(e => e.count > 0).map(e => e.projectId)
        );
        statChars.textContent = characters.filter(c => watchedIds.has(c.debut)).length;
        buildAvatarPicker(watchedIds, data.profilePicture);
      } catch {
        statChars.textContent = '?';
      }
    })();
  },

  unmount() {}
};
