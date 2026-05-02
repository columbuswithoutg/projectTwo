/************************************************
 * HOME VIEW — /home
 *
 * The playground room. Mounts the Playground engine, fetches the user's
 * saved homeCharacter (or opens the builder modal on first visit),
 * surfaces a Customize button, and exposes the same nav drawer as the
 * other primary views so users can navigate out.
 ************************************************/
const HomeView = {
  title: 'Home — MCU Tracker',

  mount(container) {
    if (!Auth.isLoggedIn()) {
      Router.go('/login');
      return;
    }

    container.innerHTML = `
      <header id="header" class="pg-header">
        <button id="nav-toggle">☰</button>
        <h1 class="pg-title">Home</h1>
        <button id="pg-customize-btn" title="Customize character">✎</button>

        <div id="nav-drawer">
          <div id="nav-drawer-overlay"></div>
          <div id="nav-drawer-content">
            <button id="close-drawer">✕</button>
            <nav>
              <button data-route="/">📋 Watch Order</button>
              <button data-route="/map">🗺 Universe Map</button>
              <button data-route="/profile">👤 Profile</button>
              <button data-route="/characters">🦸 Characters</button>
              <button id="logout-btn">🚪 Logout</button>
            </nav>
          </div>
        </div>
      </header>

      <div id="pg-stage" class="pg-stage"></div>
    `;

    // Drawer wiring (same pattern as watchorder/app views).
    const drawer = document.getElementById('nav-drawer');
    const closeDrawer = () => drawer.classList.remove('open');
    document.getElementById('nav-toggle').addEventListener('click', () => drawer.classList.add('open'));
    document.getElementById('close-drawer').addEventListener('click', closeDrawer);
    document.getElementById('nav-drawer-overlay').addEventListener('click', closeDrawer);
    document.querySelectorAll('#nav-drawer-content nav button[data-route]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeDrawer();
        Router.go(btn.dataset.route);
      });
    });
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      Auth.logout();
    });

    document.getElementById('pg-customize-btn').addEventListener('click', () => {
      HomeView._openBuilder();
    });

    HomeView._stage = document.getElementById('pg-stage');
    HomeView._loadAndStart();
  },

  async _loadAndStart() {
    let character = null;
    try {
      const res = await fetch(`${API}/profile/home-character`, {
        headers: { Authorization: `Bearer ${Auth.getToken()}` }
      });
      if (res.ok) {
        const data = await res.json();
        character = data.homeCharacter;
      }
    } catch (_) {
      // Network/server issue — fall through with null and use defaults so
      // the user isn't locked out of the playground.
    }

    const isFresh = !character || character.skin == null;
    HomeView._character = character && character.skin != null ? character : null;
    Playground.init(HomeView._stage, HomeView._character || Playground.defaultCharacter());

    if (isFresh) {
      // First-time visitor — open the builder right away with defaults.
      HomeView._openBuilder({ firstTime: true });
    }
  },

  _openBuilder({ firstTime = false } = {}) {
    HomeBuilder.open({
      initial: HomeView._character || Playground.defaultCharacter(),
      onSave: (saved) => {
        HomeView._character = saved;
        Playground.setCharacter(saved);
      },
      onCancel: () => {
        // First-time cancel keeps the default so the engine still has
        // something visible. Nothing to revert otherwise.
        if (firstTime) {
          // no-op: default is already drawn
        }
      }
    });
  },

  unmount() {
    Playground.destroy();
    HomeView._stage = null;
    HomeView._character = null;
  }
};
