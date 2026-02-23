const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/user');

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Load progress
router.get('/load', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({ watchedProjects: user.watchedProjects });
});

// Save full progress
router.post('/save', auth, async (req, res) => {
  const { watchedProjects } = req.body;
  await User.findByIdAndUpdate(req.user.id, { watchedProjects });
  res.json({ message: 'Saved' });
});

// Increment watch count for a project
router.post('/watch', auth, async (req, res) => {
  const { projectId } = req.body;
  const user = await User.findById(req.user.id);
  const entry = user.watchedProjects.find(e => e.projectId === projectId);
  if (entry) {
    entry.count += 1;
  } else {
    user.watchedProjects.push({ projectId, count: 1 });
  }
  await user.save();
  res.json({ watchedProjects: user.watchedProjects });
});

// Add a memory to a project
router.post('/memory', auth, async (req, res) => {
  const { projectId, url, type, caption } = req.body;
  const user = await User.findById(req.user.id);
  const entry = user.watchedProjects.find(e => e.projectId === projectId);
  if (!entry) return res.status(404).json({ error: 'Project not watched yet' });
  entry.memories.push({ url, type, caption });
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

module.exports = router;