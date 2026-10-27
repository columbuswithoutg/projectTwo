/************************************************
 * HOUSE HELPERS — shared by routes/world.js (keeper houses on /world) and
 * routes/profile.js + routes/friends.js (the owner's decorated /home rooms).
 * Both store the same shape, checked by js/world-house-logic.js.
 ************************************************/
const HouseLogic = require('../js/world-house-logic');
const AdminConfig = require('../models/AdminConfig');

// Same rule as memories (server/cloudinary-url.js): a portrait must be one
// of this app's own uploads, so a keeper can't hang a tracker / phishing /
// proxied URL in a house every visitor's browser then fetches.
const { isOurAssetUrl } = require('./cloudinary-url');
function portraitOk(url) {
  return !url || isOurAssetUrl(url);
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

// /home has ONE roof for the whole home: these are the fields of it. Every
// room save carries them (the editor's roof controls), and the latest save
// becomes the home's roof.
function pickRoof(house) {
  const h = house || {};
  return {
    roofStyle: h.roofStyle || 'flat',
    roofColor: h.roofColor != null ? h.roofColor : null,
    roofDir: h.roofDir || 0,
    chimney: !!h.chimney
  };
}

// The home's roof: the stored one (re-validated), else — for homes decorated
// before the shared roof existed — the first decorated room's, in layout
// order. null = the plain default roof.
function homeRoofFor(user, rooms) {
  if (user && user.homeRoof && typeof user.homeRoof === 'object') return pickRoof(toHouse(user.homeRoof));
  const map = (user && user.homeHouses) || {};
  for (const r of rooms || []) {
    if (r && Object.prototype.hasOwnProperty.call(map, r.projectId)) return pickRoof(toHouse(map[r.projectId]));
  }
  return null;
}

// The /home layout as it may be SHOWN right now: rooms whose project the user
// still has watched, capped at floor(watched / 2) — the same rule the layout
// PUT enforces — and connected. Anything that shrank the watch list (the
// old Clear Progress button) can have left a stored layout over its cap; serving it as-is showed
// rooms the owner could no longer save. Kept rooms are the connected set
// grown from the first kept room (breadth-first, so the entrance room stays
// first), in their original order. The stored layout is never rewritten here.
//   layout:     { rooms: [{ projectId, gx, gy }] } (or null)
//   watchedIds: Set or array of watched project ids
function effectiveLayout(layout, watchedIds) {
  const watched = watchedIds instanceof Set ? watchedIds : new Set(watchedIds || []);
  const rooms = ((layout && Array.isArray(layout.rooms)) ? layout.rooms : [])
    .filter(r => r && watched.has(r.projectId));
  const cap = Math.floor(watched.size / 2);
  if (!rooms.length || cap <= 0) return { rooms: [] };
  const byCell = new Map(rooms.map(r => [`${r.gx},${r.gy}`, r]));
  const keep = new Set([rooms[0]]);
  const queue = [rooms[0]];
  while (queue.length && keep.size < cap) {
    const r = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = byCell.get(`${r.gx + dx},${r.gy + dy}`);
      if (n && !keep.has(n) && keep.size < cap) { keep.add(n); queue.push(n); }
    }
  }
  return { rooms: rooms.filter(r => keep.has(r)).map(r => ({ projectId: r.projectId, gx: r.gx, gy: r.gy })) };
}

// Watched project ids of a user doc (entries may be legacy plain strings).
function watchedIdsOf(user) {
  return new Set(((user && user.watchedProjects) || []).map(e => (typeof e === 'string' ? e : e && e.projectId)).filter(Boolean));
}

// ── Saving a /home layout (PUT /api/profile/home-layout) ──
// Each room is a 1×1 grid cell { projectId, gx, gy }; |gx|, |gy| ≤ this
// bounds growth to a sane region.
const HOME_GRID_LIMIT = 32;

// Every 2 watched projects unlock one room (the same rule effectiveLayout
// applies when showing a home).
function maxHomeRooms(watchedCount) {
  return Math.floor((Number(watchedCount) || 0) / 2);
}

// True when the rooms form one 4-connected component (0 or 1 room always is).
function isLayoutConnected(rooms) {
  if (rooms.length <= 1) return true;
  const set = new Set(rooms.map(r => `${r.gx},${r.gy}`));
  const seen = new Set([`${rooms[0].gx},${rooms[0].gy}`]);
  const queue = [rooms[0]];
  while (queue.length) {
    const r = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${r.gx + dx},${r.gy + dy}`;
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        queue.push({ gx: r.gx + dx, gy: r.gy + dy });
      }
    }
  }
  return seen.size === rooms.length;
}

// The user-independent half of the layout PUT: shape, integer coords within
// the grid, no shared cell, no project twice. → { rooms } (rebuilt, nothing
// but the three fields) or { error }. Coords must be real integers — 1.2 and
// 1.7 used to pass, get floored on save and land in the same cell after the
// duplicate check had already looked at the raw values. Watched-list
// membership, the room cap and connectivity need the user and are checked
// by the route.
function checkLayoutRooms(list) {
  const rooms = [];
  for (const r of list) {
    if (!r || typeof r.projectId !== 'string' || r.projectId.length === 0 || r.projectId.length > 64) {
      return { error: 'each room needs a non-empty projectId string' };
    }
    if (!Number.isInteger(r.gx) || Math.abs(r.gx) > HOME_GRID_LIMIT ||
        !Number.isInteger(r.gy) || Math.abs(r.gy) > HOME_GRID_LIMIT) {
      return { error: `grid coords must be integers within ±${HOME_GRID_LIMIT}` };
    }
    rooms.push({ projectId: r.projectId, gx: r.gx, gy: r.gy });
  }
  const cellSet = new Set();
  const idSet = new Set();
  for (const r of rooms) {
    const k = `${r.gx},${r.gy}`;
    if (cellSet.has(k)) return { error: `two rooms share grid cell (${r.gx}, ${r.gy})` };
    cellSet.add(k);
    if (idSet.has(r.projectId)) return { error: `project ${r.projectId} appears twice` };
    idSet.add(r.projectId);
  }
  return { rooms };
}

// Whitelist of acceptable profile-picture sources (POST /api/profile/picture):
//   - relative path into the bundled character art (assets/characters/…)
//   - one of this app's own Cloudinary uploads (server/cloudinary-url.js —
//     the same strict check memories use; a bare cloud prefix also let
//     fetch-proxy and transformation URLs through)
// Blocks javascript: URIs, data: URIs, and arbitrary attacker-controlled URLs.
function validProfilePictureUrl(url) {
  if (typeof url !== 'string') return false;
  if (url.length > 512) return false;
  if (/^assets\/characters\/[\w.\-]+$/.test(url)) return true;
  return isOurAssetUrl(url);
}

module.exports = {
  portraitOk, READ_CAP, toHouse, homeMaxPropsNow, housesForRooms, pickRoof, homeRoofFor,
  effectiveLayout, watchedIdsOf,
  HOME_GRID_LIMIT, maxHomeRooms, isLayoutConnected, checkLayoutRooms, validProfilePictureUrl
};
