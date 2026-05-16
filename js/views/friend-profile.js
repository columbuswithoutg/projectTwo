/************************************************
 * FRIEND PROFILE VIEW — /friend/:username/profile
 *
 * Static read-only friend profile: avatar, username, simple stats
 * computed from their watchedProjects payload (totalWatched / sessions /
 * memories). No edit controls — all mutating UI is omitted.
 ************************************************/
const FriendProfileView = {
  title: 'Friend — Profile',

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

    const safe = (s) => String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const watched = friend.watchedProjects || [];
    const totalWatched  = watched.length;
    const totalSessions = watched.reduce((sum, e) => sum + (e.count || 0), 0);
    const totalMemories = watched.reduce((sum, e) => sum + (e.memories ? e.memories.length : 0), 0);

    const initials = friend.username ? friend.username[0].toUpperCase() : '?';
    const avatarHtml = friend.profilePicture
      ? `<img class="friend-profile-avatar" src="${safe(friend.profilePicture)}" alt="" loading="lazy" />`
      : `<div class="friend-profile-avatar friend-profile-initials">${safe(initials)}</div>`;

    container.innerHTML = `
      ${FriendView.renderHeader('profile')}
      <div class="friend-profile-body">
        <div class="friend-profile-card">
          ${avatarHtml}
          <h1 class="friend-profile-name">${safe(friend.username)}</h1>
          <div class="friend-profile-stats">
            <div class="friend-profile-stat"><strong>${totalWatched}</strong><span>watched</span></div>
            <div class="friend-profile-stat"><strong>${totalSessions}</strong><span>sessions</span></div>
            <div class="friend-profile-stat"><strong>${totalMemories}</strong><span>memories</span></div>
          </div>
        </div>
      </div>
    `;
    FriendView.wireHeader(container);
  },

  unmount() { /* no renderers/walkers to tear down */ }
};
