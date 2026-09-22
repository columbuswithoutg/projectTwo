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
    REPORTS_PER_HOUR: 10,
    POLL_MS: 45000
  };

  const REPORT_KINDS = ['bug', 'suggestion'];
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
      case 'bad-kind':             return 'Pick Bug or Suggestion.';
      case 'no-title':             return 'Give it a short title.';
      case 'title-too-long':       return `Titles are limited to ${C.TITLE_MAX} characters.`;
      case 'no-description':       return 'Describe what happened or what you’d like.';
      case 'description-too-long': return `Descriptions are limited to ${C.DESC_MAX} characters.`;
      default:                     return 'Something went wrong — please try again.';
    }
  }

  return {
    C, REPORT_KINDS, REPORT_STATUSES, SYSTEM_ADMIN,
    pairKey, adminPairKey, isKind, isStatus,
    normalizeDm, validateReport, validateReply, preview, errorText
  };
});
