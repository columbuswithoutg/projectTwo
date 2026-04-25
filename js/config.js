/************************************************
 * CONFIGURATION
 ************************************************/
const CONFIG = {
  H_SPACING: 200,
  V_SPACING: 260,
  NODE_WIDTH: 120,
  NODE_HEIGHT: 180,
  IMAGE_BASE: "assets/images/",
  START_NODE_ID: "ironman1",
  STORAGE_KEY: "watchProgress_v2",
  // Bumped when an asset file is replaced in-place (same filename, new
  // bytes). The server caches /assets aggressively (max-age: 30d), so a
  // browser that already fetched an old version will keep using it until
  // this version number changes the URL. Increment this whenever you swap
  // an image/webp under assets/ and want every user to pick it up on
  // their next load.
  ASSET_VERSION: 3,
};

// Append the cache-busting version to any asset URL. Use this everywhere
// we construct a src pointing at /assets so replacing files in-place
// propagates without manual cache clears.
function assetUrl(path) {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}v=${CONFIG.ASSET_VERSION}`;
}

const PHASE_UNLOCKERS = {
  2: "avengers1",
  3: "ageofultron",
  4: "endgame",
  5: "loki1",
  6: "loki2"
};

const API = window.location.origin + "/api";
