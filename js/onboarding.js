/************************************************
 * ONBOARDING — the first-run welcome and the first-visit feature tips.
 * Content + rules: js/onboarding-logic.js (OnboardingLogic).
 *
 *   Onboarding.maybeStart()   Watch Order calls it once the chart is up: a
 *                             new account (progress load said `onboarding`)
 *                             gets the 3-step welcome —
 *                               1 pick a path (All Marvel / Doomsday switch)
 *                               2 tick what you've already watched
 *                               3 the reveal: your count + what's up next
 *                             Finishing or skipping posts
 *                             /api/progress/onboarding, which closes it for
 *                             good (and marks the ticks watched, once).
 *   FeatureTips.maybeShow(p)  the router calls it after every mount: the
 *                             first visit to a main page gets 2–6 spotlight
 *                             steps on its real controls, once per account.
 ************************************************/
const FeatureTips = (() => {
  let _open = null;   // { close } of the tour on screen
  const _waiting = new Set();   // pages whose tour is waiting for the page to settle

  function _key() {
    let id = null;
    try { id = decodeJwtPayload(Auth.getToken())?.id || null; } catch (_) { /* logged out */ }
    return OnboardingLogic.tipsKey(id);
  }
  function _stored() { try { return localStorage.getItem(_key()); } catch (_) { return null; } }
  function seen(page) { return OnboardingLogic.tipsSeen(_stored()).includes(page); }
  function _markSeen(page) {
    try { localStorage.setItem(_key(), OnboardingLogic.markTip(_stored(), page)); } catch (_) { /* storage blocked */ }
  }

  function _visible(el) {
    if (!el || !el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    // Its middle on screen and not tucked under the fixed header (the
    // header's own controls are their own targets).
    const hdr = document.getElementById('header');
    const inHeader = hdr && hdr.contains(el);
    const minY = inHeader || !hdr ? 0 : hdr.getBoundingClientRect().bottom;
    // Small targets must be wholly in view; a big one (a column, the 3D
    // stage) only needs its middle there.
    if (r.height < innerHeight * 0.6 && r.width < innerWidth * 0.9) {
      return r.top >= minY && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
    }
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return cx > 0 && cx < innerWidth && cy > minY && cy < innerHeight;
  }
  function _find(sel) {
    for (const one of sel.split(',')) {
      // The top-most (then left-most) one on screen, not the first in the
      // DOM: the chart's posters aren't in reading order.
      const els = [...document.querySelectorAll(one.trim())].filter(_visible);
      if (els.length) {
        const at = (e) => { const r = e.getBoundingClientRect(); return r.top * 10000 + r.left; };
        return els.reduce((a, b) => (at(b) < at(a) ? b : a));
      }
    }
    return null;
  }

  // The page is ready for its tour: first step's target on screen, no
  // dialog or loading screen over it. Waits up to ~10 s, then gives up
  // (the tour comes back on the next visit).
  function _whenReady(page, firstSel) {
    return new Promise(resolve => {
      const t0 = Date.now();
      let last = null;
      const tick = () => {
        if (location.pathname !== page) return resolve(false);
        const loading = [...document.querySelectorAll('.world-loading, .kb-loading')].some(_visible);
        const el = !isModalOpen() && !loading && _find(firstSel);
        // …and settled: the chart glides to the last-watched poster on open.
        const at = el ? JSON.stringify(el.getBoundingClientRect()) : null;
        if (el && at === last) return resolve(true);
        last = at;
        if (Date.now() - t0 > 10000) return resolve(false);
        setTimeout(tick, 300);
      };
      setTimeout(tick, 600);
    });
  }

  async function maybeShow(page) {
    const tour = OnboardingLogic.TIPS[page];
    if (!tour || _open || !Auth.isLoggedIn() || seen(page)) return;
    if (typeof state !== 'undefined' && state.onboarding) return;   // the welcome runs first
    if (_waiting.has(page)) return;
    _waiting.add(page);
    const ready = await _whenReady(page, tour.steps[0].sel);
    _waiting.delete(page);
    if (!ready || _open || seen(page)) return;
    if (typeof state !== 'undefined' && state.onboarding) return;
    const steps = tour.steps.filter(s => _find(s.sel));
    if (steps.length) _run(page, tour, steps);
  }

  function _run(page, tour, steps) {
    const layer = document.createElement('div');
    layer.className = 'onb-tips';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-labelledby', 'onb-tip-title');
    layer.innerHTML = `
      <div class="onb-spot" aria-hidden="true"></div>
      <div class="onb-tip">
        <p class="onb-tip-count"></p>
        <h3 id="onb-tip-title" class="onb-tip-title"></h3>
        <p class="onb-tip-text"></p>
        <div class="onb-tip-actions">
          <button type="button" class="onb-tip-skip">Skip tips</button>
          <span class="onb-tip-gap"></span>
          <button type="button" class="onb-tip-back">Back</button>
          <button type="button" class="btn btn--primary onb-tip-next">Next</button>
        </div>
      </div>`;
    document.body.appendChild(layer);
    // In the 3D views the tips must not leak WASD / Space / Enter into the
    // game, and a locked (hidden) mouse couldn't press Next — let it go.
    const engine = typeof Playground3D !== 'undefined' ? Playground3D : null;
    if (engine && engine.setInputSuspended) engine.setInputSuspended(true, 'tips');
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    const spot = layer.querySelector('.onb-spot');
    const tip = layer.querySelector('.onb-tip');
    const next = layer.querySelector('.onb-tip-next');
    const back = layer.querySelector('.onb-tip-back');
    let i = 0;
    let target = null;

    function place() {
      // Re-pick when it's gone or slid out of view (the chart keeps panning).
      if (!target || !target.isConnected || !_visible(target)) target = _find(steps[i].sel) || target;
      if (!target) return;
      const r = target.getBoundingClientRect();
      const pad = 6;
      // Clamp a huge target (the 3D stage, a whole column) to the screen.
      const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
      const w = Math.min(innerWidth - 8, r.right + pad) - x, h = Math.min(innerHeight - 8, r.bottom + pad) - y;
      // The dimming is the hole's shadow: just big enough to cover the
      // screen (Chrome drops a shadow far larger than the viewport).
      Object.assign(spot.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px',
        boxShadow: `0 0 0 ${Math.max(innerWidth, innerHeight)}px var(--onb-scrim)` });
      // The card goes below the target, else above, else beside it (a tall
      // column), else over its middle.
      const tw = Math.min(340, innerWidth - 24);
      tip.style.width = tw + 'px';
      const th = tip.offsetHeight;
      const clampTop = (t) => Math.max(12, Math.min(innerHeight - th - 12, t));
      let top = y + h + 12;
      let left = Math.max(12, Math.min(innerWidth - tw - 12, x + w / 2 - tw / 2));
      if (top + th > innerHeight - 12) top = y - th - 12;
      if (top < 12) {
        top = clampTop(y + Math.min(h, innerHeight) / 2 - th / 2);
        if (x + w + 12 + tw <= innerWidth - 12) left = x + w + 12;
        else if (x - 12 - tw >= 12) left = x - 12 - tw;
      }
      tip.style.top = top + 'px';
      tip.style.left = left + 'px';
    }

    function show(n) {
      i = n;
      target = _find(steps[i].sel);
      const last = i === steps.length - 1;
      layer.querySelector('.onb-tip-count').textContent = `Tip ${i + 1} of ${steps.length}`;
      layer.querySelector('.onb-tip-title').textContent = steps[i].title;
      layer.querySelector('.onb-tip-text').textContent = steps[i].text;
      back.hidden = i === 0;
      next.textContent = last ? 'Got it' : 'Next';
      layer.querySelector('.onb-tip-skip').textContent = last ? 'Full guide' : 'Skip tips';
      tip.classList.remove('is-in');
      place();
      requestAnimationFrame(() => tip.classList.add('is-in'));
      next.focus();
    }

    const onResize = () => place();
    addEventListener('resize', onResize);
    addEventListener('scroll', onResize, true);
    // Left the page mid-tour (a tab, the back button): drop it, done or not.
    // Also follows a target that moves without a scroll event (the chart
    // pans by transform).
    const watch = setInterval(() => {
      if (location.pathname !== page) close(); else place();
    }, 400);

    const close = wireModalDismiss(layer, () => {
      clearInterval(watch);
      if (engine && engine.setInputSuspended) engine.setInputSuspended(false, 'tips');
      removeEventListener('resize', onResize);
      removeEventListener('scroll', onResize, true);
      _markSeen(page);
      layer.remove();
      _open = null;
    }, { initialFocus: next, backdrop: false });
    _open = { close };

    next.addEventListener('click', () => { if (i < steps.length - 1) show(i + 1); else close(); });
    back.addEventListener('click', () => { if (i > 0) show(i - 1); });
    layer.querySelector('.onb-tip-skip').addEventListener('click', () => {
      const last = i === steps.length - 1;
      close();
      if (last && typeof HelpCentre !== 'undefined') HelpCentre.open(tour.help);
    });
    // A tap on the dimmed page moves on, like Next.
    layer.addEventListener('click', (e) => { if (e.target === layer) next.click(); });
    show(0);
  }

  function close() { if (_open) _open.close(); }

  return { maybeShow, seen, close };
})();

