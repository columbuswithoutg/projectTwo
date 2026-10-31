const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user');
const auth = require('../middleware/auth');
const Username = require('../server/username');
const { passwordError, hashPassword, needsRehash, dummyHash, PASSWORD_MAX_BYTES } = require('../server/password');
const Share = require('../server/share');
const ShareLogic = require('../js/share-logic');
const MessagingLogic = require('../js/messaging-logic');

// Username: 3–30 chars, letters/digits/underscore/dash. Rejects NoSQL operator objects.
// Password: server/password.js (8 chars … 72 bytes — bcrypt ignores anything
// past 72 bytes, so a longer cap only pretended to be stricter).
function validateCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') {
    return 'Username and password must be strings';
  }
  // Shared with the "Change my username" request (js/messaging-logic.js).
  return MessagingLogic.usernameError(username) || passwordError(password);
}

router.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  const err = validateCredentials(username, password);
  if (err) return res.status(400).json({ error: err });
  try {
    // Usernames are unique case-insensitively ("bob" can't register next to
    // "Bob"). server/username.js checks usernameLower first (indexed) and
    // falls back to the exact / case-insensitive forms for accounts that
    // predate the field.
    const clean = username.trim();
    if (await Username.exists(clean)) return res.status(400).json({ error: 'Username already exists' });
    const hashed = await hashPassword(password);
    const created = await User.create({ username: clean, password: hashed });   // the model fills usernameLower
    // Signed up from someone's Doomsday share page ("Start your own"): ask
    // them to be friends. Best effort — the account exists either way.
    let referredBy = null;
    if (ShareLogic.isToken(req.body.ref)) {
      referredBy = await Share.creditReferral(created._id, req.body.ref).catch(err => {
        console.error('Register referral error:', err && err.message);
        return null;
      });
    }
    res.json({ message: 'User created', referredBy });
  } catch (e) {
    // Distinguish duplicate-key from real errors — previously every failure
    // was reported as "username exists", which masked server-side outages.
    if (e && e.code === 11000) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    console.error('Register error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Invalid credentials' });
  }
  const name = username.trim().slice(0, Username.MAX_LEN);
  const user = await Username.findByUsername(name);
  // ALWAYS run one bcrypt compare. Skipping it for an unknown name used to
  // answer in ~1 ms instead of ~300 ms, which told a caller which usernames
  // exist without ever getting a password right.
  const ok = await bcrypt.compare(password, user ? user.password : await dummyHash());
  if (!user || !ok) return res.status(401).json({ error: 'Invalid credentials' });
  // Banned users can authenticate with the right password but receive no
  // token — surfaces a clear message instead of silently failing the next
  // protected call with a confusing 401.
  if (user.banned) {
    return res.status(403).json({
      error: 'Account suspended',
      reason: user.banReason || ''
    });
  }

  // Quietly upgrade an old cost-10 hash to the current cost while we still
  // have the plaintext. Guarded on the stored hash so it can't race a reset.
  if (needsRehash(user.password) && Buffer.byteLength(password, 'utf8') <= PASSWORD_MAX_BYTES) {
    hashPassword(password)
      .then(h => User.updateOne({ _id: user._id, password: user.password }, { $set: { password: h } }))
      .catch(() => {});
  }

  // tokenVersion is bumped on ban; auth middleware rejects mismatched JWTs
  // so a banned user's existing browser tabs lose access on the next call.
  // isAdmin is included so the SPA can render the /admin link without a
  // round trip; the actual admin gate is enforced server-side by
  // requireAdmin (which re-fetches the user — a JWT claim alone can be
  // stale up to 7 days after demotion).
  const token = jwt.sign(
    { id: user._id, isAdmin: !!user.isAdmin, tv: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({
    token,
    username: user.username,
    watchedProjects: user.watchedProjects,
    isAdmin: !!user.isAdmin
  });
});

// Change your own password while signed in: the current one is required.
// Every other session is signed out (tokenVersion bump) and this one gets
// a fresh token so the user stays signed in here.
router.post('/password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || !currentPassword) {
    return res.status(400).json({ error: 'Enter your current password', field: 'current' });
  }
  const pwErr = passwordError(newPassword);
  if (pwErr) return res.status(400).json({ error: pwErr, field: 'new' });
  const user = await User.findById(req.user.id).select('password tokenVersion isAdmin').lean();
  if (!user) return res.status(401).json({ error: 'Invalid token' });
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    return res.status(400).json({ error: 'Your current password is wrong', field: 'current' });
  }
  if (await bcrypt.compare(newPassword, user.password)) {
    return res.status(400).json({ error: 'Pick a password different from your current one', field: 'new' });
  }
  const hashed = await hashPassword(newPassword);
  // Guarded on the hash we checked, so two changes at once can't both win.
  const updated = await User.findOneAndUpdate(
    { _id: user._id, password: user.password },
    { $set: { password: hashed }, $inc: { tokenVersion: 1 } },
    { returnDocument: 'after', projection: { tokenVersion: 1, isAdmin: 1 } }
  ).lean();
  if (!updated) return res.status(409).json({ error: 'Your password just changed somewhere else — sign in again' });
  auth.invalidateUser(req.user.id);
  const token = jwt.sign(
    { id: updated._id, isAdmin: !!updated.isAdmin, tv: updated.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({ ok: true, token });
});

// Log out EVERYWHERE: bumping tokenVersion makes every JWT this user holds
// (this tab, other tabs, other devices) fail the middleware's version
// check, and invalidateUser drops the 30 s validation cache entry plus any
// live /world or /home socket. The client calls this fire-and-forget from
// Auth.logout() and clears its own token regardless of the answer.
router.post('/logout', auth, async (req, res) => {
  try {
    await User.updateOne({ _id: req.user.id }, { $inc: { tokenVersion: 1 } });
  } catch (e) {
    console.error('Logout error:', e && e.message);
    return res.status(500).json({ error: 'Server error' });
  }
  auth.invalidateUser(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
