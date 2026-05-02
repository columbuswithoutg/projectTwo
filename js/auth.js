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

const Auth = {
  getToken: () => localStorage.getItem("mcu_token"),
  getUsername: () => localStorage.getItem("mcu_username"),
  setToken: (t) => localStorage.setItem("mcu_token", t),
  clearToken: () => localStorage.removeItem("mcu_token"),
  isLoggedIn: () => !!localStorage.getItem("mcu_token"),
  isAdmin: () => {
    const token = localStorage.getItem("mcu_token");
    if (!token) return false;
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
