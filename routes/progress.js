const express = require('express');
const router = express.Router();
const User = require('../models/user');
const auth = require('../middleware/auth');

// Load progress
router.get('/load', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({ watchedProjects: user.watchedProjects });
});

// Strip incoming watched-project entries to known-safe primitives so a
// malicious client can't cram arbitrary nested objects, other users'
// usernames, or unbounded memory lists into a doc.
const MAX_WATCHED_PROJECTS = 200;
const MAX_MEMORIES_PER_ENTRY = 40;
const MAX_URL_LEN = 512;
const MAX_CAPTION_LEN = 280;

function sanitizeEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (typeof e.projectId !== 'string' || e.projectId.length === 0 || e.projectId.length > 80) return null;
  const count = Number.isFinite(e.count) ? Math.max(1, Math.min(Math.floor(e.count), 9999)) : 1;
  const watchedWith = Array.isArray(e.watchedWith)
    ? e.watchedWith.filter(v => typeof v === 'string' && v.length <= 40).slice(0, 20)
    : [];
  const memories = Array.isArray(e.memories)
    ? e.memories.map(sanitizeMemory).filter(Boolean).slice(0, MAX_MEMORIES_PER_ENTRY)
    : [];
  return { projectId: e.projectId, count, watchedWith, memories };
}

// Memory URLs must point at our own Cloudinary cloud — matches the profile
// picture whitelist. An attacker who can POST a memory should not be able to
// embed arbitrary tracker/phishing URLs into the viewer's page. A protocol-
// only check (https?://…) was not sufficient.
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_PREFIX = CLOUD_NAME ? `https://res.cloudinary.com/${CLOUD_NAME}/` : '';

function sanitizeMemory(m) {
  if (!m || typeof m !== 'object') return null;
  if (typeof m.url !== 'string' || m.url.length === 0 || m.url.length > MAX_URL_LEN) return null;
  if (!CLOUDINARY_PREFIX || !m.url.startsWith(CLOUDINARY_PREFIX)) return null;
  const type = (m.type === 'video' || m.type === 'image') ? m.type : 'image';
  const caption = typeof m.caption === 'string' ? m.caption.slice(0, MAX_CAPTION_LEN) : '';
  return { url: m.url, type, caption };
}

// Save full progress
router.post('/save', auth, async (req, res) => {
  const { watchedProjects } = req.body || {};
  if (!Array.isArray(watchedProjects)) return res.status(400).json({ error: 'watchedProjects must be an array' });
  const clean = watchedProjects
    .slice(0, MAX_WATCHED_PROJECTS)
    .map(sanitizeEntry)
    .filter(Boolean);
  await User.findByIdAndUpdate(req.user.id, { watchedProjects: clean });
  res.json({ message: 'Saved' });
});

// Increment watch count for a project.
// Uses atomic $inc so rapid concurrent clicks can't read-modify-write stale
// counts — the previous load/mutate/save pattern lost increments under load.
router.post('/watch', auth, async (req, res) => {
  const { projectId } = req.body || {};
  if (typeof projectId !== 'string' || projectId.length === 0 || projectId.length > 80) {
    return res.status(400).json({ error: 'Invalid projectId' });
  }

  // Fast path: entry exists and count is below the cap — increment atomically.
  const incremented = await User.findOneAndUpdate(
    {
      _id: req.user.id,
      watchedProjects: { $elemMatch: { projectId, count: { $lt: 9999 } } }
    },
    { $inc: { 'watchedProjects.$.count': 1 } },
    { new: true, projection: { watchedProjects: 1 } }
  );
  if (incremented) return res.json({ watchedProjects: incremented.watchedProjects });

  // Either the entry doesn't exist yet, or it's already capped at 9999.
  // Try to push a new entry atomically — guarded by $ne so two parallel
  // requests can't both push duplicate entries for the same projectId,
  // and $expr enforces the per-user cap.
  const pushed = await User.findOneAndUpdate(
    {
      _id: req.user.id,
      'watchedProjects.projectId': { $ne: projectId },
      $expr: { $lt: [{ $size: { $ifNull: ['$watchedProjects', []] } }, MAX_WATCHED_PROJECTS] }
    },
    { $push: { watchedProjects: { projectId, count: 1, watchedWith: [], memories: [] } } },
    { new: true, projection: { watchedProjects: 1 } }
  );
  if (pushed) return res.json({ watchedProjects: pushed.watchedProjects });

  // Fell through: entry exists and is capped, OR user is at the project cap.
  // Re-fetch to distinguish — either way return current state so the client
  // can reconcile without another round trip.
  const user = await User.findById(req.user.id, { watchedProjects: 1 });
  if (!user) return res.status(404).json({ error: 'User not found' });
  const exists = user.watchedProjects.some(e => e.projectId === projectId);
  if (!exists && user.watchedProjects.length >= MAX_WATCHED_PROJECTS) {
    return res.status(400).json({ error: 'Watched-project cap reached' });
  }
  res.json({ watchedProjects: user.watchedProjects });
});

// Add a memory to a project
router.post('/memory', auth, async (req, res) => {
  const { projectId } = req.body || {};
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return res.status(400).json({ error: 'Invalid projectId' });
  }
  const memory = sanitizeMemory(req.body);
  if (!memory) return res.status(400).json({ error: 'Invalid memory payload (Cloudinary URL required)' });
  const user = await User.findById(req.user.id);
  const entry = user.watchedProjects.find(e => e.projectId === projectId);
  if (!entry) return res.status(404).json({ error: 'Project not watched yet' });
  if (entry.memories.length >= MAX_MEMORIES_PER_ENTRY) {
    return res.status(400).json({ error: 'Memory cap reached for this project' });
  }
  entry.memories.push(memory);
  await user.save();
  res.json({ memories: entry.memories });
});

// Delete a memory
router.delete('/memory', auth, async (req, res) => {
  const { projectId, url } = req.body;
  const user = await User.findById(req.user.id);
  const entry = user.watchedProjects.find(e => e.projectId === projectId);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  entry.memories = entry.memories.filter(m => m.url !== url);
  await user.save();
  res.json({ message: 'Deleted' });
});

// Load walker selections
router.get('/walkers', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({ walkers: user.walkers || [] });
});

// Save walker selections
router.post('/walkers', auth, async (req, res) => {
  const { walkers } = req.body;
  if (!Array.isArray(walkers)) return res.status(400).json({ error: 'walkers must be an array' });
  // Cap at 200 entries, accept strings or { id, stage } objects
  const clean = walkers.slice(0, 200).filter(w =>
    typeof w === 'string' || (w && typeof w.id === 'string')
  );
  await User.findByIdAndUpdate(req.user.id, { walkers: clean });
  res.json({ message: 'Saved' });
});

// NOTE: the Infinity Stone hunt is no longer a daily per-player REST feature.
// It's now a live shared PvP contest in the 'world' socket room — stone
// ownership + the snap live in routes/world-socket.js, and the lifetime
// snap-count leaderboard is served by GET /api/friends/stones.

module.exports = router;