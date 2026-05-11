/************************************************
 * FRIEND HOME VIEW — /friend/:username/home
 *
 * Renders the friend's 3D home read-only — same Playground3D engine,
 * fed the friend's homeCharacter + homeLayout. No ✎ menu (read-only),
 * no drawer.
 ************************************************/
const FriendHomeView = {
  title: 'Friend — Home',

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
      ${FriendView.renderHeader('home')}
      <div id="pg-stage" class="pg-stage"></div>
    `;
    FriendView.wireHeader(container);

    const stage = container.querySelector('#pg-stage');
    const layout = friend.homeLayout || { rooms: [] };

    if (!layout.rooms || layout.rooms.length === 0) {
      const safeName = String(friend.username).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      stage.innerHTML = `
        <div class="pg-empty">
          <div class="pg-empty-card">
            <h2>${safeName} hasn't placed any rooms yet</h2>
            <p>Their home will appear here once they unlock and place project rooms.</p>
          </div>
        </div>
      `;
      return;
    }

    Playground3D.init(
      stage,
      friend.homeCharacter || Playground3D.defaultCharacter(),
      layout
    );
  },

  unmount() {
    if (typeof Playground3D !== 'undefined' && Playground3D.destroy) {
      Playground3D.destroy();
    }
  }
};
