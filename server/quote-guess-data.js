/************************************************
 * QUOTE GUESS DATA — cached Mongo reads for the /world quote minigame
 *
 * The Quote Guess twin of server/scene-guess-data.js (same `cached()`
 * helper, same peek/get/invalidate contract). Shared by
 * routes/admin-quotes.js (writes → invalidate), routes/world-quotes.js
 * (REST) and the live game server.
 *
 *   settings   — the global switches (play, suggestions) + round length
 *   islands    — projects switched on / not taking suggestions (QuoteIsland)
 *   pool       — per project: approved active lines, distinct speakers, replies
 *   champions  — the top QuoteScore per project → laurels, roof labels,
 *                the idle screen's featured line, profile badges
 *
 * An island is LIVE when the global switch is on, its own switch is on and
 * its bank is playable (QuoteGuessLogic.playable). The project list is
 * Scene Guess's cache — the same titles / runtimes / episodes.
 ************************************************/
const EventEmitter = require('events');
const QuoteLine = require('../models/QuoteLine');
const QuoteScore = require('../models/QuoteScore');
const QuoteIsland = require('../models/QuoteIsland');
const AdminConfig = require('../models/AdminConfig');
const User = require('../models/user');
const Character = require('../models/Character');
const contentLoader = require('./contentLoader');
const SceneData = require('./scene-guess-data');
const Logic = require('../js/quote-guess-logic');

const { cached } = SceneData;
const events = new EventEmitter();
events.setMaxListeners(20);

// ── settings (AdminConfig) ──

// Off until the first read resolves, like Scene Guess.
const settings = cached('quote settings', async () => {
  const doc = await AdminConfig.findOne({}).select('flags.quoteGuessEnabled flags.quoteSuggestEnabled world.quoteRoundSec').lean();
  const d = AdminConfig.defaults();
  const flag = (k) => (doc && doc.flags && typeof doc.flags[k] === 'boolean') ? doc.flags[k] : d.flags[k];
  return {
    enabled: flag('quoteGuessEnabled'),
    suggest: flag('quoteSuggestEnabled'),
    roundSec: (doc && doc.world && Number.isFinite(doc.world.quoteRoundSec)) ? doc.world.quoteRoundSec : d.world.quoteRoundSec
  };
}, { enabled: false, suggest: false, roundSec: Logic.C.ROUND_MS / 1000 });

function enabledSync() { return settings.peek().enabled === true; }
function suggestSync() { return settings.peek().suggest === true; }
function roundSecSync() { return settings.peek().roundSec; }

// ── islands (per-project switches) ──

const islands = cached('quote islands', async () => {
  const rows = await QuoteIsland.find({ $or: [{ enabled: true }, { acceptSuggestions: false }] })
    .select('projectId enabled acceptSuggestions').lean();
  return {
    on: new Set(rows.filter(r => r.enabled).map(r => r.projectId)),
    noSuggest: new Set(rows.filter(r => r.acceptSuggestions === false).map(r => r.projectId))
  };
}, { on: new Set(), noSuggest: new Set() });

// ── pool ──

// Map(projectId → { n, speakers, replies }) over approved, active lines.
const pool = cached('quote pool', async () => {
  const rows = await QuoteLine.aggregate([
    { $match: { status: 'approved', active: true } },
    { $group: {
      _id: '$projectId',
      n: { $sum: 1 },
      a: { $addToSet: '$speaker.key' },
      b: { $addToSet: '$reply.speaker.key' },
      replies: { $sum: { $cond: [{ $ifNull: ['$reply.text', false] }, 1, 0] } }
    } }
  ]);
  return new Map(rows.map(r => {
    const keys = new Set([...(r.a || []), ...(r.b || [])].filter(Boolean));
    return [r._id, { n: r.n, speakers: keys.size, replies: r.replies }];
  }));
}, new Map());

function statsSync(projectId) { return pool.peek().get(projectId) || { n: 0, speakers: 0, replies: 0 }; }
function isPlayableSync(projectId) { return Logic.playable(statsSync(projectId)); }

// Island switched on AND playable (the global switch is the caller's).
function isLiveSync(projectId) { return islands.peek().on.has(projectId) && isPlayableSync(projectId); }
async function liveIslands() {
  const [isl, stats] = await Promise.all([islands.get(), pool.get()]);
  return [...isl.on].filter(id => Logic.playable(stats.get(id)));
}

