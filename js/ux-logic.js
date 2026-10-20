/************************************************
 * UX LOGIC (pure, unit-tested) — small decisions the views make that are
 * worth testing without a DOM:
 *   safeNextUrl       the only `?next=` values the login page may follow
 *   rankFriendSearch  how friend-search results are ordered and flagged
 *   friendlyAuthError the copy for a failed login / register
 *
 * UMD-ish like js/pan-zoom-logic.js: `UxLogic` in the browser,
 * module.exports under node. Loads in the core chunk before the views.
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.UxLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const NEXT_MAX_LEN = 512;

  // A same-origin in-app path (with query / hash) or null. Refuses anything
  // that could leave the site (`//evil`, `/\evil`, schemes, encoded slashes),
  // control characters, the login page itself (no loops) and junk.
  function safeNextUrl(raw) {
    if (typeof raw !== 'string') return null;
    if (!raw || raw.length > NEXT_MAX_LEN) return null;
    if (raw[0] !== '/') return null;                       // absolute URLs, schemes, leading whitespace
    if (/^\/[\/\\]/.test(raw)) return null;                // protocol-relative: //host, /\host
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
    let decoded;
    try { decoded = decodeURIComponent(raw); } catch (_) { return null; }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(decoded)) return null;
    if (/^\/[\/\\]/.test(decoded)) return null;            // %2F%2Fevil
    const path = raw.split(/[?#]/)[0];
    if (path === '/login' || path.startsWith('/login/')) return null;
    return raw;
  }

  // results: [{ _id, username }] from /api/friends/search; query: what the
  // user typed; friends / pending: Sets of usernames (lower-cased) already
  // befriended / already asked. → { items, exact }
  //   items: [{ _id, username, status: 'none'|'friend'|'pending', match: [start, end] }]
  //          exact matches first, then prefix matches, then by match
  //          position, then shorter names, then alphabetical
  //   exact: the items whose name equals the query ignoring case (Enter may
  //          auto-send only when there is exactly one and it is 'none')
  function rankFriendSearch(results, query, opts) {
    const q = String(query == null ? '' : query).trim().toLowerCase();
    const friends = (opts && opts.friends) || new Set();
    const pending = (opts && opts.pending) || new Set();
    if (!q || !Array.isArray(results)) return { items: [], exact: [] };
    const seen = new Set();
    const items = [];
    for (const r of results) {
      if (!r || typeof r.username !== 'string' || !r._id) continue;
      const id = String(r._id);
      if (seen.has(id)) continue;
      seen.add(id);
      const name = r.username;
      const lower = name.toLowerCase();
      const at = lower.indexOf(q);
      const status = friends.has(lower) ? 'friend' : pending.has(lower) ? 'pending' : 'none';
      items.push({ _id: id, username: name, status, match: at >= 0 ? [at, at + q.length] : null, _at: at, _exact: lower === q });
    }
    items.sort((a, b) => {
      if (a._exact !== b._exact) return a._exact ? -1 : 1;
      const ap = a._at === 0, bp = b._at === 0;
      if (ap !== bp) return ap ? -1 : 1;
      const aa = a._at < 0 ? 1e9 : a._at, ba = b._at < 0 ? 1e9 : b._at;
      if (aa !== ba) return aa - ba;
      if (a.username.length !== b.username.length) return a.username.length - b.username.length;
      return a.username.toLowerCase() < b.username.toLowerCase() ? -1 : a.username.toLowerCase() > b.username.toLowerCase() ? 1 : 0;
    });
    const exact = items.filter(i => i._exact);
    for (const i of items) { delete i._at; delete i._exact; }
    return { items, exact };
  }

  // data: the parsed JSON body (may be null); status: HTTP status (0 = no
  // response at all). → copy for the login page's error line.
  function friendlyAuthError(data, status) {
    const msg = (data && typeof data.error === 'string') ? data.error : '';
    if (!status || status === 0) return 'Can’t reach the server. Check your connection and try again.';
    if (status === 403 && /suspended/i.test(msg)) {
      const reason = data && typeof data.reason === 'string' && data.reason.trim();
      return reason ? `This account is suspended: ${reason}` : 'This account is suspended.';
    }
    if (status === 401 || /invalid credentials/i.test(msg)) return 'That username and password don’t match.';
    if (status === 429) return 'Too many tries — wait a few minutes and try again.';
    if (/already exists|taken/i.test(msg)) return 'That username is taken — try another.';
    if (status >= 500) return 'The server had a problem — please try again in a moment.';
    return msg || 'Something went wrong — please try again.';
  }

  return { NEXT_MAX_LEN, safeNextUrl, rankFriendSearch, friendlyAuthError };
});
