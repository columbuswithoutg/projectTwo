/************************************************
 * server/upload-policy.js — what POST /api/upload accepts and how much.
 *
 * Before: any mimetype went to Cloudinary (resource_type copied from the
 * client's own header), the only limit was 10 uploads a minute per IP at
 * 25 MB each, nothing recorded who uploaded what, and multer / Cloudinary
 * error messages were echoed to the client verbatim. Now:
 *   - UPLOAD_TYPES is the one list of accepted files (also the client's
 *     accept= hint). HEIC/HEIF are stored as JPG (Cloudinary converts on
 *     ingest) so iPhone photos show in every browser.
 *   - classifyUpload() decides from the mimetype, falling back to the file
 *     extension when the browser sends none / octet-stream (Chrome on
 *     Windows does that for HEIC).
 *   - LIMITS: per-user daily count + bytes (models/Upload.js rows over the
 *     last 24 h) and at most MAX_INFLIGHT uploads at once.
 *   - uploadErrorResponse() maps every failure to a fixed message.
 *   - every asset is tagged with the uploader (tags + context) and recorded.
 * Pure parts are unit-tested in test/upload-policy.test.js.
 ************************************************/
const FOLDER = 'mcu-memories';

const UPLOAD_TYPES = Object.freeze([
  { mime: 'image/jpeg', aliases: ['image/jpg', 'image/pjpeg'], exts: ['jpg', 'jpeg'], kind: 'image' },
  { mime: 'image/png',  aliases: [], exts: ['png'],  kind: 'image' },
  { mime: 'image/gif',  aliases: [], exts: ['gif'],  kind: 'image' },
  { mime: 'image/webp', aliases: [], exts: ['webp'], kind: 'image' },
  { mime: 'image/avif', aliases: [], exts: ['avif'], kind: 'image' },
  { mime: 'image/heic', aliases: ['image/heic-sequence'], exts: ['heic'], kind: 'image', store: 'jpg' },
  { mime: 'image/heif', aliases: ['image/heif-sequence'], exts: ['heif'], kind: 'image', store: 'jpg' },
  { mime: 'video/mp4',       aliases: ['video/x-m4v'], exts: ['mp4', 'm4v'], kind: 'video' },
  { mime: 'video/quicktime', aliases: [], exts: ['mov'],  kind: 'video' },
  { mime: 'video/webm',      aliases: [], exts: ['webm'], kind: 'video' }
].map(Object.freeze));

const ALLOWED_FORMATS = Object.freeze([...new Set(UPLOAD_TYPES.flatMap(t => t.exts))]);
const ACCEPT_LABEL = 'JPG, PNG, GIF, WebP, HEIC, AVIF, MP4, MOV or WebM';
// For <input accept="…"> on the client.
const ACCEPT_ATTR = UPLOAD_TYPES.map(t => t.mime).concat(ALLOWED_FORMATS.map(e => '.' + e)).join(',');

const LIMITS = Object.freeze({
  FILE_BYTES: 25 * 1024 * 1024,
  DAILY_COUNT: 60,
  DAILY_BYTES: 400 * 1024 * 1024,
  MAX_INFLIGHT: 2,
  WINDOW_MS: 24 * 60 * 60 * 1000
});

// multer file ({ mimetype, originalname }) → an UPLOAD_TYPES entry, or null.
function classifyUpload(file) {
  const mime = String((file && file.mimetype) || '').toLowerCase().split(';')[0].trim();
  const name = String((file && file.originalname) || '').toLowerCase();
  if (mime) {
    const byMime = UPLOAD_TYPES.find(t => t.mime === mime || t.aliases.includes(mime));
    if (byMime) return byMime;
    if (mime !== 'application/octet-stream') return null;
  }
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = name.slice(dot + 1);
  return UPLOAD_TYPES.find(t => t.exts.includes(ext)) || null;
}

function purposeOf(q) {
  return q === 'portrait' ? 'portrait' : 'memory';
}

