/************************************************
 * CONFIGURATION
 ************************************************/
const CONFIG = {
  H_SPACING: 160,
  V_SPACING: 220,
  NODE_WIDTH: 120,
  NODE_HEIGHT: 180,
  IMAGE_BASE: "assets/images/",
  START_NODE_ID: "ironman1",
  STORAGE_KEY: "watchProgress_v2"
};

// Scale down for mobile — zoomed out feel
const isMobile = window.matchMedia('(max-width: 640px)').matches;
if (isMobile) {
  CONFIG.H_SPACING = 110;
  CONFIG.V_SPACING = 130;
  CONFIG.NODE_WIDTH = 55;
  CONFIG.NODE_HEIGHT = 82;
}

const PHASE_UNLOCKERS = {
  2: "avengers1",
  3: "ageofultron",
  4: "endgame",
  5: "loki1",
  6: "loki2"
};

const API = window.location.origin + "/api";
