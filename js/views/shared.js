/************************************************
 * SHARED VIEWS — /s/:token and /s/:token/map
 *
 * The public page behind a Doomsday story link (js/share.js makes the
 * link). Anyone can open it, signed in or not (js/router.js PUBLIC_PREFIXES):
 *   /s/:token      the sharer's Doomsday checklist, ring + countdown, and
 *                  "See their full watch order" / "Start your own"
 *   /s/:token/map  their watch order, read-only (FriendView.enterShared
 *                  swaps their watched ids in, exactly like a friend visit)
 * The data is GET /api/share/public/:token — username, picture, watched
 * ids. "Start your own" remembers the token so the sign-up sends the sharer
 * a friend request (js/views/login.js → routes/auth.js).
 ************************************************/
const SHARE_REF_KEY = 'mcu_share_ref';

const SharedView = {
  title: 'The road to Avengers: Doomsday',

  // Shared chrome: the top bar of both share routes.
  topbar(token, opts = {}) {
    const right = Auth.isLoggedIn()
      ? `<button type="button" class="btn btn--secondary share-topbar-btn" data-share-act="home">My tracker</button>`
      : `<button type="button" class="btn btn--secondary share-topbar-btn" data-share-act="login">Log in</button>`;
    return `
      <header class="share-topbar">
        ${opts.back
          ? `<button type="button" class="share-topbar-back" data-share-act="back" aria-label="Back to the checklist">←</button>`
          : `<span class="brand-mark" aria-hidden="true"></span>`}
        <span class="share-topbar-title">${opts.heading || 'MCU Watch Order'}</span>
        ${right}
      </header>`;
  },

  // Wires every [data-share-act] inside root.
  wire(root, token) {
    root.querySelectorAll('[data-share-act]').forEach(el => {
      el.addEventListener('click', () => {
        const act = el.dataset.shareAct;
        if (act === 'home') Router.go('/');
        else if (act === 'login') Router.go('/login?next=' + encodeURIComponent('/s/' + token));
        else if (act === 'back') Router.go('/s/' + token);
        else if (act === 'map') Router.go('/s/' + token + '/map');
        else if (act === 'join') SharedView.startYourOwn(token);
        else if (act === 'share') ShareProgress.open();
      });
    });
  },

  startYourOwn(token) {
    try { localStorage.setItem(SHARE_REF_KEY, JSON.stringify({ token, at: Date.now() })); } catch (_) {}
    Router.go('/login?register=1');
  },

  render404(container) {
    container.innerHTML = `
      <div class="share-page">
        ${SharedView.topbar('')}
        <main class="share-main">
          <section class="share-card share-gone">
            <h1>This link isn’t shared anymore</h1>
            <p>Its owner turned it off, or it was never a share link.</p>
            ${Auth.isLoggedIn()
              ? `<button type="button" class="btn btn--primary" data-share-act="home">Go to my tracker</button>`
              : `<button type="button" class="btn btn--primary" data-share-act="join-plain">Start your own watch order</button>`}
          </section>
        </main>
      </div>`;
    SharedView.wire(container, '');
    container.querySelector('[data-share-act="join-plain"]')?.addEventListener('click', () => Router.go('/login?register=1'));
  },

  // The share data didn't load (offline, server busy or restarting) — the
  // link may be fine, so offer a retry rather than the "gone" card.
  renderUnavailable(container, token, retry) {
    container.innerHTML = `
      <div class="share-page">
        ${SharedView.topbar(token)}
        <main class="share-main">
          <section class="share-card share-gone">
            <h1>Couldn’t load this page</h1>
            <p>Check your connection and try again.</p>
            <button type="button" class="btn btn--primary" data-share-retry>Try again</button>
          </section>
        </main>
      </div>`;
    SharedView.wire(container, token);
    container.querySelector('[data-share-retry]')?.addEventListener('click', () => retry());
  },

  async mount(container, params) {
    const token = params && params.token;
    const myMount = SharedView._mountSeq = (SharedView._mountSeq || 0) + 1;
    if (!ShareLogic.isToken(token)) { SharedView.render404(container); return; }

    container.innerHTML = `<div class="share-page">${SharedView.topbar(token)}<main class="share-main"><p class="share-loading">Loading…</p></main></div>`;
    const sharer = await FriendView.enterShared(token);
    if (myMount !== SharedView._mountSeq) return;
    if (!sharer) { SharedView.render404(container); return; }
    if (sharer.error) { SharedView.renderUnavailable(container, token, () => SharedView.mount(container, params)); return; }

    state.initProjects(projects);
    const g = computeDoomsdayGoal();
    const title = g.target ? g.target.title : 'Avengers: Doomsday';
    const days = ShareLogic.daysUntil(g.target && g.target.release);
    const countdown = ShareLogic.countdownText(days, title);
    const isOwner = Auth.isLoggedIn() && (Auth.getUsername() || '').toLowerCase() === sharer.username.toLowerCase();
    const name = esc(sharer.username);
    const pic = profilePicUrl(sharer.profilePicture);
    document.title = `${sharer.username}'s road to ${title}`;

    // Ring: r = 54 → circumference 339.3. `key` keeps the two gradients apart.
    const C = 2 * Math.PI * 54;
    const ringSvg = (met, total, key) => {
      const frac = total ? met / total : 0;
      return `
      <svg class="share-ring" viewBox="0 0 132 132" role="img" aria-label="${met} of ${total} watched">
        <defs><linearGradient id="share-ring-grad-${key}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="var(--accent-text)"/><stop offset="1" stop-color="var(--highlight)"/>
        </linearGradient></defs>
        <circle cx="66" cy="66" r="54" class="share-ring-track"/>
        ${frac > 0 ? `<circle cx="66" cy="66" r="54" class="share-ring-fill" stroke="url(#share-ring-grad-${key})"
                stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 66 66)"/>` : ''}
        <text x="66" y="70" class="share-ring-count">${met}/${total}</text>
        <text x="66" y="92" class="share-ring-label">WATCHED</text>
      </svg>`;
    };
    const ring = ringSvg(g.met, g.total, 'dd');

    // "All Marvel": every title on the tracker, oldest release first.
    const all = projects.slice().sort((a, b) => String(a.release || '').localeCompare(String(b.release || '')) || String(a.title).localeCompare(String(b.title)));
    const allMet = all.filter(p => state.isWatched(p.id)).length;
    const posterList = (items) => `
            <ul class="share-posters">
              ${items.map(({ p, title: t, watched }) => `
                <li class="share-poster${watched ? ' is-watched' : ''}">
                  <span class="share-poster-art">${PosterArt.html(p, { alt: '' })}</span>
                  ${watched ? '<span class="share-poster-check" aria-hidden="true">✓</span>' : ''}
                  <span class="share-poster-title">${esc(t)}</span>
                  <span class="visually-hidden">${watched ? 'watched' : 'not watched yet'}</span>
                </li>`).join('')}
            </ul>`;

    const cta = isOwner
      ? `<button type="button" class="btn btn--primary" data-share-act="share">Share to story</button>`
      : Auth.isLoggedIn()
        ? `<button type="button" class="btn btn--secondary" data-share-act="home">Back to my tracker</button>`
        : `<button type="button" class="btn btn--secondary" data-share-act="join">Start your own</button>`;

    container.innerHTML = `
      <div class="share-page">
        ${SharedView.topbar(token)}
        <main class="share-main">
          <section class="share-card share-hero">
            <div class="share-avatar">
              ${pic ? `<img src="${esc(pic)}" alt="" />` : ''}
              <span>${esc((sharer.username || '?')[0].toUpperCase())}</span>
            </div>
            <div class="share-mode-toggle" role="group" aria-label="Which progress to show">
              <button type="button" class="share-mode-btn is-on" data-share-mode="dd" aria-pressed="true">Doomsday</button>
              <button type="button" class="share-mode-btn" data-share-mode="all" aria-pressed="false">All Marvel</button>
            </div>
            <div data-share-pane="dd">
              <p class="share-eyebrow">${name}’s road to</p>
              <h1 class="share-title">${esc(title)}</h1>
              ${ring}
              ${countdown ? `<p class="share-countdown">${esc(countdown)}</p>` : ''}
            </div>
            <div data-share-pane="all" hidden>
              <p class="share-eyebrow">${name}’s progress on</p>
              <h2 class="share-title">All Marvel</h2>
              ${ringSvg(allMet, all.length, 'all')}
            </div>
            ${isOwner ? `<p class="share-owner-note">This is your share page — it’s what people see from your story.</p>` : ''}
            <div class="share-hero-actions">
              <button type="button" class="btn btn--primary" data-share-act="map">See ${isOwner ? 'your' : 'their'} full watch order</button>
              ${cta}
            </div>
          </section>

          <section class="share-card" data-share-pane="dd">
            <h2 class="share-section-title">Marvel’s list before ${esc(title)}, in order</h2>
            ${posterList(g.items.map(i => ({ p: state.byId.get(i.id), title: i.title, watched: i.watched })))}
          </section>

          <section class="share-card" data-share-pane="all" hidden>
            <h2 class="share-section-title">Every title, oldest first</h2>
            ${posterList(all.map(p => ({ p, title: p.title, watched: state.isWatched(p.id) })))}
          </section>

          ${!Auth.isLoggedIn() ? `
          <section class="share-card share-join">
            <h2 class="share-section-title">Track your own road to ${esc(title)}</h2>
            <p>Every Marvel movie and show in watch order — tick them off, unlock heroes, and share your progress.</p>
            <button type="button" class="btn btn--primary" data-share-act="join">Start your own — it’s free</button>
          </section>` : ''}
        </main>
      </div>`;

    // A picture that fails to load falls back to the initial underneath.
    const img = container.querySelector('.share-avatar img');
    if (img) img.addEventListener('error', () => img.remove(), { once: true });
    SharedView.wire(container, token);

    // Doomsday ⇄ All Marvel: swaps the ring and the poster list.
    container.querySelectorAll('[data-share-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.shareMode;
        container.querySelectorAll('[data-share-mode]').forEach(b => {
          const on = b.dataset.shareMode === mode;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', String(on));
        });
        container.querySelectorAll('[data-share-pane]').forEach(el => { el.hidden = el.dataset.sharePane !== mode; });
      });
    });
  },

  unmount() {
    SharedView._mountSeq = (SharedView._mountSeq || 0) + 1;
  }
};

const SharedOrderView = {
  title: 'Watch order',

  async mount(container, params) {
    const token = params && params.token;
    const myMount = SharedOrderView._mountSeq = (SharedOrderView._mountSeq || 0) + 1;
    if (!ShareLogic.isToken(token)) { SharedView.render404(container); return; }

    const sharer = await FriendView.enterShared(token);
    if (myMount !== SharedOrderView._mountSeq) return;
    if (!sharer) { SharedView.render404(container); return; }
    if (sharer.error) { SharedView.renderUnavailable(container, token, () => SharedOrderView.mount(container, params)); return; }
    document.title = `${sharer.username}'s watch order`;

    container.innerHTML = `
      <div class="share-order">
        ${SharedView.topbar(token, { back: true, heading: `<b>${esc(sharer.username)}</b>’s watch order` })}
        ${!Auth.isLoggedIn() ? `
        <div class="share-order-banner">
          <span>Tap a poster for details.</span>
          <button type="button" class="btn btn--primary" data-share-act="join">Start your own</button>
        </div>` : ''}
        <div class="flow-wrapper">
          <div class="flow-canvas">
            <svg class="flow-arrows" xmlns="http://www.w3.org/2000/svg"></svg>
            <div class="flow-nodes"></div>
            <div class="flow-walkers"></div>
          </div>
        </div>
      </div>`;
    SharedView.wire(container, token);

    state.initProjects(projects);
    orderRenderer.init();
    orderRenderer.render();
  },

  unmount() {
    SharedOrderView._mountSeq = (SharedOrderView._mountSeq || 0) + 1;
    // FriendView.exit() runs before this unmount and its restoreSelections()
    // could start walkers in this chart; stop them before the DOM goes, or
    // the rAF loop keeps running on detached nodes (MAP2-05).
    if (typeof Walkers !== 'undefined' && Walkers.destroy) Walkers.destroy();
    if (typeof WalkerView !== 'undefined') WalkerView.set(null);
    if (typeof orderRenderer !== 'undefined' && orderRenderer.destroy) orderRenderer.destroy();
  }
};
