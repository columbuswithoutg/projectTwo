/************************************************
 * server/dm-policy.js — ONE send budget for private messages, whichever
 * door they come through: POST /api/messages (routes/messages.js) and
 * /world whispers (routes/world-socket.js handleWhisper).
 *
 * Each path used to keep its own floor (750 ms between sends), the socket
 * one on the per-join record (reset by a reconnect), and nothing limited how
 * many messages one account could drop into a stranger's inbox. Now:
 *  - floor:   SEND_FLOOR_MS between any two sends by the same sender
 *  - budget:  DM_BURST at once, then DM_PER_MIN sustained (token bucket)
 *  - daily:   a sender who is NOT the recipient's friend may store at most
 *             NONFRIEND_DAILY_PER_RECIPIENT messages to that recipient per
 *             rolling 24 h (counted in Mongo, so it survives a restart)
 *
 * dmDecision() is the pure rule (test/dm-policy.test.js); check() gathers
 * the inputs. This module must never require server/messages.js or
 * routes/world-socket.js (both require it indirectly → cycle).
 ************************************************/
const Friend = require('../models/Friend');
const Message = require('../models/Message');
const { friendFilter } = require('./friendship');
const { C } = require('../js/messaging-logic');
const RateStore = require('./rate-store');

const DAY_MS = 24 * 60 * 60 * 1000;

const store = new RateStore({
  rates: { dm: { cap: C.DM_BURST, perSec: C.DM_PER_MIN / 60 } },
  maxKeys: 10000,
  floorMaxMs: C.SEND_FLOOR_MS
});
const sweepTimer = setInterval(() => store.sweep(Date.now()), 60 * 1000);
if (sweepTimer.unref) sweepTimer.unref();

// → { ok: true } | { ok: false, error: 'cooldown', retryInMs } | { ok: false,
// error: 'rate' | 'daily-cap' }. Error codes have copy in both
// js/messaging-logic.js and js/world-chat-logic.js errorText.
function dmDecision({ budgetOk, floorLeft, isFriend, sentToRecipient24h }) {
  if (floorLeft > 0) return { ok: false, error: 'cooldown', retryInMs: floorLeft };
  if (!budgetOk) return { ok: false, error: 'rate' };
  if (!isFriend && (sentToRecipient24h || 0) >= C.NONFRIEND_DAILY_PER_RECIPIENT) {
    return { ok: false, error: 'daily-cap' };
  }
  return { ok: true };
}

// The in-memory checks run first (free); Mongo is only asked when they pass.
// A rejected send still costs a budget token — probing is not free.
async function check(senderId, recipientId, now = Date.now()) {
  const s = String(senderId), r = String(recipientId);
  const floorLeft = store.floorLeft(s, 'send', C.SEND_FLOOR_MS, now);
  if (floorLeft > 0) return dmDecision({ budgetOk: true, floorLeft, isFriend: true, sentToRecipient24h: 0 });
  const budgetOk = store.allow(s, 'dm', now);
  if (!budgetOk) return dmDecision({ budgetOk: false, floorLeft: 0, isFriend: true, sentToRecipient24h: 0 });
  const [isFriend, sent] = await Promise.all([
    Friend.exists(friendFilter(s, r)).then(Boolean),
    Message.countDocuments({ sender: s, recipient: r, createdAt: { $gte: new Date(now - DAY_MS) } })
  ]);
  const d = dmDecision({ budgetOk: true, floorLeft: 0, isFriend, sentToRecipient24h: sent });
  if (d.ok) store.mark(s, 'send', now);
  return d;
}

module.exports = { dmDecision, check, DAY_MS, _store: store };
