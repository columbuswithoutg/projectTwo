/************************************************
 * server/username.js — one place for username lookups.
 *
 * Usernames are unique case-insensitively ("bob" and "Bob" are the same
 * account), but the unique index on `username` is case-sensitive, so every
 * lookup used to run a case-insensitive `^name$` regex — which cannot use
 * the index and scans the whole collection (login, register, whispers, DMs).
 *
 * `usernameLower` (models/user.js, unique + sparse) fixes that. New accounts
 * get it from a pre-validate hook; old ones get it from
 * scripts/backfill-username-lower.js, or heal themselves here the first
 * time a lookup finds them through the fallback queries. Until the
 * collection is fully backfilled (isReady()), the regex stays as the last
 * fallback so no existing account is ever locked out.
 *
 * Pure helpers (lookupQueries, searchFilter, lowerName, escapeRegex) are
 * unit-tested in test/username.test.js; the Mongo-touching ones below use
 * the User model from models/user.js.
 ************************************************/
const User = require('../models/user');

const MAX_LEN = 40;
const READY_POLL_MS = 10 * 60 * 1000;

function lowerName(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

// Escape regex metacharacters so a name can't become ".*" (dump everyone)
// or "(a+)+$" (catastrophic backtracking).
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The queries to try, in order, to find ONE user by name. The regex is only
// included while the collection isn't fully backfilled.
function lookupQueries(name, ready) {
  const clean = String(name == null ? '' : name).trim();
  if (!clean || clean.length > MAX_LEN) return [];
  const queries = [{ usernameLower: clean.toLowerCase() }, { username: clean }];
  if (!ready) queries.push({ username: { $regex: '^' + escapeRegex(clean) + '$', $options: 'i' } });
  return queries;
}

// Filter for the friend search: a case-insensitive PREFIX match (anchored,
// so it can use the usernameLower index once ready), at least 2 characters.
// Returns null when there is nothing worth searching for.
function searchFilter(q, ready, excludeId) {
  const clean = String(q == null ? '' : q).trim();
  if (clean.length < 2 || clean.length > MAX_LEN) return null;
  const filter = ready
    ? { usernameLower: { $regex: '^' + escapeRegex(clean.toLowerCase()) } }
    : { username: { $regex: '^' + escapeRegex(clean), $options: 'i' } };
  if (excludeId) filter._id = { $ne: excludeId };
  return filter;
}

// ── Readiness: true once every user has usernameLower (or is a known conflict) ──
let _ready = false;
let _timer = null;
function isReady() { return _ready; }
function setReady(v) { _ready = !!v; }     // tests

async function refreshReady() {
  try {
    const missing = await User.exists({ usernameLower: { $exists: false }, usernameLowerConflict: { $ne: true } });
    _ready = !missing;
  } catch (_) { /* keep the previous answer */ }
  if (_ready && _timer) { clearInterval(_timer); _timer = null; }
}

// Called once at boot (server.js) after Mongo connects. Polls until the
// backfill is complete, then stops itself.
function startReadinessPoll(intervalMs = READY_POLL_MS) {
  refreshReady();
  if (_timer) clearInterval(_timer);
  _timer = setInterval(refreshReady, intervalMs);
  if (_timer.unref) _timer.unref();
}

// Write usernameLower onto a user found through a fallback query. Fire and
// forget; a duplicate key (two legacy accounts differing only by case) is
// left for the backfill script to report.
function heal(doc) {
  User.updateOne(
    { _id: doc._id, usernameLower: { $exists: false } },
    { $set: { usernameLower: lowerName(doc.username) } }
  ).catch(() => {});
}

// → lean user doc or null. `select` limits the fields (usernameLower is
// always added so the heal check works).
async function findByUsername(name, select) {
  const queries = lookupQueries(name, _ready);
  for (let i = 0; i < queries.length; i++) {
    let q = User.findOne(queries[i]);
    if (select) q = q.select(select + ' usernameLower');
    const doc = await q.lean();
    if (!doc) continue;
    if (i > 0 && !doc.usernameLower) heal(doc);
    return doc;
  }
  return null;
}

async function exists(name) {
  return !!(await findByUsername(name, '_id'));
}

module.exports = {
  MAX_LEN, lowerName, escapeRegex, lookupQueries, searchFilter,
  isReady, setReady, refreshReady, startReadinessPoll, findByUsername, exists
};
