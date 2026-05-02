const mongoose = require('mongoose');

// Mirrors LOCATIONS in locations.js. CONFIG_WORLD (display geometry like
// world width, zoom presets, pin sizes) is intentionally NOT in this model
// — it's display config, not editable content. It stays in the new
// js/world-config.js static file.
const LocationSchema = new mongoose.Schema({
  id:            { type: String, required: true, unique: true, index: true },
  label:         { type: String, required: true },
  worldX:        { type: Number, default: 0 },
  worldY:        { type: Number, default: 0 },
  width:         { type: Number, default: 280 },
  height:        { type: Number, default: 200 },
  clusterRadius: { type: Number, default: 100 },
  region:        { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Location', LocationSchema);
