/************************************************
 * server/password.js — password rules shared by register (routes/auth.js)
 * and the admin reset (routes/admin.js).
 *
 * bcrypt only hashes the first 72 BYTES of a password and silently ignores
 * the rest, so the old "8–128 characters" rule let a 100-character password
 * be matched by its first 72 bytes. The cap is now 72 bytes (multi-byte
 * characters count by their UTF-8 size). Existing accounts are untouched:
 * login never applies this rule, only register and reset do.
 *
 * BCRYPT_COST 12 (was 10): ~4× the work per hash, which only the auth rate
 * limiter's 20 attempts / 15 min can trigger. needsRehash() lets login
 * upgrade an old cost-10 hash the next time the user signs in.
 *
 * dummyHash() is what login compares against when the username does not
 * exist, so a miss costs the same bcrypt time as a wrong password and the
 * response time no longer says which usernames are taken.
 ************************************************/
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const BCRYPT_COST = 12;
const PASSWORD_MIN = 8;
const PASSWORD_MAX_BYTES = 72;

// → null when acceptable, otherwise the message to show the user.
function passwordError(pw) {
  if (typeof pw !== 'string') return 'Password must be a string';
  if (pw.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters`;
  if (Buffer.byteLength(pw, 'utf8') > PASSWORD_MAX_BYTES) {
    return `Password is too long (max ${PASSWORD_MAX_BYTES} characters)`;
  }
  return null;
}

function hashPassword(pw) {
  return bcrypt.hash(pw, BCRYPT_COST);
}

// True for a hash made with fewer rounds than BCRYPT_COST (or an unreadable one).
function needsRehash(hash) {
  try { return bcrypt.getRounds(hash) < BCRYPT_COST; } catch (_) { return false; }
}

// One hash of random bytes, reused for every "no such user" login so the
// compare takes real bcrypt time. Started at load (not awaited, so boot
// never waits on it): made on demand, the FIRST unknown-user login paid for
// hashing AND comparing, twice the time of a wrong password — the very
// difference this exists to hide.
let _dummy = null;
function dummyHash() {
  if (!_dummy) _dummy = bcrypt.hash(crypto.randomBytes(16).toString('hex'), BCRYPT_COST);
  return _dummy;
}
dummyHash().catch(() => { _dummy = null; });

module.exports = { BCRYPT_COST, PASSWORD_MIN, PASSWORD_MAX_BYTES, passwordError, hashPassword, needsRehash, dummyHash };
