/************************************************
 * WORLD ROUTES — /api/world
 *
 * Keeper-editable project houses for /world, plus the Scene Guess
 * minigame's read endpoints (bottom of the file).
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
const AdminConfig = require('../models/AdminConfig');
const WorldSocket = require('./world-socket');
const { toHouse, portraitOk } = require('../server/house');

const HOUSE_FIELDS = 'projectId wallColor roofColor trimColor lampColor sign portrait props roofStyle roofDir chimney wallStyle windowStyle windows';

// Admin-set prop cap (AdminConfig world.maxProps), cached like the flags in
// world-socket.js so GET / PUT never wait on Mongo for it. Falls back to the
// shared default when unset.
const MAX_PROPS_TTL_MS = 15000;
let _maxProps = AdminConfig.defaults().world.maxProps || HouseLogic.C.MAX_PROPS;
let _maxPropsAt = 0;
let _maxPropsRefreshing = false;
function maxPropsSetting() {
  if (Date.now() - _maxPropsAt >= MAX_PROPS_TTL_MS && !_maxPropsRefreshing) {
    _maxPropsRefreshing = true;
    AdminConfig.findOne({}).select('world.maxProps').lean()
      .then((doc) => {
        const v = doc && doc.world && doc.world.maxProps;
        _maxProps = Number.isFinite(v) && v >= 1 ? v : (AdminConfig.defaults().world.maxProps || HouseLogic.C.MAX_PROPS);
        _maxPropsAt = Date.now();
      })
      .catch(() => { /* keep the last known value */ })
      .finally(() => { _maxPropsRefreshing = false; });
  }
  return _maxProps;
}
// Fresh read for the PUT: the keeper's save must respect a cap changed
// seconds ago, so this one awaits Mongo (it is not a hot path).
async function maxPropsNow() {
  try {
    const doc = await AdminConfig.findOne({}).select('world.maxProps').lean();
    const v = doc && doc.world && doc.world.maxProps;
    if (Number.isFinite(v) && v >= 1) { _maxProps = v; _maxPropsAt = Date.now(); }
  } catch (_) { /* fall through to the cached value */ }
  return maxPropsSetting();
}

// Nobody keeps an island until they've really spent time there: without a
// floor, one forged position packet (a few ms of stay) claimed any of the
// ~60 unclaimed houses. Stay only accrues while moving/chatting on an island
// you've watched (routes/world-socket.js), so 5 minutes is real presence.
const KEEPER_MIN_MS = 5 * 60 * 1000;

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
    if (!(t.ms >= KEEPER_MIN_MS)) continue;
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
  res.json({ me: String(req.user.id), houses, keepers, mine, maxProps: maxPropsSetting(), minKeeperMs: KEEPER_MIN_MS });
});

