/************************************************
 * LOCATIONS — geographic map registry
 *
 * Each location is a fixed-size rectangle on an abstract 8000×5600 canvas.
 * Once any member movie unlocks, the whole rectangle appears at its authored
 * width × height with a backdrop image. Movies are small 30×45 pins along
 * the location's bottom edge — the location itself is the dominant visual,
 * not the individual pins.
 *
 * The canvas was scaled 2× (from 4000×2800) so real-world-adjacent cities
 * (NYC metro, European capitals) no longer pile onto each other at full-
 * zoom-out. Card sizes stayed the same, so every pair of cities now has
 * 2× more breathing room in each axis (4× area).
 *
 * worldX/worldY = CENTER of the location rectangle.
 * Locations with worldY > CONFIG_WORLD.cosmosThresholdY render in the
 * cosmos band (space / multiverse / TVA).
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

// Sizes roughly track expected movie count per location at full unlock:
//   1-2 members → 280×200
//   3-4 members → 400×280
//   5-7 members → 540×340
//   27+ members (NYC) → 1000×600
const LOCATIONS = [
  // EARTH — now that the map image is gone, locations sit as islands on
  // the open ocean. Positions preserve real-world spatial relationships
  // (SF west of NYC, London east of the Americas, Tokyo east of London,
  // Wakanda in Africa's latitude band, etc.) but with real-world
  // inter-city distances scaled UP aggressively so cards have 150–400 px
  // of ocean between them on every axis. The canvas is 8000×3400 and
  // cards are 200–400 px wide — real NYC-to-DC would be ~60 px, real SF-
  // to-LA ~40 px, so fidelity to literal coords isn't possible; honest
  // *relative* geography is.

  // NYC metro cluster — Manhattan centered, boroughs fanning out in
  // their real compass directions with 200+ px gaps.
  { id: "nyc",               label: "Manhattan",         worldX: 2700, worldY: 1000, width: 380, height: 220, clusterRadius: 130, region: "nyc" },
  { id: "hells-kitchen",     label: "Hell's Kitchen",    worldX: 2200, worldY: 1000, width: 220, height: 160, clusterRadius: 100, region: "nyc" },
  { id: "harlem",            label: "Harlem",            worldX: 2700, worldY: 600,  width: 220, height: 160, clusterRadius: 90,  region: "nyc" },
  { id: "queens",            label: "Queens",            worldX: 3200, worldY: 1000, width: 220, height: 160, clusterRadius: 100, region: "nyc" },
  { id: "brooklyn",          label: "Brooklyn",          worldX: 2700, worldY: 1400, width: 260, height: 160, clusterRadius: 100, region: "nyc" },
  { id: "avengers-compound", label: "Avengers Compound", worldX: 2200, worldY: 600,  width: 280, height: 200, clusterRadius: 90,  region: "nyc" },

  // Rest of the Americas — spread across the left third of the canvas
  { id: "sf",                label: "San Francisco",     worldX: 500,  worldY: 1000, width: 280, height: 200, clusterRadius: 140, region: "west-us" },
  { id: "malibu",            label: "Malibu",            worldX: 500,  worldY: 1400, width: 360, height: 260, clusterRadius: 120, region: "west-us" },
  { id: "new-mexico",        label: "New Mexico",        worldX: 1200, worldY: 1400, width: 280, height: 200, clusterRadius: 90,  region: "west-us" },
  { id: "chicago",           label: "Chicago",           worldX: 1700, worldY: 900,  width: 280, height: 200, clusterRadius: 90,  region: "nyc" },
  { id: "nola",              label: "New Orleans",       worldX: 1600, worldY: 1800, width: 280, height: 200, clusterRadius: 90,  region: "south-us" },
  { id: "dc",                label: "Washington DC",     worldX: 2400, worldY: 1300, width: 280, height: 200, clusterRadius: 90,  region: "nyc" },

  // Europe — middle-left of the canvas, north of the equator line
  { id: "london",            label: "London",            worldX: 4200, worldY: 700,  width: 400, height: 280, clusterRadius: 120, region: "europe" },
  { id: "edinburgh",         label: "Edinburgh",         worldX: 4100, worldY: 300,  width: 240, height: 180, clusterRadius: 80,  region: "europe" },
  { id: "norway",            label: "Norway",            worldX: 4500, worldY: 200,  width: 240, height: 180, clusterRadius: 80,  region: "europe" },
  { id: "new-asgard",        label: "New Asgard",        worldX: 4700, worldY: 500,  width: 280, height: 200, clusterRadius: 100, region: "europe" },
  { id: "sokovia",           label: "Sokovia",           worldX: 4900, worldY: 900,  width: 280, height: 200, clusterRadius: 100, region: "europe" },
  { id: "budapest",          label: "Budapest",          worldX: 5100, worldY: 400,  width: 240, height: 180, clusterRadius: 80,  region: "europe" },

  // Africa / Middle East / South Asia — middle of the canvas, southern band
  { id: "cairo",             label: "Cairo",             worldX: 5200, worldY: 1500, width: 280, height: 200, clusterRadius: 80,  region: "mid-east" },
  { id: "karachi",           label: "Karachi",           worldX: 5700, worldY: 1500, width: 280, height: 200, clusterRadius: 80,  region: "asia" },
  { id: "wakanda",           label: "Wakanda",           worldX: 5300, worldY: 2100, width: 400, height: 280, clusterRadius: 160, region: "wakanda" },

  // East / Southeast Asia — right third of the canvas
  { id: "ta-lo",             label: "Ta Lo",             worldX: 6400, worldY: 1100, width: 280, height: 200, clusterRadius: 80,  region: "asia" },
  { id: "hong-kong",         label: "Hong Kong",         worldX: 6900, worldY: 1600, width: 280, height: 200, clusterRadius: 120, region: "asia" },
  { id: "madripoor",         label: "Madripoor",         worldX: 6800, worldY: 2100, width: 280, height: 200, clusterRadius: 80,  region: "asia" },

  // COSMOS BAND (worldY > 3400). Coords doubled from the previous 4000×2800
  // canvas so each cosmic location sits under the same Earth-neighbor it
  // used to.
  { id: "asgard",            label: "Asgard",            worldX: 800,  worldY: 3760, width: 300,  height: 220, clusterRadius: 120, region: "cosmos" },
  { id: "sakaar",            label: "Sakaar",            worldX: 1560, worldY: 4160, width: 280,  height: 200, clusterRadius: 90,  region: "cosmos" },
  { id: "xandar",            label: "Xandar",            worldX: 2240, worldY: 3760, width: 280,  height: 200, clusterRadius: 90,  region: "cosmos" },
  { id: "knowhere",          label: "Knowhere",          worldX: 2920, worldY: 4200, width: 280,  height: 200, clusterRadius: 100, region: "cosmos" },
  { id: "sovereign",         label: "Sovereign",         worldX: 3560, worldY: 3760, width: 280,  height: 200, clusterRadius: 80,  region: "cosmos" },
  { id: "titan",             label: "Titan",             worldX: 4200, worldY: 4200, width: 280,  height: 200, clusterRadius: 90,  region: "cosmos" },
  { id: "vormir",            label: "Vormir",            worldX: 4840, worldY: 3760, width: 280,  height: 200, clusterRadius: 80,  region: "cosmos" },
  { id: "hala",              label: "Hala",              worldX: 5520, worldY: 4200, width: 320,  height: 220, clusterRadius: 100, region: "cosmos" },
  { id: "counter-earth",     label: "Counter-Earth",     worldX: 6160, worldY: 3760, width: 280,  height: 200, clusterRadius: 80,  region: "cosmos" },
  { id: "quantum",           label: "Quantum Realm",     worldX: 6800, worldY: 4200, width: 280,  height: 200, clusterRadius: 90,  region: "cosmos" },

  // VOID / NON-SPATIAL
  { id: "tva",               label: "TVA",               worldX: 360,  worldY: 4800, width: 320,  height: 220, clusterRadius: 100, region: "void" },
  { id: "multiverse",        label: "Multiverse",        worldX: 7400, worldY: 4840, width: 560,  height: 360, clusterRadius: 180, region: "void" },
];

const LOCATION_BY_ID = new Map(LOCATIONS.map(l => [l.id, l]));

// Region tints — used both as a fallback background when no image exists AND
// as the region-glow halo around every location.
const REGION_TINTS = {
  "nyc":      { a: "rgba(220, 220, 255, 0.12)", b: "rgba(70, 80, 110, 0.04)" },
  "west-us":  { a: "rgba(255, 190, 140, 0.10)", b: "rgba(180, 110, 70, 0.03)" },
  "south-us": { a: "rgba(180, 140, 90, 0.10)",  b: "rgba(120, 90, 50, 0.03)" },
  "europe":   { a: "rgba(180, 200, 255, 0.10)", b: "rgba(80, 100, 160, 0.03)" },
  "wakanda":  { a: "rgba(255, 210, 90, 0.16)",  b: "rgba(40, 120, 70, 0.05)" },
  "mid-east": { a: "rgba(240, 190, 110, 0.12)", b: "rgba(160, 110, 50, 0.04)" },
  "asia":     { a: "rgba(90, 210, 200, 0.12)",  b: "rgba(30, 120, 140, 0.03)" },
  "cosmos":   { a: "rgba(255, 140, 70, 0.14)",  b: "rgba(140, 40, 160, 0.05)" },
  "void":     { a: "rgba(180, 120, 255, 0.16)", b: "rgba(90, 50, 160, 0.05)" },
};

const isCosmicLocation = (loc) => loc && loc.worldY > CONFIG_WORLD.cosmosThresholdY;