// Params for multer-storage-cloudinary → cloudinary.uploader.upload_stream.
function cloudinaryParams(type, userId, purpose) {
  const p = {
    folder: FOLDER,
    resource_type: type.kind,
    allowed_formats: ALLOWED_FORMATS.slice(),
    tags: ['u_' + String(userId)],
    context: { uid: String(userId) }
  };
  if (type.store) p.format = type.store;     // e.g. HEIC → stored (and served) as JPG
  if (purpose === 'portrait') {
    // House portraits are shown as a small framed picture; never keep a
    // 12-megapixel original for that (incoming transformation).
    p.transformation = [{ width: 512, height: 512, crop: 'limit' }];
  }
  return p;
}

// { count, bytes } over the last 24 h and current in-flight count → go / no go.
function quotaDecision({ count, bytes, inflight }) {
  if ((inflight || 0) >= LIMITS.MAX_INFLIGHT) {
    return { ok: false, status: 429, error: 'Another upload is still in progress — wait for it to finish.' };
  }
  if ((count || 0) >= LIMITS.DAILY_COUNT) {
    return { ok: false, status: 429, error: `Daily upload limit reached (${LIMITS.DAILY_COUNT} files) — try again tomorrow.` };
  }
  if ((bytes || 0) >= LIMITS.DAILY_BYTES) {
    return { ok: false, status: 429, error: `Daily upload limit reached (${Math.round(LIMITS.DAILY_BYTES / 1048576)} MB) — try again tomorrow.` };
  }
  return { ok: true };
}

// Fixed messages only — never err.message (multer / Cloudinary internals).
function uploadErrorResponse(err) {
  const code = err && err.code;
  const http = err && Number(err.http_code);
  if (code === 'LIMIT_FILE_SIZE') return { status: 413, error: `File too large (max ${Math.round(LIMITS.FILE_BYTES / 1048576)}MB)` };
  if (code === 'UPLOAD_TYPE') return { status: 415, error: `Unsupported file type (${ACCEPT_LABEL})` };
  if (typeof code === 'string' && code.startsWith('LIMIT_')) return { status: 400, error: 'Send one file per upload.' };
  if (http === 400) return { status: 415, error: `Unsupported file type (${ACCEPT_LABEL})` };
  if (http >= 401 || code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED') {
    return { status: 502, error: 'Upload service unavailable — try again in a moment.' };
  }
  return { status: 400, error: 'Upload failed' };
}

// ── Mongo-backed parts (not unit-tested) ──

// The caller's uploads in the last 24 h.
async function usageFor(Upload, userId, now = Date.now()) {
  const mongoose = require('mongoose');
  const since = new Date(now - LIMITS.WINDOW_MS);
  const rows = await Upload.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(String(userId)), createdAt: { $gte: since } } },
    { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$bytes' } } }
  ]);
  return rows[0] ? { count: rows[0].count, bytes: rows[0].bytes } : { count: 0, bytes: 0 };
}

// True while ANY stored record still points at this asset: another user's
// memory, a feed post, a profile picture, a /world house or a /home room
// portrait. An admin delete must not destroy a photo someone else still
// legitimately shows (a re-posted URL used to do exactly that).
async function assetStillReferenced(url) {
  const User = require('../models/user');
  const FeedPost = require('../models/FeedPost');
  const WorldHouse = require('../models/WorldHouse');
  const [u, f, w, h] = await Promise.all([
    User.exists({ $or: [{ 'watchedProjects.memories.url': url }, { profilePicture: url }] }),
    FeedPost.exists({ 'memories.url': url }),
    WorldHouse.exists({ portrait: url }),
    User.aggregate([
      { $match: { homeHouses: { $type: 'object' } } },
      { $project: { h: { $objectToArray: '$homeHouses' } } },
      { $unwind: '$h' },
      { $match: { 'h.v.portrait': url } },
      { $limit: 1 }
    ])
  ]);
  return !!(u || f || w || (h && h.length));
}

module.exports = {
  FOLDER, UPLOAD_TYPES, ALLOWED_FORMATS, ACCEPT_LABEL, ACCEPT_ATTR, LIMITS,
  classifyUpload, purposeOf, cloudinaryParams, quotaDecision, uploadErrorResponse,
  usageFor, assetStillReferenced
};
