/************************************************
 * APP VIEW — Main watch order tracker
 ************************************************/
const AppView = {
  title: 'Universe Map',
  _mountSeq: 0,

  mount(container) {
    if (!Auth.isLoggedIn()) {
      Router.go('/login');
      return;
    }

    container.innerHTML = `
      <header id="header">
        ${NavDrawer.toggleHtml()}

        <div class="view-tabs" role="tablist" aria-label="View mode">
          <button class="view-tab" data-route="/" role="tab" aria-selected="false"><span class="vt-long">Watch </span>Order</button>
          <button class="view-tab" data-route="/board" role="tab" aria-selected="false">Board</button>
          <button class="view-tab" data-route="/feed" role="tab" aria-selected="false">Feed</button>
          <button class="view-tab" data-route="/world" role="tab" aria-selected="false">World</button>
        </div>

        ${NavDrawer.html('full')}
        <button id="header-profile-btn" title="Profile" aria-label="Profile">
          <img id="header-avatar" src="" alt="" style="display:none" />
          <span id="header-avatar-initials">👤</span>
        </button>
      </header>

      <div id="map-wrapper">
        <div id="world-viewport">
          <div id="map-container">
            <!-- All backdrop layers live INSIDE #map-container so the
                 fight-zoom transform applies to continents, starfield,
                 glows, roads, and pins together. When any of these sit
                 outside they get "left behind" during a zoom — the world
                 map stays put while the pins scale, which looks broken. -->
            <svg id="world-continents" aria-hidden="true" viewBox="0 0 8000 3400" preserveAspectRatio="none"></svg>
            <div id="cosmos-starfield" aria-hidden="true"></div>
            <div id="region-glows" aria-hidden="true"></div>
            <svg id="connections"></svg>
            <div id="nodes"></div>
            <div id="cluster-labels" aria-hidden="true"></div>
          </div>
        </div>

        <button id="world-view-btn" aria-label="Show world view" title="World view (W)">
          <span aria-hidden="true">🌍</span>
        </button>
      </div>

      <div id="up-next-shelf" aria-label="Up next to watch">
        <span class="shelf-label">UP NEXT</span>
        <div class="shelf-track"></div>
      </div>
    `;

    // Wired before _setup()'s awaits: the avatar button used to stay dead
    // until progress AND walkers had loaded.
    container.querySelector('#header-profile-btn')?.addEventListener('click', () => {
      Router.go('/profile');
    });

    this._setup();
  },

  async _setup() {
    const seq = ++AppView._mountSeq;
    await state.ensureLoaded();
    // Superseded while progress loaded (remounted by boot's content refresh,
    // or left): only the latest mount may build the map.
    if (seq !== AppView._mountSeq) return;
    // Re-derive the project fields on every mount: boot.js swaps
    // `projects` for the DB copy in the background and that array carries no
    // phaseNum/unlocks, which makes isUnlocked() false for everything and
    // leaves the map with no pins at all.
    state.initProjects(projects);

    // Re-bind renderer to fresh DOM elements
    renderer.init();

    // Drawer (js/nav-drawer.js): open / close, the shared buttons (log out,
    // friends, report, goals, walkers, character editor, messages badge) and
    // the Fights / Dialogues toggles, whose labels it re-reads on every open.
    NavDrawer.wire(document, { actions: true, walkerToggles: true });

    // View-mode tab toggle (Watch Order ↔ World) — the two focal surfaces.
    // On /map neither is active; the tabs act as quick jumps to a focal view.
    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const route = tab.dataset.route;
        if (route) Router.go(route);
      });
    });

    // Render map
    renderer.setCenterTarget(state.getLastWatchedId());
    renderer.render();

    // Walkers run on the map adapter while this view is active.
    WalkerView.set(MapWalkerAdapter);

    // Init walkers
    await Walkers.init();
    if (seq !== AppView._mountSeq) return;
    // Track the deploy delay so unmount can cancel it — otherwise a fast
    // logout within 500ms triggers deploy() against a destroyed renderer.
    AppView._deployTimer = setTimeout(() => {
      AppView._deployTimer = null;
      Walkers.deploy();
    }, 500);

    // Header avatar — instant initials, then upgrade to the profile photo.
    initHeaderAvatar();
  },

  unmount() {
    AppView._mountSeq++;   // a setup still awaiting progress must not finish
    if (AppView._deployTimer) {
      clearTimeout(AppView._deployTimer);
      AppView._deployTimer = null;
    }
    Walkers.destroy();
    // No adapter while no walker view is mounted, so a late deploy() (e.g.
    // FriendView.exit → restoreSelections) is a no-op (MAP2-05).
    if (typeof WalkerView !== 'undefined') WalkerView.set(null);
    renderer.destroy();
    renderer.wrapper = null;
    renderer.viewport = null;
    renderer.mapContainer = null;
    renderer.nodesContainer = null;
    renderer.svg = null;
    renderer.labelsContainer = null;
    renderer.glowsContainer = null;
    renderer.continentsSvg = null;
    renderer.worldViewBtn = null;
    renderer.shelfTrack = null;
    renderer.shelfContainer = null;
  }
};
