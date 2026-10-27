/************************************************
 * WORLD HOUSE LOGIC — pure, dependency-free helpers
 *
 * The rules behind an editable project house in /world: a palette of
 * colours for the wall / roof / trim / lamps, a roof shape, a wall finish,
 * a window style and where the windows sit, a short sign over the door,
 * and a handful of interior props placed on a 10×10 grid inside the 12×12
 * platform (one cell of margin so a prop never overlaps the wall ring).
 * The DOOR is never part of a house: its side, position and width come
 * from the roads (road-router.js ports, via PG3DScene.roadPorts) and stay fixed.
 *
 * Shared by BOTH ends of the wire:
 *   routes/world.js      — validates a keeper's PUT before saving
 *   js/views/world.js    — validates the editor draft for the live preview
 *   js/playground3d.js   — PALETTE + cellToLocal when rendering a house
 *
 * UMD-ish: attaches to window.WorldHouseLogic in the browser, exports via
 * module.exports under Node (same pattern as world-chat-logic.js).
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WorldHouseLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Swatches a keeper can pick from. Index 0..5 are the engine defaults
  // (plaster wall, the six phase roofs come next, then trim / lamp / extras)
  // so the "Default" chip and a picked swatch can both map to a real colour.
  const PALETTE = [
    0xd9cbb0,   // 0 plaster (default wall)
    0xb5563f,   // 1 terracotta (Phase 1 roof)
    0x6478a6,   // 2 slate blue (Phase 2 roof)
    0x6f8f5a,   // 3 moss (Phase 3 roof)
    0x8a5a86,   // 4 plum (Phase 4 roof)
    0x3f8f8f,   // 5 teal (Phase 5 roof)
    0xb98a3f,   // 6 amber (Phase 6 roof)
    0x9a8c6f,   // 7 stone trim (default trim)
    0xffd98a,   // 8 warm lamp (default lamp)
    0xf2e6d0,   // 9 cream
    0xc9d6e8,   // 10 sky
    0xe8c9c9,   // 11 blush
    0x3a342a,   // 12 charcoal
    0xf5f5f5    // 13 white
  ];

  // Every kind lives on ONE of five layers, and a layer only competes with
  // itself for cells — so a rug runs under a sofa, a picture hangs over a
  // bookshelf, a fan turns above a table and a kettle sits on a counter:
  //   floor   solid furniture (one prop per cell, multi-cell kinds take `span`)
  //   rug     flat floor covering
  //   hung    wall-mounted; snaps to the nearest wall and faces into the room
  //   ceil    hangs from the ceiling
  //   top     small things standing on a SURFACE_KIND (needs one in its cell)
  const FLOOR_KINDS = [
    'chair', 'table', 'plant', 'lamp', 'bookshelf', 'crate', 'bed',
    'sofa', 'armchair', 'stool', 'coffee_table', 'desk', 'dresser', 'nightstand', 'workbench',
    'counter', 'sink', 'stove', 'fridge', 'washer', 'bin',
    'toilet', 'bathtub', 'shower',
    'wardrobe', 'crib', 'petbed',
    'tv', 'fireplace', 'piano', 'aquarium', 'shoerack', 'treadmill'
  ];
  const RUG_KINDS = ['rug'];
  const HUNG_KINDS = ['frame', 'mirror', 'clock', 'curtains', 'towelrack', 'stringlights'];
  const CEILING_KINDS = ['fan', 'hangplant'];
  const TOP_KINDS = ['microwave', 'kettle', 'pots', 'fruitbowl', 'plates', 'toaster', 'vase', 'laptop', 'console', 'books'];
  // What a TOP kind may stand on.
  const SURFACE_KINDS = ['table', 'coffee_table', 'desk', 'counter', 'stove', 'dresser', 'nightstand', 'workbench', 'washer', 'crate'];
  // The first nine keep their historical order (stored houses never reference
  // an index, but the editor's chips and the tests do).
  const PROP_KINDS = ['chair', 'table', 'frame', 'plant', 'lamp', 'rug', 'bookshelf', 'crate', 'bed']
    .concat(FLOOR_KINDS.filter(k => !['chair', 'table', 'plant', 'lamp', 'bookshelf', 'crate', 'bed'].includes(k)))
    .concat(HUNG_KINDS.filter(k => k !== 'frame'), CEILING_KINDS, TOP_KINDS);
  // Props that take more than one cell: the anchor cell plus (span − 1) cells
  // along the prop's facing. A bed's anchor is its headboard cell.
  const PROP_SPAN = { bed: 2, bathtub: 2, treadmill: 2 };
  // Where rot·90° points: rot 0 → +z (S), 1 → +x (E), 2 → −z (N), 3 → −x (W).
  const FACING = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  // Props that never touch the wall ring rules (hung / flat / overhead / on a surface).
  const FREE_KINDS = ['rug'].concat(HUNG_KINDS, CEILING_KINDS, TOP_KINDS);
  // Kinds you can sit on (a bed is lain in — see the engine).
  const SEAT_KINDS = ['chair', 'armchair', 'sofa', 'stool', 'toilet'];

  function layerOf(kind) {
    if (RUG_KINDS.includes(kind)) return 'rug';
    if (HUNG_KINDS.includes(kind)) return 'hung';
    if (CEILING_KINDS.includes(kind)) return 'ceil';
    if (TOP_KINDS.includes(kind)) return 'top';
    return 'floor';
  }

  // Kinds that fuse with a neighbour of the same group standing side by side
  // (same facing, adjacent along the line perpendicular to it). The engine
  // builds each cell flush with the next, so the joins are seamless: a row of
  // tables is one long table, counters + sink + stove are one worktop, beds
  // make a double, sofas make a sectional.
  const JOIN_GROUP = {
    bookshelf: 'shelf', table: 'table', coffee_table: 'coffee', desk: 'desk', sofa: 'sofa', bed: 'bed',
    wardrobe: 'wardrobe', dresser: 'dresser', workbench: 'bench',
    counter: 'kitchen', sink: 'kitchen', stove: 'kitchen', fridge: 'kitchen', washer: 'kitchen',
    rug: 'rug'
  };

  // The editor's kind picker, grouped by room. A kind can appear in several.
  const CATEGORIES = [
    { id: 'living',  label: 'Living',  glyph: '🛋️', kinds: ['sofa', 'armchair', 'coffee_table', 'tv', 'fireplace', 'bookshelf', 'piano', 'rug', 'aquarium', 'plant', 'lamp'] },
    { id: 'kitchen', label: 'Kitchen', glyph: '🍳', kinds: ['counter', 'sink', 'stove', 'fridge', 'table', 'chair', 'stool', 'bin', 'microwave', 'kettle', 'pots', 'toaster', 'fruitbowl', 'plates'] },
    { id: 'bath',    label: 'Bath',    glyph: '🛁', kinds: ['toilet', 'bathtub', 'shower', 'sink', 'washer', 'towelrack', 'mirror', 'bin'] },
    { id: 'bedroom', label: 'Bedroom', glyph: '🛏️', kinds: ['bed', 'wardrobe', 'dresser', 'nightstand', 'crib', 'petbed', 'mirror', 'rug'] },
    { id: 'work',    label: 'Work',    glyph: '💻', kinds: ['desk', 'chair', 'laptop', 'console', 'books', 'bookshelf', 'workbench', 'treadmill', 'shoerack', 'crate'] },
    { id: 'decor',   label: 'Decor',   glyph: '🖼️', kinds: ['frame', 'mirror', 'clock', 'curtains', 'stringlights', 'vase', 'plant', 'hangplant', 'fan', 'lamp'] }
  ];
  const COLOR_SLOTS = ['wallColor', 'roofColor', 'trimColor', 'lampColor'];

  // Shape / finish options. The first entry of each list is the engine
  // default (what an undecorated house looks like).
  const ROOF_STYLES = ['flat', 'gable', 'hip'];
  const WALL_STYLES = ['plaster', 'brick', 'stone', 'timber', 'glass'];   // glass = see-through walls, no windows carved
  const WINDOW_STYLES = ['cross', 'grid', 'plain', 'shutters'];
  const SIDES = ['N', 'S', 'E', 'W'];
  const STYLE_SLOTS = [['roofStyle', ROOF_STYLES], ['wallStyle', WALL_STYLES], ['windowStyle', WINDOW_STYLES]];

  // Props that belong against a wall: placed on an edge cell of the grid they
  // turn their back to that wall and (in the engine) sit flush against it.
  // Anywhere else they stand free and can be rotated like any prop.
  const WALL_BACKED = [
    'bookshelf', 'chair', 'bed', 'sofa', 'desk', 'dresser', 'nightstand', 'workbench', 'wardrobe', 'crib',
    'counter', 'sink', 'stove', 'fridge', 'washer', 'toilet', 'bathtub', 'shower',
    'tv', 'fireplace', 'piano', 'aquarium', 'shoerack'
  ];
  const SIDE_ROT = { N: 0, W: 1, S: 2, E: 3 };   // rot that faces INTO the room from that wall

  const C = {
    MAX_PROPS: 40,      // a fully furnished house (kitchenware and wall hangings count) without filling all 100 cells
    SIGN_MAX: 24,
    PORTRAIT_MAX: 600,  // URL length cap; the server also pins it to the app's Cloudinary prefix
    GRID_MIN: 1,
    GRID_MAX: 10,       // inner 10×10 of the 12×12 platform
    PLATFORM_W: 12,
    MAX_WINDOWS: 8,
    WINDOW_W: 1.5,      // single pane width (matches playground3d WORLD.WINDOW_W); a run of n
                        // adjacent cells becomes ONE pane (n − 1) + WINDOW_W wide
    WINDOW_MARGIN: 0.35 // a pane keeps this much solid wall from a door jamb / corner
  };

  // `windows: null` means "auto" — the engine carves one centred window on
  // every long wall stretch, exactly as an undecorated house. An array (even
  // an empty one) is the keeper's explicit placement.
  function defaultHouse() {
    return {
      wallColor: null, roofColor: null, trimColor: null, lampColor: null,
      sign: '', portrait: '', props: [],
      roofStyle: ROOF_STYLES[0], roofDir: 0, chimney: false,
      wallStyle: WALL_STYLES[0], windowStyle: WINDOW_STYLES[0], windows: null
    };
  }

  // The keeper's portrait: an https image URL shown inside every 'frame'
  // prop. Only the shape is checked here; routes/world.js also requires the
  // app's own Cloudinary prefix so a house can't embed an arbitrary URL.
  function sanitizePortrait(s) {
    // Strings only — String() on a crafted object ({toString:1}) throws.
    if (s != null && typeof s !== 'string') return null;
    const url = (s || '').trim();
    if (!url) return '';
    if (url.length > C.PORTRAIT_MAX || !/^https:\/\/[^\s"'<>]+$/.test(url)) return null;
    return url;
  }

  // Control chars out, whitespace collapsed, trimmed, capped. The sign is
  // drawn onto a canvas (never HTML), so markup characters stay literal.
  function sanitizeSign(s) {
    // Strings and numbers only — String() on a crafted object throws.
    return (typeof s === 'string' ? s : typeof s === 'number' ? String(s) : '')
      .replace(/[ -]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, C.SIGN_MAX);
  }

  function isInt(n) { return typeof n === 'number' && Number.isFinite(n) && Math.floor(n) === n; }

  // Frames hang on walls, never free-standing: snap a cell to the nearest
  // edge of the grid and face the picture into the room. rot follows the
  // engine's convention (rot·90° about y; a rot-0 picture faces +z / south):
  // N wall → 0, W wall → 1 (faces +x), S wall → 2, E wall → 3 (faces -x).
  // Ties (a corner-ish cell) prefer N/S over W/E.
  function snapFrameToWall(gx, gy) {
    const dN = gy - C.GRID_MIN, dS = C.GRID_MAX - gy, dW = gx - C.GRID_MIN, dE = C.GRID_MAX - gx;
    const best = Math.min(dN, dS, dW, dE);
    if (best === dN) return { gx, gy: C.GRID_MIN, rot: 0 };
    if (best === dS) return { gx, gy: C.GRID_MAX, rot: 2 };
    if (best === dW) return { gx: C.GRID_MIN, gy, rot: 1 };
    return { gx: C.GRID_MAX, gy, rot: 3 };
  }

  // Which wall an edge cell of the grid touches ('N' | 'S' | 'W' | 'E'), or
  // null for an interior cell. Corners count as N/S first, like frames.
  function wallSideOfCell(gx, gy) {
    if (gy === C.GRID_MIN) return 'N';
    if (gy === C.GRID_MAX) return 'S';
    if (gx === C.GRID_MIN) return 'W';
    if (gx === C.GRID_MAX) return 'E';
    return null;
  }

  function isWallBacked(kind) { return WALL_BACKED.includes(kind); }

  // The forced facing for a wall-backed prop on an edge cell (back to the
  // wall, front into the room), or null when the prop is free to rotate.
  function wallBackedRot(kind, gx, gy) {
    if (!isWallBacked(kind)) return null;
    const side = wallSideOfCell(gx, gy);
    return side ? SIDE_ROT[side] : null;
  }

  // Any solid prop on an edge cell hugs that wall (the engine slides it flush);
  // returns the side, or null for interior cells / hung and flat props.
  function wallHug(kind, gx, gy) {
    if (FREE_KINDS.includes(kind)) return null;
    return wallSideOfCell(gx, gy);
  }

  // ── multi-cell props ──

  function normRot(rot) { return isInt(rot) ? ((rot % 4) + 4) % 4 : 0; }

  // Every grid cell a prop occupies: its anchor cell, then (span − 1) more
  // along its facing. Single-cell props return just the anchor.
  function propCells(p) {
    const span = PROP_SPAN[p.kind] || 1;
    const [dx, dy] = FACING[normRot(p.rot)];
    const out = [];
    for (let i = 0; i < span; i++) out.push([p.gx + dx * i, p.gy + dy * i]);
    return out;
  }

  // Offset (in cells) from the anchor cell centre to the prop's own centre.
  function propCentreOffset(p) {
    const span = PROP_SPAN[p.kind] || 1;
    const [dx, dy] = FACING[normRot(p.rot)];
    const k = (span - 1) / 2;
    return { dx: dx * k, dy: dy * k };
  }

  // Cells taken on one layer ('floor' by default — see layerOf).
  function occupiedCells(props, skipIndex, layer) {
    const want = layer || 'floor';
    const set = new Set();
    (props || []).forEach((p, i) => {
      if (i === skipIndex || !p || layerOf(p.kind) !== want) return;
      for (const [x, y] of propCells(p)) set.add(`${x},${y}`);
    });
    return set;
  }

  // Is there a surface (table, counter…) under cell (gx, gy)?
  function surfaceAt(props, gx, gy, skipIndex) {
    return (props || []).some((p, i) => i !== skipIndex && p && SURFACE_KINDS.includes(p.kind)
      && propCells(p).some(([x, y]) => x === gx && y === gy));
  }

  // The top-layer props standing on the surface at `index` (and on no other
  // surface), so removing / moving it can take them along instead of leaving
  // a kettle floating.
  function dependentTops(props, index) {
    const base = (props || [])[index];
    if (!base || !SURFACE_KINDS.includes(base.kind)) return [];
    const out = [];
    props.forEach((p, i) => {
      if (!p || layerOf(p.kind) !== 'top') return;
      if (propCells(base).some(([x, y]) => x === p.gx && y === p.gy) && !surfaceAt(props, p.gx, p.gy, index)) out.push(i);
    });
    return out;
  }

  // Can `cand` ({ kind, gx, gy, rot }) go into `props`? Applies the frame snap
  // and the wall-backed facing FIRST (so a bed on an edge turns instead of
  // being refused), then checks the cap, the grid bounds of every cell and
  // overlaps. `opts.skipIndex` ignores one existing prop (rotating in place).
  // Returns { ok: true, placed } or { ok: false, error }.
  function canPlaceProp(props, cand, opts) {
    const list = Array.isArray(props) ? props : [];
    const o = opts || {};
    const maxProps = Number.isFinite(o.maxProps) ? o.maxProps : C.MAX_PROPS;
    if (!cand || !PROP_KINDS.includes(cand.kind)) return { ok: false, error: `unknown prop kind ${typeof cand?.kind === 'string' ? cand.kind.slice(0, 40) : typeof cand?.kind}` };
    if (!isInt(cand.gx) || !isInt(cand.gy) || cand.gx < C.GRID_MIN || cand.gx > C.GRID_MAX || cand.gy < C.GRID_MIN || cand.gy > C.GRID_MAX) {
      return { ok: false, error: `prop cell must be within ${C.GRID_MIN}..${C.GRID_MAX}` };
    }
    const layer = layerOf(cand.kind);
    // Hung things (frames, mirrors, clocks…) go on the nearest wall facing in.
    const placed = layer === 'hung'
      ? { kind: cand.kind, ...snapFrameToWall(cand.gx, cand.gy) }
      : { kind: cand.kind, gx: cand.gx, gy: cand.gy, rot: normRot(cand.rot) };
    const forced = wallBackedRot(placed.kind, placed.gx, placed.gy);
    if (forced != null) placed.rot = forced;
    const count = list.length - (o.skipIndex != null && list[o.skipIndex] ? 1 : 0);
    if (count >= maxProps) return { ok: false, error: `at most ${maxProps} props` };
    const taken = occupiedCells(list, o.skipIndex, layer);
    const cells = propCells(placed);
    for (const [x, y] of cells) {
      if (x < C.GRID_MIN || x > C.GRID_MAX || y < C.GRID_MIN || y > C.GRID_MAX) {
        return { ok: false, error: cells.length > 1
          ? `a ${placed.kind} needs the cell in front of it too`
          : `prop cell must be within ${C.GRID_MIN}..${C.GRID_MAX}` };
      }
      if (taken.has(`${x},${y}`)) return { ok: false, error: `two props share cell (${x}, ${y})` };
    }
    if (layer === 'top' && !surfaceAt(list, placed.gx, placed.gy, o.skipIndex)) {
      return { ok: false, error: `a ${placed.kind} needs a table, counter or other surface to stand on` };
    }
    return { ok: true, placed };
  }

  // Runs of the same kind standing side by side: adjacent cells along the
  // axis perpendicular to their facing (rot 0/2 → same gy, consecutive gx;
  // rot 1/3 → same gx, consecutive gy), same rot. On an edge row/column that
  // also means the same wall. The engine builds one wide object per run
  // (bookshelves fill their cells edge to edge) with one collision box.
  // Returns [{ indices, rot, from: [gx,gy], to: [gx,gy], cells, centre: {gx, gy} }].
  function propRuns(props, kind) {
    const kinds = Array.isArray(kind) ? kind : [kind];   // a list = one joined group (counter + sink + stove)
    const items = [];
    (props || []).forEach((p, i) => { if (p && kinds.includes(p.kind)) items.push({ i, gx: p.gx, gy: p.gy, rot: normRot(p.rot) }); });
    const runs = [];
    const used = new Set();
    const byKey = new Map();
    for (const it of items) byKey.set(`${it.gx},${it.gy},${it.rot}`, it);
    for (const it of items.sort((a, b) => a.gy - b.gy || a.gx - b.gx)) {
      if (used.has(it.i)) continue;
      const along = it.rot % 2 === 0 ? [1, 0] : [0, 1];
      // walk back to the start of the run, then forward collecting members
      let sx = it.gx, sy = it.gy;
      while (byKey.has(`${sx - along[0]},${sy - along[1]},${it.rot}`)) { sx -= along[0]; sy -= along[1]; }
      const members = [];
      let cx = sx, cy = sy;
      while (byKey.has(`${cx},${cy},${it.rot}`)) { members.push(byKey.get(`${cx},${cy},${it.rot}`)); cx += along[0]; cy += along[1]; }
      for (const m of members) used.add(m.i);
      const last = members[members.length - 1];
      runs.push({
        indices: members.map(m => m.i), rot: it.rot,
        from: [sx, sy], to: [last.gx, last.gy], cells: members.length,
        centre: { gx: (sx + last.gx) / 2, gy: (sy + last.gy) / 2 }
      });
    }
    return runs;
  }

  // Local-right of a prop facing `rot`, as a grid step: rot 0 → +x, 1 → −y …
  function rightOf(rot) {
    const f = FACING[normRot(rot)];
    return [f[1], -f[0]];
  }

  // What a prop touches, for the engine to build it flush with its neighbours.
  //   l / r      a same-group prop (same facing) on its left / right
  //   n s e w    rugs: a rug in the cell to the north / south / east / west
  //   armL armR  sofas: keep this end's arm? An end that touches another sofa
  //              (beyond it, or a sofa turned the other way in front / behind —
  //              the corner of an L-shaped sectional) has none.
  // Always returns the full shape, so callers needn't guard.
  function joinFlags(props, index) {
    const out = { l: false, r: false, n: false, s: false, e: false, w: false, armL: true, armR: true };
    const list = props || [];
    const p = list[index];
    if (!p) return out;
    const group = JOIN_GROUP[p.kind];
    if (!group) return out;
    const rot = normRot(p.rot);
    const at = new Map();   // cell key → rot, same-group props only (anchors; every span cell for sofas)
    list.forEach((q, i) => {
      if (!q || i === index || JOIN_GROUP[q.kind] !== group) return;
      for (const [x, y] of propCells(q)) at.set(`${x},${y}`, normRot(q.rot));
    });
    if (group === 'rug') {
      out.n = at.has(`${p.gx},${p.gy - 1}`); out.s = at.has(`${p.gx},${p.gy + 1}`);
      out.w = at.has(`${p.gx - 1},${p.gy}`); out.e = at.has(`${p.gx + 1},${p.gy}`);
      return out;
    }
    const [rx, ry] = rightOf(rot);
    out.r = at.get(`${p.gx + rx},${p.gy + ry}`) === rot;
    out.l = at.get(`${p.gx - rx},${p.gy - ry}`) === rot;
    if (p.kind === 'sofa') {
      const [fx, fy] = FACING[rot];
      const turned = (x, y) => at.has(`${x},${y}`) && at.get(`${x},${y}`) % 2 !== rot % 2;
      const touches = (sx) => {   // sx = +1 right end, −1 left end
        const bx = p.gx + rx * sx, by = p.gy + ry * sx;
        return at.has(`${bx},${by}`) || turned(p.gx + fx, p.gy + fy) || turned(p.gx - fx, p.gy - fy);
      };
      out.armR = !out.r && !touches(1);
      out.armL = !out.l && !touches(-1);
    }
    return out;
  }

  // Which wall a (snapped) frame hangs on: 'N' | 'S' | 'W' | 'E'.
  function frameWall(p) {
    if (!p) return 'N';
    if (p.rot === 1) return 'W';
    if (p.rot === 2) return 'S';
    if (p.rot === 3) return 'E';
    return 'N';
  }

  // Normalise a raw client payload into a house, or explain why not.
  // Unknown fields are dropped; missing fields fall back to defaults.
  // opts.maxProps overrides the prop cap (the admin setting on the server;
  // GET passes the grid size so a lowered cap never truncates a stored house).
  function validateHouse(raw, opts) {
    const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const maxProps = (opts && Number.isFinite(opts.maxProps)) ? opts.maxProps : C.MAX_PROPS;
    const house = defaultHouse();
    for (const slot of COLOR_SLOTS) {
      const v = src[slot];
      if (v == null) { house[slot] = null; continue; }
      if (!isInt(v) || v < 0 || v >= PALETTE.length) return { ok: false, error: `${slot} must be a palette index` };
      house[slot] = v;
    }
    house.sign = sanitizeSign(src.sign);
    const portrait = sanitizePortrait(src.portrait);
    if (portrait === null) return { ok: false, error: 'portrait must be an https image URL' };
    house.portrait = portrait;
    for (const [slot, list] of STYLE_SLOTS) {
      const v = src[slot];
      if (v == null) continue;                       // missing → default
      if (!list.includes(v)) return { ok: false, error: `${slot} must be one of ${list.join(', ')}` };
      house[slot] = v;
    }
    house.roofDir = (src.roofDir === 1 || src.roofDir === '1' || src.roofDir === true) ? 1 : 0;
    house.chimney = src.chimney === true || src.chimney === 1 || src.chimney === 'true';
    if (src.windows != null) {
      if (!Array.isArray(src.windows)) return { ok: false, error: 'windows must be an array' };
      if (src.windows.length > C.MAX_WINDOWS) return { ok: false, error: `at most ${C.MAX_WINDOWS} windows` };
      const placed = [];
      for (const w of src.windows) {
        if (!w || typeof w !== 'object') return { ok: false, error: 'bad window' };
        if (!SIDES.includes(w.side)) return { ok: false, error: 'window side must be N, S, E or W' };
        if (!isInt(w.pos) || w.pos < C.GRID_MIN || w.pos > C.GRID_MAX) {
          return { ok: false, error: `window position must be within ${C.GRID_MIN}..${C.GRID_MAX}` };
        }
        if (placed.some(p => p.side === w.side && p.pos === w.pos)) {
          return { ok: false, error: `two windows share the same spot (${w.side} ${w.pos})` };
        }
        placed.push({ side: w.side, pos: w.pos });
      }
      house.windows = placed;
    }
    if (src.props != null) {
      if (!Array.isArray(src.props)) return { ok: false, error: 'props must be an array' };
      if (src.props.length > maxProps) return { ok: false, error: `at most ${maxProps} props` };
      for (const p of src.props) if (!p || typeof p !== 'object') return { ok: false, error: 'bad prop' };
      // Things that stand on a surface go last, so a kettle listed before its
      // counter still finds it.
      const ordered = src.props.filter(p => layerOf(p.kind) !== 'top').concat(src.props.filter(p => layerOf(p.kind) === 'top'));
      for (const p of ordered) {
        // canPlaceProp snaps frames to the nearest wall, turns wall-backed
        // props (bookshelf / chair / bed) on an edge cell to face the room,
        // and checks bounds + overlaps over every cell a prop covers.
        const r = canPlaceProp(house.props, p, { maxProps });
        if (!r.ok) return r;
        house.props.push({ kind: r.placed.kind, gx: r.placed.gx, gy: r.placed.gy, rot: r.placed.rot });
      }
    }
    return { ok: true, house };
  }

  // Grid cell (1..10) → platform-local centre. Cell 1 starts one unit in
  // from the platform edge (-6), so cells cover -5..+5 and the walls at ±6
  // never meet a prop.
  function cellToLocal(gx, gy) {
    return { x: gx - C.PLATFORM_W / 2 + 0.5, z: gy - C.PLATFORM_W / 2 + 0.5 };
  }

  // ── Windows vs the (fixed) door ──
  // Everything below works in "edge-offset" units along one wall: 0 is the
  // wall's start corner, PLATFORM_W its end, and grid cell c (0..11) covers
  // [c, c+1). Interior cells 1..10 are the only legal window positions, so
  // pos 1 spans 0.75..2.25 and never reaches the corner. The engine reports
  // door openings in these units (Playground3D.getHouseLayout) and both it
  // and the editor use the SAME test, so a window the editor accepts is one
  // the engine will carve — and neither can ever touch the doorway.

  // The pane's [lo, hi] along the wall for a window at cell `pos`.
  function windowSpan(pos) {
    const c = pos + 0.5;
    return [c - C.WINDOW_W / 2, c + C.WINDOW_W / 2];
  }

  // Would a pane at `pos` (grown by `margin`) overlap any door opening?
  function windowBlocked(pos, openings, margin) {
    const m = (margin == null) ? C.WINDOW_MARGIN : margin;
    const [lo, hi] = windowSpan(pos);
    for (const o of (openings || [])) {
      if (!o) continue;
      const a = Number(o[0]), b = Number(o[1]);
      if (!(b > a)) continue;
      if (lo - m < b && hi + m > a) return true;
    }
    return false;
  }

  // Door openings → inclusive grid-cell ranges they cover (for drawing the
  // locked door cells on the editor's wall ring). Clamped to 0..11.
  function openingsToCells(openings) {
    const out = [];
    for (const o of (openings || [])) {
      if (!o) continue;
      const a = Number(o[0]), b = Number(o[1]);
      if (!(b > a)) continue;
      const from = Math.max(0, Math.min(C.PLATFORM_W - 1, Math.floor(a + 1e-6)));
      const to = Math.max(0, Math.min(C.PLATFORM_W - 1, Math.ceil(b - 1e-6) - 1));
      if (to >= from) out.push([from, to]);
    }
    return out;
  }

  // The engine's "auto" rule, mirrored for the editor's greyed preview:
  // one centred window on every solid stretch at least `minSeg` long.
  // Returns pane centres in edge-offset units.
  function autoWindowCentres(openings, minSeg) {
    const min = (minSeg == null) ? 3.2 : minSeg;
    const sorted = (openings || []).filter(o => o && o[1] > o[0]).map(o => [Number(o[0]), Number(o[1])]).sort((p, q) => p[0] - q[0]);
    const centres = [];
    let cursor = 0;
    const push = (s, e) => { if (e - s >= min) centres.push((s + e) / 2); };
    for (const [a, b] of sorted) {
      if (a > cursor + 0.05) push(cursor, a);
      cursor = Math.max(cursor, b);
    }
    if (cursor < C.PLATFORM_W - 0.05) push(cursor, C.PLATFORM_W);
    return centres;
  }

  // Can the keeper put a window at (side, pos), given the windows already
  // placed and this side's door openings? Explains a refusal in plain words.
  // Adjacent cells are fine — they merge into one wide pane (windowRuns).
  function canPlaceWindow(windows, side, pos, openings) {
    const list = Array.isArray(windows) ? windows : [];
    if (!SIDES.includes(side)) return { ok: false, error: 'Pick a wall.' };
    if (!isInt(pos) || pos < C.GRID_MIN || pos > C.GRID_MAX) return { ok: false, error: 'That spot is a corner — windows go along a wall.' };
    if (list.length >= C.MAX_WINDOWS) return { ok: false, error: `That's the limit — ${C.MAX_WINDOWS} windows per house.` };
    if (windowBlocked(pos, openings)) return { ok: false, error: 'The door is fixed — it sits where the road comes in. Try another stretch of wall.' };
    if (list.some(w => w.side === side && w.pos === pos)) return { ok: false, error: 'There is already a window here.' };
    return { ok: true };
  }

  // Group one wall's window cells into runs of adjacent cells. Each run is
  // built as a single pane: centre (edge-offset units) = midpoint of the run,
  // width = (cells − 1) + WINDOW_W, so two cells side by side read as one
  // double window rather than two overlapping panes. `positions` may hold
  // duplicates or be unsorted; cells the caller already rejected (door) are
  // simply not passed in, which splits a run there.
  function windowRuns(positions) {
    const cells = [...new Set((positions || []).filter(isInt))].sort((a, b) => a - b);
    const runs = [];
    for (const p of cells) {
      const last = runs[runs.length - 1];
      if (last && p === last.to + 1) last.to = p;
      else runs.push({ from: p, to: p });
    }
    return runs.map(r => {
      const n = r.to - r.from + 1;
      return { from: r.from, to: r.to, cells: n, centre: (r.from + r.to + 1) / 2, width: (n - 1) + C.WINDOW_W };
    });
  }

  // "3h 12m" / "45m" / "<1m" — the stay-label formatter; it lives here so the
  // client (which does not load the server-only stay module) can render it.
  function formatStay(ms) {
    const mins = Math.floor((Number(ms) || 0) / 60000);
    if (mins < 1) return '<1m';
    const h = Math.floor(mins / 60), m = mins % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  return {
    PALETTE, PROP_KINDS, PROP_SPAN, FACING, WALL_BACKED, FREE_KINDS, COLOR_SLOTS, ROOF_STYLES, WALL_STYLES, WINDOW_STYLES, SIDES, C,
    FLOOR_KINDS, RUG_KINDS, HUNG_KINDS, CEILING_KINDS, TOP_KINDS, SURFACE_KINDS, SEAT_KINDS, JOIN_GROUP, CATEGORIES,
    defaultHouse, sanitizeSign, sanitizePortrait, validateHouse, cellToLocal, snapFrameToWall, frameWall,
    wallSideOfCell, isWallBacked, wallBackedRot, wallHug, layerOf,
    propCells, propCentreOffset, occupiedCells, surfaceAt, dependentTops, canPlaceProp, propRuns, joinFlags, rightOf,
    windowSpan, windowBlocked, openingsToCells, autoWindowCentres, canPlaceWindow, windowRuns, formatStay
  };
});
