/************************************************
 * APP CHROME — the bits of the app frame shared by every main page:
 *
 *   AppChrome.headerHtml()   the header's theme switch (Cinematic ⇄ Comic)
 *                            and notification bell; a view drops it in
 *                            beside HelpCentre.buttonHtml(). One delegated
 *                            click listener wires every copy.
 *   AppChrome.onRoute(path)  the router calls it after every mount: shows
 *                            the phone bottom bar (Order / Board / Feed /
 *                            World / Profile) on the main pages and lights
 *                            the current one. CSS shows it only ≤ 640px.
 *   AppChrome.setMessages(n) MessagesBadge hands over the unread count.
 *
 * The bell counts unread messages + incoming friend requests; its menu
 * opens Messages or the Friends panel.
 ************************************************/
const AppChrome = (() => {
  // Pages that get the bottom bar. Not /world (its stick and chat own the
  // bottom of the screen) or the full-screen editors.
  const NAV_PAGES = new Set(['/', '/board', '/feed', '/profile', '/characters', '/messages', '/map', '/reports']);
  const FRIENDS_POLL_MS = 60000;

  const ICONS = {
    '/': '<path d="M4 5h6v6H4zM14 13h6v6h-6zM10 8h4v8h0" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    '/board': '<rect x="3.5" y="4" width="5" height="16" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="10" y="4" width="5" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="16.5" y="4" width="4" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/>',
    '/feed': '<rect x="4" y="4" width="16" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="4" y="14" width="16" height="6" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>',
    '/world': '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 12h16M12 4c2.5 2.4 3.6 5 3.6 8s-1.1 5.6-3.6 8c-2.5-2.4-3.6-5-3.6-8S9.5 6.4 12 4z" fill="none" stroke="currentColor" stroke-width="2"/>',
    '/profile': '<circle cx="12" cy="8.5" r="3.8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  };
  const TABS = [['/', 'Order'], ['/board', 'Board'], ['/feed', 'Feed'], ['/world', 'World'], ['/profile', 'Profile']];

  let _messages = 0;
  let _friends = 0;
  let _nav = null;
  let _timer = null;
  let _who = null;      // the account the counts belong to

  const svg = (path) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">${path}</svg>`;
  const total = () => _messages + _friends;
  const fmt = (n) => (n > 99 ? '99+' : String(n));

  function headerHtml() {
    const n = total();
    const comic = Theme.resolved() === 'comic';
    return `
      <button type="button" class="hdr-icon-btn hdr-theme" data-theme-toggle
              title="${comic ? 'Switch to the Cinematic look' : 'Switch to the Comic look'}"
              aria-label="${comic ? 'Switch to the Cinematic look' : 'Switch to the Comic look'}">
        <span aria-hidden="true">${comic ? '🎬' : '💥'}</span>
      </button>
      <button type="button" class="hdr-icon-btn hdr-bell" data-bell aria-haspopup="menu" aria-expanded="false"
              aria-label="Notifications${n ? ` (${n} new)` : ''}" title="Notifications">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5zM10 20.5a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
        <span class="hdr-bell-badge" data-bell-badge${n ? '' : ' hidden'}>${fmt(n)}</span>
      </button>`;
  }

  function _paint() {
    const n = total();
    document.querySelectorAll('[data-bell-badge]').forEach(el => { el.textContent = fmt(n); el.hidden = n <= 0; });
    document.querySelectorAll('[data-bell]').forEach(b => b.setAttribute('aria-label', `Notifications${n ? ` (${n} new)` : ''}`));
    const menu = document.querySelector('.hdr-bell-menu');
    if (menu) _fillMenu(menu);
  }

  function setMessages(n) { _messages = Math.max(0, n | 0); _paint(); }

  async function refreshFriends() {
    if (typeof Auth === 'undefined' || !Auth.isLoggedIn()) { _friends = 0; _paint(); return; }
    try {
      const res = await Auth.fetch(`${API}/friends/pending`);
      if (res.ok) { const list = await res.json(); _friends = Array.isArray(list) ? list.length : 0; _paint(); }
    } catch (_) { /* keep the last known count */ }
  }

  function start() {
    if (_timer) return;
    _timer = setInterval(refreshFriends, FRIENDS_POLL_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshFriends(); });
    refreshFriends();
  }

  function _fillMenu(menu) {
    const row = (act, icon, label, n) => `
      <button type="button" role="menuitem" class="hdr-bell-row" data-bell-go="${act}">
        <span class="hdr-bell-icon" aria-hidden="true">${icon}</span>
        <span class="hdr-bell-label">${label}</span>
        <span class="hdr-bell-count${n ? ' is-new' : ''}">${n ? fmt(n) + ' new' : 'none'}</span>
      </button>`;
    menu.innerHTML = `
      <p class="hdr-bell-head">${total() ? 'You have new things' : 'You\'re all caught up'}</p>
      ${row('messages', '💬', 'Messages', _messages)}
      ${row('friends', '👋', 'Friend requests', _friends)}`;
  }

  function _closeMenu() {
    const menu = document.querySelector('.hdr-bell-menu');
    if (!menu) return;
    menu.remove();
    document.querySelectorAll('[data-bell]').forEach(b => b.setAttribute('aria-expanded', 'false'));
    document.removeEventListener('pointerdown', _outside, true);
    document.removeEventListener('keydown', _onKey, true);
  }
  function _outside(e) { if (!e.target.closest('.hdr-bell-menu, [data-bell]')) _closeMenu(); }
  function _onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); const b = document.querySelector('[data-bell][aria-expanded="true"]'); _closeMenu(); if (b) b.focus(); }
  }

  function _openMenu(btn) {
    _closeMenu();
    const menu = document.createElement('div');
    menu.className = 'hdr-bell-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Notifications');
    _fillMenu(menu);
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    const w = Math.min(280, innerWidth - 16);
    menu.style.width = w + 'px';
    menu.style.top = (r.bottom + 8) + 'px';
    menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    menu.querySelector('[role="menuitem"]').focus();
    document.addEventListener('pointerdown', _outside, true);
    document.addEventListener('keydown', _onKey, true);
    refreshFriends();
    if (typeof MessagesBadge !== 'undefined') MessagesBadge.refresh();
  }

  function _flipTheme() {
    Theme.set(Theme.resolved() === 'comic' ? 'cinematic' : 'comic');
    const comic = Theme.resolved() === 'comic';
    const label = comic ? 'Switch to the Cinematic look' : 'Switch to the Comic look';
    document.querySelectorAll('[data-theme-toggle]').forEach(b => {
      b.title = label;
      b.setAttribute('aria-label', label);
      b.querySelector('span').textContent = comic ? '🎬' : '💥';
    });
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-theme-toggle], [data-bell], [data-bell-go], [data-bnav]');
    if (!t) return;
    if (t.matches('[data-theme-toggle]')) { _flipTheme(); return; }
    if (t.matches('[data-bell]')) {
      if (t.getAttribute('aria-expanded') === 'true') _closeMenu(); else _openMenu(t);
      return;
    }
    if (t.matches('[data-bell-go]')) {
      const go = t.dataset.bellGo;
      _closeMenu();
      if (go === 'messages') Router.go('/messages');
      else if (typeof showFriendsPanel === 'function') showFriendsPanel();
      return;
    }
    if (t.matches('[data-bnav]')) {
      if (location.pathname !== t.dataset.bnav) Router.go(t.dataset.bnav);
    }
  });

  function _buildNav() {
    _nav = document.createElement('nav');
    _nav.className = 'bottom-nav';
    _nav.setAttribute('aria-label', 'Main');
    _nav.innerHTML = TABS.map(([path, label]) => `
      <button type="button" class="bottom-nav-btn" data-bnav="${path}">
        ${svg(ICONS[path])}<span>${label}</span>
      </button>`).join('');
    document.body.appendChild(_nav);
  }

  function onRoute(path) {
    _closeMenu();
    const show = NAV_PAGES.has(path) && typeof Auth !== 'undefined' && Auth.isLoggedIn();
    if (show && !_nav) _buildNav();
    document.body.classList.toggle('has-bottom-nav', show);
    if (!_nav) return;
    _nav.hidden = !show;
    _nav.querySelectorAll('[data-bnav]').forEach(b => {
      const on = b.dataset.bnav === path;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (show) { _checkAccount(); start(); }
  }

  // Another account signed in in this tab (log out → log in): its counts
  // start from zero and load now, instead of showing the last account's
  // until the next poll.
  function _checkAccount() {
    let id = null;
    try { id = decodeJwtPayload(Auth.getToken())?.id || null; } catch (_) { /* logged out */ }
    if (id === _who) return;
    const first = _who === null;
    _who = id;
    if (first) return;            // start() does the first load
    _messages = 0;
    _friends = 0;
    _paint();
    refreshFriends();
    // Zero the shared cache too, so a drawer repaint can't bring the old count back.
    if (typeof MessagesBadge !== 'undefined') { MessagesBadge.apply(0); MessagesBadge.refresh(); }
  }

  return { headerHtml, onRoute, setMessages, refreshFriends };
})();
