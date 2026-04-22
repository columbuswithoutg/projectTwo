/************************************************
 * PROJECT POPUP
 ************************************************/
function showPopup(project) {
  $('.node-popup')?.remove();

  const isWatched = state.isWatched(project.id);
  const count = state.getCount(project.id);
  const memories = state.getMemories(project.id);
  const watchedWith = state.getWatchedWith(project.id);
  const isReadonly = renderer.nodesContainer.classList.contains('readonly');

  const popup = document.createElement('div');
  popup.className = 'node-popup';
  popup.innerHTML = `
  <button class="popup-close">✕</button>
  <h3>${project.title}</h3>

  ${isWatched ? `
    <p class="watch-count">Watched ${count} time${count !== 1 ? 's' : ''}</p>
${watchedWith.length ? (() => {
      const currentUsername = Auth.getUsername();
      const formatted = watchedWith.map(name =>
        name === currentUsername ? '<span class="watched-with-you">you</span>' : `<span>${name}</span>`
      );
      return `
    <div class="watched-with-info">
      <p class="watched-with-label">Watched with:</p>
      <div class="watched-with-list">
        ${formatted.map(f => `<div class="watched-with-entry">${f}</div>`).join('')}
      </div>
    </div>
  `;
    })() : ''}
  ` : ''}

${!isReadonly ? `
  <button class="popup-action ${isWatched ? 'watch-again' : ''}">
    ${isWatched ? 'Watch Again' : 'Mark as Watched'}
  </button>
  <button class="popup-action secondary" id="watched-with-friend-btn">Watched with a Friend</button>
  ${isWatched ? `
    <button class="popup-action secondary" id="add-memory-btn">Add Memory</button>
  ` : ''}
` : ''}

  ${memories.length ? `
    <div class="memories-section">
      <h4>Memories</h4>
      <div class="memories-grid">
        ${memories.map((m, i) => `
          <div class="memory-item" data-index="${i}">
            ${m.type === 'video'
              ? `<video src="${m.url}" preload="metadata"></video>`
              : `<img src="${m.url}" alt="${m.caption}" />`
            }
            <div class="memory-overlay">
              <button class="memory-view-btn" data-index="${i}">View</button>
              ${!isReadonly ? `<button class="memory-delete" data-url="${m.url}">✕</button>` : ''}
            </div>
            ${m.caption ? `<p class="memory-caption">${m.caption}</p>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  ` : ''}
`;

  popup.querySelector('.popup-close').onclick = () => popup.remove();

  if (!isReadonly) {
    popup.querySelector('.popup-action').onclick = () => {
      if (isWatched) {
        state.watchAgain(project.id);
      } else {
        state.toggle(project.id);
      }
      renderer.setCenterTarget(project.id);
      popup.remove();
    };

    popup.querySelector('#watched-with-friend-btn')?.addEventListener('click', () => {
      popup.remove();
      showWatchedWithFriendModal(project);
    });

    popup.querySelector('#add-memory-btn')?.addEventListener('click', () => {
      popup.remove();
      showAddMemoryModal(project);
    });

    popup.querySelectorAll('.memory-delete').forEach(btn => {
      btn.onclick = async () => {
        const url = btn.dataset.url;
        await fetch(`${API}/progress/memory`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${Auth.getToken()}`
          },
          body: JSON.stringify({ projectId: project.id, url })
        });
        const entry = state.data.get(project.id);
        if (entry) entry.memories = entry.memories.filter(m => m.url !== url);
        btn.closest('.memory-item').remove();
      };
    });
  }

  popup.querySelectorAll('.memory-view-btn').forEach(btn => {
    btn.onclick = () => {
      const index = parseInt(btn.dataset.index);
      popup.remove();
      showMemoryLightbox(memories, index, project);
    };
  });

  popup.addEventListener('click', (e) => {
    if (e.target === popup) popup.remove();
  });

  document.body.appendChild(popup);
}

/************************************************
 * AUTH MODAL UI
 ************************************************/
function updateAuthUI() {
  const loggedIn = Auth.isLoggedIn();
  $("#logout-btn") && ($("#logout-btn").style.display = loggedIn ? "block" : "none");
  $("#login-btn") && ($("#login-btn").style.display = loggedIn ? "none" : "block");
  $("#register-btn") && ($("#register-btn").style.display = loggedIn ? "none" : "block");
}

function showAuthModal(mode) {
  $(".auth-modal")?.remove();

  const modal = document.createElement("div");
  modal.className = "auth-modal";
  modal.innerHTML = `
    <div class="auth-box">
      <button class="popup-close">✕</button>
      <h3>${mode === "login" ? "Login" : "Register"}</h3>
      <input id="auth-username" type="text" placeholder="Username" />
      <input id="auth-password" type="password" placeholder="Password" />
      <p class="auth-error" style="color:red;display:none;"></p>
      <button id="auth-submit">${mode === "login" ? "Login" : "Create Account"}</button>
    </div>
  `;

  modal.querySelector(".popup-close").onclick = () => modal.remove();

  modal.querySelector("#auth-submit").onclick = async () => {
    const username = modal.querySelector("#auth-username").value.trim();
    const password = modal.querySelector("#auth-password").value;
    const errorEl = modal.querySelector(".auth-error");

    if (!username || !password) {
      errorEl.textContent = "Please fill in all fields.";
      errorEl.style.display = "block";
      return;
    }

    const data = mode === "login"
      ? await Auth.login(username, password)
      : await Auth.register(username, password);

    if (data.error) {
      errorEl.textContent = data.error;
      errorEl.style.display = "block";
      return;
    }

    modal.remove();

    if (mode === "login") {
      // Use resetLocal instead of raw .clear() so layout cache invalidates —
      // otherwise the new account inherits the previous session's map until
      // a refresh (same bug as the main logout flow).
      state.resetLocal();
      await state.load();
      renderer.render();
    }

    updateAuthUI();
  };

  document.body.appendChild(modal);
}
