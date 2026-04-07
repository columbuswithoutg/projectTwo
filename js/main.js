/************************************************
 * INITIALIZATION
 ************************************************/
document.addEventListener("DOMContentLoaded", async () => {
  await state.load();
  state.initProjects(projects);
  renderer.init();

  // Drawer open/close
  const drawer = document.getElementById('nav-drawer');

  const openDrawer = () => drawer.classList.add('open');
  const closeDrawer = () => drawer.classList.remove('open');

  document.getElementById('nav-toggle').addEventListener('click', openDrawer);
  document.getElementById('close-drawer').addEventListener('click', closeDrawer);
  document.getElementById('nav-drawer-overlay').addEventListener('click', closeDrawer);
  document.getElementById('profile-btn')?.addEventListener('click', () => {
    window.location.href = '/profile.html';
  });
  document.getElementById('characters-btn')?.addEventListener('click', () => {
    window.location.href = '/characters.html';
  });

  // Close drawer after any nav button is clicked
  document.querySelectorAll('#nav-drawer-content nav button').forEach(btn => {
    btn.addEventListener('click', closeDrawer);
  });

  $("#markAllWatchedBtn")?.addEventListener("click", () => renderer.markAllWatched());

  $("#clear-progress")?.addEventListener("click", () => {
    state.clear();
    renderer.setCenterTarget(CONFIG.START_NODE_ID);
  });

  $("#logout-btn")?.addEventListener("click", () => {
    localStorage.removeItem("mcu_token");
    localStorage.removeItem("mcu_username");
    window.location.href = "/index.html";
  });

  $("#friends-btn")?.addEventListener("click", () => showFriendsPanel());

  $("#walkers-btn")?.addEventListener("click", () => Walkers.showWalkerPicker());

  renderer.setCenterTarget(state.getLastWatchedId());
  renderer.render();

  // Init walkers after first render
  Walkers.init();
  setTimeout(() => Walkers.deploy(), 500);

  // Load profile picture into header
  if (Auth.isLoggedIn()) {
    fetch(`${API}/profile`, {
      headers: { Authorization: `Bearer ${Auth.getToken()}` }
    }).then(r => r.json()).then(data => {
      const img      = document.getElementById('header-avatar');
      const initials = document.getElementById('header-avatar-initials');
      if (data.profilePicture && img) {
        img.src = data.profilePicture;
        img.style.display = 'block';
        if (initials) initials.style.display = 'none';
      } else if (initials && data.username) {
        initials.textContent = data.username[0].toUpperCase();
      }
    }).catch(() => {});
  }

  document.getElementById('header-profile-btn')?.addEventListener('click', () => {
    window.location.href = '/profile.html';
  });
});
