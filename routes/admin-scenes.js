/************************************************
 * ADMIN — Scene Guess stills + island boards
 *
 * Mounted by routes/admin.js under /api/admin/scenes, so every route here is
 * already behind requireAdmin and the admin rate limiter. A factory: the
 * audit writer and Cloudinary URL parser are private to admin.js and are
 * passed in rather than moved.
 *
 *   GET    /summary                   still counts, island switch, live status per project
 *   GET    /:projectId                the project's stills WITH times (admin only)
 *   PUT    /:projectId/island         { enabled } — this island's own on/off switch
 *   POST   /:projectId                upload one still (multipart: time, episode, then file)
 *   PATCH  /still/:id                 edit time / episode / active
 *   DELETE /still/:id                 delete (+ Cloudinary destroy, clears a champion's pick)
 *   GET    /:projectId/board          top scores
 *   DELETE /:projectId/board/:userId  remove one score
 *   DELETE /:projectId/board          reset the island's board
 *
 * Times are validated with SceneGuessLogic.validStill against the project's
 * own runtime / episode list (watchRules.getProject — Mongo first, the static
 * projects.js as fallback).
 ************************************************/
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const Project = require('../models/Project');
const SceneStill = require('../models/SceneStill');
const SceneScore = require('../models/SceneScore');
const SceneIsland = require('../models/SceneIsland');
const watchRules = require('../server/watchRules');
const SceneData = require('../server/scene-guess-data');
const Logic = require('../js/scene-guess-logic');

const MAX_BYTES = 10 * 1024 * 1024;
const BOARD_LIMIT = 20;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Episode field from a form: '' / 'null' / missing → null, else an integer.
function parseEpisode(v) {
  if (v == null || v === '' || v === 'null') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) ? n : NaN;
}

// { ok, fields: { timeSec, episode } } or { ok:false, error } for a still on `tl`.
function checkFields(tl, time, episode) {
  const timeSec = Logic.parseTime(time);
  const ep = tl && tl.kind === 'series' ? parseEpisode(episode) : (episode == null || episode === '' || episode === 'null' ? null : NaN);
  if (timeSec == null) return { ok: false, error: 'Enter the time as h:mm:ss, m:ss or seconds.' };
  if (Number.isNaN(ep)) return { ok: false, error: tl && tl.kind === 'series' ? 'Pick an episode.' : 'Movies have no episodes.' };
  const v = Logic.validStill(tl, { timeSec, episode: ep });
  return v.ok ? { ok: true, fields: { timeSec, episode: ep } } : v;
}

function toAdminStill(doc, tl) {
  const episode = doc.episode == null ? null : doc.episode;
  const at = tl ? Logic.toGlobal(tl, episode, doc.timeSec) : null;
  return {
    id: String(doc._id),
    projectId: doc.projectId,
    episode,
    timeSec: doc.timeSec,
    at,                                   // position on the whole line (sorting / the strip)
    label: tl && at != null ? Logic.formatGuess(tl, at) : Logic.formatTime(doc.timeSec),
    // False once a CMS runtime / episode edit leaves the time past the end:
    // such stills are skipped when a game draws its 10.
    valid: Logic.validStill(tl, { timeSec: doc.timeSec, episode }).ok,
    imageUrl: doc.imageUrl,
    width: doc.width || 0,
    height: doc.height || 0,
    active: doc.active !== false,
    createdAt: doc.createdAt
  };
}

// Minimal multer storage engine: stream straight to Cloudinary and keep the
// fields this tab needs. (multer-storage-cloudinary, used by routes/upload.js,
// only hands back url / size / public_id — no dimensions.) Cloudinary is
// configured by routes/upload.js, which loads first (see admin.js header).
// No public_id is passed, so Cloudinary picks a random one: nothing about
// the still's time can leak through its URL.
const stillStorage = {
  _handleFile(req, file, cb) {
    const stream = cloudinary.uploader.upload_stream({
      folder: 'mcu-scene-stills',
      resource_type: 'image',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      // Incoming transformation: never store more than 1920×1080.
      transformation: [{ width: 1920, height: 1080, crop: 'limit' }]
    }, (err, r) => {
      if (err || !r) return cb(err || new Error('Upload failed'));
      cb(null, { path: r.secure_url, filename: r.public_id, width: r.width || 0, height: r.height || 0, size: r.bytes || 0 });
    });
    file.stream.on('error', cb);
    file.stream.pipe(stream);
  },
  _removeFile(req, file, cb) {
    cloudinary.uploader.destroy(file.filename, { invalidate: true }, () => cb(null));
  }
};

