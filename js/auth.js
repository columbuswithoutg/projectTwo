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

  logout() {
    Auth.clearToken();
    localStorage.removeItem("mcu_username");
    // Clear per-user data so the next account-switch in the same browser
    // tab doesn't briefly show the previous user's walkers / watch
    // progress before the server fetch overwrites them. Per-device
    // preferences (mcu_fights_enabled, mcu_dialogues_enabled) are kept
    // intentionally — those are device choices, not user-specific.
    localStorage.removeItem("mcu_walkers");
    if (typeof CONFIG !== 'undefined' && CONFIG.STORAGE_KEY) {
      localStorage.removeItem(CONFIG.STORAGE_KEY);
    }
    if (typeof Router !== 'undefined') {
      Router.go('/login');
    } else {
      window.location.reload();
    }
  }
};
