const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const auth = require('../middleware/auth');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'mcu-memories',
    resource_type: file.mimetype.startsWith('video') ? 'video' : 'image',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'mp4', 'mov', 'webm']
  })
});

// 25MB cap — enough for phone photos and short memory clips, keeps Cloudinary
// bandwidth bounded. 100MB + 10 uploads/min allowed ~1GB/min per user.
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }
});

router.post('/', auth, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large (max 25MB)' });
      }
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({
      url: req.file.path,
      type: req.file.mimetype.startsWith('video') ? 'video' : 'image'
    });
  });
});

module.exports = router;