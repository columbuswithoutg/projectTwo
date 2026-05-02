const mongoose = require('mongoose');

// Mirrors entries in characters.js. The `id` slug ("ironman", "cap") is
// used as a key in the dialogue `pairs` map and in user walker
// selections — same don't-rename rule as Project.id applies.
const StageSchema = new mongoose.Schema({
  after: { type: String, required: true },
  image: { type: String, default: '' },
  look:  { type: String, default: '' }
}, { _id: false });

const CharacterSchema = new mongoose.Schema({
  id:     { type: String, required: true, unique: true, index: true },
  name:   { type: String, required: true },
  debut:  { type: String, default: '' },
  image:  { type: String, default: '' },
  stages: { type: [StageSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Character', CharacterSchema);
