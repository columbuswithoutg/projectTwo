/************************************************
 * AUTH HELPERS
 ************************************************/
const Auth = {
  getToken: () => localStorage.getItem("mcu_token"),
  getUsername: () => localStorage.getItem("mcu_username"),
  setToken: (t) => localStorage.setItem("mcu_token", t),
  clearToken: () => localStorage.removeItem("mcu_token"),
  isLoggedIn: () => !!localStorage.getItem("mcu_token"),

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
    if (typeof Router !== 'undefined') {
      Router.go('/');
    } else {
      window.location.reload();
    }
  }
};