router.put('/houses/:projectId', auth, async (req, res) => {
  const projectId = String(req.params.projectId || '').slice(0, 64);
  const v = HouseLogic.validateHouse(req.body, { maxProps: await maxPropsNow() });
  if (!v.ok) return res.status(400).json({ error: v.error });
  if (!portraitOk(v.house.portrait)) {
    return res.status(400).json({ error: 'portrait must be an image uploaded through this app' });
  }
  if (!(await Project.exists({ id: projectId }))) return res.status(404).json({ error: 'Unknown project' });

  await WorldSocket.flushStays();
  const top = await ProjectStay.findOne({ projectId }).sort({ ms: -1, updatedAt: 1 }).select('userId ms').lean();
  if (!top || !(top.ms >= KEEPER_MIN_MS)) {
    return res.status(403).json({ error: 'Stay on this island for 5 minutes to claim its house' });
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

// ── Scene Guess (server/scene-guess.js) ──
//
//   GET /scene                         what /world needs at mount ({ enabled:false } when off)
//   GET /scene/champions?user=name     profile badges: live islands where `name` holds the record
//   GET /scene/:projectId/board        an island's top 5 + the caller's best and rank
//   GET /scene/:projectId/picks        the champion's pick options (their record game's stills)
//
// Answers (still times) never appear here; still ids neither (an ObjectId
// carries its creation time, which follows upload — i.e. film — order).
const SceneData = require('../server/scene-guess-data');
const SceneScore = require('../models/SceneScore');
const SceneStill = require('../models/SceneStill');
const SceneGuess = require('../server/scene-guess').instance();

const sceneProjectId = (v) => (typeof v === 'string' ? v.slice(0, 80) : '');

router.get('/scene', auth, async (req, res) => {
  const s = await SceneData.settings.get();
  if (!s.enabled) return res.json({ enabled: false });
  const [islands, champs, mine] = await Promise.all([
    SceneData.liveIslands(),
    SceneData.champions.get(),
    SceneScore.find({ userId: req.user.id, best: { $gt: 0 } }).select('projectId best').lean()
  ]);
  const records = {};
  for (const pid of islands) {
    const c = champs.get(pid);
    if (c) records[pid] = SceneData.publicRecord(c);
  }
  const mineMap = {};
  for (const r of mine) mineMap[r.projectId] = r.best;
  res.json({ enabled: true, islands, records, live: SceneGuess.liveSnapshot(), mine: mineMap, roundSec: s.roundSec });
});

router.get('/scene/champions', auth, async (req, res) => {
  const name = typeof req.query.user === 'string' ? req.query.user.trim().slice(0, 40).toLowerCase() : '';
  const s = await SceneData.settings.get();
  if (!s.enabled || !name) return res.json({ items: [] });
  const [islands, champs, projects] = await Promise.all([SceneData.liveIslands(), SceneData.champions.get(), SceneData.projects.get()]);
  const items = [];
  for (const pid of islands) {
    const c = champs.get(pid);
    if (!c || c.username.toLowerCase() !== name) continue;
    const p = projects.get(pid);
    items.push({ projectId: pid, title: p ? p.title : pid, score: c.score });
  }
  res.json({ items });
});

router.get('/scene/:projectId/board', auth, async (req, res) => {
  const projectId = sceneProjectId(req.params.projectId);
  const s = await SceneData.settings.get();
  if (!s.enabled || !projectId) return res.json({ top: [], me: null });
  const [rows, me] = await Promise.all([
    SceneScore.find({ projectId, best: { $gt: 0 } }).sort({ best: -1, achievedAt: 1 }).limit(5).populate('userId', 'username').lean(),
    SceneScore.findOne({ projectId, userId: req.user.id }).select('best plays achievedAt').lean()
  ]);
  let rank = null;
  if (me && me.best > 0) {
    rank = 1 + await SceneScore.countDocuments({
      projectId,
      $or: [{ best: { $gt: me.best } }, { best: me.best, achievedAt: { $lt: me.achievedAt } }]
    });
  }
  res.json({
    top: rows.filter(r => r.userId).map(r => ({ username: r.userId.username, best: r.best, achievedAt: r.achievedAt })),
    me: me ? { best: me.best, plays: me.plays, rank } : null
  });
});

router.get('/scene/:projectId/picks', auth, async (req, res) => {
  const projectId = sceneProjectId(req.params.projectId);
  const champ = (await SceneData.champions.get()).get(projectId);
  if (!champ || champ.userId !== String(req.user.id)) {
    return res.status(403).json({ error: 'Only the island champion can choose the screen picture' });
  }
  const row = await SceneScore.findOne({ userId: req.user.id, projectId }).select('bestStills pick').lean();
  const ids = (row && row.bestStills) || [];
  const docs = ids.length ? await SceneStill.find({ _id: { $in: ids } }).select('imageUrl publicId active').lean() : [];
  const byId = new Map(docs.map(d => [String(d._id), d]));
  res.json({
    stills: ids.map(id => { const d = byId.get(String(id)); return d && d.active ? SceneData.stillUrl(d) : null; }),
    pick: row && row.pick ? ids.findIndex(id => String(id) === String(row.pick)) : -1
  });
});

module.exports = router;
