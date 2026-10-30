/************************************************
 * FRIENDS API — Auth.fetch adds the token and sends a dead session to /login.
 ************************************************/
const Friends = {
  async search(username) {
    const res = await Auth.fetch(`${API}/friends/search?username=${encodeURIComponent(username)}`);
    return res.json();
  },

  async sendRequest(recipientId) {
    const res = await Auth.fetch(`${API}/friends/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientId })
    });
    return res.json();
  },

  async getPending() {
    const res = await Auth.fetch(`${API}/friends/pending`);
    return res.json();
  },

  async respond(requestId, action) {
    const res = await Auth.fetch(`${API}/friends/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, action })
    });
    return res.json();
  },

  async getList() {
    const res = await Auth.fetch(`${API}/friends/list`);
    return res.json();
  },

  // Username-keyed lookup used by the dedicated /friend/:username SPA
  // routes via FriendView.enter(username). Returns the friend payload
  // or { error } on 4xx/5xx — callers (FriendView.enter) coerce errors
  // to null so each friend view can render the 404 card uniformly.
  async getByUsername(username) {
    const res = await Auth.fetch(`${API}/friends/by-username/${encodeURIComponent(username)}`);
    return res.json();
  },

  async remove(friendId) {
    const res = await Auth.fetch(`${API}/friends/remove/${friendId}`, {
      method: 'DELETE'
    });
    return res.json();
  }
};

// esc() is defined in js/utils.js and shared across all view modules.

/************************************************
 * FRIENDS PANEL UI
 ************************************************/
