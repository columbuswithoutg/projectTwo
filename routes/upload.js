/************************************************
 * POST /api/upload — one memory photo / video (or a house portrait with
 * ?purpose=portrait) to Cloudinary.
 *
 * What is accepted, the per-user quota and the error copy all live in
 * server/upload-policy.js; every accepted file is recorded in
 * models/Upload.js against the uploader. server.js adds a 10 / minute / IP
 * limiter on top.
 ************************************************/
const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const auth = require('../middleware/auth');
const Upload = require('../models/Upload');
const Policy = require('../server/upload-policy');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  // req.uploadType / req.uploadPurpose are set before the stream starts
  // (fileFilter below and the route handler).
  params: async (req) => Policy.cloudinaryParams(req.uploadType, req.user.id, req.uploadPurpose)
});

const upload = multer({
  storage,
  limits: { fileSize: Policy.LIMITS.FILE_BYTES, files: 1, fields: 4, parts: 6 },
  // Decides from the mimetype (extension fallback for octet-stream) BEFORE
  // a byte reaches Cloudinary; anything unknown is refused with 415.
  fileFilter(req, file, cb) {
    const type = Policy.classifyUpload(file);
    if (!type) return cb(Object.assign(new Error('Unsupported file type'), { code: 'UPLOAD_TYPE' }));
    req.uploadType = type;
    cb(null, true);
  }
});

// userId → uploads currently streaming. Bounded by construction (deleted at 0).
const inflight = new Map();

router.post('/', auth, async (req, res) => {
  const userId = String(req.user.id);
  req.uploadPurpose = Policy.purposeOf(req.query.purpose);

  // Quota check first, on what is already recorded (bytes are only known
  // after the upload, so the quota can be overshot by at most MAX_INFLIGHT
  // files — fine on one instance).
  let usage;
  try {
    usage = await Policy.usageFor(Upload, userId);
  } catch (e) {
    console.error('[upload] quota lookup failed:', e && e.message);
    return res.status(500).json({ error: 'Server error' });
  }
  const q = Policy.quotaDecision({ ...usage, inflight: inflight.get(userId) || 0 });
  if (!q.ok) return res.status(q.status).json({ error: q.error });

  inflight.set(userId, (inflight.get(userId) || 0) + 1);
  const release = () => {
    const n = (inflight.get(userId) || 1) - 1;
    if (n <= 0) inflight.delete(userId); else inflight.set(userId, n);
  };

  upload.single('file')(req, res, async (err) => {
    try {
      if (err) {
        // The raw error stays in the log; the client gets a fixed message.
        console.error('[upload] failed:', err && (err.code || err.http_code || ''), err && err.message);
        const r = Policy.uploadErrorResponse(err);
        return res.status(r.status).json({ error: r.error });
      }
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const type = req.uploadType;
      // CloudinaryStorage: path = secure_url, filename = public_id, size = bytes.
      // Recorded BEFORE the reply so the next upload's quota check sees it.
      try {
        await Upload.create({
          userId, publicId: req.file.filename, resourceType: type.kind,
          url: req.file.path, bytes: req.file.size || 0, purpose: req.uploadPurpose
        });
      } catch (e) {
        console.error('[upload] record failed:', e && e.message);
      }
      res.json({ url: req.file.path, type: type.kind });
    } finally {
      release();
    }
  });
});

module.exports = router;
