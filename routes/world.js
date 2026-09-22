/************************************************
 * WORLD ROUTES — /api/world
 *
 * Keeper-editable project houses for /world.
 *
 *   GET /houses               every decorated house + each island's keeper
 *   PUT /houses/:projectId    save a house — only the island's keeper may
 *
 * The keeper is the user with the highest all-time ProjectStay.ms for that
 * project (ties → earlier updatedAt). Stays are accumulated in
 * routes/world-socket.js; the PUT forces a flush first so someone who just
 * overtook the leader is recognised at once. A saved house is broadcast to
 * the 'world' room as `world:house` so every client restyles it live.
 ************************************************/
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Project = require('../models/Project');
const ProjectStay = require('../models/ProjectStay');
const WorldHouse = require('../models/WorldHouse');
const User = require('../models/user');
const HouseLogic = require('../js/world-house-logic');
const WorldSocket = require('./world-socket');

const HOUSE_FIELDS = 'projectId wallColor roofColor trimColor lampColor sign portrait props roofStyle roofDir chimney wallStyle windowStyle windows';

// Same rule as memories (routes/progress.js): a portrait must live on the
// app's own Cloudinary account, so a keeper can't hang a tracker/phishing
// URL in a house every visitor's browser then fetches.
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_PREFIX = CLOUD_NAME ? `https://res.cloudinary.com/${CLOUD_NAME}/` : '';

function toHouse(doc) {
  const { house } = HouseLogic.validateHouse(doc || {});
  return house;
}

// Top stay row per project, joined to the username. Returns
// { [projectId]: { userId, username, ms } }.
async function keepersByProject() {
  const top = await ProjectStay.aggregate([
    { $sort: { projectId: 1, ms: -1, updatedAt: 1 } },
    { $group: { _id: '$projectId', userId: { $first: '$userId' }, ms: { $first: '$ms' } } }
  ]);
  if (!top.length) return {};
  const users = await User.find({ _id: { $in: top.map(t => t.userId) } }).select('username').lean();
  const names = new Map(users.map(u => [String(u._id), u.username]));
  const out = {};
  for (const t of top) {
    if (!(t.ms > 0)) continue;
    out[t._id] = { userId: String(t.userId), username: names.get(String(t.userId)) || 'Someone', ms: t.ms };
  }
  return out;
}

// `mine` is the caller's own stay per island, so the client can show how much
// longer they need to stay to take a house over from its keeper.
router.get('/houses', auth, async (req, res) => {
  const docs = await WorldHouse.find({}).select(HOUSE_FIELDS).lean();
  const houses = {};
  for (const d of docs) houses[d.projectId] = toHouse(d);
  const [keepers, myRows] = await Promise.all([
    keepersByProject(),
    ProjectStay.find({ userId: req.user.id }).select('projectId ms').lean()
  ]);
  const mine = {};
  for (const r of myRows) if (r.ms > 0) mine[r.projectId] = r.ms;
  res.json({ me: String(req.user.id), houses, keepers, mine });
});

router.put('/houses/:projectId', auth, async (req, res) => {
  const projectId = String(req.params.projectId || '').slice(0, 64);
  const v = HouseLogic.validateHouse(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  if (v.house.portrait && (!CLOUDINARY_PREFIX || !v.house.portrait.startsWith(CLOUDINARY_PREFIX))) {
    return res.status(400).json({ error: 'portrait must be an image uploaded through this app' });
  }
  if (!(await Project.exists({ id: projectId }))) return res.status(404).json({ error: 'Unknown project' });

  await WorldSocket.flushStays();
  const top = await ProjectStay.findOne({ projectId }).sort({ ms: -1, updatedAt: 1 }).select('userId ms').lean();
  if (!top || !(top.ms > 0)) {
    return res.status(403).json({ error: 'No one has stayed here long enough yet' });
  }
  if (String(top.userId) !== String(req.user.id)) {
    const u = await User.findById(top.userId).select('username').lean();
    return res.status(403).json({
      error: 'Only the keeper can edit this house',
      keeper: { userId: String(top.userId), username: (u && u.username) || 'Someone', ms: top.ms }
    });
  }

  const saved = await WorldHouse.findOneAndUpdate(
    { projectId },
    { $set: { ...v.house, editedBy: req.user.id } },
    { upsert: true, new: true, projection: HOUSE_FIELDS }
  ).lean();
  const house = toHouse(saved);
  const me = await User.findById(req.user.id).select('username').lean();
  const keeper = { userId: String(req.user.id), username: (me && me.username) || 'You', ms: top.ms };
  WorldSocket.broadcastWorld('world:house', { projectId, house, keeper });
  res.json({ house, keeper });
});

module.exports = router;
