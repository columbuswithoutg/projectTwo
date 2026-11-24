/************************************************
 * UTILITY FUNCTIONS
 ************************************************/
const $ = (sel, ctx = document) => ctx.querySelector(sel);

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randBetween = (min, max) => min + Math.random() * (max - min);

// Escape HTML for safe interpolation into innerHTML. User-controlled strings
// (usernames, project titles from friends' data, memory captions, file URLs)
// must go through this before reaching template literals. Quotes are escaped
// too, so the result is safe inside quoted attributes (alt="…", src="…").
function esc(str) {
  return (str == null ? '' : String(str))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Small line icons (24×24, stroke = currentColor) used instead of emoji in
// the app chrome and empty states. iconSvg(name, size) → '' for an unknown name.
const ICON_PATHS = {
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2.5h5"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.8c1.8.7 3 2.4 3.5 5.2"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  'user-plus': '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5M19 8v6M16 11h6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  // Feed reactions
  like: '<path d="M7 10v10H4V10zM7 10l4-7c1.7 0 2.7 1.2 2.4 2.8L12.8 9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
  haha: '<circle cx="12" cy="12" r="9"/><path d="M8 9.5l2 1-2 1M16 9.5l-2 1 2 1M7.5 14h9a4.5 4.5 0 0 1-9 0z"/>',
  wow: '<circle cx="12" cy="12" r="9"/><path d="M9 9.5h.01M15 9.5h.01"/><circle cx="12" cy="15" r="2"/>',
  sad: '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M8.5 16.5a4.5 4.5 0 0 1 7 0M15.5 12.5v2"/>',
  angry: '<circle cx="12" cy="12" r="9"/><path d="M7.5 8.5l3 1.5M16.5 8.5l-3 1.5M8.5 16.5a4.5 4.5 0 0 1 7 0"/>',
  // Games / rewards
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4.5a3 3 0 0 0 3.5 4M16 6h3.5a3 3 0 0 1-3.5 4M12 13v4M8.5 20.5h7M9.5 17h5v3.5h-5z"/>',
  crown: '<path d="M3.5 8l4 4 4.5-6 4.5 6 4-4-1.5 10h-14zM5 20.5h14"/>',
  medal: '<path d="M8 3l2.5 6M16 3l-2.5 6"/><circle cx="12" cy="15" r="5.5"/>',
  laurel: '<path d="M8 20c-3-2.5-4-6.5-3-11M16 20c3-2.5 4-6.5 3-11M5 13.5c1.5 0 2.5.7 3 2M5.5 9.5c1.3.2 2.2 1 2.5 2.2M19 13.5c-1.5 0-2.5.7-3 2M18.5 9.5c-1.3.2-2.2 1-2.5 2.2"/>',
  gem: '<path d="M6 4h12l3 5-9 11L3 9zM3 9h18M9 4l3 16 3-16"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  fist: '<path d="M7 11V7.5a1.5 1.5 0 0 1 3 0V10M10 9.5V6.5a1.5 1.5 0 0 1 3 0V10M13 10V7.5a1.5 1.5 0 0 1 3 0V11M16 10.5a1.5 1.5 0 0 1 3 0v3.5A6.5 6.5 0 0 1 12.5 20.5h-1A5.5 5.5 0 0 1 6 15v-3a1.5 1.5 0 0 1 3 0"/>',
  wave: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11.5V4.5a1.5 1.5 0 0 1 3 0V12M14 12V6.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-12.4 4.4L3 15.5a1.6 1.6 0 0 1 2.6-1.8L8 16"/>',
  gamepad: '<path d="M7 8h10a4 4 0 0 1 4 4.5l-.6 4a2.5 2.5 0 0 1-4.4 1.2L14.5 16h-5L8 17.7a2.5 2.5 0 0 1-4.4-1.2l-.6-4A4 4 0 0 1 7 8zM7.5 11v3M6 12.5h3M15.5 12h.01M17.5 13.5h.01"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10"/>',
  // Voice
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3.5"/>',
  'mic-off': '<path d="M15 10V6a3 3 0 0 0-5.8-1M9 9v2a3 3 0 0 0 5 2.2M5.5 11a6.5 6.5 0 0 0 10.8 4.9M18.5 11c0 .8-.1 1.5-.4 2.2M12 17.5v3.5M3 3l18 18"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4" height="6.5" rx="1.5"/><rect x="16.5" y="14" width="4" height="6.5" rx="1.5"/>',
  // Places / things
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.4 3.6 5.4 3.6 9s-1.1 6.6-3.6 9c-2.5-2.4-3.6-5.4-3.6-9S9.5 5.4 12 3z"/>',
  home: '<path d="M3.5 11L12 4l8.5 7M6 9.5V20h12V9.5M10 20v-5h4v5"/>',
  door: '<path d="M6 21V3.5h12V21M4 21h16M14.5 12.5h.01"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  chair: '<path d="M7 3.5v9h10v-9M6 12.5h12v3H6zM7.5 15.5V21M16.5 15.5V21"/>',
  window: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M12 4v16M4 12h16"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-8 8"/>',
  camera: '<path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
  film: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M7.5 4v16M16.5 4v16M3.5 8.5h4M3.5 15.5h4M16.5 8.5h4M16.5 15.5h4"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4"/>',
  pointer: '<path d="M9 11V4.5a1.5 1.5 0 0 1 3 0V10l5 1.2a2 2 0 0 1 1.5 2.3l-1 5.5H10l-3.6-5a1.6 1.6 0 0 1 2.6-1.9z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  pencil: '<path d="M4 20l1-4.5L16 4.5l3.5 3.5-11 11zM14 6.5l3.5 3.5"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 14h9l1-14M10 10.5v6M14 10.5v6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v4h4"/>',
  party: '<path d="M4 20l4.5-12 7.5 7.5zM14 4v2M18 8h2M17 5l1.5-1.5M11 3l.5 2M20 12l2 .5"/>',
  warning: '<path d="M12 4l9 16H3zM12 10v4.5M12 17.5h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 17h7"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14zM5 19l7-7"/>',
  rotate: '<rect x="7" y="3" width="10" height="18" rx="2" transform="rotate(90 12 12)"/><path d="M4 7V4h3M20 17v3h-3"/>',
  fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  // House editor: room tabs + tools
  sofa: '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3zM5 18v2M19 18v2"/>',
  pot: '<path d="M4 10h16v4a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6zM2 10h2M20 10h2M9 6c0-1 1-1.5 1-2.5M14 6c0-1 1-1.5 1-2.5"/>',
  bath: '<path d="M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5zM6 12V6a2 2 0 0 1 4 0M7 19l-1 2M17 19l1 2"/>',
  bed: '<path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M6.5 11.5h.01"/><circle cx="7" cy="11" r="1.5"/>',
  desk: '<path d="M3 9h18M5 9v11M19 9v11M14 9v6h5M8 5h5v4H8z"/>',
  frame: '<rect x="4" y="4" width="16" height="16" rx="1"/><rect x="7.5" y="7.5" width="9" height="9"/>',
  'rotate-cw': '<path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5"/>',
  house: '<path d="M3 11l9-7 9 7M5.5 9.5V20h13V9.5"/><path d="M9.5 13h5v7h-5z"/>'
};
function iconSvg(name, size = 24) {
  const p = ICON_PATHS[name];
  return p ? `<svg class="ui-icon" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${p}</svg>` : '';
}

// A themed "nothing here yet" panel: icon (an iconSvg name), title, a line
// of text and an optional action — cta.route renders an in-app link, cta.id a button the
// view wires itself. compact: the small version for a board column.
function emptyStateHtml({ icon = '', title = '', text = '', cta = null, compact = false } = {}) {
  const action = !cta ? ''
    : cta.route ? `<a class="btn btn--secondary empty-state-cta" href="${esc(cta.route)}" data-link>${esc(cta.label)}</a>`
    : `<button type="button" class="btn btn--secondary empty-state-cta" id="${esc(cta.id)}">${esc(cta.label)}</button>`;
  return `<div class="empty-state${compact ? ' empty-state--compact' : ''}">
      ${icon ? `<span class="empty-state-icon" aria-hidden="true">${iconSvg(icon, compact ? 22 : 32)}</span>` : ''}
      ${title ? `<p class="empty-state-title">${esc(title)}</p>` : ''}
      ${text ? `<p class="empty-state-text">${esc(text)}</p>` : ''}
      ${action}
    </div>`;
}

// Shimmering placeholders shaped like what's loading: 'card' (a board
// card), 'tile' (a portrait grid tile) or 'row' (a list row). Hidden from
// screen readers; the caller keeps its own aria-busy / status text.
function skeletonHtml(kind, n = 3) {
  const one = {
    card: '<div class="sk sk-card"><span class="sk-poster"></span><span class="sk-lines"><span class="sk-line"></span><span class="sk-line sk-short"></span></span></div>',
    tile: '<div class="sk sk-tile"><span class="sk-portrait"></span><span class="sk-line"></span></div>',
    row: '<div class="sk sk-row"><span class="sk-avatar"></span><span class="sk-lines"><span class="sk-line"></span><span class="sk-line sk-short"></span></span></div>'
  }[kind] || '';
  return `<div class="sk-group sk-group--${kind}" aria-hidden="true">${one.repeat(n)}</div>`;
}

/************************************************
 * GLOBAL TOAST — branded, SPA-wide ephemeral status
 *
 * The admin surface had its own AdminView.toast; the main SPA had nothing,
 * so failures (socket drops, mic-denied, chat-send-while-offline) surfaced
 * only as console.warn or inline red text. This is the shared, branded
 * notifier every view can call: `toast('Reconnecting…', 'warn')`.
 *
 * Toasts stack in a top-centre region (out of the way of /world's bottom
 * chat row and the nav), auto-dismiss, and are tap-to-dismiss. The second
 * arg may be a kind string ('info' | 'success' | 'warn' | 'error') or an
 * options object { type, duration }. Returns a dismiss() function so a
 * persistent toast (e.g. "Offline") can be cleared when the condition ends.
 ************************************************/
// opts.action = { label, onClick } adds a button ("Reload") — such a toast
// stays until used or tapped unless a duration is given. Errors and warnings
// are role="alert" (announced at once); the rest role="status".
function toast(message, opts = {}) {
  if (typeof opts === 'string') opts = { type: opts };
  const { type = 'info', action = null } = opts;
  const duration = opts.duration != null ? opts.duration : (action ? 0 : 3200);

  let region = document.getElementById('app-toast-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'app-toast-region';
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }

  const el = document.createElement('div');
  el.className = 'app-toast app-toast-' + type;
  el.setAttribute('role', (type === 'error' || type === 'warn') ? 'alert' : 'status');
  const text = document.createElement('span');
  text.className = 'app-toast-text';
  text.textContent = message == null ? '' : String(message);
  el.appendChild(text);
  if (action && action.label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'app-toast-action';
    b.textContent = action.label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      try { if (typeof action.onClick === 'function') action.onClick(); } finally { remove(); }
    });
    el.appendChild(b);
  }
  region.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => { if (el.parentNode) el.remove(); }, 250);
  };
  // duration <= 0 means "sticky" — caller dismisses it explicitly.
  const timer = duration > 0 ? setTimeout(remove, duration) : null;
  el.addEventListener('click', remove);
  return remove;
}

