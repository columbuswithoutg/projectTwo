// Pure helpers for the admin Overview charts (routes/admin.js).
//
// fillDailyBuckets(): Mongo's $group only returns days that HAD signups, so
// the "last 30 days" chart drew evenly spaced bars for whatever days existed
// and its axis lied. This returns exactly one bucket per UTC day (zeros
// included), oldest first, matching $dateToString's UTC '%Y-%m-%d' keys.

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// buckets: [{ _id: 'YYYY-MM-DD', count }] in any order; days ≥ 1.
// → [{ _id, count }] × days, ending today (UTC).
function fillDailyBuckets(buckets, days, now = Date.now()) {
  const n = Math.max(1, Math.min(366, Math.floor(days) || 1));
  const counts = new Map();
  for (const b of buckets || []) {
    if (b && typeof b._id === 'string') counts.set(b._id, (counts.get(b._id) || 0) + (Number(b.count) || 0));
  }
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = utcDay(now - i * DAY_MS);
    out.push({ _id: key, count: counts.get(key) || 0 });
  }
  return out;
}

module.exports = { fillDailyBuckets, utcDay };