// Can players suggest lines for this island right now? (Both global
// switches on, and the admin hasn't closed this island to suggestions.)
function acceptsSuggestionsSync(projectId) {
  return enabledSync() && suggestSync() && !islands.peek().noSuggest.has(projectId);
}

function prime() {
  settings.get(); islands.get(); SceneData.projects.get(); pool.get(); champions.get();
}

// ── champions ──

const champions = cached('quote champions', async () => {
  const rows = await QuoteScore.aggregate([
    { $match: { best: { $gt: 0 } } },
    { $sort: { projectId: 1, best: -1, achievedAt: 1 } },
    { $group: {
      _id: '$projectId',
      userId: { $first: '$userId' },
      best: { $first: '$best' },
      achievedAt: { $first: '$achievedAt' },
      pick: { $first: '$pick' }
    } }
  ]);
  if (!rows.length) return new Map();
  const users = await User.find({ _id: { $in: rows.map(r => r.userId) } }).select('username').lean();
  const names = new Map(users.map(u => [String(u._id), u.username]));
  const pickIds = rows.map(r => r.pick).filter(Boolean);
  const picks = pickIds.length
    ? await QuoteLine.find({ _id: { $in: pickIds }, status: 'approved', active: true }).select('text speaker.name').lean()
    : [];
  const lines = new Map(picks.map(l => [String(l._id), { text: l.text, speaker: l.speaker ? l.speaker.name : '' }]));
  const out = new Map();
  for (const r of rows) {
    const username = names.get(String(r.userId));
    if (!username) continue;
    out.set(r._id, {
      userId: String(r.userId),
      username,
      score: r.best,
      achievedAt: r.achievedAt,
      pick: r.pick ? (lines.get(String(r.pick)) || null) : null
    });
  }
  return out;
}, new Map());

// Public shape of one island's record (no userId).
function publicRecord(c) {
  return c ? { username: c.username, score: c.score, achievedAt: c.achievedAt, pick: c.pick } : null;
}

// ── draws ──

// A stored line → the bank shape QuoteGuessLogic.buildRounds takes.
function toBank(l) {
  return {
    id: String(l._id),
    speaker: l.speaker,
    text: l.text,
    textKey: l.textKey,
    reply: l.reply && l.reply.text ? l.reply : null,
    note: l.note || '',
    episode: Number.isInteger(l.episode) ? l.episode : null,
    decoys: l.decoys || { speakers: [], replies: [] },
    credit: l.origin === 'suggestion' && l.suggestedByName ? l.suggestedByName : null
  };
}

// A game's 10 rounds (answers included — server only), or null when the
// island no longer has a playable bank.
async function drawLines(projectId, rng) {
  const rows = await QuoteLine.find({ projectId, status: 'approved', active: true })
    .select('speaker text textKey reply note episode decoys origin suggestedByName').lean();
  return Logic.buildRounds(rows.map(toBank), rng);
}

// ── portraits ──

// Speaker name → character id (QuoteGuessLogic.characterIndex) over the
// Mongo characters, characters.js as fallback. Read per call: only admin
// writes and suggestions need it.
async function characterList() {
  let list = [];
  try { list = await Character.find({}).select('id name').lean(); } catch (_) { /* fallback below */ }
  return list.length ? list : (contentLoader.get('characters') || []);
}
async function characterIndex() { return Logic.characterIndex(await characterList()); }

// After a write: drop that cache and tell the game server.
// kind: 'settings' | 'islands' | 'pool' | 'board' | 'projects'
function invalidate(kind, projectId) {
  if (kind === 'settings') settings.invalidate();
  if (kind === 'islands') islands.invalidate();
  if (kind === 'pool') pool.invalidate();
  if (kind === 'board') champions.invalidate();
  if (kind === 'projects') SceneData.projects.invalidate();
  events.emit(kind, projectId);
}

module.exports = {
  events, invalidate, prime, toBank, characterList, characterIndex,
  settings, enabledSync, suggestSync, roundSecSync,
  islands, isLiveSync, liveIslands, acceptsSuggestionsSync,
  projects: SceneData.projects, projectSync: SceneData.projectSync,
  pool, statsSync, isPlayableSync,
  champions, publicRecord,
  drawLines
};
