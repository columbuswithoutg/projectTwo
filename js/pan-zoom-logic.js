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
 *   - shouldFrame() / pointInView(): may a walker encounter or fight move
 *     the camera right now? (js/walkers.js, via js/walkerView.js)
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
    DRAG_PX: 4,           // screen pixels before a press counts as a drag
    FRAME_IDLE_MS: 3000   // no walker camera moves this soon after user input
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

  // Is (x, y) inside the visible rect { left, top, width, height } (same
  // units), grown on every side by `slack` × the rect's size?
  function pointInView(x, y, view, slack) {
    if (!view || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const s = slack || 0;
    const w = view.width || 0, h = view.height || 0;
    const l = view.left || 0, t = view.top || 0;
    return x >= l - w * s && x <= l + w * (1 + s) &&
           y >= t - h * s && y <= t + h * (1 + s);
  }

  // May walker code move the camera now? The camera belongs to the user:
  //   - never mid-drag or mid-pinch (the drag computes its scroll from where
  //     it started, so a framing scroll would fight it);
  //   - never within FRAME_IDLE_MS of pointer / wheel / touch / key input
  //     (someone reading or about to drag shouldn't be yanked away);
  //   - kind 'encounter' (a chat between two walkers, every ~15–30 s) only
  //     when the pair is already on screen — the framing then just nudges it
  //     to the centre instead of carrying the reader off to another part;
  //   - kind 'fight' (keeping an un-zoomed fight centred) once idle.
  // A fight's opening zoom is not asked: fights are opted into and their
  // zoom locks the camera (PanZoom drops a drag when it does).
  function shouldFrame(o) {
    if (!o || o.isPanning) return false;
    const idle = o.idleMs == null ? C.FRAME_IDLE_MS : o.idleMs;
    if (Number.isFinite(o.lastInputAt) && o.now - o.lastInputAt < idle) return false;
    if (o.kind === 'encounter') return !!o.onScreen;
    return o.kind === 'fight';
  }

  return { C, normalizeWheel, wheelZoomFactor, clampZoom, anchorScroll, pastThreshold, pinchZoom,
           pointInView, shouldFrame };
});
