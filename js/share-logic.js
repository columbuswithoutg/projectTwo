/************************************************
 * SHARE LOGIC (pure, unit-tested) — the Doomsday story share:
 *   DOOMSDAY_WATCHLIST  Marvel's "stream these before Avengers: Doomsday"
 *                       list (js/goals.js reads it; so does the server's
 *                       link preview, routes/share.js)
 *   doomsdayProgress    that list ticked off against a set of watched ids
 *   isToken / newToken  the secret share-link token (/s/<token>)
 *   daysUntil           the countdown on the story card and share page
 *   previewText         the link-preview title + description
 *   refFromStorage      a "Start your own" referral still worth sending
 *
 * UMD-ish like js/ux-logic.js: `ShareLogic` in the browser, module.exports
 * under node. Loads in the core chunk before js/goals.js.
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ShareLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const DOOMSDAY_ID = 'doomsday';
  // Marvel's order (marvel.com watch guide, as of 2026-10-30). Fixed here,
  // not derived from Doomsday's prerequisites: those differ slightly (Loki S1
  // is required only through Loki S2).
  const DOOMSDAY_WATCHLIST = Object.freeze([
    'xmen1', 'xmen2', 'cap1','avengers1', 'infinitywar', 'endgame', 'loki1', 'loki2', 'shangchi',
    'nowayhome', 'blackpanther2', 'cap4', 'deadpool3', 'drstrange2',
    'thunderbolts', 'fantasticfour'
  ]);

  // 12 URL-safe characters = 72 random bits: not guessable, short enough
  // for a story link sticker.
  const TOKEN_LEN = 12;
  const TOKEN_RE = /^[A-Za-z0-9_-]{12}$/;
  function isToken(t) { return typeof t === 'string' && TOKEN_RE.test(t); }

  // randomBytes(n) → Uint8Array/Buffer of n random bytes (crypto on either
  // side). 9 bytes base64url-encode to exactly 12 characters.
  const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function newToken(randomBytes) {
    const b = randomBytes(9);
    let out = '';
    for (let i = 0; i < 9; i += 3) {
      const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
      out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63];
    }
    return out;
  }

  // watched: Set (or array) of watched project ids. has(id) says whether the
  // live content has the title — one it doesn't is left off the list, the
  // same way the goals panel skips it.
  // → { items: [{ id, watched }], met, total }
  function doomsdayProgress(watched, has) {
    const set = watched instanceof Set ? watched : new Set(watched || []);
    const items = [];
    for (const id of DOOMSDAY_WATCHLIST) {
      if (has && !has(id)) continue;
      items.push({ id, watched: set.has(id) });
    }
    return { items, met: items.filter(i => i.watched).length, total: items.length };
  }

  // Whole days from `now` until the ISO date (local midnight), 0 on the day,
  // negative once it has passed, null for a missing / bad date.
  function daysUntil(iso, now) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const [y, m, d] = iso.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    if (isNaN(target)) return null;
    const n = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    const today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    return Math.round((target - today) / 86400000);
  }

  // "49 days until Avengers: Doomsday" / "Avengers: Doomsday is out tomorrow"
  // / "… is out today" / "… is now in theaters".
  function countdownText(days, title) {
    const t = title || 'Avengers: Doomsday';
    if (days == null) return '';
    if (days < 0) return `${t} is now in theaters`;
    if (days === 0) return `${t} is out today`;
    if (days === 1) return `${t} is out tomorrow`;
    return `${days} days until ${t}`;
  }

  // The link preview (og:title / og:description) for a share page. null
  // user → the generic copy for a dead link.
  function previewText(user, progress) {
    if (!user || !user.username) {
      return {
        title: 'The road to Avengers: Doomsday — MCU Watch Order',
        description: 'Track the Marvel movies and shows to watch before Avengers: Doomsday.'
      };
    }
    const p = progress || { met: 0, total: DOOMSDAY_WATCHLIST.length };
    return {
      title: `${user.username}'s road to Avengers: Doomsday`,
      description: `${p.met} of ${p.total} watched. See their watch order and start your own.`
    };
  }

  // A referral saved by "Start your own" ({ token, at }) is sent with the
  // sign-up for a week, then forgotten.
  const REF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  function refFromStorage(raw, now) {
    let ref = raw;
    if (typeof raw === 'string') { try { ref = JSON.parse(raw); } catch (_) { return null; } }
    if (!ref || !isToken(ref.token) || !Number.isFinite(ref.at)) return null;
    const t = now == null ? Date.now() : now;
    if (ref.at > t + 60000 || t - ref.at > REF_TTL_MS) return null;
    return ref.token;
  }

  return {
    DOOMSDAY_ID, DOOMSDAY_WATCHLIST, TOKEN_LEN, REF_TTL_MS,
    isToken, newToken, doomsdayProgress, daysUntil, countdownText, previewText, refFromStorage
  };
});
