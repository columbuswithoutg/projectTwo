/************************************************
 * THEME MANAGER — light / dark / system
 *
 * The inline head script in spa.html and index.html has already set
 * data-theme on <html> before first paint (anti-flash); this module is
 * the runtime API the profile Appearance toggle drives.
 *
 * NOT to be confused with js/theme-color.js, which extracts dominant
 * colors from poster images for the 3D home rooms.
 *
 * Storage: localStorage['mcu-theme'] = 'light' | 'dark'; absent key
 * means "follow the system preference".
 ************************************************/
const Theme = (() => {
  const KEY = 'mcu-theme';
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (_) { return null; }
  }

  function resolved() {
    return saved() || (mq && mq.matches ? 'dark' : 'light');
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#07080f' : '#ffffff');
  }

  // mode: 'light' | 'dark' | 'system'
  function set(mode) {
    try {
      if (mode === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch (_) { /* private browsing — theme still applies for the session */ }
    apply(resolved());
  }

  // 'light' | 'dark' | 'system' — what the toggle should show as active.
  function get() {
    return saved() || 'system';
  }

  // Follow live OS theme changes only while no explicit choice is saved.
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', () => { if (!saved()) apply(resolved()); });
  }

  return { get, set, resolved };
})();
