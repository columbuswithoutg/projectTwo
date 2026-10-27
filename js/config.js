/************************************************
 * CONFIGURATION
 ************************************************/
const CONFIG = {
  H_SPACING: 200,
  V_SPACING: 260,
  NODE_WIDTH: 120,
  NODE_HEIGHT: 180,
  // Absolute path — relative ("assets/images/") would resolve wrong on
  // nested routes like /friend/:username/home (browser would try
  // /friend/:username/assets/images/...).
  IMAGE_BASE: "/assets/images/",
  START_NODE_ID: "ironman1",
  // Bumped when an asset file is replaced in-place (same filename, new
  // bytes). The server caches /assets for a day in production (max-age:
  // 1d; the service worker revalidates with cache: 'no-cache'), so a
  // browser that already fetched an old version can keep using it until
  // this version number changes the URL. Increment this whenever you swap
  // an image/webp under assets/ and want every user to pick it up on
  // their next load.
  ASSET_VERSION: 4,
};

// Append the cache-busting version to any asset URL. Use this everywhere
// we construct a src pointing at /assets so replacing files in-place
// propagates without manual cache clears. A bare "assets/…" path is made
// root-relative first: on nested routes (/friend/:username/map) the browser
// would otherwise look for /friend/:username/assets/… and get a 404.
function assetUrl(path) {
  const abs = /^(\/|[a-z][a-z0-9+.-]*:)/i.test(path) ? path : '/' + path;
  const sep = abs.includes('?') ? '&' : '?';
  return `${abs}${sep}v=${CONFIG.ASSET_VERSION}`;
}

// A profile picture is either a bundled portrait ("assets/characters/x.jpg",
// the form the server stores) or a Cloudinary URL. Portraits go through
// assetUrl so they load on nested routes and pick up ASSET_VERSION.
function profilePicUrl(pic) {
  if (!pic) return '';
  return /^assets\//.test(pic) ? assetUrl(pic) : pic;
}

const PHASE_UNLOCKERS = {
  2: "avengers1",
  3: "ageofultron",
  4: "endgame",
  5: "loki1",
  6: "loki2"
};

const API = window.location.origin + "/api";