function showFriendsPanel() {
  $('.friends-panel')?.remove();

  const panel = document.createElement('div');
  panel.className = 'friends-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'friends-panel-heading');
  panel.innerHTML = `
    <div class="friends-box">
      <button class="popup-close" id="close-friends" aria-label="Close">✕</button>
      <h3 id="friends-panel-heading">Friends</h3>

      <!-- Search -->
      <div class="friends-section">
        <h4>Add friend</h4>
        <label class="visually-hidden" for="friend-search">Search by username</label>
        <div class="friends-search-row">
          <input id="friend-search" type="search" placeholder="Search by username" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="30" />
          <button id="friend-search-btn" type="button">Search</button>
        </div>
        <p id="friend-search-status" class="friends-search-status" role="status" aria-live="polite" hidden></p>
        <ul id="friend-search-results" class="friends-search-results" role="list"></ul>
      </div>

      <!-- Pending Requests -->
      <div class="friends-section">
        <h4>Pending Requests</h4>
        <div id="friend-pending-list">Loading...</div>
      </div>

      <!-- Friends List -->
      <div class="friends-section">
        <h4>Your Friends</h4>
        <div id="friend-list">Loading...</div>
      </div>
    </div>
  `;

  // Search shows a LIST of matches with a per-person Add. The old button
  // sent a request to the first fuzzy match, so "an" + Enter befriended a
  // stranger. Enter still sends — only when the typed name is exactly one
  // person who can be asked (js/ux-logic.js rankFriendSearch).
  const searchBtn = panel.querySelector('#friend-search-btn');
  const searchInput = panel.querySelector('#friend-search');
  const resultsEl = panel.querySelector('#friend-search-results');
  const statusEl = panel.querySelector('#friend-search-status');
  // Lower-cased names already befriended (filled by loadFriendList) / asked here.
  panel._friendNames = new Set();
  panel._outgoing = new Set();
  const setStatus = (text) => { statusEl.textContent = text || ''; statusEl.hidden = !text; };

  const sendTo = async (user, btn) => {
    btn.disabled = true;
    btn.textContent = 'Sending…';
    let data;
    try { data = await Friends.sendRequest(user._id); }
    catch (_) { data = { error: "Couldn't send — check your connection." }; }
    if (!data || data.error) {
      const already = data && data.error === 'Request already exists';
      if (already) {
        panel._outgoing.add(user.username.toLowerCase());
        btn.textContent = 'Requested';
        return;
      }
      btn.textContent = /declined/i.test(data && data.error) ? 'Declined' : 'Failed';
      btn.classList.add('is-err');
      toast((data && data.error) || "Couldn't send that request.", 'error');
      setTimeout(() => { btn.disabled = false; btn.textContent = 'Add'; btn.classList.remove('is-err'); }, 2500);
      return;
    }
    panel._outgoing.add(user.username.toLowerCase());
    btn.textContent = 'Sent ✓';
    btn.classList.add('is-ok');
    toast(`Friend request sent to ${user.username}.`, 'success');
  };

  const renderResults = (ranked, query) => {
    if (!ranked.items.length) {
      resultsEl.innerHTML = '';
      setStatus(`No one called “${query}” — names are matched from the start.`);
      return;
    }
    setStatus(`${ranked.items.length} ${ranked.items.length === 1 ? 'person matches' : 'people match'} “${query}”`);
    resultsEl.innerHTML = ranked.items.map(u => {
      const [a, b] = u.match || [0, 0];
      const name = u.match
        ? esc(u.username.slice(0, a)) + '<mark>' + esc(u.username.slice(a, b)) + '</mark>' + esc(u.username.slice(b))
        : esc(u.username);
      const action = u.status === 'friend' ? '<span class="friend-search-state">Friends</span>'
        : u.status === 'pending' ? '<span class="friend-search-state">Requested</span>'
        : `<button type="button" class="friend-search-add" data-id="${esc(u._id)}" data-name="${esc(u.username)}" aria-label="Add ${esc(u.username)}">Add</button>`;
      return `<li class="friend-row"><span class="friend-username">${name}</span><div class="friend-row-actions">${action}</div></li>`;
    }).join('');
    resultsEl.querySelectorAll('.friend-search-add').forEach(btn => {
      btn.addEventListener('click', () => sendTo({ _id: btn.dataset.id, username: btn.dataset.name }, btn));
    });
  };

  const runSearch = async () => {
    const query = searchInput.value.trim();
    if (query.length < 2) {
      resultsEl.innerHTML = '';
      setStatus(query ? 'Type at least 2 characters.' : '');
      return null;
    }
    searchBtn.disabled = true;
    let results;
    try { results = await Friends.search(query); }
    catch (_) { toast("Couldn't search — check your connection", 'error'); searchBtn.disabled = false; return null; }
    searchBtn.disabled = false;
    if (!Array.isArray(results)) { setStatus((results && results.error) || "Couldn't search right now."); return null; }
    const ranked = UxLogic.rankFriendSearch(results, query, { friends: panel._friendNames, pending: panel._outgoing });
    renderResults(ranked, query);
    return ranked;
  };

  searchBtn.addEventListener('click', runSearch);
  searchInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const ranked = await runSearch();
    if (ranked && ranked.exact.length === 1 && ranked.exact[0].status === 'none') {
      const btn = resultsEl.querySelector(`.friend-search-add[data-id="${CSS.escape(ranked.exact[0]._id)}"]`);
      if (btn) sendTo(ranked.exact[0], btn);
    }
  });

  // Load pending requests. Named + retryable — this fetch used to have no
  // .catch, so a network failure left the section on "Loading..." forever.
  const loadPendingList = () => {
    const container = panel.querySelector('#friend-pending-list');
    container.textContent = 'Loading...';
    Friends.getPending().then(requests => {
    if (!Array.isArray(requests)) throw new Error(requests?.error || 'Bad response');
    if (!requests.length) {
      container.innerHTML = '<p class="friends-empty">No pending requests</p>';
      return;
    }
    container.innerHTML = requests.map(r => `
  <div class="friend-row">
    <span>
      ${r.type === 'watch'
        ? `<strong>${esc(r.requester?.username || 'A deleted user')}</strong> ${r.postId ? 'says you watched' : 'wants to log'} <em class="friend-req-title">${esc(r.projectTitle || r.projectId)}${r.episode ? ` · Episode ${Number(r.episode)}` : ''}</em> together — accept to be tagged on their post`
        : `<strong>${esc(r.requester?.username || 'A deleted user')}</strong> sent you a friend request`
      }
    </span>
    <div class="friend-row-actions">
      <button class="friend-accept-btn" data-id="${esc(r._id)}" data-type="${esc(r.type || 'friend')}" data-project="${esc(r.projectId || '')}">Accept</button>
      <button class="friend-reject-btn" data-id="${r._id}">Reject</button>
    </div>
  </div>
`).join('');

    // Both buttons lock while a request is in flight (a double tap sent it
    // twice), and the row only leaves once the server said yes.
    const respond = async (btn, action) => {
      const row = btn.closest('.friend-row');
      const buttons = row.querySelectorAll('button');
      buttons.forEach(b => { b.disabled = true; });
      let data;
      try { data = await Friends.respond(btn.dataset.id, action); }
      catch (_) { data = { error: "Couldn't reach the server — try again." }; }
      if (!data || data.error) {
        toast((data && data.error) || `Couldn't ${action === 'accepted' ? 'accept' : 'decline'} that request.`, 'error');
        buttons.forEach(b => { b.disabled = false; });
        return null;
      }
      row.remove();
      const list = panel.querySelector('#friend-pending-list');
      if (!list.querySelector('.friend-row')) {
        list.innerHTML = '<p class="friends-empty">No pending requests</p>';
      }
      return data;
    };

    container.querySelectorAll('.friend-accept-btn').forEach(btn => {
      btn.onclick = async () => {
        const type = btn.dataset.type;
        const projectId = btn.dataset.project;
        const data = await respond(btn, 'accepted');
        if (!data) return;

        if (type === 'watch' && projectId) {
          // The server only tags the co-watcher on an existing watch (it never
          // adds one — that takes the timed Start watching flow), so mirror
          // that locally instead of saving a guessed count.
          const entry = state.data.get(projectId);
          if (entry && data.tagged) {
            if (data.requester?.username && !entry.watchedWith.includes(data.requester.username)) {
              entry.watchedWith.push(data.requester.username);
            }
            renderer.render();
          }
          if (data.taggedOnPost) {
            toast(entry ? "You're tagged on their post." : "You're tagged on their post. Start it on your Board to log your own watch too.", 'success');
          } else if (!data.tagged) {
            toast('Finish watching it from your Board first — then you can log it together.', 'info');
          }
        }
        if (type === 'friend') loadFriendList(panel);
      };
    });

    container.querySelectorAll('.friend-reject-btn').forEach(btn => {
      btn.onclick = () => respond(btn, 'rejected');
    });
    }).catch(() => {
      container.innerHTML = `
        <p class="friends-empty">Couldn't load requests.</p>
        <button type="button" class="friends-retry-btn">Retry</button>
      `;
      container.querySelector('.friends-retry-btn').onclick = loadPendingList;
      toast("Couldn't load friend requests", 'error');
    });
  };
  loadPendingList();

  loadFriendList(panel);

  document.body.appendChild(panel);

  // Esc + backdrop dismiss + focus restore via the shared helper — wired
  // after append so focus can actually move into the panel. Stored on the
  // element so row handlers that tear the panel down (View Progress) can
  // reuse the same cleanup path.
  panel._close = wireModalDismiss(panel, () => panel.remove(), {
    initialFocus: panel.querySelector('#close-friends')
  });
  panel.querySelector('#close-friends').onclick = panel._close;
}

