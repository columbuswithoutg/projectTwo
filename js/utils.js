/************************************************
 * UTILITY FUNCTIONS
 ************************************************/
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randBetween = (min, max) => min + Math.random() * (max - min);

// Escape HTML for safe interpolation into innerHTML. User-controlled strings
// (usernames, project titles from friends' data, memory captions, file URLs)
// must go through this before reaching template literals.
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

/************************************************
 * MODAL HELPERS — dismissal, focus, confirm dialog
 *
 * Shared by the project popup, memory modals/lightbox, and the branded
 * confirm dialog so every overlay behaves the same: Escape closes,
 * backdrop click closes, focus moves into the modal on open and is
 * restored to the trigger on close.
 ************************************************/

// Wire Escape + backdrop dismissal and focus management onto an overlay
// element. `closeFn` does the actual teardown (usually `el.remove()`).
// Returns an idempotent `close()` the caller should use for ALL dismissal
// paths (close button, action buttons, etc.) so listeners and focus are
// always cleaned up.
function wireModalDismiss(overlayEl, closeFn, { initialFocus, backdrop = true } = {}) {
  const prevFocus = document.activeElement;
  let closed = false;

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }
  function onBackdrop(e) {
    if (e.target === overlayEl) close();
  }

  function close() {
    if (closed) return;
    closed = true;
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

const allPrereqs = (p) => [
  ...(p.prerequisites || []),
  ...(p.hiddenPrerequisites || [])
];

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
