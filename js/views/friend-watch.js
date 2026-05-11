/************************************************
 * FRIEND WATCH VIEW — /friend/:username
 *
 * Renders the friend's flowchart watch order. Stripped-down counterpart
 * to WatchOrderView — only the friend header is shown above the canvas;
 * no drawer / view tabs / friends panel / clear-progress / logout, since
 * those would mutate the viewer's own account.
 ************************************************/
const FriendWatchView = {
  title: 'Friend — Watch Order',

  async mount(container, params) {
    if (!Auth.isLoggedIn()) {
      Router.go('/login');
      return;
    }
    const username = params && params.username;
    if (!username) { Router.go('/'); return; }

    const friend = await FriendView.enter(username);
    if (!friend) {
      FriendView.render404(container, username);
      return;
    }

    container.innerHTML = `
      ${FriendView.renderHeader('watch')}
      <div class="flow-wrapper">
        <div class="flow-canvas">
          <svg class="flow-arrows" xmlns="http://www.w3.org/2000/svg"></svg>
          <div class="flow-nodes"></div>
          <div class="flow-walkers"></div>
        </div>
      </div>
    `;
    FriendView.wireHeader(container);

    state.initProjects(projects);
    orderRenderer.init();
    orderRenderer.render();

    WalkerView.set(FlowWalkerAdapter);
    await Walkers.init();
    FriendWatchView._deployTimer = setTimeout(() => {
      FriendWatchView._deployTimer = null;
      Walkers.deploy();
    }, 500);
  },

  unmount() {
    if (FriendWatchView._deployTimer) {
      clearTimeout(FriendWatchView._deployTimer);
      FriendWatchView._deployTimer = null;
    }
    if (typeof Walkers !== 'undefined' && Walkers.destroy) Walkers.destroy();
    if (typeof orderRenderer !== 'undefined' && orderRenderer.destroy) orderRenderer.destroy();
  }
};
