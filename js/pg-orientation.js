/************************************************
 * PLAYGROUND 3D — orientation (rotate hint, fullscreen + landscape lock)
 *
 * Phones play /home and /world best sideways, but no phone can be forced:
 * iPhone Safari has neither element fullscreen nor screen.orientation.lock,
 * and Android only honours lock() once the document is fullscreen. So this
 * module makes landscape the natural way in, degrading per platform:
 *   - .pg-fullscreen — a HUD button that goes fullscreen and then asks for a
 *     landscape lock. Created only where element fullscreen exists (Android,
 *     iPad); iPhone never sees a button that can't work.
 *   - .pg-rotate-hint — a one-time "turn your phone" pill on portrait phones.
 *   - an orientation-change resize nudge beside the engine's ResizeObserver.
 *
 * attach(stage, { onResize }) returns { detach }. Playground3D calls it after
 * input creation and detaches from destroy(), so leaving the view can never
 * strand the user in locked fullscreen. Must load BEFORE js/playground3d.js.
 ************************************************/
(function (root) {
  const SEEN_KEY = 'pg_rotate_hint_seen';
  // Phones only: tablets in portrait are ≥744px wide and have room to spare.
  const PHONE_PORTRAIT = '(pointer: coarse) and (orientation: portrait) and (max-width: 520px)';
  const LANDSCAPE = '(orientation: landscape)';

  function mq(q) { return root.matchMedia ? root.matchMedia(q) : null; }
  // matchMedia change subscription with the iOS 13 addListener fallback.
  function onMq(m, fn) {
    if (!m) return () => {};
    if (m.addEventListener) { m.addEventListener('change', fn); return () => m.removeEventListener('change', fn); }
    m.addListener(fn);
    return () => m.removeListener(fn);
  }
  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function fsSupported() { return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled); }
  function unlockOrientation() {
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (_) {}
  }

  function attach(stage, opts) {
    const onResize = (opts && opts.onResize) || null;
    const cleanups = [];
    let detached = false;
    const land = mq(LANDSCAPE);

    // ── orientation → resize nudge (the ResizeObserver normally fires first;
    //    _resizeRenderer is idempotent so a double call is harmless) ──
    cleanups.push(onMq(land, () => { if (onResize) requestAnimationFrame(onResize); }));

    // ── fullscreen + landscape lock ──
    if (fsSupported()) {
      const btn = document.createElement('button');
      let enteredByUs = false;
      btn.type = 'button';
      btn.className = 'pg-fullscreen';
      btn.setAttribute('aria-label', 'Full screen');
      btn.setAttribute('aria-pressed', 'false');
      btn.title = 'Full screen — locks landscape where your phone allows it';
      btn.textContent = '⛶';
      // Body-appended like the joystick so z-index escapes .pg-stage.
      document.body.appendChild(btn);

      const enter = () => {
        const el = document.documentElement;
        let p;
        try {
          // Only the unprefixed API takes options; older WebKit's prefixed
          // form throws on an argument.
          p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen();
        } catch (_) { return; }
        enteredByUs = true;
        Promise.resolve(p).then(() => {
          // Chrome Android rejects lock() unless the document is already
          // fullscreen, hence after the promise. iOS + desktop reject too —
          // there landscape stays a suggestion, which is all they allow.
          if (screen.orientation && screen.orientation.lock) return screen.orientation.lock('landscape');
        }).catch(() => {});
      };
      const exit = () => {
        try {
          const p = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen();
          Promise.resolve(p).catch(() => {});
        } catch (_) {}
      };
      const sync = () => {
        const on = !!fsElement();
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.textContent = on ? '✕' : '⛶';
        btn.title = on ? 'Exit full screen' : 'Full screen — locks landscape where your phone allows it';
        if (!on) { enteredByUs = false; unlockOrientation(); }
      };
      const onClick = () => { if (fsElement()) exit(); else enter(); };
      btn.addEventListener('click', onClick);
      document.addEventListener('fullscreenchange', sync);
      document.addEventListener('webkitfullscreenchange', sync);
      cleanups.push(() => {
        btn.removeEventListener('click', onClick);
        document.removeEventListener('fullscreenchange', sync);
        document.removeEventListener('webkitfullscreenchange', sync);
        if (enteredByUs && fsElement()) exit();
        unlockOrientation();
        if (btn.parentNode) btn.parentNode.removeChild(btn);
      });
    }

    // ── one-time rotate hint ──
    const portrait = mq(PHONE_PORTRAIT);
    let seen = true;
    // Storage blocked (private mode) → still show it, at most once per mount.
    try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch (_) { seen = false; }
    if (portrait && portrait.matches && !seen) {
      let hint = null;
      let timers = [];
      let offs = [];
      const clear = () => {
        timers.forEach(clearTimeout); timers = [];
        offs.forEach((f) => f()); offs = [];
      };
      const dismiss = () => {
        clear();
        if (!hint) return;
        const h = hint;
        hint = null;
        h.classList.remove('show');
        setTimeout(() => { if (h.parentNode) h.parentNode.removeChild(h); }, 400);
      };
      const show = () => {
        if (detached || !stage.isConnected || !portrait.matches) return;   // gone, or already turned
        try { localStorage.setItem(SEEN_KEY, '1'); } catch (_) {}
        hint = document.createElement('div');
        hint.className = 'pg-rotate-hint';
        hint.innerHTML = '<span class="world-hint-icon">🔄</span> Turn your phone sideways for a wider view';
        stage.appendChild(hint);
        requestAnimationFrame(() => { if (hint) hint.classList.add('show'); });
        offs.push(onMq(land, (e) => { if (e.matches) dismiss(); }));
        const onDown = () => dismiss();
        window.addEventListener('pointerdown', onDown, true);
        offs.push(() => window.removeEventListener('pointerdown', onDown, true));
        timers.push(setTimeout(dismiss, 6000));
      };
      // /world's first-visit controls hint (.world-hint) removes itself after
      // ~6.4 s — wait it out so two pills never stack.
      timers.push(setTimeout(() => {
        if (stage.querySelector('.world-hint')) timers.push(setTimeout(show, 6500));
        else show();
      }, 1500));
      cleanups.push(() => {
        clear();
        if (hint && hint.parentNode) hint.parentNode.removeChild(hint);
        hint = null;
      });
    }

    function detach() {
      if (detached) return;
      detached = true;
      cleanups.splice(0).forEach((f) => { try { f(); } catch (_) {} });
    }
    return { detach };
  }

  root.PGOrientation = { attach };
})(typeof self !== 'undefined' ? self : this);
