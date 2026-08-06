/************************************************
 * THEME MANAGER — light / dark / system, dark by default
 *
 * The inline head script in spa.html and index.html has already set
 * data-theme on <html> before first paint (anti-flash); this module is
 * the runtime API the profile Appearance toggle drives. Keep both inline
 * scripts in lockstep with the defaulting logic below or a saved
 * preference will flash the wrong theme on load.
 *
 * NOT to be confused with js/theme-color.js, which extracts dominant
 * colors from poster images for the 3D home rooms.
 *
 * Storage: localStorage['mcu-theme'] = 'light' | 'dark' | 'system'.
 * Absent/unrecognized key means the hard default: dark, and does NOT
 * follow the OS — only an explicit 'system' choice follows the OS live.
 ************************************************/
const Theme = (() => {
  const KEY = 'mcu-theme';
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' || v === 'system' ? v : null;
    } catch (_) { return null; }
  }

  function resolved() {
    const s = saved();
    if (s === 'light') return 'light';
    if (s === 'system') return (mq && mq.matches) ? 'dark' : 'light';
    // 'dark', or no/invalid saved value — dark is the hard default.
    return 'dark';
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#07080f' : '#ffffff');
  }

  // mode: 'light' | 'dark' | 'system'
  function set(mode) {
    try {
      if (mode === 'light' || mode === 'dark' || mode === 'system') {
        localStorage.setItem(KEY, mode);
      } else {
        localStorage.removeItem(KEY);
      }
    } catch (_) { /* private browsing — theme still applies for the session */ }
    apply(resolved());
  }

  // 'light' | 'dark' | 'system' — what the toggle should show as active.
  // A fresh visit (no saved key) shows Dark active, matching resolved().
  function get() {
    return saved() || 'dark';
  }

  // Follow live OS theme changes ONLY while the user explicitly chose
  // 'system' — a hard dark default must not flip to light just because a
  // fresh visitor's OS reports a light preference.
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', () => { if (saved() === 'system') apply(resolved()); });
  }

  return { get, set, resolved };
})();
