const mongoose = require('mongoose');

// One row per file accepted by POST /api/upload (routes/upload.js). Ties a
// Cloudinary asset to the account that uploaded it, which gives:
//   - the per-user daily quota (count + bytes over the last 24 h)
//   - "whose photo is this?" when an admin moderates a memory, so a
//     re-posted URL can't get the original owner's asset destroyed
// Rows are never shown to users; a lost row only means that asset can't be
// attributed any more.
const UploadSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  publicId:     { type: String, required: true, unique: true },
  resourceType: { type: String, enum: ['image', 'video'], default: 'image' },
  url:          { type: String, required: true },
  bytes:        { type: Number, default: 0 },
  purpose:      { type: String, default: 'memory' }      // 'memory' | 'portrait'
}, { timestamps: true });

UploadSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Upload', UploadSchema);
