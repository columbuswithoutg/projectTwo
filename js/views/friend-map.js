/************************************************
 * FRIEND MAP VIEW — /friend/:username/map
 *
 * Renders the friend's universe map. Stripped-down counterpart to
 * AppView — only the friend header is shown above the map; no drawer,
 * view tabs, walker picker, fight toggle, etc.
 ************************************************/
const FriendMapView = {
  title: 'Friend — Universe Map',

  async mount(container, params) {
    if (!Auth.isLoggedIn()) {
      Router.go('/login');
      return;
    }
    const username = params && params.username;
    if (!username) { Router.go('/'); return; }

    // Mount token: unmount() bumps it so a late await never draws over the
    // next page (same pattern as world.js _mountSeq).
    const myMount = FriendMapView._mountSeq = (FriendMapView._mountSeq || 0) + 1;
    const friend = await FriendView.enter(username);
    if (myMount !== FriendMapView._mountSeq) return;
    if (!friend) {
      FriendView.render404(container, username);
      return;
    }

    container.innerHTML = `
      ${FriendView.renderHeader('map')}
      <div id="map-wrapper">
        <div id="world-viewport">
          <div id="map-container">
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
    `;
    FriendView.wireHeader(container);

    state.initProjects(projects);
    renderer.init();
    renderer.setCenterTarget(state.getLastWatchedId());
    renderer.render();

    WalkerView.set(MapWalkerAdapter);
    await Walkers.init();
    if (myMount !== FriendMapView._mountSeq) return;
    FriendMapView._deployTimer = setTimeout(() => {
      FriendMapView._deployTimer = null;
      Walkers.deploy();
    }, 500);
  },

  unmount() {
    FriendMapView._mountSeq = (FriendMapView._mountSeq || 0) + 1;
    if (FriendMapView._deployTimer) {
      clearTimeout(FriendMapView._deployTimer);
      FriendMapView._deployTimer = null;
    }
    if (typeof Walkers !== 'undefined' && Walkers.destroy) Walkers.destroy();
    if (typeof renderer !== 'undefined' && renderer.destroy) renderer.destroy();
  }
};