const Onboarding = (() => {
  let _active = false;

  const today = () => new Date().toISOString().slice(0, 10);
  const pathIds = () => (orderRenderer && orderRenderer._pathIds) ? orderRenderer._pathIds() : [];

  function maybeStart() {
    if (_active || typeof state === 'undefined' || !state.onboarding || !Auth.isLoggedIn()) return;
    if (location.pathname !== '/') return;
    _open();
  }

  function _posterTile(p, picked) {
    return `<button type="button" class="onb-poster${picked ? ' is-picked' : ''}" data-id="${esc(p.id)}" aria-pressed="${picked}">
        <span class="onb-poster-art">${PosterArt.html(p, { alt: '' })}</span>
        <span class="onb-poster-check" aria-hidden="true">✓</span>
        <span class="onb-poster-title">${esc(p.title)}</span>
      </button>`;
  }

  function _open() {
    _active = true;
    let mode = orderRenderer && orderRenderer.doomsdayOnly ? 'dd' : 'all';
    const picked = new Set();
    let finished = false;
    let saving = null;       // the ticks' save while it's in flight
    let skipped = false;     // closed by Skip / Esc (not by leaving the page)

    const el = document.createElement('div');
    el.className = 'onb-welcome';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'onb-heading');
    el.innerHTML = `
      <div class="onb-box">
        <header class="onb-head">
          <ol class="onb-dots" aria-label="Welcome steps">
            <li class="is-on">Path</li><li>Watched</li><li>Ready</li>
          </ol>
          <button type="button" class="onb-skip">Skip</button>
        </header>
        <div class="onb-body"></div>
      </div>`;
    document.body.appendChild(el);
    const body = el.querySelector('.onb-body');
    const dots = el.querySelectorAll('.onb-dots li');

    function setStep(n) {
      dots.forEach((d, i) => {
        d.classList.toggle('is-on', i <= n);
        if (i === n) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current');
      });
      body.classList.remove('is-in');
      requestAnimationFrame(() => body.classList.add('is-in'));
    }

    // ── 1 · Pick a path ──
    function step1() {
      setStep(0);
      const name = esc(Auth.getUsername() || '');
      body.innerHTML = `
        <h2 id="onb-heading" class="onb-title">Welcome${name ? ', ' + name : ''}!</h2>
        <p class="onb-lead">Track every Marvel title in story order, unlock characters as you go, and explore it all with friends. First, pick your path:</p>
        <div class="onb-paths">
          <button type="button" class="onb-path${mode === 'all' ? ' is-picked' : ''}" data-mode="all" aria-pressed="${mode === 'all'}">
            <span class="onb-path-name">All Marvel</span>
            <span class="onb-path-desc">Every movie and series, from Iron Man to today. The full journey.</span>
          </button>
          <button type="button" class="onb-path${mode === 'dd' ? ' is-picked' : ''}" data-mode="dd" aria-pressed="${mode === 'dd'}">
            <span class="onb-path-name">Doomsday</span>
            <span class="onb-path-desc">Only Marvel's must-watch list before Avengers: Doomsday. Quick and focused.</span>
          </button>
        </div>
        <p class="onb-hint">You can switch any time with the All / Doom switch at the top.</p>
        <div class="onb-actions"><span></span><button type="button" class="btn btn--primary onb-primary" data-go="2">Next</button></div>`;
      body.querySelectorAll('.onb-path').forEach(b => b.addEventListener('click', () => {
        mode = b.dataset.mode;
        body.querySelectorAll('.onb-path').forEach(x => {
          const on = x === b;
          x.classList.toggle('is-picked', on);
          x.setAttribute('aria-pressed', String(on));
        });
      }));
      body.querySelector('[data-go="2"]').addEventListener('click', () => {
        if (orderRenderer && orderRenderer.setDoomsdayOnly) orderRenderer.setDoomsdayOnly(mode === 'dd');
        step2();
      });
      body.querySelector('[data-go="2"]').focus();
    }

    // ── 2 · Already watched? ──
    function step2() {
      setStep(1);
      const list = OnboardingLogic.candidates(projects, mode, pathIds(), today())
        .filter(p => !state.isWatched(p.id));
      // Ticks from the other path that this list doesn't show are dropped —
      // "Continue with 1" with nothing visibly ticked would save a title
      // the user can't see.
      const ids = new Set(list.map(p => p.id));
      [...picked].forEach(id => { if (!ids.has(id)) picked.delete(id); });
      body.innerHTML = `
        <h2 id="onb-heading" class="onb-title">Seen any already?</h2>
        <p class="onb-lead">Tap the ones you've watched — they count straight away, just this once. New to Marvel? Skip ahead.</p>
        <div class="onb-tools">
          <input type="search" class="onb-search" placeholder="Search titles…" aria-label="Search titles" autocomplete="off">
          <button type="button" class="onb-link" data-all>Select all</button>
          <button type="button" class="onb-link" data-none>Clear</button>
        </div>
        <div class="onb-grid" role="group" aria-label="Titles you've watched">
          ${list.map(p => _posterTile(p, picked.has(p.id))).join('')}
        </div>
        <p class="onb-error" role="alert" hidden></p>
        <div class="onb-actions">
          <button type="button" class="btn btn--secondary onb-secondary" data-back>Back</button>
          <button type="button" class="btn btn--primary onb-primary" data-go="3"></button>
        </div>`;
      const go = body.querySelector('[data-go="3"]');
      const grid = body.querySelector('.onb-grid');
      const label = () => { go.textContent = picked.size ? `Continue with ${picked.size}` : "I haven't seen any"; };
      label();
      grid.addEventListener('click', (e) => {
        const b = e.target.closest('.onb-poster');
        if (!b) return;
        const id = b.dataset.id;
        if (picked.has(id)) picked.delete(id); else picked.add(id);
        b.classList.toggle('is-picked', picked.has(id));
        b.setAttribute('aria-pressed', String(picked.has(id)));
        label();
      });
      const shown = () => [...grid.querySelectorAll('.onb-poster')].filter(b => !b.hidden);
      body.querySelector('[data-all]').addEventListener('click', () => {
        shown().forEach(b => { picked.add(b.dataset.id); b.classList.add('is-picked'); b.setAttribute('aria-pressed', 'true'); });
        label();
      });
      body.querySelector('[data-none]').addEventListener('click', () => {
        picked.clear();
        grid.querySelectorAll('.onb-poster').forEach(b => { b.classList.remove('is-picked'); b.setAttribute('aria-pressed', 'false'); });
        label();
      });
      body.querySelector('.onb-search').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        grid.querySelectorAll('.onb-poster').forEach(b => {
          b.hidden = !!q && !b.querySelector('.onb-poster-title').textContent.toLowerCase().includes(q);
        });
      });
      body.querySelector('[data-back]').addEventListener('click', step1);
      go.addEventListener('click', async () => {
        go.disabled = true;
        go.textContent = 'Saving…';
        skipBtn.disabled = true;
        saving = _finish([...picked], body.querySelector('.onb-error'));
        const ok = await saving;
        saving = null;
        skipBtn.disabled = false;
        if (!el.isConnected) return;   // left the page meanwhile; the save still counted
        if (ok) step3(); else { go.disabled = false; label(); }
      });
      go.focus();
    }

    // ── 3 · The reveal ──
    function step3() {
      setStep(2);
      const watched = state.data.size;
      const next = OnboardingLogic.nextUp(projects, mode, pathIds(), isRevealed, 3);
      body.innerHTML = `
        <h2 id="onb-heading" class="onb-title">Your path is ready</h2>
        <div class="onb-reveal">
          <div class="onb-stat"><span class="onb-stat-num" data-count="${watched}">0</span><span class="onb-stat-label">watched</span></div>
          <div class="onb-stat"><span class="onb-stat-num">${mode === 'dd' ? 'Doomsday' : 'All Marvel'}</span><span class="onb-stat-label">your path</span></div>
        </div>
        ${next.length ? `
          <p class="onb-lead">Up next for you:</p>
          <div class="onb-next">${next.map((p, i) => `
            <div class="onb-next-item" style="--i:${i}">
              <span class="onb-poster-art">${PosterArt.html(p, { alt: '' })}</span>
              <span class="onb-poster-title">${esc(p.title)}</span>
            </div>`).join('')}</div>` : '<p class="onb-lead">You\'re all caught up — impressive!</p>'}
        <p class="onb-hint">Next, a few quick tips show you around each page. The ? at the top has the full guide.</p>
        <div class="onb-actions"><span></span><button type="button" class="btn btn--primary onb-primary" data-done>Start exploring</button></div>`;
      _countUp(body.querySelector('[data-count]'));
      const done = body.querySelector('[data-done]');
      done.addEventListener('click', () => close());
      done.focus();
    }

    // POST the ticks (or nothing, to skip) → state; false + message on failure.
    async function _finish(ids, errEl) {
      try {
        const res = await Auth.fetch(`${API}/progress/onboarding`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectIds: ids })
        });
        let data = null;
        try { data = await res.json(); } catch (_) {}
        // 409 "already finished" (another tab got there first): fine, move on.
        if (data && Array.isArray(data.watchedProjects)) state._applyServer(data);
        if (res.ok || res.status === 409) {
          finished = true;
          state.onboarding = false;
          // Another tab finished the welcome first: these ticks weren't saved.
          if (res.status === 409 && ids.length) toast('Your welcome was already finished in another tab, so those picks weren’t saved. Use Start watching on each title instead.', { type: 'error', duration: 7000 });
          if (data && data.added && data.added.length) toast(`${data.added.length} title${data.added.length === 1 ? '' : 's'} marked as watched.`, 'success');
          return true;
        }
        if (errEl) { errEl.textContent = (data && data.error) || 'Couldn\'t save that. Try again.'; errEl.hidden = false; }
      } catch (_) {
        if (errEl) { errEl.textContent = 'Couldn\'t reach the server. Try again.'; errEl.hidden = false; }
      }
      return false;
    }

    const close = wireModalDismiss(el, () => {
      el.remove();
      _active = false;
      // Skipped (Skip / Esc) before step 2 saved: close it on the server too,
      // so it doesn't come back on every visit. Closed by leaving the page
      // (the back button, a link): nothing is decided — the welcome comes
      // back on the next visit to the watch order.
      if (!finished && skipped && !saving) { state.onboarding = false; _finish([], null); }
      if (!finished && !skipped) return;
      FeatureTips.maybeShow('/');
    }, {
      backdrop: false,
      // Esc counts as Skip — but never while the ticks are saving (closing
      // then sent a second, empty save that could win the race).
      // Esc in the search box with text in it only clears the box.
      onEscape: (e) => {
        if (saving) return true;
        const t = e && e.target;
        if (t && t.classList && t.classList.contains('onb-search') && t.value) {
          t.value = '';
          t.dispatchEvent(new Event('input'));
          return true;
        }
        if (picked.size && !finished) { skip(); return true; }
        skipped = true;
        return false;
      },
      canClose: () => !saving
    });
    // The welcome is one-time, so skipping with titles ticked would lose them
    // for good: ask first.
    let asking = false;
    async function skip() {
      if (saving || asking) return;
      if (picked.size && !finished) {
        asking = true;
        const n = picked.size;
        const ok = await confirmDialog({
          title: 'Skip without saving?',
          message: `You ticked ${n} title${n === 1 ? '' : 's'}. Skipping won't mark ${n === 1 ? 'it' : 'them'} as watched, and this welcome won't come back.`,
          confirmLabel: 'Skip anyway',
          cancelLabel: 'Keep my ticks',
          danger: true
        });
        asking = false;
        if (!ok || saving || !el.isConnected) return;
      }
      skipped = true;
      close();
    }
    const skipBtn = el.querySelector('.onb-skip');
    skipBtn.addEventListener('click', () => skip());
    step1();
  }

  function _countUp(el) {
    if (!el) return;
    const to = Number(el.dataset.count) || 0;
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || to === 0) { el.textContent = String(to); return; }
    const t0 = performance.now(), dur = Math.min(1200, 300 + to * 40);
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  return { maybeStart, isActive: () => _active };
})();
