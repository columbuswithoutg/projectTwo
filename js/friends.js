/************************************************
 * FRIENDS API
 ************************************************/
const Friends = {
  async search(username) {
    const res = await fetch(`${API}/friends/search?username=${encodeURIComponent(username)}`, {
      headers: { Authorization: `Bearer ${Auth.getToken()}` }
    });
    return res.json();
  },

  async sendRequest(recipientId) {
    const res = await fetch(`${API}/friends/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Auth.getToken()}`
      },
      body: JSON.stringify({ recipientId })
    });
    return res.json();
  },

  async getPending() {
    const res = await fetch(`${API}/friends/pending`, {
      headers: { Authorization: `Bearer ${Auth.getToken()}` }
    });
    return res.json();
  },

  async respond(requestId, action) {
    const res = await fetch(`${API}/friends/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Auth.getToken()}`
      },
      body: JSON.stringify({ requestId, action })
    });
    return res.json();
  },

  async getList() {
    const res = await fetch(`${API}/friends/list`, {
      headers: { Authorization: `Bearer ${Auth.getToken()}` }
    });
    return res.json();
  },

  async getProgress(friendId) {
    const res = await fetch(`${API}/friends/progress/${friendId}`, {
      headers: { Authorization: `Bearer ${Auth.getToken()}` }
    });
    return res.json();
  },

  async remove(friendId) {
    const res = await fetch(`${API}/friends/remove/${friendId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${Auth.getToken()}` }
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
        <h4>Add Friend</h4>
        <div class="friends-search-row">
          <input id="friend-search" type="text" placeholder="Search by username" />
          <button id="friend-search-btn">Add</button>
        </div>
        <div id="friend-search-results"></div>
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

  panel.querySelector('#close-friends').onclick = () => panel.remove();

  const addBtn = panel.querySelector('#friend-search-btn');

  const doAdd = async () => {
    const query = panel.querySelector('#friend-search').value.trim();
    if (!query) return;

    addBtn.disabled = true;
    addBtn.textContent = '...';

    const results = await Friends.search(query);

    if (!results.length) {
      addBtn.textContent = 'Not Found';
      addBtn.style.background = 'rgba(255, 80, 80, 0.7)';
      addBtn.style.color = '#fff';
      setTimeout(() => {
        addBtn.textContent = 'Add';
        addBtn.style.background = '';
        addBtn.style.color = '';
        addBtn.disabled = false;
      }, 2000);
      return;
    }

    const user = results.find(u => u.username.toLowerCase() === query.toLowerCase()) || results[0];
    const data = await Friends.sendRequest(user._id);

    if (data.error) {
      addBtn.textContent = data.error === 'Request already exists' ? 'Already Added' : data.error;
      addBtn.style.background = 'rgba(255, 80, 80, 0.7)';
      addBtn.style.color = '#fff';
    } else {
      addBtn.textContent = 'Added!';
      addBtn.style.background = 'rgba(46, 255, 81, 0.8)';
      addBtn.style.color = '#000';
    }

    setTimeout(() => {
      addBtn.textContent = 'Add';
      addBtn.style.background = '';
      addBtn.style.color = '';
      addBtn.disabled = false;
      panel.querySelector('#friend-search').value = '';
    }, 2000);
  };

  addBtn.onclick = doAdd;

  panel.querySelector('#friend-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doAdd();
  });

  // Load pending requests
  Friends.getPending().then(requests => {
    const container = panel.querySelector('#friend-pending-list');
    if (!requests.length) {
      container.innerHTML = '<p class="friends-empty">No pending requests</p>';
      return;
    }
    container.innerHTML = requests.map(r => `
  <div class="friend-row">
    <span>
      ${r.type === 'watch'
        ? `<strong>${esc(r.requester.username)}</strong> wants to watch <em style="color:rgba(46,255,81,0.8)">${esc(r.projectTitle || r.projectId)}</em> together`
        : `<strong>${esc(r.requester.username)}</strong> sent you a friend request`
      }
    </span>
    <div class="friend-row-actions">
      <button class="friend-accept-btn" data-id="${r._id}" data-type="${r.type || 'friend'}" data-project="${r.projectId || ''}">Accept</button>
      <button class="friend-reject-btn" data-id="${r._id}">Reject</button>
    </div>
  </div>
`).join('');

    container.querySelectorAll('.friend-accept-btn').forEach(btn => {
      btn.onclick = async () => {
        const data = await Friends.respond(btn.dataset.id, 'accepted');
        const type = btn.dataset.type;
        const projectId = btn.dataset.project;

        if (type === 'watch' && projectId) {
          const entry = state.data.get(projectId);
          if (entry) {
            entry.count += 1;
            if (data.requester?.username && !entry.watchedWith.includes(data.requester.username)) {
              entry.watchedWith.push(data.requester.username);
            }
          } else {
            state.data.set(projectId, { count: 1, watchedWith: [], memories: [] });
          }
          state.save();
          renderer.render();
        }

        btn.closest('.friend-row').remove();
        if (type === 'friend') loadFriendList(panel);

        const list = panel.querySelector('#friend-pending-list');
        if (!list.querySelector('.friend-row')) {
          list.innerHTML = '<p class="friends-empty">No pending requests</p>';
        }
      };
    });

    container.querySelectorAll('.friend-reject-btn').forEach(btn => {
      btn.onclick = async () => {
        await Friends.respond(btn.dataset.id, 'rejected');
        btn.closest('.friend-row').remove();
      };
    });
  });

  loadFriendList(panel);

  document.body.appendChild(panel);
}

