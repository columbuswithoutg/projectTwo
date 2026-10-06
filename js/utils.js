/************************************************
 * UTILITY FUNCTIONS
 ************************************************/
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

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
function toast(message, opts = {}) {
  if (typeof opts === 'string') opts = { type: opts };
  const { type = 'info', duration = 3200 } = opts;

  let region = document.getElementById('app-toast-region');
  if (!region) {
    region = document.createElement('div');
    region.id = 'app-toast-region';
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
  }

  const el = document.createElement('div');
  el.className = 'app-toast app-toast-' + type;
  el.setAttribute('role', 'status');
  el.textContent = message == null ? '' : String(message);
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
function isModalOpen() {
  return !!topModal() || !!document.querySelector('[aria-modal="true"]');
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
function wireModalDismiss(overlayEl, closeFn, { initialFocus, backdrop = true, onEscape, canClose } = {}) {
  const prevFocus = document.activeElement;
  let closed = false;
  let asking = false;
  pushModal(overlayEl);

  function onKey(e) {
    if (e.key !== 'Escape' || closed) return;
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
    maxLength = 500
  } = opts;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    const field = multiline
      ? `<textarea class="textarea prompt-input" rows="3" maxlength="${maxLength}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input class="input prompt-input" type="text" maxlength="${maxLength}" placeholder="${esc(placeholder)}" value="${esc(value)}">`;
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
    const sync = () => { ok.disabled = required && !input.value.trim(); };
    const close = wireModalDismiss(
      overlay,
      () => { if (overlay.parentNode) overlay.remove(); resolve(result); },
      { initialFocus: input }
    );
    const submit = () => {
      if (ok.disabled) return;
      result = input.value.trim();
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
  fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${Auth.getToken()}` } })
    .then(r => r.json())
    .then(data => {
      if (data.username) initials.textContent = data.username[0].toUpperCase();
      if (data.profilePicture && img) {
        // Reveal the <img> only once it has decoded, so the initials never
        // flash to a half-loaded or broken image.
        img.onload = () => { img.style.display = 'block'; initials.style.display = 'none'; };
        img.onerror = () => { img.style.display = 'none'; initials.style.display = ''; };
        img.src = data.profilePicture;
      }
    })
    .catch(() => { /* keep the initials we already set */ });
}

/************************************************
 * VISIBILITY & UNLOCK LOGIC
 ************************************************/
const isPhaseUnlocked = (p) => {
  if (p.phaseNum === 1) return true;
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
  if (!isPhaseUnlocked(p)) return false;
  return allPrereqs(p).every(id => state.isWatched(id));
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
// visibility could have changed (watch/unwatch/clear). state.save fires
// listeners, and state.clear does too — covers all mutations we care about.
if (typeof state !== 'undefined' && typeof state.subscribe === 'function') {
  state.subscribe(invalidateLayoutCache);
}
