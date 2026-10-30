/************************************************
 * ADMIN — Quote Guess quote bank, suggestion queue + island boards
 *
 * Mounted by routes/admin.js under /api/admin/quotes, so every route here is
 * already behind requireAdmin and the admin rate limiter. A factory, like
 * routes/admin-scenes.js: the audit writer is private to admin.js.
 *
 *   GET    /summary                    per project: lines, speakers, replies, pending, switches, live
 *   GET    /queue?projectId=&before=   pending suggestions, oldest first (+ look-alike lines)
 *   GET    /keys?projectIds=a,b        existing text keys (the importer's duplicate check)
 *   GET    /export?projectId=&status=  stored lines (the page writes the CSV / JSON file)
 *   POST   /import/commit              { rows, mode: skip|update, importId, origin: admin|seed }
 *   DELETE /import/:importId           undo one import
 *   PUT    /:projectId/island          { enabled?, acceptSuggestions? }
 *   GET    /:projectId?status=         the island's lines (answers included — admin only)
 *   POST   /:projectId                 add one line
 *   PATCH  /line/:id                   edit fields / active
 *   DELETE /line/:id                   delete (clears a champion's featured line)
 *   POST   /line/:id/approve           { edits? } — a suggestion goes live
 *   POST   /line/:id/reject            { reason? }
 *   GET    /:projectId/board           top scores
 *   DELETE /:projectId/board/:userId   remove one score
 *   DELETE /:projectId/board           reset the island's board
 *
 * Every line is validated with QuoteGuessLogic.validateLine against the
 * project's own runtime / episode list (watchRules — Mongo first, static
 * projects.js as fallback). The importer plans in the browser (it can't post
 * 5,000 rows past the 64 KB body limit) and commits in chunks; each chunk is
 * validated again here.
 ************************************************/
const express = require('express');
const mongoose = require('mongoose');
const QuoteLine = require('../models/QuoteLine');
const QuoteScore = require('../models/QuoteScore');
const QuoteIsland = require('../models/QuoteIsland');
const watchRules = require('../server/watchRules');
const QuoteData = require('../server/quote-guess-data');
const Logic = require('../js/quote-guess-logic');

const BOARD_LIMIT = 20;
const QUEUE_LIMIT = 50;
const IMPORT_ID = /^[a-z0-9-]{4,40}$/;
const ADMIN_FIELDS = 'projectId episode timeSec speaker text textKey reply note source decoys active status origin importId addedBy suggestedByName reviewedBy reviewedAt rejectReason createdAt updatedAt';

// What the admin page gets for one line (everything but internal keys).
function toAdminLine(d) {
  return {
    id: String(d._id),
    projectId: d.projectId,
    episode: Number.isInteger(d.episode) ? d.episode : null,
    timeSec: Number.isInteger(d.timeSec) ? d.timeSec : null,
    speaker: d.speaker,
    text: d.text,
    reply: d.reply && d.reply.text ? d.reply : null,
    note: d.note || '',
    source: d.source || '',
    decoys: { speakers: (d.decoys && d.decoys.speakers) || [], replies: (d.decoys && d.decoys.replies) || [] },
    active: d.active !== false,
    status: d.status,
    origin: d.origin,
    importId: d.importId || null,
    suggestedByName: d.suggestedByName || '',
    reviewedBy: d.reviewedBy || '',
    reviewedAt: d.reviewedAt || null,
    rejectReason: d.rejectReason || '',
    createdAt: d.createdAt,
    updatedAt: d.updatedAt
  };
}

// The fields a validated line writes (validateLine's `line`, minus projectId).
function contentSet(line) {
  return {
    episode: line.episode,
    timeSec: line.timeSec,
    speaker: line.speaker,
    text: line.text,
    textKey: line.textKey,
    reply: line.reply,
    note: line.note,
    source: line.source,
    decoys: line.decoys
  };
}

// Portrait links (Mongo characters, characters.js as fallback).
const { characterList, characterIndex } = QuoteData;

// Words-overlap score (Jaccard) — the queue's "looks like" hint.
function wordSet(s) { return new Set(Logic.norm(s).split(' ').filter(w => w.length > 2)); }
function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / (a.size + b.size - n);
}

