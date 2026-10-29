/************************************************
 * WORLD — Quote Guess player endpoints (mounted by routes/world.js under
 * /api/world, so behind the API rate limiter; every route needs a login)
 *
 *   GET  /quote                       what /world needs at mount ({ enabled:false } when off)
 *   GET  /quote/champions?user=name   profile: islands where `name` holds the record + lines they added
 *   GET  /quote/:projectId/board      an island's top 5 + the caller's best and rank
 *   GET  /quote/:projectId/picks      the champion's featured-line options (their record game's lines)
 *   POST /quote/:projectId/suggest    suggest a line for the admin queue (needs a rough time)
 *
 * Answers never appear here: picks only go to the island's champion, after
 * the game, and a line's speaker is part of what they already saw revealed.
 * Line ids neither (an ObjectId carries its creation time).
 ************************************************/
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/user');
const QuoteLine = require('../models/QuoteLine');
const QuoteScore = require('../models/QuoteScore');
const watchRules = require('../server/watchRules');
const { findByUsername } = require('../server/username');
const QuoteData = require('../server/quote-guess-data');
const Logic = require('../js/quote-guess-logic');

// Per player: suggestions per hour / per day, and waiting for review.
const LIMITS = { hour: 5, day: 20, pending: 30 };

const quoteProjectId = (v) => (typeof v === 'string' ? v.slice(0, 80) : '');
const QuoteGuess = () => require('../server/quote-guess').instance();

router.get('/quote', auth, async (req, res) => {
  const s = await QuoteData.settings.get();
  if (!s.enabled) return res.json({ enabled: false });
  const [islands, champs, mine, isl, pool] = await Promise.all([
    QuoteData.liveIslands(),
    QuoteData.champions.get(),
    QuoteScore.find({ userId: req.user.id, best: { $gt: 0 } }).select('projectId best').lean(),
    QuoteData.islands.get(),
    QuoteData.pool.get()
  ]);
  const records = {};
  for (const pid of islands) {
    const c = champs.get(pid);
    if (c) records[pid] = QuoteData.publicRecord(c);
  }
  const mineMap = {};
  for (const r of mine) mineMap[r.projectId] = r.best;
  // How far each island's bank is (the "coming soon" panel), for islands
  // the admin switched on that aren't playable yet.
  const progress = {};
  for (const pid of isl.on) {
    if (islands.includes(pid)) continue;
    const st = pool.get(pid) || { n: 0, speakers: 0 };
    progress[pid] = { lines: st.n, speakers: st.speakers };
  }
  res.json({
    enabled: true,
    islands,
    records,
    live: QuoteGuess().liveSnapshot(),
    mine: mineMap,
    roundSec: s.roundSec,
    suggest: !!s.suggest,
    noSuggest: [...isl.noSuggest],
    progress,
    need: { lines: Logic.C.MIN_POOL, speakers: Logic.C.MIN_SPEAKERS }
  });
});

router.get('/quote/champions', auth, async (req, res) => {
  const name = typeof req.query.user === 'string' ? req.query.user.trim().slice(0, 40) : '';
  const s = await QuoteData.settings.get();
  if (!s.enabled || !name) return res.json({ items: [], linesAdded: 0 });
  const [islands, champs, projects, user] = await Promise.all([
    QuoteData.liveIslands(), QuoteData.champions.get(), QuoteData.projects.get(), findByUsername(name, '_id')
  ]);
  const items = [];
  const lower = name.toLowerCase();
  for (const pid of islands) {
    const c = champs.get(pid);
    if (!c || c.username.toLowerCase() !== lower) continue;
    const p = projects.get(pid);
    items.push({ projectId: pid, title: p ? p.title : pid, score: c.score });
  }
  const linesAdded = user
    ? await QuoteLine.countDocuments({ suggestedBy: user._id, status: 'approved' })
    : 0;
  res.json({ items, linesAdded });
});

