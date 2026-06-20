/************************************************
 * PROJECT POPUP
 ************************************************/
function showPopup(project) {
  $('.node-popup')?.remove();

  const isWatched = state.isWatched(project.id);
  const count = state.getCount(project.id);
  const memories = state.getMemories(project.id);
  const watchedWith = state.getWatchedWith(project.id);
  // Readonly mode only exists on the map view (set when viewing a friend's
  // progress). On the watch-order view there's no map renderer mounted, so
  // default to false rather than crashing on a null container.
  const isReadonly = renderer.nodesContainer
    ? renderer.nodesContainer.classList.contains('readonly')
    : false;

  const popup = document.createElement('div');
  popup.className = 'node-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-modal', 'true');
  popup.setAttribute('aria-label', project.title);
  popup.innerHTML = `
  <button class="popup-close" aria-label="Close">✕</button>
  <h3>${esc(project.title)}</h3>

  ${isWatched ? `
    <p class="watch-count">Watched ${count} time${count !== 1 ? 's' : ''}</p>
${watchedWith.length ? (() => {
      const currentUsername = Auth.getUsername();
      const formatted = watchedWith.map(name =>
        name === currentUsername ? '<span class="watched-with-you">✓ you</span>' : `<span>${esc(name)}</span>`
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
              ? `<video src="${esc(m.url)}" preload="metadata"></video>`
              : `<img src="${esc(m.url)}" alt="${esc(m.caption)}" loading="lazy" />`
            }
            <div class="memory-overlay">
              <button class="memory-view-btn" data-index="${i}">View</button>
              ${!isReadonly ? `<button class="memory-delete" data-url="${esc(m.url)}">✕</button>` : ''}
            </div>
            ${m.caption ? `<p class="memory-caption">${esc(m.caption)}</p>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  ` : ''}
`;

  document.body.appendChild(popup);
  const close = wireModalDismiss(popup, () => popup.remove(), {
    initialFocus: popup.querySelector('.popup-close')
  });
  popup.querySelector('.popup-close').onclick = close;

  if (!isReadonly) {
    popup.querySelector('.popup-action').onclick = () => {
      if (isWatched) {
        state.watchAgain(project.id);
      } else {
        state.toggle(project.id);
      }
      // Map view: re-center camera on the project. Flow view: no camera.
      renderer.setCenterTarget?.(project.id);
      close();
    };

    popup.querySelector('#watched-with-friend-btn')?.addEventListener('click', () => {
      close();
      showWatchedWithFriendModal(project);
    });

    popup.querySelector('#add-memory-btn')?.addEventListener('click', () => {
      close();
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
      close();
      showMemoryLightbox(memories, index, project);
    };
  });

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
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'auth-modal-heading');
  modal.innerHTML = `
    <div class="auth-box">
      <button class="popup-close" aria-label="Close">✕</button>
      <h3 id="auth-modal-heading">${mode === "login" ? "Login" : "Register"}</h3>
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
