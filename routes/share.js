const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/user');
const auth = require('../middleware/auth');
const Share = require('../server/share');
const ShareLogic = require('../js/share-logic');

// Doomsday story share (server/share.js has the overview).
//   GET    /api/share/me             my link: { enabled, token, joins }
//   POST   /api/share/me             turn it on (mints a token once) → same shape
//   DELETE /api/share/me             turn it off (token deleted; old stories go dead)
//   GET    /api/share/public/:token  no auth — the share page's data

function linkPayload(user) {
  const token = (user && user.shareToken) || null;
  return { enabled: !!token, token, joins: (user && user.shareJoins) || 0 };
}

router.get('/me', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('shareToken shareJoins').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(linkPayload(user));
});

router.post('/me', auth, async (req, res) => {
  // Only ever SET a token where there is none, so two tabs sharing at once
  // agree on one link. A unique-index clash (72 random bits — practically
  // never) just tries another.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await User.updateOne(
        { _id: req.user.id, shareToken: { $exists: false } },
        { $set: { shareToken: ShareLogic.newToken(crypto.randomBytes) } }
      );
      break;
    } catch (e) {
      if (!(e && e.code === 11000) || attempt === 2) throw e;
    }
  }
  const user = await User.findById(req.user.id).select('shareToken shareJoins').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(linkPayload(user));
});

router.delete('/me', auth, async (req, res) => {
  await User.updateOne({ _id: req.user.id }, { $unset: { shareToken: 1 } });
  const user = await User.findById(req.user.id).select('shareToken shareJoins').lean();
  res.json(linkPayload(user));
});

router.get('/public/:token', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const user = await Share.findSharer(String(req.params.token || ''));
  // One answer for "never existed", "turned off" and "banned".
  if (!user) return res.status(404).json({ error: 'This link is no longer shared' });
  res.json(Share.publicPayload(user));
});

module.exports = router;
