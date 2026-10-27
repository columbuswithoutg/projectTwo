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
  // True once getToken/isLoggedIn dropped a token because it was past its
  // `exp` — i.e. this tab WAS signed in and the session ran out under it.
  // Lets a caller tell "expired, send them to /login" apart from "never
  // signed in" after the token itself is already gone. Cleared by every
  // setToken/clearToken (a new sign-in, or a deliberate logout).
  _expired: false,
  // Storm guard for endSession(): set by the first dead-session detection,
  // so ten parallel 401s cause ONE logout + redirect, not ten.
  _sessionEnding: false,

  getToken: () => {
    const t = localStorage.getItem("mcu_token");
    if (!t) return null;
    if (!isTokenValid(t)) {
      localStorage.removeItem("mcu_token");
      Auth._expired = true;
      return null;
    }
    return t;
  },
  getUsername: () => localStorage.getItem("mcu_username"),
  setToken: (t) => { Auth._expired = false; Auth._sessionEnding = false; localStorage.setItem("mcu_token", t); },
  clearToken: () => { Auth._expired = false; localStorage.removeItem("mcu_token"); },
  isLoggedIn: () => {
    const t = localStorage.getItem("mcu_token");
    if (!t) return false;
    if (!isTokenValid(t)) {
      // Self-clean stale tokens so subsequent calls don't keep checking
      // the same dead JWT and so logout-style cleanup is unnecessary.
      localStorage.removeItem("mcu_token");
      Auth._expired = true;
      return false;
    }
    return true;
  },
  // See _expired: the token ran out in this tab (not a deliberate logout).
  sessionExpired: () => Auth._expired,

  // The session is dead (token missing/expired, or the server answered 401):
  // sign out ONCE and go to /login?next=<this page>, so signing back in lands
  // the user where they were. Returns a promise that never settles — the page
  // is being replaced, and resolving/rejecting would only make every caller
  // paint its own "No token" / "Couldn't load your progress" error toast
  // over the redirect. (state.resetLocal drops its in-flight load promise so
  // the next sign-in doesn't wait on this one.)
  endSession() {
    if (!Auth._sessionEnding) {
      Auth._sessionEnding = true;
      const here = location.pathname + location.search;
      try {
        Auth.logout(location.pathname === '/login' ? undefined : { next: here });
      } catch (e) { console.warn('logout failed:', e); }
    }
    return new Promise(() => {});
  },

  // fetch() for every SIGNED-IN API call: adds `Authorization: Bearer <token>`
  // from a fresh getToken() (never "Bearer null"), and routes a missing /
  // expired token or a 401 answer through endSession(). Every other status
  // resolves as usual, so each module keeps its own error handling. NOT for
  // /api/auth/* — a wrong password there is a legitimate 401 (login.js
  // keeps using plain fetch).
  fetch(url, opts) {
    const token = Auth.getToken();
    if (!token) return Auth.endSession();
    const o = Object.assign({}, opts);
    o.headers = Object.assign({}, o.headers, { Authorization: 'Bearer ' + token });
    return fetch(url, o).then(res => {
      if (res.status !== 401) return res;
      // A request sent with a PREVIOUS account's token that answers after a
      // new sign-in must not log the new account out; hand it back as a
      // plain failed response.
      const now = localStorage.getItem("mcu_token");
      if (now && now !== token) return res;
      return Auth.endSession();
    });
  },
  isAdmin: () => {
    const token = localStorage.getItem("mcu_token");
    if (!token || !isTokenValid(token)) return false;
    const payload = decodeJwtPayload(token);
    return !!(payload && payload.isAdmin);
  },

  // Forget EVERYTHING that belongs to the signed-in user, in one place.
  // Three logout paths used to each clean a different subset, so switching
  // accounts in one tab showed the previous user's walkers, composer draft,
  // avatar or unread badge until a hard refresh. Called by logout(), by the
  // login page on mount, and right before a new login stores its token.
  // Per-device preferences (theme, fights/dialogues toggles, zoom) stay.
  resetClientState() {
    // 1. Leave friend mode first (it writes the saved state.data back), close dialogs.
    if (typeof FriendView !== 'undefined') { try { FriendView.exit(); } catch (_) {} }
    if (typeof closeAllModals === 'function') { try { closeAllModals(); } catch (_) {} }
    if (typeof PostComposer !== 'undefined' && PostComposer.reset) { try { PostComposer.reset(); } catch (_) {} }
    // 2. Credentials + per-user storage.
    Auth.clearToken();
    localStorage.removeItem("mcu_username");
    localStorage.removeItem("mcu_walkers");
    // 3. In-memory per-user state. resetLocal fires listeners, so the layout
    //    / renderer / walker caches rebuild for the next account.
    if (typeof Walkers !== 'undefined' && Walkers.resetInit) { try { Walkers.resetInit(); } catch (_) {} }
    if (typeof state !== 'undefined' && state.resetLocal) { try { state.resetLocal(); } catch (_) {} }
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
