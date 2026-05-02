const mongoose = require('mongoose');

// Mirrors the entries in projects.js. The `id` is the human-readable slug
// (e.g. "ironman1") that everything else in the system already references —
// prerequisites in other projects, debut on characters, watch progress in
// users, dialogue requires fields. Renaming an `id` would break those
// references, so the editor disables the id field on existing rows.
const ProjectSchema = new mongoose.Schema({
  id:            { type: String, required: true, unique: true, index: true },
  title:         { type: String, required: true },
  release:       { type: String, default: '' },
  prerequisites: { type: [String], default: [] },
  phase:         { type: String, default: '' },
  gridX:         { type: Number, default: 0 },
  gridY:         { type: Number, default: 0 },
  location:      { type: String, default: '' },
  image:         { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Project', ProjectSchema);