function loadFriendList(panel) {
  const container = panel.querySelector('#friend-list');
  const fail = () => {
    container.innerHTML = `
      <p class="friends-empty">Couldn't load friends.</p>
      <button type="button" class="friends-retry-btn">Retry</button>
    `;
    container.querySelector('.friends-retry-btn').onclick = () => loadFriendList(panel);
    toast("Couldn't load friends", 'error');
  };
  container.textContent = 'Loading...';
  Friends.getList().then(friends => {
    if (!friends || friends.error || !Array.isArray(friends)) { fail(); return; }
    panel._friendNames = new Set(friends.map(f => String(f.username || '').toLowerCase()));
    if (!friends.length) {
      container.innerHTML = '<p class="friends-empty">No friends yet</p>';
      return;
    }
    container.innerHTML = friends.map(f => `
      <div class="friend-row" data-id="${f.id}">
        <span class="friend-username">${esc(f.username)}</span>
        <div class="friend-row-actions">
          <button class="friend-view-btn" data-id="${f.id}" data-name="${esc(f.username)}">View Progress</button>
          <button class="friend-remove-btn" data-id="${f.id}" data-name="${esc(f.username)}">Remove</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.friend-view-btn').forEach(btn => {
      btn.onclick = () => {
        // Go through the shared close so the Esc listener is detached.
        (panel._close || (() => panel.remove()))();
        // Dedicated route — username goes in the URL, FriendView.enter
        // does the fetch/swap/walker work inside the friend view's mount.
        Router.go('/friend/' + encodeURIComponent(btn.dataset.name));
      };
    });

    container.querySelectorAll('.friend-remove-btn').forEach(btn => {
      btn.onclick = () => showRemoveConfirm(btn.dataset.id, btn.dataset.name, panel);
    });

  }).catch(fail);
}


async function showWatchedWithFriendModal(project) {
  let friends;
  try {
    friends = await Friends.getList();
    if (!Array.isArray(friends)) throw new Error((friends && friends.error) || 'Bad response');
  } catch (_) {
    toast("Couldn't load your friends — check your connection and try again.", 'error');
    return;
  }

  const modal = document.createElement('div');
  modal.className = 'auth-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'watched-with-friend-heading');
  modal.innerHTML = `
    <div class="auth-box">
      <button class="popup-close" type="button" aria-label="Close">✕</button>
      <h3 id="watched-with-friend-heading">Watched with a friend</h3>
      <p class="dialog-muted">Tag a friend you watched <strong class="dialog-strong">${esc(project.title)}</strong> with. It's added once they accept, if they've finished it too.</p>
      <div id="watch-friends-list">
        ${!friends.length
          ? '<p class="dialog-empty">No friends yet</p>'
          : friends.map(f => `
            <div class="friend-row">
              <span>${esc(f.username)}</span>
              <button class="watch-with-btn" type="button" data-id="${esc(f.id)}">Send request</button>
            </div>
          `).join('')
        }
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  // Esc, backdrop, focus restore — the shared helper, like every other dialog.
  const close = wireModalDismiss(modal, () => modal.remove(), { initialFocus: modal.querySelector('.popup-close') });
  modal.querySelector('.popup-close').onclick = close;

  modal.querySelectorAll('.watch-with-btn').forEach(btn => {
    btn.onclick = async () => {
      const recipientId = btn.dataset.id;

      // Only a finished watch can be tagged (the popup only offers this
      // button once it's watched; the server enforces it too).
      if (!state.isWatched(project.id)) {
        toast('Finish watching it first.', 'error');
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Sending…';
      let data = null, ok = false;
      try {
        const res = await Auth.fetch(`${API}/friends/watch-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipientId, projectId: project.id, projectTitle: project.title })
        });
        try { data = await res.json(); } catch (_) {}
        ok = res.ok && !!data && !data.error;
      } catch (_) { /* network */ }

      if (!ok) {
        toast((data && data.error) || "Couldn't send — check your connection.", 'error');
        btn.textContent = 'Failed';
        btn.classList.add('is-err');
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Send request'; btn.classList.remove('is-err'); }, 2500);
        return;
      }
      // The "watched with" tag lands only when the friend accepts (and has
      // watched it too) — see applyCoWatch in routes/friends.js.
      btn.textContent = 'Sent ✓';
      btn.classList.add('is-ok');
    };
  });
}

// The branded confirm (tokens, Esc, focus) — the hand-built dialog here
// had white text on the Comic theme's white sheet and an invisible Cancel.
async function showRemoveConfirm(friendId, friendName, panel) {
  const sure = await confirmDialog({
    title: 'Remove friend?',
    message: `Remove ${friendName} from your friends? You can add them again later.`,
    confirmLabel: 'Remove',
    cancelLabel: 'Keep',
    danger: true
  });
  if (!sure) return;
  const removeBtn = panel.querySelector(`.friend-remove-btn[data-id="${CSS.escape(friendId)}"]`);
  if (removeBtn) { removeBtn.disabled = true; removeBtn.textContent = 'Removing…'; }
  let data = null;
  try { data = await Friends.remove(friendId); } catch (_) { data = null; }
  if (!data || data.error) {
    toast((data && data.error) || "Couldn't remove them — check your connection and try again.", 'error');
    if (removeBtn) { removeBtn.disabled = false; removeBtn.textContent = 'Remove'; }
    return;
  }
  if (panel._friendNames) panel._friendNames.delete(String(friendName).toLowerCase());
  removeBtn?.closest('.friend-row')?.remove();
  const list = panel.querySelector('#friend-list');
  if (!list.querySelector('.friend-row')) {
    list.innerHTML = '<p class="friends-empty">No friends yet</p>';
  }
  toast(`${friendName} removed from your friends.`, 'success');
}
