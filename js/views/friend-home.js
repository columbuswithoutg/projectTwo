/************************************************
 * FRIEND HOME VIEW — /friend/:username/home
 *
 * Renders the friend's 3D home using their saved homeLayout (the rooms
 * and project posters they placed), but with the VISITOR's character —
 * you walk into your friend's house as yourself.
 *
 * Multiplayer: opens a socket on mount and joins room `home:<ownerId>`
 * via the shared Multiplayer module. If the owner is also on /home
 * they're already in the same room, so you see each other walk, chat,
 * and emote (same UX as /world, scoped to one home).
 ************************************************/
const FriendHomeView = (() => {
  let _mp = null;

  async function mount(container, params) {
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
      <div class="world-chat-row">
        <div class="world-chat-log" id="world-chat-log" aria-live="polite"></div>
        <div class="world-chat-inputrow">
          <input class="pg3d-chat" id="world-chat-input" placeholder="Say something…" maxlength="200" autocomplete="off" />
          <button class="pg3d-emote" id="world-emote-btn" type="button" aria-label="Wave">👋</button>
        </div>
      </div>
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

    // Visitor's own character — fetched the same way /world does it.
    let character = null;
    try {
      const res = await fetch(`${API}/profile/home-character`, {
        headers: { Authorization: `Bearer ${Auth.getToken()}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.homeCharacter && data.homeCharacter.skin != null) character = data.homeCharacter;
      }
    } catch (_) { /* fall through to default */ }
    if (!character) character = Playground3D.defaultCharacter();

    Playground3D.init(stage, character, layout);

    if (typeof Multiplayer !== 'undefined' && Multiplayer.start) {
      _mp = Multiplayer.start({
        events: Multiplayer.HOME_EVENTS,
        joinPayload: { ownerUsername: username },
        character
      });
    }
  }

  function unmount() {
    if (_mp) { try { _mp.stop(); } catch (_) {} _mp = null; }
    if (typeof Playground3D !== 'undefined' && Playground3D.destroy) {
      Playground3D.destroy();
    }
  }

  return { mount, unmount, title: 'Friend — Home' };
})();