// A deleted project's Quote Guess data: island switch, lines and scores.
// Best-effort (the project is already gone). → { lines, scores } | { error }.
async function deleteProjectQuotes(projectId) {
  try {
    const [, lines, scores] = await Promise.all([
      QuoteIsland.deleteMany({ projectId }),
      QuoteLine.deleteMany({ projectId }),
      QuoteScore.deleteMany({ projectId })
    ]);
    QuoteData.invalidate('islands', projectId);
    QuoteData.invalidate('pool', projectId);
    QuoteData.invalidate('board', projectId);
    return { lines: lines.deletedCount || 0, scores: scores.deletedCount || 0 };
  } catch (err) {
    console.error('Project delete → Quote Guess cleanup failed:', err && err.message);
    return { error: true };
  }
}

module.exports = function adminQuotes({ logAudit }) {
  const router = express.Router();

  function badRequest(res, msg, fields) { return res.status(400).json(fields ? { error: msg, fields } : { error: msg }); }

  async function loadProject(req, res, next) {
    const p = await watchRules.getProject(String(req.params.projectId || ''));
    if (!p) return res.status(404).json({ error: 'Project not found' });
    req.quoteProject = p;
    next();
  }

  async function loadLine(req, res, next) {
    if (!mongoose.isValidObjectId(req.params.id)) return badRequest(res, 'Invalid line id');
    const doc = await QuoteLine.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Line not found' });
    req.quoteLine = doc;
    req.quoteProject = await watchRules.getProject(doc.projectId);
    next();
  }

  // A stored line with `body` laid over it (the admin form's flat shape),
  // validated as a whole. → { ok, line } | { ok:false, errors }.
  async function merged(doc, project, body) {
    const row = Object.assign(Logic.lineToForm(doc), {});
    const was = { speaker: row.speaker, replySpeaker: row.replySpeaker };
    const has = (k) => body && Object.prototype.hasOwnProperty.call(body, k);
    for (const k of ['speaker', 'speakerCharacterId', 'text', 'replySpeaker', 'replyCharacterId', 'replyText', 'note', 'episode', 'time', 'source', 'decoySpeakers', 'decoyReplies']) {
      if (has(k)) row[k] = body[k];
    }
    // A renamed speaker (or replier) drops the stored portrait, so the new
    // name links its own — unless the body picks one for it.
    if (has('speaker') && !has('speakerCharacterId') && Logic.norm(row.speaker) !== Logic.norm(was.speaker)) row.speakerCharacterId = '';
    if (has('replySpeaker') && !has('replyCharacterId') && Logic.norm(row.replySpeaker) !== Logic.norm(was.replySpeaker)) row.replyCharacterId = '';
    return Logic.validateLine(row, { project, mode: 'admin', characters: await characterIndex() });
  }

  function dupeError(res) {
    return res.status(409).json({ error: 'That line is already in this island\'s bank.', fields: { text: 'Already in the bank.' } });
  }

  router.get('/summary', async (req, res) => {
    const [projects, counts, islands, settings] = await Promise.all([
      watchRules.allProjects(),
      QuoteLine.aggregate([
        { $group: {
          _id: '$projectId',
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          live: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'approved'] }, '$active'] }, 1, 0] } },
          a: { $addToSet: { $cond: [{ $and: [{ $eq: ['$status', 'approved'] }, '$active'] }, '$speaker.key', null] } },
          b: { $addToSet: { $cond: [{ $and: [{ $eq: ['$status', 'approved'] }, '$active'] }, '$reply.speaker.key', null] } },
          replies: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'approved'] }, '$active', { $ifNull: ['$reply.text', false] }] }, 1, 0] } }
        } }
      ]),
      QuoteIsland.find({}).select('projectId enabled acceptSuggestions').lean(),
      QuoteData.settings.get()
    ]);
    const byId = new Map(counts.map(c => [c._id, c]));
    const sw = new Map(islands.map(i => [i.projectId, i]));
    const items = [...projects.values()]
      .sort((x, y) => String(x.release || '').localeCompare(String(y.release || '')) || (x.gridY - y.gridY) || (x.gridX - y.gridX))
      .map(p => {
        const c = byId.get(p.id) || { total: 0, pending: 0, live: 0, a: [], b: [], replies: 0 };
        const stats = { n: c.live, speakers: new Set([...(c.a || []), ...(c.b || [])].filter(Boolean)).size, replies: c.replies };
        const s = sw.get(p.id) || {};
        const series = Array.isArray(p.episodes) && p.episodes.length > 0;
        const playable = Logic.playable(stats);
        return {
          id: p.id,
          title: p.title,
          kind: series ? 'series' : 'movie',
          episodes: series ? p.episodes.length : 0,
          total: c.total,
          lines: stats.n,
          speakers: stats.speakers,
          replies: stats.replies,
          pending: c.pending,
          playable,
          needs: Logic.needs(stats),
          enabled: !!s.enabled,
          acceptSuggestions: s.acceptSuggestions !== false,
          live: !!settings.enabled && !!s.enabled && playable
        };
      });
    res.json({
      items,
      minPool: Logic.C.MIN_POOL,
      minSpeakers: Logic.C.MIN_SPEAKERS,
      globalEnabled: !!settings.enabled,
      suggestEnabled: !!settings.suggest,
      pendingTotal: items.reduce((n, i) => n + i.pending, 0)
    });
  });

  // Pending suggestions, oldest first, with lines that look alike so a
  // near-duplicate is easy to spot.
  router.get('/queue', async (req, res) => {
    const q = { status: 'pending' };
    if (typeof req.query.projectId === 'string' && req.query.projectId) q.projectId = req.query.projectId;
    if (typeof req.query.before === 'string' && !Number.isNaN(Date.parse(req.query.before))) q.createdAt = { $gt: new Date(req.query.before) };
    const [docs, total, projects] = await Promise.all([
      QuoteLine.find(q).sort({ createdAt: 1 }).limit(QUEUE_LIMIT).select(ADMIN_FIELDS).lean(),
      QuoteLine.countDocuments({ status: 'pending' }),
      watchRules.allProjects()
    ]);
    const pids = [...new Set(docs.map(d => d.projectId))];
    const others = pids.length
      ? await QuoteLine.find({ projectId: { $in: pids }, status: { $ne: 'rejected' } }).select('projectId text speaker.name status').lean()
      : [];
    const items = docs.map(d => {
      const mine = wordSet(d.text);
      const alike = others
        .filter(o => o.projectId === d.projectId && String(o._id) !== String(d._id))
        .map(o => ({ id: String(o._id), text: o.text, speaker: o.speaker ? o.speaker.name : '', status: o.status, score: overlap(mine, wordSet(o.text)) }))
        .filter(o => o.score >= 0.5)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      const p = projects.get(d.projectId);
      return Object.assign(toAdminLine(d), {
        projectTitle: p ? p.title : d.projectId,
        episodes: p && Array.isArray(p.episodes) ? p.episodes : [],
        runtime: p ? p.runtime || 0 : 0,
        alike
      });
    });
    res.json({ items, total });
  });

  router.get('/keys', async (req, res) => {
    const ids = typeof req.query.projectIds === 'string' && req.query.projectIds
      ? req.query.projectIds.split(',').map(s => s.trim()).filter(Boolean).slice(0, 200)
      : null;
    const rows = await QuoteLine.find(ids ? { projectId: { $in: ids } } : {}).select('projectId textKey').lean();
    res.json({ keys: rows.map(r => r.projectId + '|' + r.textKey) });
  });

  router.get('/export', async (req, res) => {
    const q = {};
    if (typeof req.query.projectId === 'string' && req.query.projectId) q.projectId = req.query.projectId;
    const status = String(req.query.status || 'approved');
    if (status !== 'all') {
      if (!Logic.STATUSES.includes(status)) return badRequest(res, 'Unknown status');
      q.status = status;
    }
    const docs = await QuoteLine.find(q).sort({ projectId: 1, createdAt: 1 }).select(ADMIN_FIELDS).lean();
    res.json({ items: docs.map(toAdminLine) });
  });

  // One chunk of an import. Rows are re-planned here (the page's plan is
  // only a preview): new lines are inserted, existing ones skipped or (mode
  // 'update') overwritten — an update also re-approves the line.
  router.post('/import/commit', async (req, res) => {
    const body = req.body || {};
    const rows = Array.isArray(body.rows) ? body.rows : null;
    if (!rows || !rows.length) return badRequest(res, 'No rows to import');
    if (rows.length > Logic.C.COMMIT_ROWS) return badRequest(res, `Up to ${Logic.C.COMMIT_ROWS} rows per request`);
    const mode = body.mode === 'update' ? 'update' : 'skip';
    const origin = body.origin === 'seed' ? 'seed' : 'admin';
    const importId = typeof body.importId === 'string' && IMPORT_ID.test(body.importId) ? body.importId : null;
    if (!importId) return badRequest(res, 'importId must be 4–40 lowercase letters, digits or dashes');

    const projects = [...(await watchRules.allProjects()).values()];
    const pids = [...new Set(rows.map(r => r && String(r.projectId || '')).filter(Boolean))];
    const existing = await QuoteLine.find({ projectId: { $in: pids.concat(projects.filter(p => pids.includes(p.title)).map(p => p.id)) } })
      .select('projectId textKey').lean();
    const plan = Logic.planImport(rows, {
      projects,
      existingKeys: new Set(existing.map(e => e.projectId + '|' + e.textKey)),
      characters: await characterList()
    });

    const who = req.adminUser.username;
    const fresh = plan.rows.filter(r => r.status === 'ok').map(r => Object.assign({ projectId: r.projectId }, contentSet(r.line), {
      status: 'approved', active: true, origin, importId, addedBy: who
    }));
    let inserted = 0, updated = 0, skipped = 0;
    const failed = plan.rows.filter(r => r.status === 'error').map(r => ({ index: r.index, projectId: r.projectId, errors: r.errors }));
    if (fresh.length) {
      try {
        const out = await QuoteLine.insertMany(fresh, { ordered: false });
        inserted = out.length;
      } catch (e) {
        // A line added by someone else since the plan: count it as skipped.
        inserted = (e && e.insertedDocs ? e.insertedDocs.length : 0);
        skipped += fresh.length - inserted;
        if (!e || (e.code !== 11000 && !(e.writeErrors || []).every(w => (w.code || (w.err && w.err.code)) === 11000))) {
          console.error('Quote import insert failed:', e && e.message);
          return res.status(500).json({ error: 'Import failed part-way — nothing more was written.', inserted });
        }
      }
    }
    const dupes = plan.rows.filter(r => r.status === 'dupe-db' || r.status === 'dupe-batch');
    if (mode === 'update') {
      for (const r of dupes.filter(d => d.status === 'dupe-db')) {
        const u = await QuoteLine.updateOne(
          { projectId: r.projectId, textKey: r.line.textKey },
          { $set: Object.assign(contentSet(r.line), { status: 'approved', active: true, reviewedBy: who, reviewedAt: new Date() }) }
        );
        if (u.modifiedCount) updated++; else skipped++;
      }
      skipped += dupes.filter(d => d.status === 'dupe-batch').length;
    } else {
      skipped += dupes.length;
    }
    const touched = [...new Set(plan.rows.filter(r => r.status !== 'error').map(r => r.projectId))];
    if (inserted || updated) {
      touched.forEach(pid => QuoteData.invalidate('pool', pid));
      logAudit(req, 'quoteImport', { importId }, { action: 'commit', mode, origin, inserted, updated, skipped, failed: failed.length, projects: touched.slice(0, 100) });
    }
    res.json({ inserted, updated, skipped, failed });
  });

  router.delete('/import/:importId', async (req, res) => {
    const importId = String(req.params.importId || '');
    if (!IMPORT_ID.test(importId)) return badRequest(res, 'Invalid import id');
    const docs = await QuoteLine.find({ importId }).select('_id projectId').lean();
    if (!docs.length) return res.status(404).json({ error: 'Nothing from that import is left' });
    const ids = docs.map(d => d._id);
    await QuoteLine.deleteMany({ _id: { $in: ids } });
    const unpicked = await QuoteScore.updateMany({ pick: { $in: ids } }, { $set: { pick: null } });
    const pids = [...new Set(docs.map(d => d.projectId))];
    pids.forEach(pid => QuoteData.invalidate('pool', pid));
    if (unpicked.modifiedCount) QuoteData.invalidate('board', null);
    logAudit(req, 'quoteImport', { importId }, { action: 'undo', removed: docs.length, projects: pids.slice(0, 100) });
    res.json({ removed: docs.length });
  });

  router.post('/line/:id/approve', loadLine, async (req, res) => {
    const doc = req.quoteLine;
    if (doc.status === 'approved') return badRequest(res, 'Already approved');
    const set = { status: 'approved', active: true, reviewedBy: req.adminUser.username, reviewedAt: new Date(), rejectReason: '' };
    const edits = req.body && req.body.edits;
    if (edits && typeof edits === 'object') {
      const v = await merged(doc, req.quoteProject, edits);
      if (!v.ok) return badRequest(res, 'Please fix the highlighted fields.', v.errors);
      Object.assign(set, contentSet(v.line));
    }
    let after;
    try {
      after = await QuoteLine.findByIdAndUpdate(doc._id, { $set: set }, { returnDocument: 'after' }).select(ADMIN_FIELDS).lean();
    } catch (e) {
      if (e && e.code === 11000) return dupeError(res);
      throw e;
    }
    QuoteData.invalidate('pool', doc.projectId);
    logAudit(req, 'quoteModerate', { type: 'quoteLine', id: String(doc._id), projectId: doc.projectId },
      { action: 'approve', edited: !!edits, suggestedBy: doc.suggestedByName || null });
    res.json(toAdminLine(after));
  });

  router.post('/line/:id/reject', loadLine, async (req, res) => {
    const doc = req.quoteLine;
    if (doc.status === 'rejected') return badRequest(res, 'Already rejected');
    const reason = Logic.cleanText(req.body && req.body.reason).slice(0, Logic.C.MAX_REASON);
    const after = await QuoteLine.findByIdAndUpdate(doc._id, {
      $set: { status: 'rejected', active: false, reviewedBy: req.adminUser.username, reviewedAt: new Date(), rejectReason: reason }
    }, { returnDocument: 'after' }).select(ADMIN_FIELDS).lean();
    QuoteData.invalidate('pool', doc.projectId);
    if (doc.status === 'approved') QuoteData.invalidate('board', doc.projectId);
    logAudit(req, 'quoteModerate', { type: 'quoteLine', id: String(doc._id), projectId: doc.projectId },
      { action: 'reject', reason, suggestedBy: doc.suggestedByName || null });
    res.json(toAdminLine(after));
  });

  router.patch('/line/:id', loadLine, async (req, res) => {
    const doc = req.quoteLine;
    const body = req.body || {};
    const set = {};
    const content = ['speaker', 'speakerCharacterId', 'text', 'replySpeaker', 'replyCharacterId', 'replyText', 'note', 'episode', 'time', 'source', 'decoySpeakers', 'decoyReplies']
      .some(k => Object.prototype.hasOwnProperty.call(body, k));
    if (content) {
      const v = await merged(doc, req.quoteProject, body);
      if (!v.ok) return badRequest(res, 'Please fix the highlighted fields.', v.errors);
      Object.assign(set, contentSet(v.line));
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') return badRequest(res, 'active must be true or false');
      set.active = body.active;
    }
    if (!Object.keys(set).length) return badRequest(res, 'Nothing to change');
    let after;
    try {
      after = await QuoteLine.findByIdAndUpdate(doc._id, { $set: set }, { returnDocument: 'after' }).select(ADMIN_FIELDS).lean();
    } catch (e) {
      if (e && e.code === 11000) return dupeError(res);
      throw e;
    }
    QuoteData.invalidate('pool', doc.projectId);
    // The champion's featured line may have changed or gone.
    QuoteData.invalidate('board', doc.projectId);
    logAudit(req, 'contentEdit', { type: 'quoteLine', id: String(doc._id), projectId: doc.projectId },
      { action: 'update', fields: Object.keys(body).slice(0, 20) });
    res.json(toAdminLine(after));
  });

  router.delete('/line/:id', loadLine, async (req, res) => {
    const doc = req.quoteLine;
    await QuoteLine.deleteOne({ _id: doc._id });
    const unpicked = await QuoteScore.updateMany({ pick: doc._id }, { $set: { pick: null } });
    QuoteData.invalidate('pool', doc.projectId);
    if (unpicked.modifiedCount) QuoteData.invalidate('board', doc.projectId);
    logAudit(req, 'contentEdit', { type: 'quoteLine', id: String(doc._id), projectId: doc.projectId },
      { action: 'delete', text: doc.text.slice(0, 80), status: doc.status });
    res.json({ message: 'Deleted' });
  });

  // This island's own switches. `enabled`: live once playable (and the
  // global switch is on). `acceptSuggestions`: players may suggest lines here.
  router.put('/:projectId/island', loadProject, async (req, res) => {
    const body = req.body || {};
    const set = {};
    for (const k of ['enabled', 'acceptSuggestions']) {
      if (body[k] === undefined) continue;
      if (typeof body[k] !== 'boolean') return badRequest(res, `${k} must be true or false`);
      set[k] = body[k];
    }
    if (!Object.keys(set).length) return badRequest(res, 'Nothing to change');
    const after = await QuoteIsland.findOneAndUpdate(
      { projectId: req.quoteProject.id },
      { $set: Object.assign(set, { updatedBy: req.adminUser.username }) },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    ).lean();
    QuoteData.invalidate('islands', req.quoteProject.id);
    logAudit(req, 'contentEdit', { type: 'quoteIsland', projectId: req.quoteProject.id }, { action: 'update', ...set });
    res.json({ enabled: !!after.enabled, acceptSuggestions: after.acceptSuggestions !== false });
  });

  router.get('/:projectId', loadProject, async (req, res) => {
    const p = req.quoteProject;
    const q = { projectId: p.id };
    const status = String(req.query.status || 'all');
    if (status !== 'all') {
      if (!Logic.STATUSES.includes(status)) return badRequest(res, 'Unknown status');
      q.status = status;
    }
    const [docs, island, settings] = await Promise.all([
      QuoteLine.find(q).sort({ createdAt: 1 }).select(ADMIN_FIELDS).lean(),
      QuoteIsland.findOne({ projectId: p.id }).select('enabled acceptSuggestions').lean(),
      QuoteData.settings.get()
    ]);
    const lines = docs.map(toAdminLine);
    const stats = Logic.poolStats(lines.filter(l => l.status === 'approved' && l.active));
    res.json({
      project: { id: p.id, title: p.title, runtime: p.runtime || 0, episodes: Array.isArray(p.episodes) ? p.episodes : [] },
      lines,
      stats,
      playable: Logic.playable(stats),
      needs: Logic.needs(stats),
      enabled: !!(island && island.enabled),
      acceptSuggestions: !island || island.acceptSuggestions !== false,
      globalEnabled: !!settings.enabled,
      suggestEnabled: !!settings.suggest,
      minPool: Logic.C.MIN_POOL,
      minSpeakers: Logic.C.MIN_SPEAKERS
    });
  });

  router.post('/:projectId', loadProject, async (req, res) => {
    const v = Logic.validateLine(req.body || {}, { project: req.quoteProject, mode: 'admin', characters: await characterIndex() });
    if (!v.ok) return badRequest(res, 'Please fix the highlighted fields.', v.errors);
    let doc;
    try {
      doc = await QuoteLine.create(Object.assign({ projectId: req.quoteProject.id }, contentSet(v.line), {
        status: 'approved', active: true, origin: 'admin', addedBy: req.adminUser.username
      }));
    } catch (e) {
      if (e && e.code === 11000) return dupeError(res);
      throw e;
    }
    QuoteData.invalidate('pool', req.quoteProject.id);
    logAudit(req, 'contentEdit', { type: 'quoteLine', id: String(doc._id), projectId: req.quoteProject.id },
      { action: 'create', text: doc.text.slice(0, 80) });
    res.status(201).json(toAdminLine(doc.toObject()));
  });

  router.get('/:projectId/board', loadProject, async (req, res) => {
    const rows = await QuoteScore.find({ projectId: req.quoteProject.id, best: { $gt: 0 } })
      .sort({ best: -1, achievedAt: 1 })
      .limit(BOARD_LIMIT)
      .populate('userId', 'username')
      .lean();
    res.json({
      items: rows.map((r, i) => ({
        rank: i + 1,
        userId: r.userId ? String(r.userId._id) : null,
        username: r.userId ? r.userId.username : '(deleted user)',
        best: r.best,
        achievedAt: r.achievedAt,
        plays: r.plays
      }))
    });
  });

  router.delete('/:projectId/board/:userId', loadProject, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.userId)) return badRequest(res, 'Invalid user id');
    const row = await QuoteScore.findOneAndDelete({ projectId: req.quoteProject.id, userId: req.params.userId })
      .populate('userId', 'username').lean();
    if (!row) return res.status(404).json({ error: 'Score not found' });
    QuoteData.invalidate('board', req.quoteProject.id);
    logAudit(req, 'scoreReset', { type: 'quoteScore', projectId: req.quoteProject.id, userId: req.params.userId },
      { username: row.userId ? row.userId.username : null, best: row.best });
    res.json({ message: 'Score removed' });
  });

  router.delete('/:projectId/board', loadProject, async (req, res) => {
    const r = await QuoteScore.deleteMany({ projectId: req.quoteProject.id });
    QuoteData.invalidate('board', req.quoteProject.id);
    logAudit(req, 'scoreReset', { type: 'quoteScore', projectId: req.quoteProject.id }, { all: true, count: r.deletedCount });
    res.json({ message: 'Board reset', removed: r.deletedCount });
  });

  return router;
};

// For routes/admin.js (project delete).
module.exports.deleteProjectQuotes = deleteProjectQuotes;
