/************************************************
 * PROFILE VIEW
 ************************************************/
const ProfileView = {
  title: 'Profile',

  // "Characters Unlocked": counted over the same entries /characters shows
  // ("N of M unlocked"), where shared bodies (Hulk / Bruce Banner, …) are
  // separate cards, so both pages give the same number.
  charactersUnlocked(watchedIds) {
    return characterPageEntries(characters).filter(c => isCharUnlocked(c, watchedIds)).length;
  },

  // The island games: "🎬 Iron Man 1,773" for every island where this user
  // holds the Scene Guess record, "💬 Iron Man 9,100" for Quote Guess, and
  // how many of their suggested quotes made it into Quote Guess. Empty — and
  // hidden — while the games are switched off. Shared with the friend
  // profile (js/views/friend-profile.js).
  async championBadges(el, username) {
    if (!el || !username) return;
    const get = async (game) => {
      try {
        const res = await Auth.fetch(`${API}/world/${game}/champions?user=${encodeURIComponent(username)}`);
        return res.ok ? await res.json() : null;
      } catch (_) { return null; }
    };
    const [scene, quote] = await Promise.all([get('scene'), get('quote')]);
    const badge = (i, icon, game) => `
      <span class="profile-champion-badge" title="${game} island record">${icon} ${esc(i.title)} <b>${Number(i.score).toLocaleString()}</b></span>`;
    const items = [].concat(
      ((scene && scene.items) || []).map(i => badge(i, '🎬', 'Scene Guess')),
      ((quote && quote.items) || []).map(i => badge(i, '💬', 'Quote Guess')));
    const lines = (quote && Number(quote.linesAdded)) || 0;
    if ((!items.length && !lines) || !el.isConnected) return;
    el.innerHTML = `
      <p class="profile-section-label">${items.length ? '👑 Island champion' : '💬 Quote Guess'}</p>
      <div class="profile-champion-list">
        ${items.join('')}
        ${lines ? `<span class="profile-champion-badge is-lines" title="Quotes they suggested that are now in Quote Guess">💬 Lines added <b>${lines.toLocaleString()}</b></span>` : ''}
      </div>`;
    el.hidden = false;
  },

  mount(container) {
    if (!Auth.isLoggedIn()) {
      Router.go('/login');
      return;
    }

    const adminLink = Auth.isAdmin()
      ? `<button id="admin-link-btn" class="admin-link-btn" type="button" title="Admin panel" aria-label="Admin panel">⚙</button>`
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
            <button id="change-avatar-btn" type="button" title="Change picture" aria-label="Change picture" aria-expanded="false" aria-controls="profile-avatar-picker">✎</button>
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

        <div id="profile-champion" class="profile-champion" hidden></div>

        <div id="profile-cowatcher" style="display:none">
          <p class="profile-section-label">Favourite Co-Watcher</p>
          <p id="cowatcher-name"></p>
        </div>

        <div id="profile-share">
          <p class="profile-section-label">Share your progress</p>
          <p class="profile-share-text">Post your road to Avengers: Doomsday to your Instagram or Facebook story. Friends who tap your link see your checklist and watch order — no account needed.</p>
          <p class="profile-share-status" id="profile-share-status" hidden></p>
          <div class="profile-support-actions">
            <button type="button" class="profile-support-btn primary" id="profile-share-btn">Share to story</button>
            <button type="button" class="profile-support-btn" id="profile-share-off" hidden>Turn off link</button>
          </div>
        </div>

        <div id="profile-appearance">
          <p class="profile-section-label">Appearance</p>
          <div id="theme-toggle" role="radiogroup" aria-label="Theme">
            <button type="button" class="theme-option" data-mode="cinematic">
              <span class="theme-swatch theme-swatch--cinematic" aria-hidden="true"></span>Cinematic
            </button>
            <button type="button" class="theme-option" data-mode="comic">
              <span class="theme-swatch theme-swatch--comic" aria-hidden="true"></span>Comic
            </button>
            <button type="button" class="theme-option" data-mode="system">
              <span class="theme-swatch theme-swatch--system" aria-hidden="true"></span>System
            </button>
          </div>
          <p class="theme-hint">System follows your device: dark → Cinematic, light → Comic.</p>
        </div>

        <div id="profile-support">
          <p class="profile-section-label">Support</p>
          <div class="profile-support-actions">
            <button type="button" class="profile-support-btn" id="profile-messages-btn">Messages <span class="nav-badge" data-unread-badge hidden></span></button>
            <button type="button" class="profile-support-btn" id="profile-reports-btn">My reports</button>
            <button type="button" class="profile-support-btn primary" id="profile-report-btn">Report a bug or idea</button>
          </div>
        </div>

        <div id="avatar-picker" hidden>
          <p class="profile-section-label">Choose your hero</p>
          <p id="avatar-picker-empty" style="display:none">Watch more movies to unlock heroes!</p>
          <div id="avatar-picker-grid"></div>
        </div>
      </div>
    `;

    document.getElementById('back-btn').addEventListener('click', () => Router.back('/'));
    const adminLinkBtn = document.getElementById('admin-link-btn');
    if (adminLinkBtn) adminLinkBtn.addEventListener('click', () => Router.go('/admin'));
    document.getElementById('profile-messages-btn').addEventListener('click', () => Router.go('/messages'));
    document.getElementById('profile-reports-btn').addEventListener('click', () => Router.go('/reports'));
    document.getElementById('profile-report-btn').addEventListener('click', () => showReportDialog());
    MessagesBadge.apply();

    // Share your progress: whether the link is on, and how many joined from it.
    const shareStatus = document.getElementById('profile-share-status');
    const shareOff = document.getElementById('profile-share-off');
    const paintShare = (info) => {
      if (!shareStatus.isConnected) return;
      shareOff.hidden = !(info && info.enabled);
      if (!info || !info.enabled) { shareStatus.hidden = true; return; }
      const joins = info.joins || 0;
      shareStatus.textContent = `Your link is on${joins ? ` · ${joins} ${joins === 1 ? 'person' : 'people'} joined from it` : ''}.`;
      shareStatus.hidden = false;
    };
    ShareProgress.link().then(paintShare).catch(() => {});
    // The dialog turns the link on (and can turn it off): keep this status in step.
    document.getElementById('profile-share-btn').addEventListener('click', () => ShareProgress.open({ onChange: paintShare }));
    shareOff.addEventListener('click', async () => {
      try {
        const info = await ShareProgress.turnOff();
        if (info) paintShare(info);
      } catch (_) {
        toast('Couldn’t turn the link off — try again.', 'error');
      }
    });

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

    function showInitials(username) {
      avatarImg.style.display = 'none';
      avatarInitials.textContent = (username || '?')[0].toUpperCase();
      avatarInitials.style.display = 'flex';
    }
    function setAvatar(src, username) {
      if (src) {
        // A portrait file that doesn't exist (isaiah.jpg) falls back to the
        // initial instead of a broken-image icon. (Property handlers are
        // fine under the CSP; only inline onerror= attributes are blocked.)
        avatarImg.onerror = () => showInitials(username);
        avatarImg.src = profilePicUrl(src);
        avatarImg.alt = username;
        avatarImg.style.display = 'block';
        avatarInitials.style.display = 'none';
      } else {
        avatarImg.onerror = null;
        showInitials(username);
      }
    }

    function buildAvatarPicker(watchedIds, currentPic) {
      const unlocked = characters.filter(c => isCharUnlocked(c, watchedIds));
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
          btn.type = 'button';
          btn.setAttribute('aria-label', btn.title);
          btn.setAttribute('aria-pressed', String(src === currentPic));

          // Monogram under the portrait — shows when the file is missing.
          // ...and a portrait that doesn't load can't be picked: saving it
          // would put a broken picture on the profile, feed and messages.
          // The portrait's own <img> is the probe (no second request per
          // option); PosterArt's capture listener removes it first, but the
          // event still reaches this target listener.
          const portrait = PosterArt.charMount(btn, c, s.image, { lazy: false });
          if (portrait) portrait.addEventListener('error', () => {
            btn.disabled = true;
            btn.classList.add('avatar-option-missing');   // styles/legacy/11-profile.css
            btn.title = `${btn.title} (picture unavailable)`;
            btn.setAttribute('aria-label', btn.title);
          }, { once: true });

          btn.onclick = async () => {
            if (btn.disabled) return;
            // A failed save used to do nothing at all (and a network error
            // threw out of the handler) — now it says so and keeps the old pick.
            if (btn.getAttribute('aria-busy') === 'true') return;
            btn.setAttribute('aria-busy', 'true');
            try {
              const res = await Auth.fetch(`${API}/profile/picture`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ profilePicture: src })
              });
              let data = null;
              try { data = await res.json(); } catch (_) {}
              if (!res.ok || !data || data.error) throw new Error((data && data.error) || `HTTP ${res.status}`);

              setAvatar(src, usernameEl.textContent);
              pickerGrid.querySelectorAll('.avatar-option').forEach(b => { b.classList.remove('selected'); b.setAttribute('aria-pressed', 'false'); });
              btn.classList.add('selected');
              btn.setAttribute('aria-pressed', 'true');
              if (typeof PostComposer !== 'undefined' && PostComposer.setProfilePic) PostComposer.setProfilePic(src);
              toast('Profile picture updated.', 'success');
            } catch (e) {
              toast('Couldn’t change your picture — try again.', 'error');
            } finally {
              btn.removeAttribute('aria-busy');
            }
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
      changeBtn.setAttribute('aria-expanded', String(willOpen));
      const label = willOpen ? 'Close picture picker' : 'Change picture';
      changeBtn.setAttribute('aria-label', label);
      changeBtn.title = label;
      if (willOpen) pickerWrap.scrollIntoView({ behavior: smoothBehavior(), block: 'nearest' });
    });

    // Load profile data
    (async () => {
      try {
        const res = await Auth.fetch(`${API}/profile`);
        const data = await res.json();
        if (data.error) return;

        usernameEl.textContent = data.username;
        setAvatar(data.profilePicture, data.username);
        ProfileView.championBadges(document.getElementById('profile-champion'), data.username);

        statWatched.textContent  = data.stats.totalWatched;
        statSessions.textContent = data.stats.totalSessions;
        statMemories.textContent = data.stats.totalMemories;

        if (data.stats.topCoWatcher) {
          coWatcherName.textContent = data.stats.topCoWatcher;
          coWatcherWrap.style.display = 'block';
        }

        const progRes = await Auth.fetch(`${API}/progress/load`);
        const prog = await progRes.json();
        const watchedIds = new Set(
          (prog.watchedProjects || []).filter(e => e.count > 0).map(e => e.projectId)
        );
        statChars.textContent = ProfileView.charactersUnlocked(watchedIds);
        buildAvatarPicker(watchedIds, data.profilePicture);
      } catch {
        statChars.textContent = '?';
      }
    })();
  },

  unmount() {}
};