router.get('/quote/:projectId/board', auth, async (req, res) => {
  const projectId = quoteProjectId(req.params.projectId);
  const s = await QuoteData.settings.get();
  if (!s.enabled || !projectId) return res.json({ top: [], me: null });
  const [rows, me] = await Promise.all([
    QuoteScore.find({ projectId, best: { $gt: 0 } }).sort({ best: -1, achievedAt: 1 }).limit(5).populate('userId', 'username').lean(),
    QuoteScore.findOne({ projectId, userId: req.user.id }).select('best plays achievedAt').lean()
  ]);
  let rank = null;
  if (me && me.best > 0) {
    rank = 1 + await QuoteScore.countDocuments({
      projectId,
      $or: [{ best: { $gt: me.best } }, { best: me.best, achievedAt: { $lt: me.achievedAt } }]
    });
  }
  res.json({
    top: rows.filter(r => r.userId).map(r => ({ username: r.userId.username, best: r.best, achievedAt: r.achievedAt })),
    me: me ? { best: me.best, plays: me.plays, rank } : null
  });
});

router.get('/quote/:projectId/picks', auth, async (req, res) => {
  const projectId = quoteProjectId(req.params.projectId);
  const champ = (await QuoteData.champions.get()).get(projectId);
  if (!champ || champ.userId !== String(req.user.id)) {
    return res.status(403).json({ error: 'Only the island champion can choose the featured line' });
  }
  const row = await QuoteScore.findOne({ userId: req.user.id, projectId }).select('bestLines pick').lean();
  const ids = (row && row.bestLines) || [];
  const docs = ids.length ? await QuoteLine.find({ _id: { $in: ids } }).select('text speaker.name status active').lean() : [];
  const byId = new Map(docs.map(d => [String(d._id), d]));
  res.json({
    lines: ids.map(id => {
      const d = byId.get(String(id));
      return d && d.status === 'approved' && d.active ? { text: d.text, speaker: d.speaker ? d.speaker.name : '' } : null;
    }),
    pick: row && row.pick ? ids.findIndex(id => String(id) === String(row.pick)) : -1
  });
});

// A player suggests a line for an island they've watched. It waits in the
// admin queue (CMS → Quotes → Suggestions) and joins games once approved,
// credited to them at the reveal.
router.post('/quote/:projectId/suggest', auth, async (req, res) => {
  const projectId = quoteProjectId(req.params.projectId);
  await Promise.all([QuoteData.settings.get(), QuoteData.islands.get()]);
  if (!QuoteData.acceptsSuggestionsSync(projectId)) {
    return res.status(403).json({ error: 'Suggestions are closed for this island right now.' });
  }
  const [project, me] = await Promise.all([
    watchRules.getProject(projectId),
    User.findById(req.user.id).select('username watchedProjects.projectId').lean()
  ]);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!me) return res.status(401).json({ error: 'Invalid token' });
  if (!(me.watchedProjects || []).some(w => w.projectId === projectId)) {
    return res.status(403).json({ error: 'Watch it first — then you can suggest its lines.' });
  }
  const v = Logic.validateLine(req.body || {}, { project, mode: 'suggest', characters: await QuoteData.characterIndex() });
  if (!v.ok) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: v.errors });

  const now = Date.now();
  const [hour, day, pending] = await Promise.all([
    QuoteLine.countDocuments({ suggestedBy: req.user.id, createdAt: { $gte: new Date(now - 3600e3) } }),
    QuoteLine.countDocuments({ suggestedBy: req.user.id, createdAt: { $gte: new Date(now - 86400e3) } }),
    QuoteLine.countDocuments({ suggestedBy: req.user.id, status: 'pending' })
  ]);
  if (pending >= LIMITS.pending) return res.status(429).json({ error: `You have ${pending} lines waiting for review — please wait for those first.` });
  if (day >= LIMITS.day) return res.status(429).json({ error: 'That’s the most lines for today — thank you! Try again tomorrow.' });
  if (hour >= LIMITS.hour) return res.status(429).json({ error: 'That’s a lot of lines this hour — try again in a little while.' });

  const line = v.line;
  try {
    await QuoteLine.create({
      projectId,
      episode: line.episode,
      timeSec: line.timeSec,
      speaker: line.speaker,
      text: line.text,
      textKey: line.textKey,
      reply: line.reply,
      note: line.note,
      status: 'pending',
      active: true,
      origin: 'suggestion',
      suggestedBy: req.user.id,
      suggestedByName: me.username,
      addedBy: me.username
    });
  } catch (e) {
    if (e && e.code === 11000) {
      return res.status(409).json({ error: 'That line is already in this island’s quotes (or waiting for review).', fields: { text: 'Already suggested or in the game.' } });
    }
    throw e;
  }
  res.status(201).json({ status: 'pending' });
});

module.exports = router;
module.exports.LIMITS = LIMITS;
