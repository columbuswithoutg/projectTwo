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

  renderer.setCenterTarget(state.getLastWatchedId());
  renderer.render();
});
