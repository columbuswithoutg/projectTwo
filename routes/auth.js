const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user');

// Username: 3–30 chars, letters/digits/underscore/dash. Rejects NoSQL operator objects.
// Password: 8–128 chars. Rejects empty strings, non-strings, and coerced objects.
function validateCredentials(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') {
    return 'Username and password must be strings';
  }
  const u = username.trim();
  if (u.length < 3 || u.length > 30) return 'Username must be 3–30 characters';
  if (!/^[a-zA-Z0-9_-]+$/.test(u)) return 'Username can only contain letters, numbers, _ or -';
  if (password.length < 8 || password.length > 128) return 'Password must be 8–128 characters';
  return null;
}

router.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  const err = validateCredentials(username, password);
  if (err) return res.status(400).json({ error: err });
  try {
    const hashed = await bcrypt.hash(password, 10);
    await User.create({ username: username.trim(), password: hashed });
    res.json({ message: 'User created' });
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
  const user = await User.findOne({ username: username.trim() });
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ error: 'Invalid credentials' });
  // Banned users can authenticate with the right password but receive no
  // token — surfaces a clear message instead of silently failing the next
  // protected call with a confusing 401.
  if (user.banned) {
    return res.status(403).json({
      error: 'Account suspended',
      reason: user.banReason || ''
    });
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

module.exports = router;