function loadFriendList(panel) {
  Friends.getList().then(friends => {
    const container = panel.querySelector('#friend-list');
    if (!friends || friends.error || !Array.isArray(friends)) {
      container.innerHTML = '<p class="friends-empty">Failed to load</p>';
      return;
    }
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
        panel.remove();
        viewFriendProgress(btn.dataset.id, btn.dataset.name);
      };
    });

    container.querySelectorAll('.friend-remove-btn').forEach(btn => {
      btn.onclick = () => showRemoveConfirm(btn.dataset.id, btn.dataset.name, panel);
    });

  }).catch(() => {
    panel.querySelector('#friend-list').innerHTML =
      '<p class="friends-empty">Failed to load friends</p>';
  });
}

async function viewFriendProgress(friendId, friendName) {
  const data = await Friends.getProgress(friendId);
  if (data.error) return alert(data.error);

  const mapWrapperCheck = document.getElementById('map-wrapper');
  if (!mapWrapperCheck) return; // not on the app view — bail safely

  const originalData = new Map(state.data);

  // Block state.save from pushing the friend's data onto our account while
  // the UI is in friend-view. Cleared when exiting the banner.
  state.readonly = true;

  state.data.clear();
  data.watchedProjects.forEach(entry => {
    state.data.set(entry.projectId, {
      count: entry.count,
      watchedWith: entry.watchedWith || [],
      memories: entry.memories || []
    });
  });
  // Fire listeners so the layout cache invalidates; otherwise we'd keep
  // rendering the viewer's own watched set instead of the friend's.
  state.listeners.forEach(fn => fn(state.data));

  const originalHeader = document.getElementById('header');
  originalHeader.style.display = 'none';

  const banner = document.createElement('header');
  banner.className = 'friend-view-banner';
  banner.innerHTML = `
    <h1>Viewing <strong>${esc(friendName)}</strong>'s Progress</h1>
    <button id="exit-friend-view">← Back to My Progress</button>
  `;

  banner.querySelector('#exit-friend-view').onclick = () => {
    state.data.clear();
    originalData.forEach((v, k) => state.data.set(k, v));
    // Re-enable saves before the first post-exit listener fires.
    state.readonly = false;
    // Fire listeners so the layout cache invalidates on return; without
    // this the map renders the friend's stale layout over the viewer's data.
    state.listeners.forEach(fn => fn(state.data));
    banner.remove();
    originalHeader.style.display = '';
    renderer.nodesContainer.classList.remove('readonly');
    renderer.render();
    Walkers.restoreSelections();
  };

  const mapWrapper = document.getElementById('map-wrapper');
  mapWrapper.parentNode.insertBefore(banner, mapWrapper);
  renderer.nodesContainer.classList.add('readonly');
  renderer.render();
  Walkers.deployWithSelections(data.walkers || []);
}

