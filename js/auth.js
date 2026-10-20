/************************************************
 * AUTH HELPERS
 ************************************************/
// Decode a JWT without verifying. Browser-only, used to read the isAdmin
// claim for UX gating — server enforcement (requireAdmin) is the real gate
// since the JWT can be tampered or stale after demotion.
function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

// Returns true iff the token decodes and isn't past its `exp` claim. Used by
// isLoggedIn so a stale token left in localStorage from a prior session
// doesn't fool the SPA into routing the user to / instead of /login.
function isTokenValid(token) {
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  if (typeof payload.exp === 'number') {
    // exp is seconds-since-epoch per RFC 7519; allow a 30s skew.
    if (Date.now() / 1000 > payload.exp + 30) return false;
  }
  return true;
}

const Auth = {
  getToken: () => {
    const t = localStorage.getItem("mcu_token");
    if (!t) return null;
    if (!isTokenValid(t)) {
      localStorage.removeItem("mcu_token");
      return null;
    }
    return t;
  },
  getUsername: () => localStorage.getItem("mcu_username"),
  setToken: (t) => localStorage.setItem("mcu_token", t),
  clearToken: () => localStorage.removeItem("mcu_token"),
  isLoggedIn: () => {
    const t = localStorage.getItem("mcu_token");
    if (!t) return false;
    if (!isTokenValid(t)) {
      // Self-clean stale tokens so subsequent calls don't keep checking
      // the same dead JWT and so logout-style cleanup is unnecessary.
      localStorage.removeItem("mcu_token");
      return false;
    }
    return true;
  },
  isAdmin: () => {
    const token = localStorage.getItem("mcu_token");
    if (!token || !isTokenValid(token)) return false;
    const payload = decodeJwtPayload(token);
    return !!(payload && payload.isAdmin);
  },

  async register(username, password) {
    const res = await fetch(`${API}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    return res.json();
  },

  async login(username, password) {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.token) Auth.setToken(data.token);
    return data;
  },

  // Forget EVERYTHING that belongs to the signed-in user, in one place.
  // Three logout paths used to each clean a different subset, so switching
  // accounts in one tab showed the previous user's walkers, composer draft,
  // avatar or unread badge until a hard refresh. Called by logout(), by the
  // login page on mount, and right before a new login stores its token.
  // Per-device preferences (theme, fights/dialogues toggles, zoom) stay.
  resetClientState() {
    // 1. Save the outgoing user's last progress click while the token is valid.
    try { if (typeof state !== 'undefined' && state.flushPersist) state.flushPersist(); } catch (_) {}
    // 2. Leave friend mode first (it writes the saved state.data back), close dialogs.
    if (typeof FriendView !== 'undefined') { try { FriendView.exit(); } catch (_) {} }
    if (typeof closeAllModals === 'function') { try { closeAllModals(); } catch (_) {} }
    if (typeof PostComposer !== 'undefined' && PostComposer.reset) { try { PostComposer.reset(); } catch (_) {} }
    // 3. Credentials + per-user storage.
    Auth.clearToken();
    localStorage.removeItem("mcu_username");
    localStorage.removeItem("mcu_walkers");
    if (typeof CONFIG !== 'undefined' && CONFIG.STORAGE_KEY) {
      localStorage.removeItem(CONFIG.STORAGE_KEY);
    }
    // 4. In-memory per-user state. resetLocal fires listeners, so the layout
    //    / renderer / walker caches rebuild for the next account.
    if (typeof Walkers !== 'undefined' && Walkers.resetInit) { try { Walkers.resetInit(); } catch (_) {} }
    if (typeof state !== 'undefined' && state.resetLocal) { try { state.resetLocal(); } catch (_) {} }
    if (typeof WatchOrderView !== 'undefined') WatchOrderView._initialized = false;
    if (typeof AppView !== 'undefined') AppView._initialized = false;
    if (typeof HomeView !== 'undefined') HomeView._firstVisitPrompted = false;
    if (typeof FeedView !== 'undefined' && FeedView.reset) { try { FeedView.reset(); } catch (_) {} }
    if (typeof MessagesBadge !== 'undefined' && MessagesBadge.apply) { try { MessagesBadge.apply(0); } catch (_) {} }
  },

  // opts.next: the in-app URL to return to after signing in again (used by
  // the 401 handlers, never by a deliberate logout — the next account must
  // not land on the previous user's page).
  logout(opts) {
    const next = opts && typeof opts.next === 'string' ? opts.next : null;
    // Tell the server first (fire-and-forget): it bumps tokenVersion, so
    // this token stops working in every tab and on every device. The
    // response is never read — a stale token's 401 can't loop back here.
    const t = localStorage.getItem("mcu_token");
    if (t && isTokenValid(t)) {
      try {
        fetch(`${API}/auth/logout`, {
          method: 'POST', keepalive: true,
          headers: { Authorization: 'Bearer ' + t }
        }).catch(() => {});
      } catch (_) {}
    }
    Auth.resetClientState();
    const target = next && next !== '/' ? '/login?next=' + encodeURIComponent(next) : '/login';
    if (typeof Router !== 'undefined') {
      Router.go(target, { force: true });   // unsaved work can't hold a dead session
    } else {
      window.location.reload();
    }
  }
};
