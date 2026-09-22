const mongoose = require('mongoose');

// A project's house in /world as decorated by its keeper (the ProjectStay
// leader). Global: everyone sees the same house. Colours are indices into
// WorldHouseLogic.PALETTE (null = engine default); props sit on the inner
// 10×10 grid of the platform. Deliberately NOT stored on Project so the CMS
// export / reseed scripts never touch (or wipe) player decorations.
const WorldHouseSchema = new mongoose.Schema({
  projectId: { type: String, required: true, unique: true, index: true },
  wallColor: { type: Number, default: null },
  roofColor: { type: Number, default: null },
  trimColor: { type: Number, default: null },
  lampColor: { type: Number, default: null },
  sign:      { type: String, default: '', maxlength: 24 },
  portrait:  { type: String, default: '', maxlength: 600 },   // Cloudinary image URL, shown in 'frame' props
  // Shape / finish (WorldHouseLogic ROOF_STYLES / WALL_STYLES / WINDOW_STYLES).
  roofStyle:   { type: String, default: 'flat' },
  roofDir:     { type: Number, default: 0 },       // gable ridge: 0 = E–W, 1 = N–S
  chimney:     { type: Boolean, default: false },
  wallStyle:   { type: String, default: 'plaster' },
  windowStyle: { type: String, default: 'cross' },
  // null = auto (one window per long wall stretch); an array is the keeper's
  // own [{ side, pos }] placement. Mixed so null and [] both round-trip.
  windows:     { type: mongoose.Schema.Types.Mixed, default: null },
  props: {
    type: [{
      kind: { type: String, required: true },
      gx:   { type: Number, required: true },
      gy:   { type: Number, required: true },
      rot:  { type: Number, default: 0 },
      _id: false
    }],
    default: []
  },
  editedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

module.exports = mongoose.model('WorldHouse', WorldHouseSchema);