/************************************************
 * MODAL HELPERS — dismissal, focus, confirm dialog
 *
 * Shared by the project popup, memory modals/lightbox, and the branded
 * confirm dialog so every overlay behaves the same: Escape closes,
 * backdrop click closes, focus moves into the modal on open and is
 * restored to the trigger on close.
 *
 * Open dialogs form a stack: Escape only ever closes the TOP one (a confirm
 * over the post composer used to close both), and global key handlers
 * (map arrows / Esc, flowchart + − 0, the /world SNAP key) check
 * shouldIgnoreGlobalKey(e) so nothing reacts behind an open dialog.
 ************************************************/
const _modalStack = [];

function pushModal(el) {
  if (el && !_modalStack.includes(el)) _modalStack.push(el);
}
function popModal(el) {
  const i = _modalStack.lastIndexOf(el);
  if (i !== -1) _modalStack.splice(i, 1);
}
// The open dialog on top, skipping any that were removed without closing.
function topModal() {
  for (let i = _modalStack.length - 1; i >= 0; i--) {
    if (_modalStack[i].isConnected) return _modalStack[i];
    _modalStack.splice(i, 1);
  }
  return null;
}
// Any dialog open — ours, or an aria-modal overlay built without the stack.
// A dialog inside an `inert` subtree is closed: the nav drawer keeps its
// aria-modal panel in the DOM while shut, which used to make this always
// true and swallow every map / chart keyboard shortcut.
function isModalOpen() {
  if (topModal()) return true;
  for (const el of document.querySelectorAll('[aria-modal="true"]')) {
    if (!el.closest('[inert]')) return true;
  }
  return false;
}
// Close every stacked dialog (navigating away must not leave one floating).
function closeAllModals() {
  for (const el of _modalStack.slice().reverse()) {
    if (el._closeModal) el._closeModal();
    else if (el.isConnected) el.remove();
  }
  _modalStack.length = 0;
}
function isTypingTarget(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/i.test(el.type || '');
}
// Page-level shortcuts (map arrows, flowchart + − 0, SNAP) bail on this:
// a dialog already handled it, the user is typing, or a dialog is open.
function shouldIgnoreGlobalKey(e) {
  return !!(e && (e.defaultPrevented || isTypingTarget(e.target) || isModalOpen()));
}

