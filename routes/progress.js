const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/user');

// Middleware to verify token
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

// Save progress
router.post('/save', auth, async (req, res) => {
  const { watchedProjects } = req.body;
  await User.findByIdAndUpdate(req.user.id, { watchedProjects });
  res.json({ message: 'Progress saved' });
});

// Load progress
router.get('/load', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({ watchedProjects: user.watchedProjects });
});

module.exports = router;