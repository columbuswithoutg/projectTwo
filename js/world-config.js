/************************************************
 * WORLD CONFIG — display geometry for the map view
 *
 * Extracted from locations.js so the bulky LOCATIONS array can move to
 * MongoDB (Phase 3 CMS) while these display constants stay as a small
 * static script. Values here describe the canvas itself (dimensions,
 * zoom presets, pin sizes), not editable content.
 ************************************************/
const CONFIG_WORLD = {
  worldWidth: 8000,
  worldHeight: 5600,
  // Minimum and world-view zoom halved to match the 2× canvas so the
  // whole Earth still fits on screen when you hit "W". zoomDefault and
  // zoomRegionPreset stay the same — at those zoom levels cards appear
  // at the same screen size they did before the scale-up; you just see
  // less of the world at once, which is the point.
  zoomMin: 0.125,
  zoomMax: 2.0,
  zoomDefault: 0.55,
  zoomWorldPreset: 0.175,
  zoomRegionPreset: 1.0,
  cosmosThresholdY: 3400,
  snapDurationMs: 600,
  nodeGap: 24,
  // Pin row spec (consumed by layout.packLocation)
  pinWidth: 30,
  pinHeight: 45,
  pinGap: 4,
  pinShelfPad: 14,
};
