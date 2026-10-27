const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Character = require('../models/Character');
const contentLoader = require('../server/contentLoader');
const auth = require('../middleware/auth');
const HouseLogic = require('../js/world-house-logic');
const House = require('../server/house');
const WorldSocket = require('./world-socket');
const { validateCharacterUpdate } = require('../server/character');

// GET /api/profile — returns stats + profilePicture
router.get('/', auth, async (req, res) => {
  // Only what the four counters read (memories.url just keeps one small
  // field per memory so the array length survives the projection), lean —
  // this used to hydrate the whole user document, homes and all.
  const user = await User.findById(req.user.id)
    .select('username profilePicture watchedProjects.count watchedProjects.memories.url watchedProjects.watchedWith')
    .lean();
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Lean skips schema defaults, so apply the two the sums relied on
  // (count: 1, memories: []).
  const watched = user.watchedProjects || [];
  const totalWatched = watched.length;
  const totalSessions = watched.reduce((sum, e) => sum + (e.count ?? 1), 0);
  const totalMemories = watched.reduce((sum, e) => sum + (e.memories || []).length, 0);

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

// Accepted profile-picture sources: House.validProfilePictureUrl
// (server/house.js — bundled character art or this app's own uploads).

// Character portraits the picker can offer: image file → what unlocks it.
// A character's base image needs its debut watched; an alternate look
// (stage) needs only its `after` project — the same rule as getCharStages in
// characters.js, so Deadpool & Wolverine alone offers yellow-suit Wolverine
// without X-Men (2000). Same source as /api/content
// (Mongo, else characters.js), cached briefly.
let _charImages = null;
let _charImagesAt = 0;
async function characterImages() {
  if (_charImages && Date.now() - _charImagesAt < 60000) return _charImages;
  let list = null;
  try {
    const docs = await Character.find({}).select('debut image stages').lean();
    if (docs.length) list = docs;
  } catch (_) { /* fall back to the static file */ }
  const map = new Map();
  for (const c of list || contentLoader.get('characters')) {
    if (c.image) map.set(c.image, { needs: [c.debut] });
    for (const s of c.stages || []) if (s.image) map.set(s.image, { needs: [s.after] });
  }
  _charImages = map;
  _charImagesAt = Date.now();
  return map;
}

// Why a character portrait can't be used, or null if it can. Uploaded
// (Cloudinary) photos aren't character portraits and always pass here.
async function characterPictureError(url, userId) {
  const m = /^assets\/characters\/([\w.\-]+)$/.exec(url);
  if (!m) return null;
  const rule = (await characterImages()).get(m[1]);
  if (!rule) return 'Unknown character picture';
  const u = await User.findById(userId).select('watchedProjects.projectId').lean();
  const watched = new Set(((u && u.watchedProjects) || []).map(e => e.projectId));
  return rule.needs.every(id => id && watched.has(id)) ? null : 'Watch more to unlock that character';
}

// POST /api/profile/picture — update profile picture
router.post('/picture', auth, async (req, res) => {
  const { profilePicture } = req.body || {};
  if (!profilePicture) return res.status(400).json({ error: 'No picture provided' });
  if (!House.validProfilePictureUrl(profilePicture))
    return res.status(400).json({ error: 'Invalid picture URL' });
  const locked = await characterPictureError(profilePicture, req.user.id);
  if (locked) return res.status(400).json({ error: locked });
  await User.findByIdAndUpdate(req.user.id, { profilePicture });
  res.json({ profilePicture });
});

// /home playground character. The slot ranges (and the partial-update
// validation) live in server/character.js — shared with the socket layer,
// which re-broadcasts characters to other players. Returns null fields when
// the user has never saved — the client treats that as "open the builder".
//
// PUT is a partial update: any key that is missing from the body is left
// untouched in Mongo, so older clients (and progressive new-field rollouts)
// don't 400 just for not knowing about a slot. A key that IS present must
// validate or the whole request 400s.
router.get('/home-character', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('homeCharacter').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ homeCharacter: user.homeCharacter || null });
});

router.put('/home-character', auth, async (req, res) => {
  const { update, errors } = validateCharacterUpdate(req.body);
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', fields: errors });
  }
  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'No valid fields supplied' });
  }
  const user = await User.findByIdAndUpdate(
    req.user.id,
    { $set: update },
    { returnDocument: 'after', projection: { homeCharacter: 1 } }
  ).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ homeCharacter: user.homeCharacter });
});

