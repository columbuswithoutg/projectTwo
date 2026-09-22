/************************************************
 * WORLD STAY LOGIC — pure, dependency-free helpers
 *
 * How long has a player "stayed" on a project island? The server credits
 * connected time on the island, but pauses after AFK_LIMIT_MS without any
 * action from that socket (movement, chat on any channel, emote, punch,
 * stone grab). Someone standing still while chatting keeps counting; a
 * tab parked overnight stops after one idle minute.
 *
 * A stay record is created when a player steps onto an island
 * (`enter`), refreshed on every accepted action (`touch`), and drained
 * into a persisted total (`drain`) on island exit, disconnect, and on a
 * periodic flush so long stays survive a crash.
 *
 * Invariant: the credit between two consecutive actions never exceeds
 * min(gap, AFK_LIMIT_MS), no matter how many flushes run in between —
 * `creditedUpTo` guards against double-crediting the same interval.
 *
 * Server-only today (routes/world-socket.js), but written UMD-ish like
 * world-chat-logic.js so the unit tests can require it and the client
 * could share it later.
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WorldStayLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const C = {
    AFK_LIMIT_MS: 60 * 1000,        // stop counting after this long without an action
    FLUSH_INTERVAL_MS: 60 * 1000    // how often live stays are written to Mongo
  };

  // A fresh stay on `projectId`, started at `now`.
  function enter(projectId, now) {
    return { projectId, lastActiveAt: now, creditedUpTo: now, pendingMs: 0 };
  }

  // Move the credited horizon forward to `now`, capped at the AFK limit past
  // the last action. Mutates `stay`; returns the ms credited by this call.
  function settle(stay, now) {
    if (!stay) return 0;
    const cap = Math.min(now, stay.lastActiveAt + C.AFK_LIMIT_MS);
    const credit = Math.max(0, cap - stay.creditedUpTo);
    stay.pendingMs += credit;
    stay.creditedUpTo = Math.max(stay.creditedUpTo, cap);
    return credit;
  }

  // An accepted action at `now`: credit up to the limit, then restart the
  // idle clock from here. An idle gap longer than the limit is skipped, never
  // back-credited.
  function touch(stay, now) {
    if (!stay) return;
    settle(stay, now);
    stay.lastActiveAt = now;
    stay.creditedUpTo = Math.max(stay.creditedUpTo, now);
  }

  // Take everything credited so far (settling first) and zero the buffer.
  function drain(stay, now) {
    if (!stay) return 0;
    settle(stay, now);
    const ms = stay.pendingMs;
    stay.pendingMs = 0;
    return ms;
  }

  // The keeper of an island: highest total, ties broken by whoever got there
  // first (earlier updatedAt). `rows` is [{ userId, ms, updatedAt }]; null
  // when nobody has stayed yet.
  function keeperOf(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;
    let best = null;
    for (const r of rows) {
      if (!r || typeof r.ms !== 'number') continue;
      if (!best || r.ms > best.ms ||
          (r.ms === best.ms && toTime(r.updatedAt) < toTime(best.updatedAt))) best = r;
    }
    return best;
  }

  function toTime(d) {
    const t = d instanceof Date ? d.getTime() : (typeof d === 'number' ? d : Date.parse(d));
    return Number.isFinite(t) ? t : Infinity;
  }

  // "3h 12m" / "45m" / "<1m"
  function formatStay(ms) {
    const mins = Math.floor((Number(ms) || 0) / 60000);
    if (mins < 1) return '<1m';
    const h = Math.floor(mins / 60), m = mins % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  return { C, enter, settle, touch, drain, keeperOf, formatStay };
});