// The form must send `time` (and `episode` for a series) BEFORE `file`:
// multer has parsed the earlier fields by the time fileFilter runs, so a bad
// time is refused before anything is uploaded.
const upload = multer({
  storage: stillStorage,
  limits: { fileSize: MAX_BYTES, files: 1, fields: 6 },
  fileFilter(req, file, cb) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(httpError(400, 'Images only (JPG, PNG or WebP).'));
    const v = checkFields(req.sceneTl, req.body && req.body.time, req.body && req.body.episode);
    if (!v.ok) return cb(httpError(400, v.error));
    req.sceneFields = v.fields;
    cb(null, true);
  }
});

function destroyAsset(publicId) {
  if (!publicId) return;
  cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true })
    .catch(err => console.error('Cloudinary destroy failed:', err && err.message));
}

module.exports = function adminScenes({ logAudit, parseCloudinary }) {
  const router = express.Router();

  function badRequest(res, msg) { return res.status(400).json({ error: msg }); }

  async function loadProject(req, res, next) {
    const p = await watchRules.getProject(String(req.params.projectId || ''));
    if (!p) return res.status(404).json({ error: 'Project not found' });
    req.sceneProject = p;
    req.sceneTl = Logic.timeline(p);
    next();
  }

  router.get('/summary', async (req, res) => {
    const [projects, counts, islands, settings] = await Promise.all([
      Project.find({}).select('id title release runtime episodes gridX gridY').sort({ release: 1, gridY: 1, gridX: 1 }).lean(),
      SceneStill.aggregate([{ $group: { _id: '$projectId', total: { $sum: 1 }, active: { $sum: { $cond: ['$active', 1, 0] } } } }]),
      SceneIsland.find({ enabled: true }).select('projectId').lean(),
      SceneData.settings.get()
    ]);
    const byId = new Map(counts.map(c => [c._id, c]));
    const on = new Set(islands.map(i => i.projectId));
    const items = projects.map(p => {
      const c = byId.get(p.id) || { total: 0, active: 0 };
      const tl = Logic.timeline(p);
      const playable = c.active >= Logic.C.MIN_POOL;
      return {
        id: p.id,
        title: p.title,
        kind: tl ? tl.kind : 'none',
        episodes: tl && tl.kind === 'series' ? tl.segments.length : 0,
        stills: c.total,
        active: c.active,
        playable,
        enabled: on.has(p.id),
        live: !!settings.enabled && on.has(p.id) && playable
      };
    });
    res.json({ items, minPool: Logic.C.MIN_POOL, globalEnabled: !!settings.enabled });
  });

  // This island's own switch. Off (or no row) = the island shows nothing,
  // whatever stills it has; on = live once it has MIN_POOL active stills
  // and the global switch is on.
  router.put('/:projectId/island', loadProject, async (req, res) => {
    const enabled = req.body && req.body.enabled;
    if (typeof enabled !== 'boolean') return badRequest(res, 'enabled must be true or false');
    await SceneIsland.updateOne(
      { projectId: req.sceneProject.id },
      { $set: { enabled, updatedBy: req.adminUser.username } },
      { upsert: true }
    );
    SceneData.invalidate('islands', req.sceneProject.id);
    logAudit(req, 'contentEdit', { type: 'sceneIsland', projectId: req.sceneProject.id }, { action: enabled ? 'enable' : 'disable' });
    res.json({ enabled });
  });

  router.get('/:projectId', loadProject, async (req, res) => {
    const tl = req.sceneTl;
    const [docs, island, settings] = await Promise.all([
      SceneStill.find({ projectId: req.sceneProject.id }).lean(),
      SceneIsland.findOne({ projectId: req.sceneProject.id }).select('enabled').lean(),
      SceneData.settings.get()
    ]);
    const stills = docs.map(d => toAdminStill(d, tl)).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    const p = req.sceneProject;
    res.json({
      project: { id: p.id, title: p.title, runtime: p.runtime || 0, episodes: Array.isArray(p.episodes) ? p.episodes : [] },
      timeline: tl,
      stills,
      enabled: !!(island && island.enabled),
      globalEnabled: !!settings.enabled,
      minPool: Logic.C.MIN_POOL,
      maxBytes: MAX_BYTES
    });
  });

  router.post('/:projectId', loadProject, (req, res) => {
    if (!req.sceneTl) return badRequest(res, 'This project has no runtime yet — set it in CMS → Projects first.');
    upload.single('file')(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Image too large (max ${MAX_BYTES / 1024 / 1024} MB)` });
        return res.status(err.status || 400).json({ error: err.message || 'Upload failed' });
      }
      if (!req.file) return badRequest(res, 'No image uploaded');
      const { timeSec, episode } = req.sceneFields;
      try {
        const doc = await SceneStill.create({
          projectId: req.sceneProject.id,
          episode,
          timeSec,
          imageUrl: req.file.path,
          publicId: req.file.filename,
          width: req.file.width,
          height: req.file.height,
          addedBy: req.adminUser.id
        });
        SceneData.invalidate('pool', req.sceneProject.id);
        logAudit(req, 'contentEdit', { type: 'sceneStill', id: String(doc._id), projectId: req.sceneProject.id }, { action: 'create', timeSec, episode });
        res.json(toAdminStill(doc.toObject(), req.sceneTl));
      } catch (e) {
        destroyAsset(req.file.filename);
        console.error('Scene still save failed:', e && e.message);
        res.status(500).json({ error: 'Could not save the still' });
      }
    });
  });

  router.patch('/still/:id', async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return badRequest(res, 'Invalid still id');
    const doc = await SceneStill.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Still not found' });
    const p = await watchRules.getProject(doc.projectId);
    const tl = Logic.timeline(p);
    const body = req.body || {};
    const set = {};
    if (body.time !== undefined || body.episode !== undefined) {
      const time = body.time !== undefined ? body.time : doc.timeSec;
      const episode = body.episode !== undefined ? body.episode : doc.episode;
      const v = checkFields(tl, typeof time === 'number' ? String(time) : time, episode);
      if (!v.ok) return badRequest(res, v.error);
      set.timeSec = v.fields.timeSec;
      set.episode = v.fields.episode;
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') return badRequest(res, 'active must be true or false');
      set.active = body.active;
    }
    if (!Object.keys(set).length) return badRequest(res, 'Nothing to change');
    const after = await SceneStill.findByIdAndUpdate(doc._id, { $set: set }, { new: true }).lean();
    SceneData.invalidate('pool', doc.projectId);
    // A champion's pick that was just hidden falls back to the default screen.
    if (set.active === false) SceneData.invalidate('board', doc.projectId);
    logAudit(req, 'contentEdit', { type: 'sceneStill', id: String(doc._id), projectId: doc.projectId }, { action: 'update', ...set });
    res.json(toAdminStill(after, tl));
  });

  router.delete('/still/:id', async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return badRequest(res, 'Invalid still id');
    const doc = await SceneStill.findByIdAndDelete(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Still not found' });
    const parsed = doc.publicId ? null : parseCloudinary(doc.imageUrl);
    destroyAsset(doc.publicId || (parsed && parsed.public_id));
    const unpicked = await SceneScore.updateMany({ pick: doc._id }, { $set: { pick: null } });
    SceneData.invalidate('pool', doc.projectId);
    if (unpicked.modifiedCount) SceneData.invalidate('board', doc.projectId);
    logAudit(req, 'contentEdit', { type: 'sceneStill', id: String(doc._id), projectId: doc.projectId }, { action: 'delete', timeSec: doc.timeSec, episode: doc.episode });
    res.json({ message: 'Deleted' });
  });

  router.get('/:projectId/board', loadProject, async (req, res) => {
    const rows = await SceneScore.find({ projectId: req.sceneProject.id, best: { $gt: 0 } })
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
    const row = await SceneScore.findOneAndDelete({ projectId: req.sceneProject.id, userId: req.params.userId })
      .populate('userId', 'username').lean();
    if (!row) return res.status(404).json({ error: 'Score not found' });
    SceneData.invalidate('board', req.sceneProject.id);
    logAudit(req, 'scoreReset', { type: 'sceneScore', projectId: req.sceneProject.id, userId: req.params.userId },
      { username: row.userId ? row.userId.username : null, best: row.best });
    res.json({ message: 'Score removed' });
  });

  router.delete('/:projectId/board', loadProject, async (req, res) => {
    const r = await SceneScore.deleteMany({ projectId: req.sceneProject.id });
    SceneData.invalidate('board', req.sceneProject.id);
    logAudit(req, 'scoreReset', { type: 'sceneScore', projectId: req.sceneProject.id }, { all: true, count: r.deletedCount });
    res.json({ message: 'Board reset', removed: r.deletedCount });
  });

  return router;
};
