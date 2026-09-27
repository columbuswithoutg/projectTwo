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
  // Required before it unlocks, but not drawn as a road on the flowchart
  // (e.g. Daredevil needs Iron Man). Omitted by the admin form, so its $set
  // never clears it.
  hiddenPrerequisites: { type: [String], default: undefined },
  // Suggested before this project ("could be needed") but NEVER required to
  // unlock it — e.g. Daredevil S3 before She-Hulk. Drawn as a dashed road and
  // listed as optional; the unlock rules in server/watchRules.js and
  // js/utils.js deliberately ignore it. Editable in the admin form.
  recommendedPrerequisites: { type: [String], default: [] },
  phase:         { type: String, default: '' },
  gridX:         { type: Number, default: 0 },
  gridY:         { type: Number, default: 0 },
  location:      { type: String, default: '' },
  image:         { type: String, default: '' },
  // Watch timer. A movie/special uses `runtime` (minutes); a series season
  // lists each episode's minutes in `episodes` instead (non-empty ⇒ series).
  // Both are gates: "Mark as watched" stays locked until that much time has
  // passed since "Start watching" — see server/watchRules.js.
  runtime:       { type: Number, default: 0 },
  episodes:      { type: [Number], default: undefined }
}, { timestamps: true });

module.exports = mongoose.model('Project', ProjectSchema);
