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

// /home playground character. Server-side validation must mirror the option
// counts defined client-side in js/playground.js. Bumping any of these maxes
// requires updating BOTH places. Returns null fields when the user has never
// saved — the client treats that as "open the builder modal".
//
// PUT is a partial update: any key that is missing from the body is left
// untouched in Mongo, so older clients (and progressive new-field rollouts)
// don't 400 just for not knowing about a slot. A key that IS present must
// validate or the whole request 400s.
const HOME_CHARACTER_RANGES = {
  skin:            { max: 12 },   // 12 = Hulk green (added for Avengers presets)
  hairStyle:       { max: 13 },
  hairColor:       { max: 13 },
  shirtColor:      { max: 15 },
  pantsColor:      { max: 15 },
  eyeColor:        { max: 7 },
  eyeShape:        { max: 4 },
  facialHairStyle: { max: 5 },
  facialHairColor: { max: 13 },
  glasses:         { max: 4 },
  hat:             { max: 4 },
  shoeColor:       { max: 7 },
  build:           { max: 3 },    // body size/bulk
  gear:            { max: 6 }     // hero gear set (0 = none)
};

function pickInt(value, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const v = Math.floor(value);
  if (v < 0 || v > max) return null;
  return v;
}

router.get('/home-character', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('homeCharacter').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ homeCharacter: user.homeCharacter || null });
});

router.put('/home-character', auth, async (req, res) => {
  const body = req.body || {};
  const update = {};
  const errors = {};
  for (const [key, rule] of Object.entries(HOME_CHARACTER_RANGES)) {
    if (!(key in body)) continue;          // partial update — skip missing keys
    const v = pickInt(body[key], rule.max);
    if (v === null) {
      errors[key] = `must be an integer 0..${rule.max}`;
    } else {
      update['homeCharacter.' + key] = v;
    }
  }
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', fields: errors });
  }
  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'No valid fields supplied' });
  }
  const user = await User.findByIdAndUpdate(
    req.user.id,
    { $set: update },
    { new: true, projection: { homeCharacter: 1 } }
  ).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ homeCharacter: user.homeCharacter });
});

// /home room layout. Each room is a 1×1 grid cell {projectId, gx, gy}. The
// cap is floor(user.watchedProjects.length / 2) — every 2 watched projects
// unlocks a slot. We also enforce: every projectId must be in the user's
// watchedProjects, no two rooms share a (gx,gy), grid coords are clamped,
// and (when 2+ rooms) the layout is one connected component.
const GRID_LIMIT = 32; // |gx|, |gy| max — bounds growth to a sane region.

function isLayoutConnected(rooms) {
  if (rooms.length <= 1) return true;
  const set = new Set(rooms.map(r => `${r.gx},${r.gy}`));
  const seen = new Set([`${rooms[0].gx},${rooms[0].gy}`]);
  const queue = [rooms[0]];
  while (queue.length) {
    const r = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${r.gx + dx},${r.gy + dy}`;
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        queue.push({ gx: r.gx + dx, gy: r.gy + dy });
      }
    }
  }
  return seen.size === rooms.length;
}

router.get('/home-layout', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('homeLayout watchedProjects').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const watchedIds = (user.watchedProjects || []).map(e => e.projectId);
  res.json({
    homeLayout: user.homeLayout || { rooms: [] },
    maxRooms: Math.floor(watchedIds.length / 2),
    watchedCount: watchedIds.length,
    watchedIds
  });
});

router.put('/home-layout', auth, async (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.rooms)) {
    return res.status(400).json({ error: 'rooms must be an array' });
  }

  // Shape check + integer coercion.
  const rooms = [];
  for (const r of body.rooms) {
    if (!r || typeof r.projectId !== 'string' || r.projectId.length === 0 || r.projectId.length > 64) {
      return res.status(400).json({ error: 'each room needs a non-empty projectId string' });
    }
    const gx = pickInt(r.gx, GRID_LIMIT);
    const gy = pickInt(r.gy, GRID_LIMIT);
    // pickInt rejects negatives; allow ±GRID_LIMIT by checking bounds directly.
    if (typeof r.gx !== 'number' || !Number.isFinite(r.gx) || Math.abs(r.gx) > GRID_LIMIT ||
        typeof r.gy !== 'number' || !Number.isFinite(r.gy) || Math.abs(r.gy) > GRID_LIMIT) {
      return res.status(400).json({ error: `grid coords must be integers within ±${GRID_LIMIT}` });
    }
    rooms.push({ projectId: r.projectId, gx: Math.floor(r.gx), gy: Math.floor(r.gy) });
  }

  // No duplicate cells, no duplicate projectIds.
  const cellSet = new Set();
  const idSet = new Set();
  for (const r of rooms) {
    const k = `${r.gx},${r.gy}`;
    if (cellSet.has(k)) return res.status(400).json({ error: `two rooms share grid cell (${r.gx}, ${r.gy})` });
    cellSet.add(k);
    if (idSet.has(r.projectId)) return res.status(400).json({ error: `project ${r.projectId} appears twice` });
    idSet.add(r.projectId);
  }

  // Per-user gating: count + projectId membership.
  const user = await User.findById(req.user.id).select('watchedProjects').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const watchedIds = new Set((user.watchedProjects || []).map(e => e.projectId));
  const maxRooms = Math.floor(watchedIds.size / 2);
  if (rooms.length > maxRooms) {
    return res.status(400).json({ error: `rooms.length (${rooms.length}) exceeds allowed (${maxRooms})` });
  }
  for (const r of rooms) {
    if (!watchedIds.has(r.projectId)) {
      return res.status(400).json({ error: `project ${r.projectId} is not in your watched list` });
    }
  }

  // Connectivity (BFS).
  if (!isLayoutConnected(rooms)) {
    return res.status(400).json({ error: 'layout is not connected — every room must be reachable from every other' });
  }

  const updated = await User.findByIdAndUpdate(
    req.user.id,
    { $set: { 'homeLayout.rooms': rooms } },
    { new: true, projection: { homeLayout: 1 } }
  ).lean();
  if (!updated) return res.status(404).json({ error: 'User not found' });
  res.json({ homeLayout: updated.homeLayout });
});

module.exports = router;
