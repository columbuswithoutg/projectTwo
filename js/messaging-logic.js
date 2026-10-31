/************************************************
 * MESSAGING LOGIC — pure, dependency-free helpers
 *
 * The shared rules behind the Messages inbox (persisted whispers / DMs)
 * and Bug & suggestion reports:
 *   - size caps and enums, identical on both ends of the wire
 *   - pairKey(): the symmetric conversation key two users share
 *   - normalizeDm() / validateReport() / validateReply(): input shaping
 *
 * Shared by:
 *   routes/messages.js, routes/reports.js, routes/admin.js, server/messages.js
 *   js/messages.js, js/reports.js, js/views/messages.js, js/views/reports.js
 *
 * UMD-ish: attaches to window.MessagingLogic in the browser, exports via
 * module.exports under Node (same pattern as world-chat-logic.js).
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MessagingLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const C = {
    DM_MAX_LEN: 1000,
    USERNAME_MAX: 40,
    TITLE_MAX: 120,
    DESC_MAX: 2000,
    REPLY_MAX: 2000,
    PAGE_MAX: 200,
    UA_MAX: 300,
    THREAD_PAGE: 50,
    CONVERSATIONS_MAX: 100,
    REPLIES_MAX: 100,
    SEND_FLOOR_MS: 750,
    // server/dm-policy.js — one budget per sender for inbox DMs AND /world
    // whispers: DM_BURST at once, DM_PER_MIN sustained, and a stranger (not a
    // friend) may store at most NONFRIEND_DAILY_PER_RECIPIENT per recipient
    // per rolling day.
    DM_BURST: 8,
    DM_PER_MIN: 20,
    NONFRIEND_DAILY_PER_RECIPIENT: 20,
    REPORTS_PER_HOUR: 10,
    POLL_MS: 45000,
    // Requests (kind 'request'): at most this many titles in one "mark as
    // watched" request (server/admin-watch.js MAX_PER_REQUEST), and the
    // highest count a "fix count" request may ask for (/complete stops
    // counting at 9999 too).
    REQUEST_TITLES_MAX: 200,
    WATCH_COUNT_MAX: 9999,
    PROJECT_ID_MAX: 80,
    SUGGEST_TITLE_MAX: 120
  };

  // 'request' = the user asks the admin to change something on their
  // account; REQUEST_TYPES says what, and the admin approves or rejects it
  // from the Reports tab (server/user-requests.js makes the change).
  const REPORT_KINDS = ['bug', 'suggestion', 'request'];
  const REQUEST_TYPES = ['mark-watched', 'undo-watch', 'fix-count', 'add-title', 'rename', 'delete-account'];
  const REQUEST_LABEL = {
    'mark-watched':   'Mark titles as watched',
    'undo-watch':     'Undo a watch',
    'fix-count':      'Fix a watch count',
    'add-title':      'Add a missing title',
    'rename':         'Change my username',
    'delete-account': 'Delete my account'
  };
  const REPORT_STATUSES = ['open', 'in-progress', 'fixed', 'wontfix', 'closed'];
  const SYSTEM_ADMIN = 'admin';

  // Only real strings count — an object/array/number smuggled into a text
  // field is dropped rather than coerced (mirrors the routes' typeof checks).
  const str = (v) => (typeof v === 'string' ? v : '');
  const clip = (v, n) => str(v).trim().slice(0, n);

  // Symmetric conversation key: the two ids sorted and joined, so A→B and
  // B→A land in the same thread regardless of who wrote first.
  function pairKey(a, b) {
    const x = String(a), y = String(b);
    return x < y ? `${x}:${y}` : `${y}:${x}`;
  }

  // System ("Admin") conversations are one per user.
  function adminPairKey(userId) {
    return `${SYSTEM_ADMIN}:${String(userId)}`;
  }

  function isKind(k) { return REPORT_KINDS.includes(k); }
  function isStatus(s) { return REPORT_STATUSES.includes(s); }
  function isRequestType(t) { return REQUEST_TYPES.includes(t); }

  // Names nobody may pick at sign-up or in a rename request (SRV3-01): they
  // would read like the system "Admin" thread or staff in the inbox. The name
  // is lowercased with _ and - removed, then rejected if it STARTS with a
  // prefix ("Admin-1", "_admin", "SystemBot", "Systemic" too) or EQUALS an
  // exact name ("mod", so "modern" stays allowed). Only new names are checked:
  // login, profiles and sockets never call usernameError, so existing
  // accounts with such names keep working.
  const RESERVED_PREFIXES = ['admin', 'administrator', 'moderator', 'system', 'staff', 'support', 'official', 'mcutracker'];
  const RESERVED_EXACT = ['mod', 'mods'];
  const RESERVED_MSG = 'That username is reserved';
  function isReservedUsername(u) {
    const n = str(u).trim().toLowerCase().replace(/[_-]/g, '');
    return RESERVED_EXACT.includes(n) || RESERVED_PREFIXES.some(p => n.startsWith(p));
  }

  // Same rule as register (routes/auth.js): 3–30 letters, digits, _ or -,
  // and not reserved. → null when fine, else the message to show.
  function usernameError(u) {
    if (typeof u !== 'string') return 'Username must be a string';
    const t = u.trim();
    if (t.length < 3 || t.length > 30) return 'Username must be 3–30 characters';
    if (!/^[a-zA-Z0-9_-]+$/.test(t)) return 'Username can only contain letters, numbers, _ or -';
    if (isReservedUsername(t)) return RESERVED_MSG;
    return null;
  }

  const validProjectId = (id) => typeof id === 'string' && id.length > 0 && id.length <= C.PROJECT_ID_MAX;

  // { to, text } → { ok, to, text } | { ok:false, error }
  function normalizeDm(raw) {
    const to = clip(raw && raw.to, C.USERNAME_MAX);
    const text = str(raw && raw.text).trim();
    if (!to) return { ok: false, error: 'no-target' };
    if (!text) return { ok: false, error: 'empty' };
    if (text.length > C.DM_MAX_LEN) return { ok: false, error: 'too-long' };
    return { ok: true, to, text };
  }

  // { kind, title, description, page, userAgent } →
  //   { ok, report } | { ok:false, error, field }
  function validateReport(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const kind = str(r.kind).trim().toLowerCase();
    if (!isKind(kind)) return { ok: false, error: 'bad-kind', field: 'kind' };
    const title = str(r.title).trim();
    if (!title) return { ok: false, error: 'no-title', field: 'title' };
    if (title.length > C.TITLE_MAX) return { ok: false, error: 'title-too-long', field: 'title' };
    const description = str(r.description).trim();
    if (!description) return { ok: false, error: 'no-description', field: 'description' };
    if (description.length > C.DESC_MAX) return { ok: false, error: 'description-too-long', field: 'description' };
    return {
      ok: true,
      report: {
        kind,
        title,
        description,
        page: clip(r.page, C.PAGE_MAX),
        userAgent: clip(r.userAgent, C.UA_MAX)
      }
    };
  }

  // A request: { type, projectIds | projectId (+ count) | title | newUsername
  // | confirm, note, page, userAgent } → { ok, report } | { ok:false, error, field }.
  // The report title here is a placeholder: the server names the titles
  // (requestTitle) once it has looked the project ids up. `note` is optional.
  function validateRequest(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const type = str(r.type).trim();
    if (!isRequestType(type)) return { ok: false, error: 'bad-request-type', field: 'type' };
    const note = str(r.note).trim();
    if (note.length > C.DESC_MAX) return { ok: false, error: 'description-too-long', field: 'note' };
    const request = { type };
    if (type === 'mark-watched') {
      const ids = Array.isArray(r.projectIds) ? r.projectIds : [];
      if (!ids.length) return { ok: false, error: 'no-titles', field: 'projectIds' };
      if (ids.length > C.REQUEST_TITLES_MAX) return { ok: false, error: 'too-many-titles', field: 'projectIds' };
      if (!ids.every(validProjectId)) return { ok: false, error: 'bad-project', field: 'projectIds' };
      request.projectIds = [...new Set(ids)];
    } else if (type === 'undo-watch' || type === 'fix-count') {
      if (!validProjectId(r.projectId)) return { ok: false, error: 'no-project', field: 'projectId' };
      request.projectId = r.projectId;
      if (type === 'fix-count') {
        const n = Number(r.count);
        if (!Number.isInteger(n) || n < 1 || n > C.WATCH_COUNT_MAX) return { ok: false, error: 'bad-count', field: 'count' };
        request.count = n;
      }
    } else if (type === 'add-title') {
      const t = str(r.title).trim();
      if (!t) return { ok: false, error: 'no-suggest-title', field: 'title' };
      if (t.length > C.SUGGEST_TITLE_MAX) return { ok: false, error: 'title-too-long', field: 'title' };
      request.title = t;
    } else if (type === 'rename') {
      const nameErr = usernameError(r.newUsername);
      if (nameErr) return { ok: false, error: nameErr === RESERVED_MSG ? 'reserved-username' : 'bad-username', field: 'newUsername' };
      request.newUsername = r.newUsername.trim();
    } else if (type === 'delete-account') {
      if (r.confirm !== true) return { ok: false, error: 'no-confirm', field: 'confirm' };
    }
    return {
      ok: true,
      report: {
        kind: 'request',
        title: REQUEST_LABEL[type],
        description: note,
        page: clip(r.page, C.PAGE_MAX),
        userAgent: clip(r.userAgent, C.UA_MAX),
        request
      }
    };
  }

  // The report title for a request, e.g. "Mark as watched: Iron Man, Thor
  // and 3 more". titleOf(id) → display title (the server's project lookup).
  function requestTitle(request, titleOf) {
    const name = (id) => String((titleOf && titleOf(id)) || id);
    let t;
    switch (request && request.type) {
      case 'mark-watched': {
        const ids = request.projectIds || [];
        const shown = ids.slice(0, 2).map(name).join(', ');
        t = `Mark as watched: ${shown}${ids.length > 2 ? ` and ${ids.length - 2} more` : ''}`;
        break;
      }
      case 'undo-watch':     t = `Undo watch: ${name(request.projectId)}`; break;
      case 'fix-count':      t = `Set watch count of ${name(request.projectId)} to ${request.count}`; break;
      case 'add-title':      t = `Add a missing title: ${request.title}`; break;
      case 'rename':         t = `Change username to ${request.newUsername}`; break;
      case 'delete-account': t = 'Delete my account'; break;
      default:               t = 'Request';
    }
    return t.length > C.TITLE_MAX ? t.slice(0, C.TITLE_MAX - 1).trimEnd() + '…' : t;
  }

  // How a report is named to its author ("your request …").
  function kindLabel(kind) {
    return kind === 'bug' ? 'bug report' : kind === 'request' ? 'request' : 'suggestion';
  }

  // { text } → { ok, text } | { ok:false, error }
  function validateReply(raw) {
    const text = str(raw && raw.text).trim();
    if (!text) return { ok: false, error: 'empty' };
    if (text.length > C.REPLY_MAX) return { ok: false, error: 'too-long' };
    return { ok: true, text };
  }

  // Single-line, truncated preview for conversation lists.
  function preview(text, n) {
    const max = n || 80;
    const one = str(text).replace(/\s+/g, ' ').trim();
    return one.length > max ? one.slice(0, max - 1).trimEnd() + '…' : one;
  }

  // Friendly copy for a rejected action.
  function errorText(err) {
    switch (err) {
      case 'no-target':            return 'Enter a username to message.';
      case 'empty':                return 'Type a message first.';
      case 'too-long':             return `Keep it under ${C.DM_MAX_LEN} characters.`;
      case 'cooldown':             return 'Slow down a little.';
      case 'rate':                 return 'You’re sending messages too quickly — give it a minute.';
      case 'daily-cap':            return 'You’ve reached today’s limit for messaging someone who isn’t your friend yet.';
      case 'bad-kind':             return 'Pick Bug or Suggestion.';
      case 'no-title':             return 'Give it a short title.';
      case 'title-too-long':       return `Titles are limited to ${C.TITLE_MAX} characters.`;
      case 'no-description':       return 'Describe what happened or what you’d like.';
      case 'description-too-long': return `Descriptions are limited to ${C.DESC_MAX} characters.`;
      case 'bad-request-type':     return 'Pick what you’d like the admin to do.';
      case 'no-titles':            return 'Tick at least one title.';
      case 'too-many-titles':      return `At most ${C.REQUEST_TITLES_MAX} titles in one request.`;
      case 'bad-project':
      case 'no-project':           return 'Pick a title.';
      case 'bad-count':            return `Enter a whole number from 1 to ${C.WATCH_COUNT_MAX}.`;
      case 'no-suggest-title':     return 'Enter the title you’d like added.';
      case 'bad-username':         return 'Usernames are 3–30 letters, numbers, _ or -.';
      case 'reserved-username':    return 'That username is reserved — pick another.';
      case 'no-confirm':           return 'Tick the box to confirm.';
      default:                     return 'Something went wrong — please try again.';
    }
  }

  return {
    C, REPORT_KINDS, REPORT_STATUSES, REQUEST_TYPES, REQUEST_LABEL, SYSTEM_ADMIN,
    pairKey, adminPairKey, isKind, isStatus, isRequestType, usernameError, isReservedUsername,
    normalizeDm, validateReport, validateRequest, requestTitle, kindLabel, validateReply, preview, errorText
  };
});
