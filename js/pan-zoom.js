/************************************************
 * PAN / ZOOM — "drag to move, wheel to zoom" for a scroll container
 *
 * Used by the watch-order flowchart (js/orderRenderer.js, also /friend/:u)
 * and the admin project board (js/views/admin/cms-projects-board.js). The
 * container keeps overflow:auto (its scroll offsets ARE the camera — the
 * walker fight framing drives them too) but hides its scrollbars; this
 * module supplies the input:
 *   - mouse / pen: press and drag anywhere `canPanFrom` allows. The pointer
 *     is only captured once the press has moved DRAG_PX screen pixels, so a
 *     plain click still reaches its real target (a poster, a button), and
 *     the click that ends a drag is swallowed.
 *   - wheel: every wheel event zooms at the cursor (the board never scrolls
 *     on a wheel — it only moves by dragging). Trackpad pinches arrive as
 *     Ctrl+wheel and zoom too; sideways swipes are ignored.
 *   - touch: one finger keeps the browser's native scrolling (momentum);
 *     two fingers pinch-zoom about their midpoint and pan with it.
 *
 * The owner keeps its zoom state: attach() calls opts.getZoom() and
 * opts.setZoom(z, anchorX, anchorY) with the anchor in px from the
 * container's top-left, and setZoom is expected to keep that point fixed.
 * Pure maths: js/pan-zoom-logic.js (PanZoomLogic, unit-tested).
 ************************************************/
const PanZoom = (() => {
  const INTERACTIVE = 'button, a[href], input, select, textarea, [contenteditable="true"]';

  // Swallow the click the browser fires after a drag ends on a clickable
  // thing (a poster would otherwise open its popup). A touch drag may never
  // produce that click, so the swallower expires.
  function swallowNextClick() {
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 80);
  }

  function attach(container, opts) {
    const PZ = window.PanZoomLogic;
    const o = Object.assign({
      min: 0.4,
      max: 2.5,
      isLocked: () => false,          // e.g. a walker fight owns the camera
      canPanFrom: () => true,         // (target, event) → may a drag start here?
      onPanStart: null,
      onPinchStart: null
    }, opts);
    const listeners = [];
    const on = (t, ev, fn, opt) => { t.addEventListener(ev, fn, opt); listeners.push([t, ev, fn, opt]); };

    // ── mouse / pen drag ──
    let pan = null;   // { id, x0, y0, sl, st, moved }

    function endPan(e, clicked) {
      if (!pan) return;
      const moved = pan.moved;
      const id = pan.id;
      pan = null;
      try { container.releasePointerCapture(id); } catch (_) {}
      container.classList.remove('panning');
      if (moved && clicked) swallowNextClick();
    }

    on(container, 'pointerdown', (e) => {
      if (e.pointerType === 'touch') return;          // native one-finger scrolling
      if (e.button !== 0 || o.isLocked()) return;
      const t = e.target;
      if (t && t.closest && t.closest(INTERACTIVE)) return;
      if (!o.canPanFrom(t, e)) return;
      pan = { id: e.pointerId, x0: e.clientX, y0: e.clientY,
              sl: container.scrollLeft, st: container.scrollTop, moved: false };
    });
    on(container, 'pointermove', (e) => {
      if (!pan || e.pointerId !== pan.id) return;
      // A release outside the window never sends pointerup to us.
      if (e.buttons === 0) { endPan(e, false); return; }
      const dx = e.clientX - pan.x0, dy = e.clientY - pan.y0;
      if (!pan.moved) {
        if (!PZ.pastThreshold(dx, dy)) return;
        pan.moved = true;
        try { container.setPointerCapture(e.pointerId); } catch (_) {}
        container.classList.add('panning');
        if (o.onPanStart) o.onPanStart();
      }
      container.scrollLeft = pan.sl - dx;
      container.scrollTop = pan.st - dy;
    });
    on(container, 'pointerup', (e) => { if (pan && e.pointerId === pan.id) endPan(e, true); });
    on(container, 'pointercancel', (e) => { if (pan && e.pointerId === pan.id) endPan(e, false); });
    on(window, 'blur', () => endPan(null, false));
    // Posters are <img>s: stop the browser's own image drag-and-drop ghost.
    on(container, 'dragstart', (e) => e.preventDefault());

    // ── wheel = zoom at the cursor ──
    on(container, 'wheel', (e) => {
      e.preventDefault();                 // the board never scrolls on a wheel
      if (o.isLocked()) return;
      const w = PZ.normalizeWheel(e, { pageHeight: container.clientHeight });
      if (w.horizontal || !w.dy) return;
      const r = container.getBoundingClientRect();
      o.setZoom(o.getZoom() * PZ.wheelZoomFactor(w.dy, w), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    // ── two-finger pinch (touch) ──
    let pinch = null;   // { z0, g0, m }
    const gap = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    on(container, 'touchstart', (e) => {
      if (e.touches.length !== 2 || o.isLocked()) {
        if (e.touches.length < 2) pinch = null;
        return;
      }
      e.preventDefault();                 // no native page zoom / scroll fight
      pinch = { z0: o.getZoom(), g0: gap(e.touches), m: mid(e.touches) };
      if (o.onPinchStart) o.onPinchStart();
    }, { passive: false });
    on(container, 'touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const m = mid(e.touches);
      // Pan with the fingers' midpoint, then zoom about it.
      container.scrollLeft -= m.x - pinch.m.x;
      container.scrollTop -= m.y - pinch.m.y;
      pinch.m = m;
      const r = container.getBoundingClientRect();
      o.setZoom(PZ.pinchZoom(pinch.z0, pinch.g0, gap(e.touches), o.min, o.max), m.x - r.left, m.y - r.top);
    }, { passive: false });
    const endPinch = (e) => { if (!e.touches || e.touches.length < 2) pinch = null; };
    on(container, 'touchend', endPinch);
    on(container, 'touchcancel', endPinch);

    return {
      // True while a mouse drag is moving the view.
      isPanning: () => !!(pan && pan.moved),
      destroy() {
        for (const [t, ev, fn, opt] of listeners) t.removeEventListener(ev, fn, opt);
        listeners.length = 0;
        pan = null;
        pinch = null;
        container.classList.remove('panning');
      }
    };
  }

  return { attach };
})();
