/************************************************
 * PLAYGROUND 3D — input (keyboard / mouse / touch / joystick)
 *
 * Extracted from js/playground3d.js (2026-09-22). Wires WASD + arrows,
 * mouse orbit + wheel zoom, the mobile joystick, jump / punch buttons and
 * pinch zoom for the 3D views.
 *
 * makeInput(viewport, { orbit, CAMERA, minElev }) mutates the engine's
 * orbit object in place (azimuth / elevation / distance) and returns
 * { getAxis, isOrbiting, consumeJump, consumePunch, setPunchCooldown,
 *   denyPunch, detach }. Uses PG3DPhysics.pinchZoom when present. Must
 * load BEFORE js/playground3d.js.
 ************************************************/
(function (root) {
  function makeInput(viewport, opts) {
    const _orbit = opts.orbit;
    const CAMERA = opts.CAMERA;
    const _minElev = opts.minElev;
    const keys = { up: false, down: false, left: false, right: false };
    let joyAxis = { x: 0, y: 0 };
    let joyActive = false;
    // Jump is a one-shot edge trigger: keydown sets the flag; the tick
    // consumes it (and resets) when applying the impulse. This stops
    // hold-space from auto-bouncing.
    let jumpRequested = false;
    let punchRequested = false;   // same one-shot edge-trigger pattern as jump
    let interactRequested = false; // E / the 🪑 button: sit on a chair, lie in a bed, stand up

    function isTextField(el) {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    }

    function onKey(e, down) {
      if (isTextField(document.activeElement)) return;
      let handled = true;
      switch (e.key) {
        case 'w': case 'W': case 'ArrowUp':    keys.up = down; break;
        case 's': case 'S': case 'ArrowDown':  keys.down = down; break;
        case 'a': case 'A': case 'ArrowLeft':  keys.left = down; break;
        case 'd': case 'D': case 'ArrowRight': keys.right = down; break;
        case ' ': case 'Spacebar':
          // Suppress the browser's default (page scroll) regardless of
          // direction; only the keydown sets the one-shot request flag.
          if (down) jumpRequested = true;
          break;
        case 'f': case 'F':
          if (down) punchRequested = true;
          break;
        case 'e': case 'E':
          if (down) interactRequested = true;
          break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    }
    const onKeyDown = e => onKey(e, true);
    const onKeyUp   = e => onKey(e, false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Mouse-drag to orbit camera; wheel to zoom.
    let mouseDragging = false;
    let lastMouse = { x: 0, y: 0 };
    function onMouseDown(e) {
      if (e.button !== 0) return;
      // The joystick's pointerdown handler may have just activated and
      // captured this pointer for itself — don't double-engage the camera.
      if (activeJoyPointerId !== null) return;
      mouseDragging = true;
      lastMouse.x = e.clientX;
      lastMouse.y = e.clientY;
    }
    function onMouseMove(e) {
      if (!mouseDragging || !_orbit) return;
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      lastMouse.x = e.clientX;
      lastMouse.y = e.clientY;
      _orbit.azimuth -= dx * CAMERA.ROTATE_SPEED;
      _orbit.elevation = Math.max(_minElev(),
        Math.min(CAMERA.MAX_ELEV, _orbit.elevation - dy * CAMERA.ROTATE_SPEED));
    }
    function onMouseUp() { mouseDragging = false; }
    function onWheel(e) {
      if (!_orbit) return;
      _orbit.distance = Math.max(CAMERA.MIN_DIST,
        Math.min(CAMERA.MAX_DIST, _orbit.distance + e.deltaY * CAMERA.ZOOM_SPEED));
      e.preventDefault();
    }
    viewport.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    viewport.addEventListener('wheel', onWheel, { passive: false });

    // Touch joystick (mobile) + one-finger camera drag (anywhere outside joystick).
    let joyEl = null, stickEl = null, joyCenter = null, joyRadius = 56;
    let activeJoyTouchId = null;
    let activeCamTouchId = null;
    let lastCamTouch = { x: 0, y: 0 };
    // Pinch-to-zoom: every finger down on the scene (not the joystick), by
    // touch identifier. Two or more → pinching, which pauses orbit so a
    // zoom gesture doesn't also spin the camera.
    const camTouches = new Map();
    let pinchGap = 0;
    const pinching = () => camTouches.size >= 2;
    function firstTwoGap() {
      const [a, b] = camTouches.values();
      return (a && b) ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    }

    // Always create the joystick element. CSS gates visibility via a
    // (pointer: coarse) / narrow-viewport media query so it shows on
    // mobile and stays out of the way on desktop.
    const hasTouch = ('ontouchstart' in window) ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
    try { console.log('[Playground3D] touch=' + hasTouch); } catch (_) {}
    joyEl = document.createElement('div');
    joyEl.className = 'pg-joy';
    stickEl = document.createElement('div');
    stickEl.className = 'pg-joy-stick';
    joyEl.appendChild(stickEl);
    // Appended to <body>, not viewport, so its z-index lives at the
    // root stacking context — otherwise sibling overlays like
    // .world-chat-row (z-index: 6) would paint over the joystick even
    // though the joystick has z-index: 50 inside .pg-stage's context.
    document.body.appendChild(joyEl);

    // Touch jump button — bottom-right mirror of the joystick, same
    // body-append + CSS-gated (coarse pointer) visibility pattern.
    const jumpEl = document.createElement('button');
    jumpEl.type = 'button';
    jumpEl.className = 'pg-jump';
    jumpEl.setAttribute('aria-label', 'Jump');
    jumpEl.textContent = '⤒';
    jumpEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      jumpRequested = true;
    });
    document.body.appendChild(jumpEl);

    // Touch punch button — stacked above the jump button.
    const punchEl = document.createElement('button');
    punchEl.type = 'button';
    punchEl.className = 'pg-punch';
    punchEl.setAttribute('aria-label', 'Punch');
    punchEl.textContent = '👊';
    punchEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      punchRequested = true;
    });
    document.body.appendChild(punchEl);

    // Touch interact button — stacked above punch, shown only while there is
    // something to sit on / lie in nearby (setInteractLabel) or while seated.
    const sitEl = document.createElement('button');
    sitEl.type = 'button';
    sitEl.className = 'pg-sit';
    sitEl.setAttribute('aria-label', 'Sit');
    sitEl.textContent = '🪑';
    sitEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      interactRequested = true;
    });
    document.body.appendChild(sitEl);
    let sitLabel = null;
    function setInteractLabel(label) {
      if (label === sitLabel) return;
      sitLabel = label;
      sitEl.classList.toggle('pg-sit--on', !!label);
      if (label) { sitEl.setAttribute('aria-label', label); sitEl.title = label; }
    }

    // Cooldown display: --pg-cd (1 → 0) drives a sweep that drains off the
    // button. Quantised so the DOM is only touched ~50 times per cooldown.
    let punchCdShown = -1;
    function setPunchCooldown(frac) {
      const q = frac > 0 ? Math.ceil(frac * 50) / 50 : 0;
      if (q === punchCdShown) return;
      const was = punchCdShown;
      punchCdShown = q;
      punchEl.style.setProperty('--pg-cd', String(q));
      if ((q > 0) !== (was > 0)) {
        punchEl.classList.toggle('pg-punch--cooling', q > 0);
        punchEl.setAttribute('aria-label', q > 0 ? 'Punch (cooling down)' : 'Punch');
      }
    }
    function denyPunch() {
      punchEl.classList.remove('pg-punch--denied');
      void punchEl.offsetWidth;                 // restart the shake animation
      punchEl.classList.add('pg-punch--denied');
    }
    punchEl.addEventListener('animationend', () => punchEl.classList.remove('pg-punch--denied'));

    // Joystick activation — three redundant entry points (pointer, mouse,
    // document-level pointer) all funnel through engageJoystick().
    let activeJoyPointerId = null;
    // Pointer-event-based camera-orbit drag — kicks in when a touch
    // misses the joystick. Separate id from activeJoyPointerId so the
    // two finger tracks don't collide.
    let activeCamPointerId = null;
    const lastCamPointer = { x: 0, y: 0 };

    function moveJoystick(cx, cy) {
      if (!joyCenter) return;
      let dx = cx - joyCenter.x;
      let dy = cy - joyCenter.y;
      const d = Math.hypot(dx, dy);
      if (d > joyRadius) { dx = dx / d * joyRadius; dy = dy / d * joyRadius; }
      stickEl.style.transform = `translate(${dx}px, ${dy}px)`;
      joyAxis = { x: dx / joyRadius, y: dy / joyRadius };
    }
    function releaseJoystick() {
      activeJoyPointerId = null;
      joyActive = false;
      joyAxis = { x: 0, y: 0 };
      if (stickEl) stickEl.style.transform = 'translate(0,0)';
    }
    function engageJoystick(cx, cy, pid, type, e) {
      const rect = joyEl.getBoundingClientRect();
      if (rect.width < 1) return false;
      const jcx = rect.left + rect.width / 2;
      const jcy = rect.top  + rect.height / 2;
      const dx  = cx - jcx;
      const dy  = cy - jcy;
      const hit = Math.hypot(dx, dy) <= rect.width / 2;
      if (!hit) return false;
      if (activeJoyPointerId !== null) return false;
      if (e) { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} }
      activeJoyPointerId = pid;
      joyActive = true;
      joyCenter = { x: jcx, y: jcy };
      joyRadius = rect.width / 2;
      if (e && typeof viewport.setPointerCapture === 'function' && typeof pid === 'number') {
        try { viewport.setPointerCapture(pid); } catch (_) {}
      }
      return true;
    }

    // Pointer events (modern; mouse + touch + pen). Named so detach()
    // can remove them.
    const onPointerDown = (e) => {
      if (engageJoystick(e.clientX, e.clientY, e.pointerId, 'pdown', e)) {
        moveJoystick(e.clientX, e.clientY);
        return;
      }
      // Joystick miss — on touch, treat the drag as a camera orbit so
      // swiping outside the joystick looks around the character (mirrors
      // desktop mouse-drag behavior).
      if (e.pointerType === 'touch' && activeCamPointerId === null) {
        activeCamPointerId = e.pointerId;
        lastCamPointer.x = e.clientX;
        lastCamPointer.y = e.clientY;
        if (typeof viewport.setPointerCapture === 'function') {
          try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
        }
      }
    };
    const onPointerMove = (e) => {
      if (e.pointerId === activeJoyPointerId) {
        moveJoystick(e.clientX, e.clientY);
        return;
      }
      if (e.pointerId === activeCamPointerId && _orbit) {
        const dx = e.clientX - lastCamPointer.x;
        const dy = e.clientY - lastCamPointer.y;
        lastCamPointer.x = e.clientX;
        lastCamPointer.y = e.clientY;
        // Keep tracking during a pinch so orbit resumes without a jump.
        if (pinching()) return;
        _orbit.azimuth -= dx * CAMERA.ROTATE_SPEED;
        _orbit.elevation = Math.max(_minElev(),
          Math.min(CAMERA.MAX_ELEV, _orbit.elevation - dy * CAMERA.ROTATE_SPEED));
      }
    };
    const onPointerUp = (e) => {
      if (e.pointerId === activeJoyPointerId) {
        try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
        releaseJoystick();
        return;
      }
      if (e.pointerId === activeCamPointerId) {
        try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
        activeCamPointerId = null;
      }
    };
    const onPointerCancel = (e) => {
      if (e.pointerId === activeJoyPointerId) releaseJoystick();
      if (e.pointerId === activeCamPointerId) activeCamPointerId = null;
    };
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerCancel);

    // Mouse-event fallback for browsers where pointer events don't fire
    // or are intercepted. Uses a sentinel pointerId 'mouse' so the
    // pointer-event listeners above don't accidentally route mouse moves
    // (they'd compare e.pointerId === 'mouse' which is false for a real
    // pointer event).
    const onJoyMouseDown = (e) => {
      if (e.button !== 0) return;
      if (engageJoystick(e.clientX, e.clientY, 'mouse', 'mdown', e)) {
        moveJoystick(e.clientX, e.clientY);
      }
    };
    const onJoyMouseMove = (e) => {
      if (activeJoyPointerId === 'mouse') moveJoystick(e.clientX, e.clientY);
    };
    const onJoyMouseUp = () => {
      if (activeJoyPointerId === 'mouse') releaseJoystick();
    };
    viewport.addEventListener('mousedown', onJoyMouseDown);
    window.addEventListener('mousemove', onJoyMouseMove);
    window.addEventListener('mouseup', onJoyMouseUp);

    // Document-level capture-phase listener — last-resort safety net for
    // stacking quirks where viewport's pointerdown never reaches us.
    // Hit-test gates engagement to clicks actually inside joyEl's rect,
    // so it never steals clicks from elsewhere.
    const onDocPointerDown = (e) => {
      if (activeJoyPointerId !== null) return;
      if (engageJoystick(e.clientX, e.clientY, e.pointerId, 'doc-pdown', e)) {
        moveJoystick(e.clientX, e.clientY);
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);

    function joyStart(t) {
      activeJoyTouchId = t.identifier;
      joyActive = true;
      const rect = joyEl.getBoundingClientRect();
      joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      joyRadius = rect.width / 2;
      try { console.log('[Playground3D] joyStart id=' + t.identifier + ' rect=' + rect.width + 'x' + rect.height + ' center=' + joyCenter.x.toFixed(0) + ',' + joyCenter.y.toFixed(0)); } catch (_) {}
      joyMove(t);
    }
    function joyMove(t) {
      let dx = t.clientX - joyCenter.x;
      let dy = t.clientY - joyCenter.y;
      const d = Math.hypot(dx, dy);
      if (d > joyRadius) { dx = dx / d * joyRadius; dy = dy / d * joyRadius; }
      stickEl.style.transform = `translate(${dx}px, ${dy}px)`;
      joyAxis = { x: dx / joyRadius, y: dy / joyRadius };
    }
    function joyEnd() {
      activeJoyTouchId = null;
      joyActive = false;
      joyAxis = { x: 0, y: 0 };
      if (stickEl) stickEl.style.transform = 'translate(0,0)';
      try { console.log('[Playground3D] joyEnd'); } catch (_) {}
    }

    function onTouchStart(e) {
      try {
        const t0 = e.changedTouches[0];
        const tag = t0 && t0.target && (t0.target.className || t0.target.tagName);
        const hit = joyEl && t0 && joyEl.contains(t0.target);
        console.log('[Playground3D] touchstart n=' + e.changedTouches.length + ' target=' + tag + ' joyHit=' + hit);
      } catch (_) {}
      // The pointerdown path may have just activated the joystick — don't
      // also engage the touch-based joystick branch or the camera-orbit
      // drag, otherwise both would race the same finger.
      // A second finger while the joystick is held is still a scene touch
      // for pinch purposes — only skip the joystick finger itself.
      if (activeJoyPointerId !== null) {
        for (const t of e.changedTouches) {
          if (!(joyEl && joyEl.contains(t.target))) camTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
        }
        if (pinching()) pinchGap = firstTwoGap();
        return;
      }
      for (const t of e.changedTouches) {
        // Joystick gets priority hit-test.
        if (joyEl && joyEl.contains(t.target)) {
          e.preventDefault();
          joyStart(t);
          return;
        }
      }
      for (const t of e.changedTouches) camTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
      if (pinching()) {
        e.preventDefault();          // stop the browser's own page zoom
        pinchGap = firstTwoGap();
      }
      // Otherwise — start a camera-orbit drag with the first new touch.
      if (activeCamTouchId === null) {
        const t = e.changedTouches[0];
        activeCamTouchId = t.identifier;
        lastCamTouch.x = t.clientX;
        lastCamTouch.y = t.clientY;
      }
    }
    function onTouchMove(e) {
      let pinchMoved = false;
      for (const t of e.changedTouches) {
        const tracked = camTouches.get(t.identifier);
        if (tracked) { tracked.x = t.clientX; tracked.y = t.clientY; pinchMoved = true; }
        if (t.identifier === activeJoyTouchId) {
          e.preventDefault();
          joyMove(t);
        } else if (t.identifier === activeCamTouchId && _orbit) {
          const dx = t.clientX - lastCamTouch.x;
          const dy = t.clientY - lastCamTouch.y;
          lastCamTouch.x = t.clientX;
          lastCamTouch.y = t.clientY;
          // The same finger also drives the pointer-event orbit above; only
          // rotate here when that path isn't active (browsers without
          // pointer events, or after a pointercancel) — otherwise the camera
          // turned twice as fast on touch.
          if (activeCamPointerId !== null || pinching()) continue;
          _orbit.azimuth -= dx * CAMERA.ROTATE_SPEED;
          _orbit.elevation = Math.max(_minElev(),
            Math.min(CAMERA.MAX_ELEV, _orbit.elevation - dy * CAMERA.ROTATE_SPEED));
        }
      }
      if (pinchMoved && pinching() && _orbit) {
        e.preventDefault();
        const gap = firstTwoGap();
        if (typeof PG3DPhysics !== 'undefined' && PG3DPhysics.pinchZoom) {
          _orbit.distance = PG3DPhysics.pinchZoom(_orbit.distance, pinchGap, gap, CAMERA.MIN_DIST, CAMERA.MAX_DIST);
        }
        pinchGap = gap;
      }
    }
    function onTouchEnd(e) {
      for (const t of e.changedTouches) {
        camTouches.delete(t.identifier);
        if (t.identifier === activeJoyTouchId) {
          e.preventDefault();
          joyEnd();
        } else if (t.identifier === activeCamTouchId) {
          activeCamTouchId = null;
        }
      }
      if (pinching()) pinchGap = firstTwoGap();
      // Pinch ended with one finger still down — re-anchor its orbit so the
      // camera doesn't snap by however far that finger travelled mid-pinch.
      const rest = camTouches.size === 1 ? [...camTouches.entries()][0] : null;
      if (rest && activeCamTouchId === null) {
        activeCamTouchId = rest[0];
        lastCamTouch.x = rest[1].x;
        lastCamTouch.y = rest[1].y;
      }
    }
    // Touch listeners are always attached. Devices without touch input
    // simply never dispatch these events; no overhead.
    viewport.addEventListener('touchstart', onTouchStart, { passive: false });
    // joyEl now lives outside the viewport DOM subtree, so taps on it
    // wouldn't fire viewport's touchstart on older Android WebViews
    // that don't synthesize pointer events. Bind directly as a safety net.
    joyEl.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);

    function getAxis() {
      if (joyActive) return { x: joyAxis.x, y: joyAxis.y };
      let x = 0, y = 0;
      if (keys.left)  x -= 1;
      if (keys.right) x += 1;
      if (keys.up)    y -= 1;
      if (keys.down)  y += 1;
      return { x, y };
    }

    // True while the user is actively dragging the camera (mouse held or
    // touch-orbit in progress). Tick uses this to suspend auto-follow so
    // the user's manual rotation isn't fought by the follow lerp.
    function isOrbiting() {
      return mouseDragging || activeCamTouchId !== null || activeCamPointerId !== null;
    }

    // One-shot jump request. Tick reads and clears once per keydown so
    // that hold-space doesn't auto-bounce repeatedly.
    function consumeJump() {
      if (!jumpRequested) return false;
      jumpRequested = false;
      return true;
    }

    function consumePunch() {
      if (!punchRequested) return false;
      punchRequested = false;
      return true;
    }

    function consumeInteract() {
      if (!interactRequested) return false;
      interactRequested = false;
      return true;
    }

    function detach() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      viewport.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', onPointerUp);
      viewport.removeEventListener('pointercancel', onPointerCancel);
      viewport.removeEventListener('mousedown', onJoyMouseDown);
      window.removeEventListener('mousemove', onJoyMouseMove);
      window.removeEventListener('mouseup', onJoyMouseUp);
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      viewport.removeEventListener('touchstart', onTouchStart);
      if (joyEl) joyEl.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      // joyEl / jumpEl / punchEl are appended to <body>, not viewport — won't
      // get cleaned up by Playground3D's container.innerHTML='' on init/destroy.
      // Pull them out explicitly so re-init doesn't leak nodes.
      if (joyEl && joyEl.parentNode) joyEl.parentNode.removeChild(joyEl);
      if (jumpEl && jumpEl.parentNode) jumpEl.parentNode.removeChild(jumpEl);
      if (punchEl && punchEl.parentNode) punchEl.parentNode.removeChild(punchEl);
      if (sitEl && sitEl.parentNode) sitEl.parentNode.removeChild(sitEl);
    }

    return { getAxis, isOrbiting, consumeJump, consumePunch, consumeInteract, setInteractLabel, setPunchCooldown, denyPunch, detach };
  }

  root.PG3DInput = { makeInput };
})(typeof self !== 'undefined' ? self : this);
