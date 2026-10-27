/************************************************
 * Unit tests for js/pan-zoom-logic.js — wheel normalisation and zoom
 * anchoring shared by the watch-order flowchart, the admin board and /map.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/pan-zoom-logic.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('normalizeWheel: pixel, line and page deltas all come out in pixels', () => {
  assert.equal(L.normalizeWheel({ deltaY: 100, deltaMode: 0 }).dy, 100);
  assert.equal(L.normalizeWheel({ deltaY: 3, deltaMode: 1 }).dy, 3 * L.C.LINE_PX);
  assert.equal(L.normalizeWheel({ deltaY: 0.25, deltaMode: 2 }, { pageHeight: 800 }).dy, 200);
  assert.equal(L.normalizeWheel({ deltaY: -2, deltaMode: 1 }).dy, -2 * L.C.LINE_PX);
});

test('normalizeWheel: spikes are clamped, junk becomes zero', () => {
  assert.equal(L.normalizeWheel({ deltaY: 5000 }).dy, L.C.MAX_DY);
  assert.equal(L.normalizeWheel({ deltaY: -5000 }).dy, -L.C.MAX_DY);
  assert.equal(L.normalizeWheel({ deltaY: 'x' }).dy, 0);
  assert.equal(L.normalizeWheel(null).dy, 0);
});

test('normalizeWheel: Ctrl/⌘ wheel is a pinch; a sideways swipe is not a zoom', () => {
  assert.equal(L.normalizeWheel({ deltaY: 4, ctrlKey: true }).pinch, true);
  assert.equal(L.normalizeWheel({ deltaY: 4, metaKey: true }).pinch, true);
  assert.equal(L.normalizeWheel({ deltaY: 4 }).pinch, false);
  assert.equal(L.normalizeWheel({ deltaX: 30, deltaY: 4 }).horizontal, true);
  assert.equal(L.normalizeWheel({ deltaX: 4, deltaY: 30 }).horizontal, false);
  // A pinch is never "horizontal", whatever its deltas.
  assert.equal(L.normalizeWheel({ deltaX: 30, deltaY: 4, ctrlKey: true }).horizontal, false);
});

test('wheelZoomFactor: wheel down zooms out, up zooms in, zero does nothing', () => {
  assert.ok(L.wheelZoomFactor(100) < 1);
  assert.ok(L.wheelZoomFactor(-100) > 1);
  assert.equal(L.wheelZoomFactor(0), 1);
  // Symmetric: a notch down then a notch up returns to the start.
  near(L.wheelZoomFactor(100) * L.wheelZoomFactor(-100), 1, 1e-12);
});

test('wheelZoomFactor: ten 10 px trackpad events ≈ one 100 px notch', () => {
  let z = 1;
  for (let i = 0; i < 10; i++) z *= L.wheelZoomFactor(10);
  near(z, L.wheelZoomFactor(100), 1e-9);
});

test('wheelZoomFactor: clamped per event; a pinch is more sensitive', () => {
  assert.equal(L.wheelZoomFactor(1e6), L.C.MIN_FACTOR);
  assert.equal(L.wheelZoomFactor(-1e6), L.C.MAX_FACTOR);
  assert.ok(L.wheelZoomFactor(5, { pinch: true }) < L.wheelZoomFactor(5));
});

test('anchorScroll keeps the content point under the cursor fixed', () => {
  // 300 px scrolled, cursor 200 px in → content x = 500 at zoom 1.
  const s = L.anchorScroll(300, 200, 1, 2);
  assert.equal((s + 200) / 2, 500);
  // Zooming back out returns to the original scroll.
  assert.equal(L.anchorScroll(s, 200, 2, 1), 300);
  // Never negative (the browser would clamp it anyway).
  assert.equal(L.anchorScroll(0, 10, 1, 0.5), 0);
  // Bad zoom levels leave the scroll alone.
  assert.equal(L.anchorScroll(120, 50, 0, 1), 120);
});

test('clampZoom handles NaN and bounds', () => {
  assert.equal(L.clampZoom(NaN, 0.4, 2.5), 1);
  assert.equal(L.clampZoom(NaN, 0.4, 2.5, 0.8), 0.8);
  assert.equal(L.clampZoom(9, 0.4, 2.5), 2.5);
  assert.equal(L.clampZoom(0.1, 0.4, 2.5), 0.4);
});

test('pastThreshold is measured in screen pixels', () => {
  assert.equal(L.pastThreshold(3, 0), false);
  assert.equal(L.pastThreshold(3, 3), true);        // hypot 4.24 > 4
  assert.equal(L.pastThreshold(0, 0), false);
  assert.equal(L.pastThreshold(10, 0, 12), false);
});

test('pinchZoom scales by the finger-gap ratio within bounds', () => {
  assert.equal(L.pinchZoom(1, 100, 200, 0.4, 2.5), 2);
  assert.equal(L.pinchZoom(1, 100, 50, 0.4, 2.5), 0.5);
  assert.equal(L.pinchZoom(2, 100, 400, 0.4, 2.5), 2.5);
  assert.equal(L.pinchZoom(1.2, 0, 50, 0.4, 2.5), 1.2);
});

test('pointInView: inside the rect, outside it, and with slack', () => {
  const v = { left: 100, top: 50, width: 400, height: 300 };
  assert.equal(L.pointInView(300, 200, v), true);
  assert.equal(L.pointInView(100, 50, v), true);          // edges count
  assert.equal(L.pointInView(99, 200, v), false);
  assert.equal(L.pointInView(300, 351, v), false);
  // One viewport of slack reaches a full width/height beyond each side.
  assert.equal(L.pointInView(-250, 200, v, 1), true);
  assert.equal(L.pointInView(-301, 200, v, 1), false);
  assert.equal(L.pointInView(NaN, 200, v), false);
  assert.equal(L.pointInView(300, 200, null), false);
});

test('shouldFrame: never mid-drag or right after user input', () => {
  const base = { now: 10000, lastInputAt: -Infinity, isPanning: false, onScreen: true };
  assert.equal(L.shouldFrame({ ...base, kind: 'encounter' }), true);
  assert.equal(L.shouldFrame({ ...base, kind: 'fight' }), true);
  assert.equal(L.shouldFrame({ ...base, kind: 'encounter', isPanning: true }), false);
  assert.equal(L.shouldFrame({ ...base, kind: 'fight', isPanning: true }), false);
  // Input 1 s ago blocks both; once the idle window has passed it doesn't.
  assert.equal(L.shouldFrame({ ...base, kind: 'encounter', lastInputAt: 9000 }), false);
  assert.equal(L.shouldFrame({ ...base, kind: 'fight', lastInputAt: 9000 }), false);
  assert.equal(L.shouldFrame({ ...base, kind: 'fight', lastInputAt: 10000 - L.C.FRAME_IDLE_MS }), true);
  assert.equal(L.shouldFrame({ ...base, kind: 'fight', lastInputAt: 9000, idleMs: 500 }), true);
});

test('shouldFrame: an encounter only frames a pair already on screen', () => {
  const base = { now: 10000, lastInputAt: 0, isPanning: false };
  assert.equal(L.shouldFrame({ ...base, kind: 'encounter', onScreen: false }), false);
  assert.equal(L.shouldFrame({ ...base, kind: 'encounter', onScreen: true }), true);
  // A fight's follow-centring doesn't need the point on screen.
  assert.equal(L.shouldFrame({ ...base, kind: 'fight', onScreen: false }), true);
  // Unknown kinds and missing input never move the camera.
  assert.equal(L.shouldFrame({ ...base, kind: 'other', onScreen: true }), false);
  assert.equal(L.shouldFrame(null), false);
});
