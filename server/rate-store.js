/************************************************
 * server/rate-store.js — token buckets and cooldown floors keyed by USER
 * (or IP), not by socket.
 *
 * The socket handlers used to keep their buckets on socket.data and their
 * chat / punch / snap floors on the per-join player record, so a client that
 * reconnected (new socket, fresh record) started every limit from zero.
 * Here the key is the verified user id from the handshake, so a new socket
 * for the same user finds the same entry.
 *
 * Memory is bounded two ways:
 *  - sweep(now) drops entries idle for longer than the slowest bucket needs
 *    to refill completely (and the longest floor needs to expire). Such an
 *    entry is indistinguishable from a fresh one, so sweeping never weakens
 *    a limit.
 *  - maxKeys is a hard LRU cap for pathological churn (more distinct keys
 *    than that active at once); only then can state be lost.
 *
 * Buckets are js/world-net-logic.js bucket/take (shared with the client's
 * mirror of the rates). Unit-tested in test/rate-store.test.js.
 ************************************************/
const NetLogic = require('../js/world-net-logic');

class RateStore {
  // rates: { name: { cap, perSec } }; floorMaxMs: the longest floor the
  // caller will ask about, so sweep() can't drop a live one.
  constructor({ rates, maxKeys = 10000, floorMaxMs = 0 } = {}) {
    this.rates = rates || NetLogic.RATES;
    this.maxKeys = maxKeys;
    this.entries = new Map();          // key → { b: {name: bucket}, f: {name: lastMs}, seen }
    let idle = Math.max(0, floorMaxMs || 0);
    for (const name of Object.keys(this.rates)) {
      const r = this.rates[name];
      if (r && r.perSec > 0) idle = Math.max(idle, (r.cap / r.perSec) * 1000);
    }
    this.idleMs = idle;
  }

  // Fetch-or-create, moving the key to the most-recent end; evict the
  // oldest key past maxKeys.
  _touch(key, now) {
    const k = String(key);
    let e = this.entries.get(k);
    if (e) this.entries.delete(k);
    else e = { b: Object.create(null), f: Object.create(null), seen: 0 };
    if (Number.isFinite(now) && now > e.seen) e.seen = now;
    this.entries.set(k, e);
    if (this.entries.size > this.maxKeys) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
    return e;
  }

  // Spend one token from `name`'s bucket for `key`. Unknown names are
  // unlimited (same contract as NetLogic.allow).
  allow(key, name, now) {
    const r = this.rates[name];
    if (!r) return true;
    const e = this._touch(key, now);
    let b = e.b[name];
    if (!b) b = e.b[name] = NetLogic.bucket(r.cap, r.perSec, now);
    return NetLogic.take(b, now);
  }

  // Milliseconds still to wait on a floor last marked with mark(). 0 when
  // free or unknown. Read-only.
  floorLeft(key, name, ms, now) {
    const e = this.entries.get(String(key));
    if (!e) return 0;
    const last = e.f[name];
    if (!last) return 0;
    const elapsed = now - last;
    if (!Number.isFinite(elapsed)) return 0;
    return Math.min(ms, Math.max(0, ms - elapsed));
  }

  mark(key, name, now) {
    const e = this._touch(key, now);
    e.f[name] = now;
  }

  // Drop entries that have been idle long enough to be indistinguishable
  // from fresh ones.
  sweep(now) {
    for (const [k, e] of this.entries) {
      if (now - e.seen >= this.idleMs) this.entries.delete(k);
    }
  }

  get size() { return this.entries.size; }
  clear() { this.entries.clear(); }
}

module.exports = RateStore;
