/************************************************
 * server/ttl-cache.js — cache one async value for a few seconds.
 *
 *   const shared = ttlCache(() => expensiveQuery(), 15000);
 *   await shared.get();      // runs the query at most once per 15 s
 *   shared.invalidate();     // the next get() runs it again
 *
 * Single-flight: concurrent callers during a refresh share one promise. A
 * rejection is never cached — the next caller retries. `now` is injectable
 * for tests (test/ttl-cache.test.js).
 ************************************************/
function ttlCache(fn, ttlMs, now = Date.now) {
  let value;
  let validUntil = -Infinity;
  let inflight = null;

  async function get() {
    const t = now();
    if (t < validUntil) return value;
    if (inflight) return inflight;
    inflight = Promise.resolve()
      .then(fn)
      .then((v) => { value = v; validUntil = now() + ttlMs; return v; })
      .finally(() => { inflight = null; });
    return inflight;
  }

  function invalidate() {
    validUntil = -Infinity;
  }

  return { get, invalidate };
}

module.exports = { ttlCache };
