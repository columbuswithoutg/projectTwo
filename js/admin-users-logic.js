/************************************************
 * ADMIN USERS LOGIC — pure sort rules behind the admin Users table
 *
 *   SORT_KEYS / DIRS / DEFAULT_SORT / DEFAULT_DIR
 *                              the allowlist GET /api/admin/users accepts
 *   parseSort(sort, dir)       query strings → a valid { sort, dir }
 *   nextSort(state, key)       what a header click does (asc first, then desc)
 *   sortKey(user, key)         one user's comparable value for a column
 *   compareUsers(a, b, …)      the table's order (never-active users last)
 *   sortUsers(items, …)        a sorted copy — stable, deterministic ties
 *   sortStage(sort, dir)       the Mongo $sort the route uses for that order
 *
 * Shared by: routes/admin.js (GET /users: allowlist + $sort, so the WHOLE
 *            list is sorted, not just the page),
 *            js/views/admin/users.js (header state + indicators).
 * Unit tests: test/admin-users-sort.test.js, test/admin-users-route.test.js.
 *
 * UMD-ish: attaches to window.AdminUsersLogic in the browser, exports via
 * module.exports under Node (same pattern as project-logic.js).
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AdminUsersLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const SORT_KEYS = ['username', 'lastActive', 'watched', 'memories', 'joined'];
  const DIRS = ['asc', 'desc'];
  // The order the list had before it was sortable: newest account first.
  // What you get with no (or an unknown) sort param.
  const DEFAULT_SORT = 'joined';
  const DEFAULT_DIR = 'desc';

  // Query strings → { sort, dir }. An unknown sort means the default ORDER
  // (sort and dir both); a known sort with a bad or missing dir is ascending.
  function parseSort(sort, dir) {
    if (!SORT_KEYS.includes(sort)) return { sort: DEFAULT_SORT, dir: DEFAULT_DIR };
    return { sort, dir: DIRS.includes(dir) ? dir : 'asc' };
  }

  // A header click: a new column starts ascending, the same column flips.
  function nextSort(state, key) {
    const cur = parseSort(state && state.sort, state && state.dir);
    if (!SORT_KEYS.includes(key)) return cur;
    if (cur.sort !== key) return { sort: key, dir: 'asc' };
    return { sort: key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  }

  // A Date / ISO string / ms → ms, or null when there is no usable date.
  function timeOf(v) {
    if (v == null || v === '') return null;
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }

  function countOf(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  // The comparable value of one column. For Last active, null means "never"
  // and sorts after every real date both ways. A missing join date is the
  // other way round: the account predates the schema's timestamps, so it is
  // the OLDEST — first ascending, last descending (which is also where
  // Mongo puts a null createdAt, so the two orders agree).
  function sortKey(user, key) {
    const u = user || {};
    switch (key) {
      case 'username':   return String(u.username == null ? '' : u.username).toLowerCase();
      case 'lastActive': return timeOf(u.lastActiveAt);
      case 'watched':    return countOf(u.watchedCount);
      case 'memories':   return countOf(u.memoryCount);
      case 'joined':     { const t = timeOf(u.createdAt); return t == null ? -Infinity : t; }
      default:           return null;
    }
  }

  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  // Two column values in one direction; null is last whichever way.
  function compareValues(ka, kb, dir) {
    if (ka == null && kb == null) return 0;
    if (ka == null) return 1;
    if (kb == null) return -1;
    const c = cmp(ka, kb);
    return dir === 'desc' ? -c : c;
  }

  // Ties fall back to the default order (newest account first, an account
  // with no join date last), then the id, so the same list always comes out
  // the same way — across pages too.
  function tiebreak(a, b) {
    return compareValues(sortKey(a, 'joined'), sortKey(b, 'joined'), 'desc')
      || cmp(String(a._id == null ? '' : a._id), String(b._id == null ? '' : b._id));
  }

  function compareUsers(a, b, sort, dir) {
    const s = parseSort(sort, dir);
    const ua = a || {}, ub = b || {};
    return compareValues(sortKey(ua, s.sort), sortKey(ub, s.sort), s.dir) || tiebreak(ua, ub);
  }

  // A sorted COPY of items (the input is left alone).
  function sortUsers(items, sort, dir) {
    const s = parseSort(sort, dir);
    return (Array.isArray(items) ? items : []).slice().sort((a, b) => compareUsers(a, b, s.sort, s.dir));
  }

  // Mongo's version of compareUsers, for the aggregation behind
  // GET /api/admin/users. The route's $project stage defines the computed
  // fields named here: _un (lower-cased username — a case-insensitive
  // sort), _na (0 when lastActiveAt is a real date, 1 when never active, so
  // those users come last whichever way lastActiveAt goes), watchedCount
  // and memoryCount ($size'd in the pipeline). createdAt / _id are the
  // same tiebreakers as tiebreak() above.
  const MONGO_FIELD = {
    username: '_un',
    lastActive: 'lastActiveAt',
    watched: 'watchedCount',
    memories: 'memoryCount',
    joined: 'createdAt'
  };

  function sortStage(sort, dir) {
    const s = parseSort(sort, dir);
    const n = s.dir === 'desc' ? -1 : 1;
    const spec = {};
    if (s.sort === 'lastActive') spec._na = 1;
    spec[MONGO_FIELD[s.sort]] = n;
    if (s.sort !== 'joined') spec.createdAt = -1;
    spec._id = 1;
    return spec;
  }

  return {
    SORT_KEYS, DIRS, DEFAULT_SORT, DEFAULT_DIR, MONGO_FIELD,
    parseSort, nextSort, sortKey, compareUsers, sortUsers, sortStage
  };
});
