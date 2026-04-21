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

function sanitizeMemory(m) {
  if (!m || typeof m !== 'object') return null;
  if (typeof m.url !== 'string' || m.url.length === 0 || m.url.length > MAX_URL_LEN) return null;
  if (!/^https?:\/\//i.test(m.url)) return null;
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

// Increment watch count for a project
router.post('/watch', auth, async (req, res) => {
  const { projectId } = req.body || {};
  if (typeof projectId !== 'string' || projectId.length === 0 || projectId.length > 80) {
    return res.status(400).json({ error: 'Invalid projectId' });
  }
  const user = await User.findById(req.user.id);
  const entry = user.watchedProjects.find(e => e.projectId === projectId);
  if (entry) {
    entry.count = Math.min((entry.count || 0) + 1, 9999);
  } else {
    if (user.watchedProjects.length >= MAX_WATCHED_PROJECTS) {
      return res.status(400).json({ error: 'Watched-project cap reached' });
    }
    user.watchedProjects.push({ projectId, count: 1 });
  }
  await user.save();
  res.json({ watchedProjects: user.watchedProjects });
});

// Add a memory to a project
router.post('/memory', auth, async (req, res) => {
  const { projectId } = req.body || {};
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return res.status(400).json({ error: 'Invalid projectId' });
  }
  const memory = sanitizeMemory(req.body);
  if (!memory) return res.status(400).json({ error: 'Invalid memory payload (http/https URL required)' });
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

module.exports = router;