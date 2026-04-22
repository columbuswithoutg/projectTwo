const express = require('express');
const router = express.Router();
const User = require('../models/user');
const auth = require('../middleware/auth');

// GET /api/profile — returns stats + profilePicture
router.get('/', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const watched = user.watchedProjects;
  const totalWatched = watched.length;
  const totalSessions = watched.reduce((sum, e) => sum + e.count, 0);
  const totalMemories = watched.reduce((sum, e) => sum + e.memories.length, 0);

  // Most frequent co-watcher
  const coWatchCounts = {};
  watched.forEach(e => {
    (e.watchedWith || []).forEach(name => {
      coWatchCounts[name] = (coWatchCounts[name] || 0) + 1;
    });
  });
  const topCoWatcher = Object.entries(coWatchCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  res.json({
    username: user.username,
    profilePicture: user.profilePicture || '',
    stats: {
      totalWatched,
      totalSessions,
      totalMemories,
      topCoWatcher
    }
  });
});

// Whitelist of acceptable profile-picture sources:
//   - relative path into the bundled character art (assets/characters/…)
//   - https URL on our Cloudinary cloud (signed in upload route)
// Blocks javascript: URIs, data: URIs, and arbitrary attacker-controlled URLs.
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
function validProfilePictureUrl(url) {
  if (typeof url !== 'string') return false;
  if (url.length > 512) return false;
  if (/^assets\/characters\/[\w.\-]+$/.test(url)) return true;
  if (CLOUD_NAME) {
    const prefix = `https://res.cloudinary.com/${CLOUD_NAME}/`;
    if (url.startsWith(prefix)) return true;
  }
  return false;
}

// POST /api/profile/picture — update profile picture
router.post('/picture', auth, async (req, res) => {
  const { profilePicture } = req.body;
  if (!profilePicture) return res.status(400).json({ error: 'No picture provided' });
  if (!validProfilePictureUrl(profilePicture))
    return res.status(400).json({ error: 'Invalid picture URL' });
  await User.findByIdAndUpdate(req.user.id, { profilePicture });
  res.json({ profilePicture });
});

module.exports = router;
