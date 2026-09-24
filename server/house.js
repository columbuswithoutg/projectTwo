/************************************************
 * HOUSE HELPERS — shared by routes/world.js (keeper houses on /world) and
 * routes/profile.js + routes/friends.js (the owner's decorated /home rooms).
 * Both store the same shape, checked by js/world-house-logic.js.
 ************************************************/
const HouseLogic = require('../js/world-house-logic');
const AdminConfig = require('../models/AdminConfig');

// Same rule as memories (routes/progress.js): a portrait must live on the
// app's own Cloudinary account, so a keeper can't hang a tracker/phishing
// URL in a house every visitor's browser then fetches.
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_PREFIX = CLOUD_NAME ? `https://res.cloudinary.com/${CLOUD_NAME}/` : '';
function portraitOk(url) {
  return !url || (!!CLOUDINARY_PREFIX && url.startsWith(CLOUDINARY_PREFIX));
}

// Reading never truncates: a stored house keeps every prop even if the
// admin later lowered the cap (the keeper just can't add more). The grid
// itself is the only ceiling here.
const READ_CAP = HouseLogic.C.GRID_MAX * HouseLogic.C.GRID_MAX;
function toHouse(doc) {
  const { house } = HouseLogic.validateHouse(doc || {}, { maxProps: READ_CAP });
  return house;
}

// Admin cap for props per /home room (AdminConfig world.homeMaxProps). Read
// fresh — only the layout GET and a room save need it.
async function homeMaxPropsNow() {
  const fallback = AdminConfig.defaults().world.homeMaxProps || HouseLogic.C.MAX_PROPS;
  try {
    const doc = await AdminConfig.findOne({}).select('world.homeMaxProps').lean();
    const v = doc && doc.world && doc.world.homeMaxProps;
    return Number.isFinite(v) && v >= 1 ? v : fallback;
  } catch (_) {
    return fallback;
  }
}

// A user's saved room houses, limited to rooms still in their layout (a room
// taken out keeps its house in storage, so putting it back restores it).
function housesForRooms(map, rooms) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const r of rooms || []) {
    if (r && Object.prototype.hasOwnProperty.call(map, r.projectId)) out[r.projectId] = toHouse(map[r.projectId]);
  }
  return out;
}

module.exports = { CLOUDINARY_PREFIX, portraitOk, READ_CAP, toHouse, homeMaxPropsNow, housesForRooms };
