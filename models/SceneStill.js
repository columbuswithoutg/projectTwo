const mongoose = require('mongoose');

// One still for the /world "Scene Guess" minigame: an image from a project
// plus the moment it happens, typed by an admin off the Disney+ player.
// Deliberately NOT on Project — project records are public and cached
// (/api/content/projects, projects.js), and `timeSec` is the answer: it
// must never reach a client before the reveal. The image's Cloudinary id is
// random (unique_filename), so the URL gives nothing away either.
const SceneStillSchema = new mongoose.Schema({
  projectId: { type: String, required: true },
  // Series only: 0-based episode index into Project.episodes; null for a movie.
  episode:   { type: Number, default: null },
  // Seconds from the start of the movie / episode (SceneGuessLogic.validStill).
  timeSec:   { type: Number, required: true, min: 0 },
  imageUrl:  { type: String, required: true, maxlength: 600 },
  publicId:  { type: String, default: '' },     // Cloudinary public_id, for destroy on delete
  width:     { type: Number, default: 0 },
  height:    { type: Number, default: 0 },
  active:    { type: Boolean, default: true },  // inactive stills stay in the admin tab but are never drawn
  addedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

SceneStillSchema.index({ projectId: 1, active: 1 });

module.exports = mongoose.model('SceneStill', SceneStillSchema);
