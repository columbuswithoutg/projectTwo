/************************************************
 * LOCATIONS — geographic map registry
 *
 * Each location is a fixed-size rectangle on an abstract 4000×2600 canvas.
 * Once any member movie unlocks, the whole rectangle appears at its authored
 * width × height with a backdrop image. Movies are small 30×45 pins along
 * the location's bottom edge — the location itself is the dominant visual,
 * not the individual pins.
 *
 * worldX/worldY = CENTER of the location rectangle.
 * Locations with worldY > CONFIG_WORLD.cosmosThresholdY render in the
 * cosmos band (space / multiverse / TVA).
 ************************************************/
const CONFIG_WORLD = {
  worldWidth: 4000,
  worldHeight: 2800,
  zoomMin: 0.25,
  zoomMax: 2.0,
  zoomDefault: 0.55,
  zoomWorldPreset: 0.35,
  zoomRegionPreset: 1.0,
  cosmosThresholdY: 1700,
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
  // EARTH — Americas
  { id: "nyc",               label: "New York",          worldX: 900,  worldY: 820,  width: 1000, height: 600, clusterRadius: 180, region: "nyc" },
  { id: "avengers-compound", label: "Avengers Compound", worldX: 250,  worldY: 260,  width: 280,  height: 200, clusterRadius: 90,  region: "nyc" },
  { id: "malibu",            label: "Malibu",            worldX: 120,  worldY: 1040, width: 360,  height: 260, clusterRadius: 120, region: "west-us" },
  { id: "new-mexico",        label: "New Mexico",        worldX: 500,  worldY: 1440, width: 280,  height: 200, clusterRadius: 90,  region: "west-us" },
  { id: "dc",                label: "Washington DC",     worldX: 1620, worldY: 980,  width: 280,  height: 200, clusterRadius: 90,  region: "nyc" },
  { id: "sf",                label: "San Francisco",     worldX: 100,  worldY: 1480, width: 280,  height: 200, clusterRadius: 140, region: "west-us" },
  { id: "nola",              label: "New Orleans",       worldX: 1340, worldY: 1500, width: 280,  height: 200, clusterRadius: 90,  region: "south-us" },
  { id: "chicago",           label: "Chicago",           worldX: 1620, worldY: 560,  width: 280,  height: 200, clusterRadius: 90,  region: "nyc" },

  // EARTH — Europe
  { id: "london",            label: "London",            worldX: 1900, worldY: 300,  width: 400,  height: 280, clusterRadius: 120, region: "europe" },
  { id: "sokovia",           label: "Sokovia",           worldX: 2300, worldY: 380,  width: 280,  height: 200, clusterRadius: 100, region: "europe" },
  { id: "edinburgh",         label: "Edinburgh",         worldX: 1840, worldY: 80,   width: 240,  height: 180, clusterRadius: 80,  region: "europe" },
  { id: "budapest",          label: "Budapest",          worldX: 2440, worldY: 180,  width: 240,  height: 180, clusterRadius: 80,  region: "europe" },
  { id: "norway",            label: "Norway",            worldX: 2140, worldY: 60,   width: 240,  height: 180, clusterRadius: 80,  region: "europe" },
  { id: "new-asgard",        label: "New Asgard",        worldX: 2260, worldY: 600,  width: 280,  height: 200, clusterRadius: 100, region: "europe" },

  // EARTH — Africa / Middle East
  { id: "wakanda",           label: "Wakanda",           worldX: 2200, worldY: 1260, width: 400,  height: 280, clusterRadius: 160, region: "wakanda" },
  { id: "cairo",             label: "Cairo",             worldX: 2540, worldY: 900,  width: 280,  height: 200, clusterRadius: 80,  region: "mid-east" },
  { id: "karachi",           label: "Karachi",           worldX: 2820, worldY: 900,  width: 280,  height: 200, clusterRadius: 80,  region: "asia" },

  // EARTH — Asia
  { id: "hong-kong",         label: "Hong Kong",         worldX: 3420, worldY: 1060, width: 280,  height: 200, clusterRadius: 120, region: "asia" },
  { id: "ta-lo",             label: "Ta Lo",             worldX: 3160, worldY: 780,  width: 280,  height: 200, clusterRadius: 80,  region: "asia" },
  { id: "madripoor",         label: "Madripoor",         worldX: 3700, worldY: 1340, width: 280,  height: 200, clusterRadius: 80,  region: "asia" },

  // COSMOS BAND (worldY > 1700)
  { id: "asgard",            label: "Asgard",            worldX: 400,  worldY: 1880, width: 300,  height: 220, clusterRadius: 120, region: "cosmos" },
  { id: "sakaar",            label: "Sakaar",            worldX: 780,  worldY: 2080, width: 280,  height: 200, clusterRadius: 90,  region: "cosmos" },
  { id: "xandar",            label: "Xandar",            worldX: 1120, worldY: 1880, width: 280,  height: 200, clusterRadius: 90,  region: "cosmos" },
  { id: "knowhere",          label: "Knowhere",          worldX: 1460, worldY: 2100, width: 280,  height: 200, clusterRadius: 100, region: "cosmos" },
  { id: "sovereign",         label: "Sovereign",         worldX: 1780, worldY: 1880, width: 280,  height: 200, clusterRadius: 80,  region: "cosmos" },
  { id: "titan",             label: "Titan",             worldX: 2100, worldY: 2100, width: 280,  height: 200, clusterRadius: 90,  region: "cosmos" },
  { id: "vormir",            label: "Vormir",            worldX: 2420, worldY: 1880, width: 280,  height: 200, clusterRadius: 80,  region: "cosmos" },
  { id: "hala",              label: "Hala",              worldX: 2760, worldY: 2100, width: 320,  height: 220, clusterRadius: 100, region: "cosmos" },
  { id: "counter-earth",     label: "Counter-Earth",     worldX: 3080, worldY: 1880, width: 280,  height: 200, clusterRadius: 80,  region: "cosmos" },
  { id: "quantum",           label: "Quantum Realm",     worldX: 3400, worldY: 2100, width: 280,  height: 200, clusterRadius: 90,  region: "cosmos" },

  // VOID / NON-SPATIAL
  { id: "tva",               label: "TVA",               worldX: 180,  worldY: 2400, width: 320,  height: 220, clusterRadius: 100, region: "void" },
  { id: "multiverse",        label: "Multiverse",        worldX: 3700, worldY: 2420, width: 560,  height: 360, clusterRadius: 180, region: "void" },
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
