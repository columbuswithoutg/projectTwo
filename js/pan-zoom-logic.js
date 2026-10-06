/************************************************
 * PAN / ZOOM LOGIC — pure, dependency-free helpers
 *
 * The maths behind "drag to move, wheel to zoom" on the watch-order
 * flowchart, the admin project board and the /map wheel:
 *   - normalizeWheel(): pixel / line / page wheel deltas → pixels, and
 *     tells a trackpad pinch (Ctrl/⌘ + wheel) from a sideways swipe
 *   - wheelZoomFactor(): one smooth multiplicative step per wheel event,
 *     so a 100 px mouse notch and ten 10 px trackpad events zoom alike
 *   - anchorScroll(): keep the content point under the cursor in place
 *   - pastThreshold(): has a press moved far enough to be a drag?
 *
 * Shared by: js/pan-zoom.js, js/orderRenderer.js, js/renderer.js,
 *            js/views/admin/cms-projects-board.js
 *
 * UMD-ish: attaches to window.PanZoomLogic in the browser, exports via
 * module.exports under Node (same pattern as messaging-logic.js).
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PanZoomLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const C = {
    LINE_PX: 16,          // deltaMode 1 (lines) → px
    WHEEL_K: 0.0022,      // zoom per wheel pixel: a 100 px notch ≈ ×0.80 / ×1.25
    PINCH_K: 0.01,        // trackpad pinch deltas are small — more sensitive
    MIN_FACTOR: 0.5,      // one event never more than halves / doubles the zoom
    MAX_FACTOR: 2,
    MAX_DY: 400,          // a page-mode wheel or a spike can't fling the zoom
    DRAG_PX: 4            // screen pixels before a press counts as a drag
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Wheel event (or anything shaped like one) → { dx, dy, pinch, horizontal }
  // in pixels. `pageHeight` sizes deltaMode 2 (pages).
  function normalizeWheel(e, opts) {
    const pageH = (opts && opts.pageHeight) || 800;
    let dx = Number(e && e.deltaX) || 0;
    let dy = Number(e && e.deltaY) || 0;
    if (e && e.deltaMode === 1) { dx *= C.LINE_PX; dy *= C.LINE_PX; }
    else if (e && e.deltaMode === 2) { dx *= pageH; dy *= pageH; }
    // Laptop trackpads deliver a pinch as a wheel event with ctrlKey set.
    const pinch = !!(e && (e.ctrlKey || e.metaKey));
    // A sideways swipe (or a tilt wheel) is not a zoom gesture.
    const horizontal = !pinch && Math.abs(dx) > Math.abs(dy);
    dy = clamp(dy, -C.MAX_DY, C.MAX_DY);
    return { dx, dy, pinch, horizontal };
  }

  // Multiplicative zoom step for a (normalized) vertical delta. Positive dy
  // (wheel down / pinch in) zooms out.
  function wheelZoomFactor(dy, opts) {
    const k = opts && opts.pinch ? C.PINCH_K : C.WHEEL_K;
    const f = Math.exp(-(Number(dy) || 0) * k);
    return clamp(f, C.MIN_FACTOR, C.MAX_FACTOR);
  }

  function clampZoom(z, min, max, fallback) {
    if (!Number.isFinite(z)) return fallback != null ? fallback : clamp(1, min, max);
    return clamp(z, min, max);
  }

  // Scroll offset that keeps the content point under `anchor` (px from the
  // viewport's leading edge) fixed when the zoom goes z0 → z1. Content is
  // laid out at natural size × zoom, so (scroll + anchor) / z0 is the
  // unscaled coordinate under the anchor.
  function anchorScroll(scroll, anchor, z0, z1) {
    if (!(z0 > 0) || !(z1 > 0)) return Math.max(0, scroll || 0);
    const content = ((scroll || 0) + anchor) / z0;
    return Math.max(0, content * z1 - anchor);
  }

  function pastThreshold(dx, dy, px) {
    return Math.hypot(dx || 0, dy || 0) > (px == null ? C.DRAG_PX : px);
  }

  // Two-finger pinch: new zoom from the start zoom and the finger gap ratio.
  function pinchZoom(z0, gap0, gap1, min, max) {
    if (!(gap0 > 0) || !(gap1 > 0)) return clampZoom(z0, min, max);
    return clampZoom(z0 * (gap1 / gap0), min, max);
  }

  return { C, normalizeWheel, wheelZoomFactor, clampZoom, anchorScroll, pastThreshold, pinchZoom };
});
