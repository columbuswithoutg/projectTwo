/************************************************
 * Doomsday story share, browser side — js/share.js (the story card and the
 * share dialog) and js/views/shared.js (the public /s/<token> pages), run in
 * a vm with a recording canvas and a minimal fake DOM.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ShareLogic = require('../js/share-logic');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');

// ── fakes ──

// A 2D context that records fillRect / drawImage / fillText; everything else
// is a no-op.
function recordingCtx() {
  const log = { rects: [], images: [], texts: [] };
  const base = {
    font: '10px sans-serif', letterSpacing: '0px',
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText(t) { const px = parseFloat((/(\d+(?:\.\d+)?)px/.exec(this.font) || [0, 10])[1]); return { width: String(t).length * px * 0.55 }; },
    fillRect(x, y, w, h) { log.rects.push({ x, y, w, h }); },
    drawImage(img, x, y, w, h) { log.images.push({ x, y, w, h }); },
    fillText(text, x, y) { log.texts.push({ text, x, y, font: this.font }); }
  };
  const ctx = new Proxy(base, { get: (t, k) => (k in t ? t[k] : () => {}) });
  return { ctx, log };
}

// An element: remembers listeners, answers every querySelector with one
// memoised child element per selector.
function el() {
  const kids = new Map();
  const e = {
    isConnected: true, hidden: false, disabled: false, textContent: '', innerHTML: '', value: '',
    listeners: {},
    classList: { replace() {}, add() {}, remove() {}, toggle() {} },
    addEventListener(t, fn) { (e.listeners[t] = e.listeners[t] || []).push(fn); },
    click() { (e.listeners.click || []).forEach(fn => fn({})); },
    setAttribute() {}, removeAttribute() {}, focus() {}, select() {},
    remove() { e.isConnected = false; },
    querySelector(sel) { if (!kids.has(sel)) kids.set(sel, el()); return kids.get(sel); },
    querySelectorAll() { return []; }
  };
  return e;
}

const tick = () => new Promise(r => setTimeout(r, 0));
async function flush(n = 20) { for (let i = 0; i < n; i++) await tick(); }

function loadShare(over = {}) {
  const calls = [];
  const appended = [];
  const ctx = {
    API: '/api', console, setTimeout, clearTimeout,
    location: { origin: 'https://mcu.test', host: 'mcu.test', pathname: '/s/abcDEF123_-x' },
    document: {
      createElement: (tag) => {
        if (tag !== 'canvas') return el();
        const { ctx: c2d } = recordingCtx();
        return { width: 0, height: 0, getContext: () => c2d, toBlob: (cb) => cb({ size: 1 }) };
      },
      body: { appendChild: (n) => appended.push(n) }
    },
    navigator: {},
    URL: { createObjectURL: () => 'blob:card', revokeObjectURL() {} },
    File: class { constructor(parts, name, o) { this.name = name; this.type = o && o.type; } },
    Image: class {},
    $: () => null,
    esc: (s) => String(s),
    toast: () => {},
    confirmDialog: async () => true,
    wireModalDismiss: (panel, onClose) => () => onClose(),
    profilePicUrl: () => '',
    PosterArt: { phaseOf: () => 1, url: () => '' },
    ShareLogic,
    computeDoomsdayGoal: () => ({ items: [], met: 0, total: 16, target: null }),
    state: { readonly: false, ensureLoaded: async () => {}, byId: new Map() },
    FriendView: { getActive: () => null },
    Auth: {
      isLoggedIn: () => true,
      getUsername: () => 'kevin',
      fetch: async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        calls.push(method + ' ' + url);
        if (url.endsWith('/share/me')) {
          const body = method === 'DELETE' ? { enabled: false, token: null, joins: 0 } : { enabled: true, token: 'abcDEF123_-x', joins: 2 };
          return { ok: true, status: 200, json: async () => body };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }
    },
    ...over
  };
  vm.createContext(ctx);
  vm.runInContext(read('share.js') + '\nthis.ShareProgress = ShareProgress;', ctx);
  return { ...ctx, calls, appended };
}

// ── CLI2-01: the poster grid stays clear of the footer and the sticker strip ──

function drawWith(n) {
  const { ctx: c2d, log } = recordingCtx();
  const ctx = loadShare({
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => c2d }) }
  });
  const poster = { width: 400, height: 600 };     // 2:3, so drawImage covers the poster exactly
  const items = Array.from({ length: n }, (_, i) => ({
    project: { id: 'p' + i, title: 'Title number ' + i }, watched: i % 3 === 0, img: i % 2 ? poster : null
  }));
  ctx.ShareProgress.drawCard({ username: 'kevin', avatar: null, items, met: 5, total: n, title: 'Avengers: Doomsday', countdown: '230 days to Doomsday', host: 'mcu.test' });
  const posters = [...log.rects.filter(r => r.w < 1080), ...log.images];
  const tap = log.texts.find(t => t.text === 'TAP THE LINK TO SEE MY WATCH ORDER');
  return { posters, tap };
}

for (const n of [14, 16, 20]) {
  test(`drawCard: ${n} posters all drawn, none overlapping each other, the footer text or the Link-sticker strip`, () => {
    const { posters, tap } = drawWith(n);
    assert.equal(posters.length, n);
    assert.ok(tap, 'footer line drawn');
    const footerTop = tap.y - parseFloat(/(\d+)px/.exec(tap.font)[1]);   // the caps sit above the baseline
    const STICKER_TOP = 1660;                                             // under the host line: Link sticker + reply bar
    for (const p of posters) {
      assert.ok(p.x >= 0 && p.x + p.w <= 1080, `poster inside the frame (x ${p.x}..${p.x + p.w})`);
      assert.ok(p.y >= 1064, `poster below the countdown pill (top ${p.y})`);
      assert.ok(p.y + p.h <= footerTop - 8, `poster bottom ${p.y + p.h} clears the footer text at ${footerTop}`);
      assert.ok(p.y + p.h <= STICKER_TOP, 'poster above the Link-sticker strip');
    }
    for (let i = 0; i < posters.length; i++) {
      for (let j = i + 1; j < posters.length; j++) {
        const a = posters[i], b = posters[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.ok(!overlap, `posters ${i} and ${j} overlap`);
      }
    }
  });
}

test('posterGrid: 14 titles keep the original 7 × 2 at 128 px; 16 → 8 × 2; 20 → three rows', () => {
  const { ShareProgress } = loadShare();
  const g = (n) => ShareProgress._debug.posterGrid(n);
  assert.deepEqual([g(14).cols, g(14).rows, g(14).pw, g(14).ph], [7, 2, 128, 192]);
  assert.equal(g(14).at(0).x, 56);
  assert.deepEqual([g(16).cols, g(16).rows], [8, 2]);
  assert.equal(g(20).rows, 3);
  // A short last row is centred.
  const g15 = g(15), last = g15.at(14), firstOfRow = g15.at(8);
  const rowW = 7 * g15.pw + 6 * g15.gap;
  assert.equal(firstOfRow.x, (1080 - rowW) / 2);
  assert.equal(last.x + g15.pw, (1080 + rowW) / 2);
});

// ── CLI2-02: "Share to story" on your own /s/<token> page opens the dialog ──

test('open(): on your own share page (readonly, your token) the dialog opens and turns the link on', async () => {
  const ctx = loadShare({
    state: { readonly: true, ensureLoaded: async () => {}, byId: new Map() },
    FriendView: { getActive: () => ({ username: 'Kevin', shareToken: 'abcDEF123_-x' }) }
  });
  await ctx.ShareProgress.open();
  await flush();
  assert.equal(ctx.appended.length, 1, 'panel added');
  assert.ok(ctx.calls.includes('POST /api/share/me'));
});

test('open(): still refuses on a friend\'s board or someone else\'s share page', async () => {
  for (const active of [{ username: 'pal' }, { username: 'elsid', shareToken: 'abcDEF123_-x' }]) {
    const ctx = loadShare({
      state: { readonly: true, ensureLoaded: async () => {}, byId: new Map() },
      FriendView: { getActive: () => active }
    });
    await ctx.ShareProgress.open();
    assert.equal(ctx.appended.length, 0);
    assert.deepEqual(ctx.calls, []);
  }
  // Your own share page, but signed out (an old username in storage).
  const out = loadShare({
    state: { readonly: true, ensureLoaded: async () => {}, byId: new Map() },
    FriendView: { getActive: () => ({ username: 'kevin', shareToken: 'abcDEF123_-x' }) },
    Auth: { isLoggedIn: () => false, getUsername: () => 'kevin', fetch: async () => { throw new Error('no'); } }
  });
  await out.ShareProgress.open();
  assert.equal(out.appended.length, 0);
});

// ── CLI2-06: the dialog reports turning the link on and off ──

test('open({ onChange }): called with the link info after it turns the link on, and again after "Turn off link"', async () => {
  const seen = [];
  const ctx = loadShare();
  await ctx.ShareProgress.open({ onChange: (info) => seen.push(info.enabled) });
  await flush();
  assert.deepEqual(seen, [true]);
  const panel = ctx.appended[0];
  panel.querySelector('[data-act="off"]').click();
  await flush();
  assert.ok(ctx.calls.includes('DELETE /api/share/me'));
  assert.deepEqual(seen, [true, false]);
  assert.equal(panel.isConnected, false, 'dialog closed');
});

// ── CLI2-04: the share page tells "gone" apart from "couldn't load" ──

function loadShared(enterShared) {
  const ctx = {
    console, ShareLogic,
    Auth: { isLoggedIn: () => false, getUsername: () => null },
    Router: { go() {} },
    FriendView: { enterShared },
    localStorage: { setItem() {}, getItem: () => null },
    document: {}
  };
  vm.createContext(ctx);
  vm.runInContext(read('views/shared.js') + '\nthis.SharedView = SharedView; this.SharedOrderView = SharedOrderView;', ctx);
  return ctx;
}

for (const view of ['SharedView', 'SharedOrderView']) {
  test(`${view}: a failed load shows a retry card, not "isn't shared anymore"; Retry loads again`, async () => {
    const answers = [{ error: 'unavailable' }, null];
    let n = 0;
    const ctx = loadShared(async () => answers[n++]);
    const container = el();
    await ctx[view].mount(container, { token: 'abcDEF123_-x' });
    assert.match(container.innerHTML, /Couldn’t load this page/);
    assert.doesNotMatch(container.innerHTML, /isn’t shared anymore/);
    container.querySelector('[data-share-retry]').click();
    await flush();
    assert.equal(n, 2);
    assert.match(container.innerHTML, /isn’t shared anymore/);   // the second answer was a real 404
  });
}