// /home room layout. Each room is a 1×1 grid cell {projectId, gx, gy}. The
// cap is floor(user.watchedProjects.length / 2) — every 2 watched projects
// unlocks a slot. We also enforce: every projectId must be in the user's
// watchedProjects, no two rooms share a (gx,gy), grid coords are clamped,
// and (when 2+ rooms) the layout is one connected component. The pure
// checks (shape, integer coords within House.HOME_GRID_LIMIT, duplicates,
// connectivity, the cap) live in server/house.js, unit-tested in
// test/home-house.test.js.

router.get('/home-layout', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('homeLayout watchedProjects homeHouses homeRoof').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const watchedIds = (user.watchedProjects || []).map(e => e.projectId);
    // Within today's cap (the old Clear Progress could leave a stored layout over it).
    const homeLayout = House.effectiveLayout(user.homeLayout, watchedIds);
    res.json({
      homeLayout,
      maxRooms: Math.floor(watchedIds.length / 2),
      watchedCount: watchedIds.length,
      watchedIds,
      homeHouses: House.housesForRooms(user.homeHouses, homeLayout.rooms),
      homeRoof: House.homeRoofFor(user, homeLayout.rooms),
      houseMaxProps: await House.homeMaxPropsNow()
    });
  } catch (err) {
    console.error('[profile] GET /home-layout failed:', err);
    res.status(500).json({ error: 'Could not load your home' });
  }
});

// Save the decoration of one of your own /home rooms. Owner-only by
// construction: it only ever writes the caller's own document. Its roof
// fields become the whole home's roof, and everyone in the home (visiting
// friends too) gets the change live as `home:house`.
router.put('/home-houses/:projectId', auth, async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').slice(0, 64);
    if (!/^[\w-]+$/.test(projectId)) return res.status(400).json({ error: 'Bad room id' });
    const user = await User.findById(req.user.id).select('homeLayout').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const rooms = (user.homeLayout && user.homeLayout.rooms) || [];
    if (!rooms.some(r => r.projectId === projectId)) {
      return res.status(404).json({ error: "That room isn't in your home" });
    }
    const v = HouseLogic.validateHouse(req.body, { maxProps: await House.homeMaxPropsNow() });
    if (!v.ok) return res.status(400).json({ error: v.error });
    if (!House.portraitOk(v.house.portrait)) {
      return res.status(400).json({ error: 'portrait must be an image uploaded through this app' });
    }
    const homeRoof = House.pickRoof(v.house);
    await User.updateOne({ _id: req.user.id }, { $set: { ['homeHouses.' + projectId]: v.house, homeRoof } });
    WorldSocket.broadcastHome(req.user.id, 'home:house', { projectId, house: v.house, homeRoof });
    res.json({ house: v.house, homeRoof });
  } catch (err) {
    console.error('[profile] PUT /home-houses failed:', err);
    res.status(500).json({ error: 'Could not save the room' });
  }
});

router.put('/home-layout', auth, async (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.rooms)) {
    return res.status(400).json({ error: 'rooms must be an array' });
  }

  // Shape, integer coords, no duplicate cells / projectIds.
  const checked = House.checkLayoutRooms(body.rooms);
  if (checked.error) return res.status(400).json({ error: checked.error });
  const rooms = checked.rooms;

  // Per-user gating: count + projectId membership.
  const user = await User.findById(req.user.id).select('watchedProjects').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const watchedIds = new Set((user.watchedProjects || []).map(e => e.projectId));
  const maxRooms = House.maxHomeRooms(watchedIds.size);
  if (rooms.length > maxRooms) {
    return res.status(400).json({ error: `rooms.length (${rooms.length}) exceeds allowed (${maxRooms})` });
  }
  for (const r of rooms) {
    if (!watchedIds.has(r.projectId)) {
      return res.status(400).json({ error: `project ${r.projectId} is not in your watched list` });
    }
  }

  // Connectivity (BFS).
  if (!House.isLayoutConnected(rooms)) {
    return res.status(400).json({ error: 'layout is not connected — every room must be reachable from every other' });
  }

  const updated = await User.findByIdAndUpdate(
    req.user.id,
    { $set: { 'homeLayout.rooms': rooms } },
    { returnDocument: 'after', projection: { homeLayout: 1 } }
  ).lean();
  if (!updated) return res.status(404).json({ error: 'User not found' });
  res.json({ homeLayout: updated.homeLayout });
});

module.exports = router;
