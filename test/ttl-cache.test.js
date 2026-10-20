const test = require('node:test');
const assert = require('node:assert/strict');
const { ttlCache } = require('../server/ttl-cache');

test('ttlCache: one call per TTL, shared in-flight promise, rejections not cached, invalidate forces a refresh', async () => {
  let t = 1000;
  let calls = 0;
  let fail = false;
  const c = ttlCache(async () => { calls++; if (fail) throw new Error('db down'); return 'v' + calls; }, 5000, () => t);

  // Two concurrent callers share one run.
  const [a, b] = await Promise.all([c.get(), c.get()]);
  assert.equal(a, 'v1'); assert.equal(b, 'v1'); assert.equal(calls, 1);

  t += 4999;
  assert.equal(await c.get(), 'v1'); assert.equal(calls, 1);        // still fresh
  t += 2;
  assert.equal(await c.get(), 'v2'); assert.equal(calls, 2);        // expired → refreshed

  // A failure is surfaced and not cached: the next call tries again.
  c.invalidate();
  fail = true;
  await assert.rejects(c.get(), /db down/);
  fail = false;
  assert.equal(await c.get(), 'v4'); assert.equal(calls, 4);

  // invalidate() during the TTL forces the next get() to run fn.
  c.invalidate();
  assert.equal(await c.get(), 'v5'); assert.equal(calls, 5);
});
