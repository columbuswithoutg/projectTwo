/************************************************
 * THEME MANAGER — Cinematic / Comic / System, Cinematic by default
 *
 * Two looks for every page, the in-game HUD and /customize:
 *   cinematic — dark film-poster mood (the default)
 *   comic     — bright comic-book print
 * The 3D world itself looks the same in both.
 *
 * The inline head script in spa.html has already set data-theme on <html>
 * before first paint (anti-flash); this module is the runtime API the
 * profile Appearance control drives. scripts/build.mjs checks that the
 * inline script's theme names and meta colours match THEMES below.
 *
 * Storage: localStorage['mcu-theme'] = 'cinematic' | 'comic' | 'system'.
 * Old saves migrate once: 'dark' → cinematic, 'light' → comic. Nothing
 * saved → cinematic, and the OS is only followed after an explicit 'system'
 * choice (dark → Cinematic, light → Comic).
 *
 * NOT to be confused with js/theme-color.js, which extracts dominant
 * colours from poster images for the 3D home rooms.
 ************************************************/
const Theme = (() => {
  const KEY = 'mcu-theme';
  // theme → <meta name="theme-color"> (the phone browser's toolbar colour)
  const THEMES = { cinematic: { meta: '#0b0d13' }, comic: { meta: '#fff6d5' } };
  const LEGACY = { dark: 'cinematic', light: 'comic' };
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() {
    try {
      let v = localStorage.getItem(KEY);
      if (LEGACY[v]) { v = LEGACY[v]; localStorage.setItem(KEY, v); }   // one-time migration
      return (v === 'cinematic' || v === 'comic' || v === 'system') ? v : null;
    } catch (_) { return null; }
  }

  function resolved() {
    const s = saved();
    if (s === 'comic') return 'comic';
    if (s === 'system') return (mq && mq.matches) ? 'cinematic' : 'comic';
    return 'cinematic';            // 'cinematic', or nothing saved
  }

  function apply(theme) {
    const root = document.documentElement;
    if (root.getAttribute('data-theme') === theme) return;
    // One frame without transitions, so every themed surface flips at once
    // instead of each fading at its own speed.
    root.classList.add('theme-switching');
    root.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEMES[theme].meta);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
    try { window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } })); } catch (_) {}
  }

  // mode: 'cinematic' | 'comic' | 'system'
  function set(mode) {
    try {
      if (mode === 'cinematic' || mode === 'comic' || mode === 'system') localStorage.setItem(KEY, mode);
      else localStorage.removeItem(KEY);
    } catch (_) { /* private browsing — the theme still applies for the session */ }
    apply(resolved());
  }

  // What the Appearance control shows as selected.
  function get() {
    return saved() || 'cinematic';
  }

  // Follow live OS changes only while the user chose 'system'.
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', () => { if (saved() === 'system') apply(resolved()); });
  }

  // Normalise whatever the inline script set (e.g. a stale 'dark' from an
  // older cached spa.html).
  apply(resolved());

  return { get, set, resolved, THEMES };
})();