// Wire Escape + backdrop dismissal and focus management onto an overlay
// element. `closeFn` does the actual teardown (usually `el.remove()`).
// Returns an idempotent `close()` the caller should use for ALL dismissal
// paths (close button, action buttons, etc.) so listeners and focus are
// always cleaned up. Options:
//   onEscape(e) → return true when it handled Escape itself (e.g. leaving a
//                 sub-mode) so the dialog stays open
//   canClose()  → (async) false keeps the dialog open; Escape, the backdrop
//                 and close.request() ask it first ("Discard changes?")
//   trapFocus   → Tab / Shift+Tab cycle inside the dialog (default on)
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
function focusableIn(rootEl) {
  return [...rootEl.querySelectorAll(FOCUSABLE)].filter(el =>
    el.getClientRects().length && !el.closest('[inert], [hidden]'));
}

function wireModalDismiss(overlayEl, closeFn, { initialFocus, backdrop = true, onEscape, canClose, trapFocus = true } = {}) {
  const prevFocus = document.activeElement;
  let closed = false;
  let asking = false;
  pushModal(overlayEl);

  function onKey(e) {
    if (closed) return;
    if (e.key === 'Tab' && trapFocus) {
      if (topModal() !== overlayEl) return;
      const items = focusableIn(overlayEl);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (!overlayEl.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (e.key !== 'Escape') return;
    if (topModal() !== overlayEl) return;          // only the top dialog reacts
    e.preventDefault();
    e.stopPropagation();
    if (onEscape && onEscape(e) === true) return;
    request();
  }
  function onBackdrop(e) {
    if (e.target !== overlayEl) return;
    // Some dialogs ARE the box and draw their scrim with ::before (the project
    // popup): a click on the box's own padding hits the same element, so
    // only a click outside a non-fullscreen overlay's rectangle counts.
    const r = overlayEl.getBoundingClientRect();
    const fullscreen = r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2;
    if (!fullscreen && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return;
    request();
  }

  // Close unless canClose() says no. Safe to call repeatedly (a second ✕
  // while a "Discard changes?" confirm is up does nothing).
  async function request() {
    if (closed || asking) return;
    if (canClose) {
      asking = true;
      let ok = false;
      try { ok = await canClose(); } catch (_) { ok = false; }
      asking = false;
      if (!ok) return;
    }
    close();
  }

  function close() {
    if (closed) return;
    closed = true;
    popModal(overlayEl);
    document.removeEventListener('keydown', onKey, true);
    if (backdrop) overlayEl.removeEventListener('click', onBackdrop);
    try { closeFn(); }
    finally {
      // Restore focus to whatever was focused before — but only if it's
      // still in the document (the trigger node may have been re-rendered).
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) {
        prevFocus.focus();
      }
    }
  }
  close.request = request;
  overlayEl._closeModal = close;

  document.addEventListener('keydown', onKey, true);
  if (backdrop) overlayEl.addEventListener('click', onBackdrop);

  // Move focus into the modal so keyboard users land inside it.
  const focusTarget = initialFocus
    || overlayEl.querySelector('.popup-close, .lightbox-close, .confirm-cancel, [autofocus]')
    || overlayEl;
  if (focusTarget && focusTarget.focus) {
    if (focusTarget === overlayEl && !overlayEl.hasAttribute('tabindex')) {
      overlayEl.setAttribute('tabindex', '-1');
    }
    focusTarget.focus();
  }

  return close;
}

// Enter / Space on an element matching `selector` inside `root` clicks it.
// For things that are clickable but not buttons (chart posters, map pins,
// goal rows, home-edit cells): el.click() fires the existing click handler
// with no pointer events first, so the pan-zoom drag/click discrimination is
// never involved. Returns the keydown handler (for owners that track listeners).
function activateOnKey(root, selector) {
  const handler = (e) => {
    if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = e.target && e.target.closest ? e.target.closest(selector) : null;
    if (!el || !root.contains(el) || el.tagName === 'BUTTON' || el.tagName === 'A') return;
    if (el.getAttribute('aria-disabled') === 'true') return;
    e.preventDefault();               // Space must not scroll the container
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  };
  root.addEventListener('keydown', handler);
  return handler;
}

// 'smooth' unless the user asked for reduced motion (the CSS kill switch
// can't reach a behavior set from JS).
function smoothBehavior() {
  return (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto' : 'smooth';
}

// Branded confirmation dialog (replaces native confirm()). Resolves true on
// confirm, false on Cancel / Escape / backdrop. Cancel is auto-focused as
// the safe default; pass `danger:true` for a destructive (red) confirm.
function confirmDialog(opts = {}) {
  const {
    title = 'Are you sure?',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false
  } = opts;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    overlay.innerHTML = `
      <div class="confirm-box">
        <h3 class="confirm-title">${esc(title)}</h3>
        ${message ? `<p class="confirm-message">${esc(message)}</p>` : ''}
        <div class="confirm-actions">
          <button type="button" class="confirm-btn confirm-cancel">${esc(cancelLabel)}</button>
          <button type="button" class="confirm-btn confirm-ok${danger ? ' danger' : ''}">${esc(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let resolved = false;
    const done = (val) => { if (!resolved) { resolved = true; resolve(val); } };

    const close = wireModalDismiss(
      overlay,
      () => { if (overlay.parentNode) overlay.remove(); done(false); },
      { initialFocus: overlay.querySelector('.confirm-cancel') }
    );

    overlay.querySelector('.confirm-cancel').addEventListener('click', close);
    overlay.querySelector('.confirm-ok').addEventListener('click', () => { done(true); close(); });
  });
}

// Branded text prompt (replaces native prompt()). Resolves the trimmed text
// on confirm, or null on Cancel / Escape / backdrop. `required` keeps the
// confirm button disabled until something is typed.
function promptDialog(opts = {}) {
  const {
    title = 'Enter a value',
    message = '',
    label = '',
    value = '',
    placeholder = '',
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    danger = false,
    multiline = false,
    required = false,
    maxLength = 500,
    type = 'text',        // 'text' | 'password' (masked, never trimmed)
    minLength = 0         // OK stays disabled below this many characters
  } = opts;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    const field = multiline
      ? `<textarea class="textarea prompt-input" rows="3" maxlength="${maxLength}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input class="input prompt-input" type="${type === 'password' ? 'password' : 'text'}"${type === 'password' ? ' autocomplete="new-password"' : ''} maxlength="${maxLength}" placeholder="${esc(placeholder)}" value="${esc(value)}">`;
    overlay.innerHTML = `
      <div class="confirm-box">
        <h3 class="confirm-title">${esc(title)}</h3>
        ${message ? `<p class="confirm-message">${esc(message)}</p>` : ''}
        <label class="prompt-field">${label ? `<span class="prompt-label">${esc(label)}</span>` : ''}${field}</label>
        <div class="confirm-actions">
          <button type="button" class="confirm-btn confirm-cancel">${esc(cancelLabel)}</button>
          <button type="button" class="confirm-btn confirm-ok${danger ? ' danger' : ''}">${esc(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('.prompt-input');
    const ok = overlay.querySelector('.confirm-ok');
    let result = null;
    const sync = () => { const v = input.value; ok.disabled = (required && !v.trim()) || v.length < minLength; };
    const close = wireModalDismiss(
      overlay,
      () => { if (overlay.parentNode) overlay.remove(); resolve(result); },
      { initialFocus: input }
    );
    const submit = () => {
      if (ok.disabled) return;
      result = type === 'password' ? input.value : input.value.trim();
      close();
    };
    input.addEventListener('input', sync);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !multiline && !e.isComposing) { e.preventDefault(); submit(); }
    });
    overlay.querySelector('.confirm-cancel').addEventListener('click', close);
    ok.addEventListener('click', submit);
    sync();
    if (input.select) input.select();
  });
}

/************************************************
 * AVATAR <img> WITH AN INITIAL FALLBACK
 *
 * A profile picture can point at a portrait that doesn't exist (Isaiah
 * Bradley is pickable after Falcon & Winter Soldier, but there is no
 * assets/characters/isaiah.jpg), which used to leave a broken-image icon.
 * Inline onerror= is blocked by the CSP (script-src-attr 'none'), so — as
 * PosterArt does for posters — ONE capture-phase listener swaps any failed
 * img[data-avatar-initial] for a <span> with the same classes (plus
 * opts.fallbackCls) showing the initial.
 *   avatarImgHtml(url, name, cls, { fallbackCls, lazy = true })
 ************************************************/
function avatarImgHtml(url, name, cls, opts = {}) {
  const initial = String(name || '').trim().charAt(0).toUpperCase() || '?';
  return `<img class="${esc(cls || '')}" src="${esc(url)}" alt=""${opts.lazy === false ? '' : ' loading="lazy"'}` +
    ` data-avatar-initial="${esc(initial)}"${opts.fallbackCls ? ` data-avatar-fallback-cls="${esc(opts.fallbackCls)}"` : ''} />`;
}
if (typeof document !== 'undefined') {
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.hasAttribute('data-avatar-initial')) return;
    const span = document.createElement('span');
    span.className = [img.className, img.getAttribute('data-avatar-fallback-cls')].filter(Boolean).join(' ');
    span.setAttribute('aria-hidden', 'true');
    span.textContent = img.getAttribute('data-avatar-initial') || '?';
    img.replaceWith(span);
  }, true);
}

/************************************************
 * HEADER AVATAR — instant initials, then upgrade to photo
 *
 * Used by the Watch Order and Map views. Sets the user's initial
 * synchronously from the cached username so the header never flashes the
 * generic 👤 placeholder while /profile is in flight; then swaps in the
 * profile photo once it has actually decoded.
 ************************************************/
function initHeaderAvatar() {
  const img      = document.getElementById('header-avatar');
  const initials = document.getElementById('header-avatar-initials');
  if (!initials) return;

  // 1) Instant: initial from the cached username (no network).
  const cachedName = (typeof Auth !== 'undefined' && Auth.getUsername && Auth.getUsername())
    || localStorage.getItem('mcu_username') || '';
  if (cachedName) initials.textContent = cachedName[0].toUpperCase();

  // 2) Upgrade: fetch the profile, swap in the photo if present.
  if (typeof Auth === 'undefined' || !Auth.isLoggedIn || !Auth.isLoggedIn()) return;
  // Auth.fetch: every view mounts this, so a revoked session (logout
  // everywhere, password reset) is sent to /login here instead of toasting.
  Auth.fetch(`${API}/profile`)
    .then(r => r.json())
    .then(data => {
      if (data.username) initials.textContent = data.username[0].toUpperCase();
      if (data.profilePicture && img) {
        // Reveal the <img> only once it has decoded, so the initials never
        // flash to a half-loaded or broken image.
        img.onload = () => { img.style.display = 'block'; initials.style.display = 'none'; };
        img.onerror = () => { img.style.display = 'none'; initials.style.display = ''; };
        img.src = profilePicUrl(data.profilePicture);
      }
    })
    .catch(() => { /* keep the initials we already set */ });
}

/************************************************
 * VISIBILITY & UNLOCK LOGIC
 ************************************************/
const isPhaseUnlocked = (p) => {
  if (!PHASE_UNLOCKERS[p.phaseNum]) return true;
  const unlockerId = PHASE_UNLOCKERS[p.phaseNum];
  return unlockerId && state.isWatched(unlockerId);
};

// Optional "watch this first" suggestions for a project, limited to titles
// the user can already see (watched or revealed) so nothing unreached is
// named. Never used by the unlock rules.
const visibleRecommended = (p) => (p.recommendedPrerequisites || [])
  .map(id => state.byId?.get(id))
  .filter(r => r && (state.isWatched(r.id) || isRevealed(r)))
  .map(r => ({ id: r.id, title: r.title || r.id, watched: state.isWatched(r.id) }));

// Required prerequisites only — recommendedPrerequisites never lock a project.
// Links to projects that no longer exist are ignored (they could never be
// watched, so they'd hide the title forever) — same rule as the server's
// watchRules.isAvailable.
const allPrereqs = (p) => {
  const ids = [...(p.prerequisites || []), ...(p.hiddenPrerequisites || [])];
  const known = state.byId;
  return known && known.size ? ids.filter(id => known.has(id)) : ids;
};

const isUnlocked = (p) => {
  if (isPhaseUnlocked(p) && allPrereqs(p).every(id => state.isWatched(id))) return true;
  // Or reached along Marvel's Doomsday list (same rule as the server).
  return typeof ShareLogic !== 'undefined' && !!state.byId &&
    ShareLogic.doomsdayPathOpen(p.id, id => state.isWatched(id), id => state.byId.has(id));
};

// Only watched projects sit on the world map. Unlocked-but-unwatched pins
// (including the start node for new users) live on the bottom "up-next"
// shelf — the map shows what's been seen, the shelf shows what's next.
const isVisible = (p) => state.isWatched(p.id);

const isRevealed = (p) =>
  !state.isWatched(p.id) && isUnlocked(p);

const getHighestUnlockedPhase = () => {
  const unlocked = projects.filter(isPhaseUnlocked);
  return unlocked.length ? Math.max(...unlocked.map(p => p.phaseNum)) : 1;
};

/************************************************
 * WORLD COORDINATES & ROAD GEOMETRY (cached)
 *
 * Push-based invalidation: state.subscribe fires on every watch/unwatch,
 * which bumps a version counter. Cached artifacts compare their saved
 * version to the current one — cheap integer compare instead of rebuilding
 * a string key every call (called hundreds of times per physics tick).
 ************************************************/
let _layoutVersion = 0;
let _cachedLayout = null;
let _cachedLayoutVersion = -1;
let _cachedClusterRects = null;
let _cachedRoadGeometry = null;

function invalidateLayoutCache() {
  _layoutVersion++;
  _cachedLayout = null;
  _cachedClusterRects = null;
  _cachedRoadGeometry = null;
}

function getLayoutVersion() { return _layoutVersion; }

function getLayout() {
  if (_cachedLayout && _cachedLayoutVersion === _layoutVersion) return _cachedLayout;
  _cachedLayout = LayoutSystem.computeLayout(projects, isVisible);
  _cachedLayoutVersion = _layoutVersion;
  _cachedClusterRects = null;
  _cachedRoadGeometry = null;
  return _cachedLayout;
}

function getClusterRects() {
  if (_cachedClusterRects) return _cachedClusterRects;
  _cachedClusterRects = LayoutSystem.computeClusterRects(getLayout());
  return _cachedClusterRects;
}

function getRoadGeometry() {
  if (_cachedRoadGeometry) return _cachedRoadGeometry;
  _cachedRoadGeometry = LayoutSystem.buildRoadGeometry(projects, getLayout(), getClusterRects());
  return _cachedRoadGeometry;
}

function getNodePosition(id) {
  return getLayout().get(id) || null;
}

// Subscribe once to state changes so cached artifacts invalidate whenever
// visibility could have changed (a watch completing, an account switch).
// state._applyServer and state.resetLocal both fire listeners.
if (typeof state !== 'undefined' && typeof state.subscribe === 'function') {
  state.subscribe(invalidateLayoutCache);
}