async function showWatchedWithFriendModal(project) {
  const friends = await Friends.getList();

  const modal = document.createElement('div');
  modal.className = 'auth-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'watched-with-friend-heading');
  modal.innerHTML = `
    <div class="auth-box">
      <button class="popup-close" aria-label="Close">✕</button>
      <h3 id="watched-with-friend-heading">Watched with a Friend</h3>
      <p style="color:#aaa; font-size:0.9rem">Select a friend to mark <strong style="color:#fff">${esc(project.title)}</strong> as watched for them too.</p>
      <div id="watch-friends-list">
        ${!friends.length
          ? '<p style="color:#666">No friends yet</p>'
          : friends.map(f => `
            <div class="friend-row">
              <span>${esc(f.username)}</span>
              <button class="watch-with-btn" data-id="${f.id}">Send Request</button>
            </div>
          `).join('')
        }
      </div>
    </div>
  `;

  modal.querySelector('.popup-close').onclick = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelectorAll('.watch-with-btn').forEach(btn => {
    btn.onclick = async () => {
      const recipientId = btn.dataset.id;

      if (!state.isWatched(project.id)) {
        state.data.set(project.id, { count: 1, watchedWith: [], memories: [] });
        state.save();
        renderer.render();
      }

      const res = await fetch(`${API}/friends/watch-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Auth.getToken()}`
        },
        body: JSON.stringify({ recipientId, projectId: project.id, projectTitle: project.title })
      });
      const data = await res.json();

      if (data.error) {
        btn.textContent = data.error;
        btn.style.background = 'rgba(255, 80, 80, 0.7)';
        btn.style.color = '#fff';
      } else {
        btn.textContent = 'Sent!';
        const entry = state.data.get(project.id);
        const friendName = btn.closest('.friend-row').querySelector('span').textContent;
        if (entry && !entry.watchedWith.includes(friendName)) {
          entry.watchedWith.push(friendName);
          state.save();
        }
      }
      btn.disabled = true;
    };
  });

  document.body.appendChild(modal);
}

function showRemoveConfirm(friendId, friendName, panel) {
  const confirm = document.createElement('div');
  confirm.className = 'auth-modal';
  confirm.setAttribute('role', 'alertdialog');
  confirm.setAttribute('aria-modal', 'true');
  confirm.setAttribute('aria-labelledby', 'remove-friend-heading');
  confirm.innerHTML = `
    <div class="auth-box" style="text-align:center; gap:16px">
      <h3 id="remove-friend-heading">Remove Friend</h3>
      <p style="color:#aaa">Are you sure you want to remove <strong style="color:#fff">${esc(friendName)}</strong> as a friend?</p>
      <p class="auth-error" style="display:none; color:red"></p>
      <div style="display:flex; gap:8px">
        <button id="confirm-remove" style="flex:1; padding:10px; border-radius:8px; border:none; background:rgba(255,80,80,0.8); color:#fff; font-weight:bold; cursor:pointer">
          Remove
        </button>
        <button id="cancel-remove" style="flex:1; padding:10px; border-radius:8px; border:none; background:rgba(255,255,255,0.1); color:#fff; font-weight:bold; cursor:pointer">
          Cancel
        </button>
      </div>
    </div>
  `;

  confirm.querySelector('#cancel-remove').onclick = () => confirm.remove();
  confirm.addEventListener('click', (e) => { if (e.target === confirm) confirm.remove(); });

  confirm.querySelector('#confirm-remove').onclick = async () => {
    const btn = confirm.querySelector('#confirm-remove');
    const errorEl = confirm.querySelector('.auth-error');
    btn.disabled = true;
    btn.textContent = 'Removing...';

    try {
      const res = await fetch(`${API}/friends/remove/${friendId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${Auth.getToken()}` }
      });
      const data = await res.json();

      if (data.error) {
        errorEl.textContent = data.error;
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Remove';
        return;
      }

      confirm.remove();
      const removeBtn = panel.querySelector(`.friend-remove-btn[data-id="${friendId}"]`);
      removeBtn?.closest('.friend-row')?.remove();

      const list = panel.querySelector('#friend-list');
      if (!list.querySelector('.friend-row')) {
        list.innerHTML = '<p class="friends-empty">No friends yet</p>';
      }
    } catch (e) {
      errorEl.textContent = 'Failed to remove. Try again.';
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Remove';
    }
  };

  document.body.appendChild(confirm);
}
