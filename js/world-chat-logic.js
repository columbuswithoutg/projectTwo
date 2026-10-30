/************************************************
 * WORLD CHAT LOGIC — pure, dependency-free helpers
 *
 * The rules behind /world's chat channels:
 *   world   — everyone in the room
 *   project — only players in the same ZONE: the same project island, or
 *             the same road segment between two islands (voice uses the
 *             same zone — see zoneKey / roadAt)
 *   whisper — one named player (plus an echo to the sender)
 * Only World chat has a cooldown; Project and Whisper send freely.
 *
 * Shared by BOTH ends of the wire:
 *   routes/world-socket.js — authoritative validation + "which island is
 *                            this player on" from their broadcast position
 *   js/home-socket.js      — the same cooldown / parsing on the client, so
 *                            the countdown and /w command match the server
 *
 * Pure: every function takes `now` explicitly, so test/world-chat.test.js
 * can drive time by hand.
 *
 * UMD-ish: attaches to window.WorldChatLogic in the browser, exports via
 * module.exports under Node (same pattern as world-npc-logic.js).
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WorldChatLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const CHANNELS = ['world', 'project', 'whisper'];
  const C = {
    COOLDOWN_MS: 10000,
    MAX_LEN: 200,
    // Mirrors Playground3D's WORLD constants: a node sits at grid × SCALE and
    // its walkable apron is (PLATFORM_W + APRON_MARGIN) = 16 units square.
    // test/world-chat.test.js fails if these drift from js/playground3d.js —
    // a stale SCALE put players in the wrong island's Project chat.
    GRID_SCALE: 24,
    ZONE_HALF: 8,
    // Mirrors js/playground3d.js WORLD.ROAD_W / WORLD.DOORWAY_WIDTH, the two
    // inputs (with WORLD_GRID) of PG3DScene.roadView — so the server's road
    // rectangles are the ones the client walks on. Drift-tested like above.
    ROAD_W: 2.5,
    DOORWAY_WIDTH: 4.0,
    // A zone change only takes effect once the new zone has been reported
    // this long without a break — walking through a doorway (road → apron →
    // road) must not tear a voice call down and rebuild it.
    ZONE_DWELL_MS: 1000,
    // Max voice peers per player in /world: a full P2P mesh of N costs every
    // client N-1 uploads, so each player only links to their nearest few.
    VOICE_CAP: 8
  };

  // Id of the project whose apron contains (x, z), or null when the point is
  // on a road / open ground. `grid` is [{ id, gridX, gridY }]. Aprons never
  // overlap (18u spacing vs 16u square), so the first hit is the only hit.
  function projectAt(x, z, grid) {
    if (!Array.isArray(grid) || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    for (const p of grid) {
      if (!p || typeof p.gridX !== 'number' || typeof p.gridY !== 'number') continue;
      if (Math.abs(x - p.gridX * C.GRID_SCALE) <= C.ZONE_HALF &&
          Math.abs(z - p.gridY * C.GRID_SCALE) <= C.ZONE_HALF) return p.id;
    }
    return null;
  }

  // ── roads ──
  // Walkable rectangles of one road: one per leg of the polyline (`points` =
  // RoadRouter.toView(road, view).points, {x, y} with y = world z), ROAD_W
  // wide and running ROAD_W/2 past each end. The ONE copy of this maths:
  // js/playground3d.js _buildWorldRoad lays its road meshes and
  // _walkableRoads out from it too (`angle` = the mesh's rotation.y, length
  // 2·halfL), so the server's road zones are the roads players walk on.
  function roadRects(key, points, roadW) {
    const w = roadW || C.ROAD_W;
    const out = [];
    if (!Array.isArray(points)) return out;
    for (let i = 1; i < points.length; i++) {
      const ax = points[i - 1].x, az = points[i - 1].y, bx = points[i].x, bz = points[i].y;
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (!(len >= 0.01)) continue;
      const angle = Math.atan2(dx, dz);
      out.push({ key, cx: (ax + bx) / 2, cz: (az + bz) / 2, angle, cosA: Math.cos(angle), sinA: Math.sin(angle), halfW: w / 2, halfL: (len + w) / 2 });
    }
    return out;
  }

  // Every required road of the /world graph as rectangles + an index.
  // `router` is js/road-router.js and `view` is PG3DScene.roadView(WORLD)
  // (passed in so this module stays dependency-free). Mirrors
  // PG3DScene.roadRoutes: placed projects only, no trails.
  // → { rects: [{ key, cx, cz, angle, cosA, sinA, halfW, halfL }], byKey: Map key → { fromId, toId } }
  function buildRoads(projects, router, view, roadW) {
    const rects = [], byKey = new Map();
    if (!router || typeof router.route !== 'function' || !view) return { rects, byKey };
    const placed = (projects || []).filter(p => p && typeof p.gridX === 'number' && typeof p.gridY === 'number');
    const routed = router.route(placed, { trails: false });
    for (const road of (routed && routed.roads) || []) {
      if (!road || road.required === false) continue;
      byKey.set(road.key, { fromId: road.fromId, toId: road.toId });
      for (const r of roadRects(road.key, router.toView(road, view).points, roadW)) rects.push(r);
    }
    return { rects, byKey };
  }

  // Same point test as Playground3D's _roadHas.
  function inRoadRect(r, x, z) {
    const dx = x - r.cx, dz = z - r.cz;
    return Math.abs(dx * r.cosA - dz * r.sinA) <= r.halfW &&
           Math.abs(dx * r.sinA + dz * r.cosA) <= r.halfL;
  }
  // Distance from (x, z) to the rectangle's centre-line segment.
  function centreDist(r, x, z) {
    const dx = x - r.cx, dz = z - r.cz;
    const across = dx * r.cosA - dz * r.sinA;
    const along = dx * r.sinA + dz * r.cosA;
    const over = Math.max(0, Math.abs(along) - Math.max(0, r.halfL - r.halfW));
    return Math.hypot(across, over);
  }

  // Key of the road segment (x, z) stands on, or null. Where roads overlap
  // (a crossing, lanes sharing a stretch) the nearest centre line wins, ties
  // by key; but while the point is still inside `prevKey`'s road it stays
  // on it (hysteresis — no flapping across a crossing).
  function roadAt(x, z, rects, prevKey) {
    if (!Array.isArray(rects) || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    let best = null, bestD = Infinity;
    for (const r of rects) {
      if (!r || !inRoadRect(r, x, z)) continue;
      if (prevKey && r.key === prevKey) return prevKey;
      const d = centreDist(r, x, z);
      if (d < bestD || (d === bestD && String(r.key) < String(best))) { bestD = d; best = r.key; }
    }
    return best;
  }

  // "Road: Iron Man → Iron Man 2" — titles from `titleOf(id)` (falls back to ids).
  function roadLabel(road, titleOf) {
    if (!road) return '';
    const t = (id) => (typeof titleOf === 'function' && titleOf(id)) || id;
    return `Road: ${t(road.fromId)} → ${t(road.toId)}`;
  }

  // ── zones ──
  // A player's chat / voice zone: 'p:<projectId>' on an island, 'r:<roadKey>'
  // on a road, null on open ground (or unknown).
  function zoneKey(p) {
    if (!p) return null;
    if (p.projectId) return 'p:' + p.projectId;
    if (p.roadKey) return 'r:' + p.roadKey;
    return null;
  }

  // Dwell filter for zone changes. `st` = { zone, pending, since } (zone =
  // the committed zone), `cand` = the zone measured now. Returns the next
  // state plus `changed` (commit cand now) and `waitMs` (re-check after this
  // long if nothing else arrives; 0 = nothing pending).
  function dwellStep(st, cand, now, dwellMs) {
    const dwell = dwellMs == null ? C.ZONE_DWELL_MS : dwellMs;
    const zone = st ? st.zone : null;
    const c = cand || null;
    if (c === zone) return { zone, pending: undefined, since: 0, changed: false, waitMs: 0 };
    const since = (st && st.pending === c) ? st.since : now;
    if (now - since >= dwell) return { zone: c, pending: undefined, since: 0, changed: true, waitMs: 0 };
    return { zone, pending: c, since, changed: false, waitMs: dwell - (now - since) };
  }

  // Who links to whom in a capped voice mesh. `entries` = [{ id, zone, x, z }];
  // only entries sharing a non-null zone can link, and nobody gets more than
  // `cap` links. Greedy by distance (nearest pairs first, ties by ids), so
  // each player's peers are their nearest ones that still have room. A pair
  // linked in `current` (Map id → Set) counts as `keep`× its distance, so
  // two near-equal candidates don't swap back and forth every re-check.
  // → Map id → Set of linked ids (symmetric; every entry present).
  function selectVoiceLinks(entries, cap, current, keep) {
    const k = cap == null ? C.VOICE_CAP : cap;
    const stick = keep == null ? 0.8 : keep;
    const out = new Map(), byZone = new Map();
    for (const e of entries || []) {
      if (!e || !e.id || out.has(e.id)) continue;
      out.set(e.id, new Set());
      if (!e.zone) continue;
      if (!byZone.has(e.zone)) byZone.set(e.zone, []);
      byZone.get(e.zone).push(e);
    }
    const num = (v) => (Number.isFinite(v) ? v : 0);
    const linked = (a, b) => !!(current && typeof current.get === 'function' && current.get(a) && current.get(a).has(b));
    for (const list of byZone.values()) {
      list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const pairs = [];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          let d = Math.hypot(num(a.x) - num(b.x), num(a.z) - num(b.z));
          if (linked(a.id, b.id)) d *= stick;
          pairs.push({ a: a.id, b: b.id, d });
        }
      }
      pairs.sort((p, q) => p.d - q.d || (p.a < q.a ? -1 : p.a > q.a ? 1 : 0) || (p.b < q.b ? -1 : p.b > q.b ? 1 : 0));
      for (const p of pairs) {
        const A = out.get(p.a), B = out.get(p.b);
        if (A.size >= k || B.size >= k) continue;
        A.add(p.b); B.add(p.a);
      }
    }
    return out;
  }

  // The events that move a /world voice mesh from `oldLinks` to `want` (both
  // Map id → Set, symmetric: selectVoiceLinks' shape), in send order. Every
  // voice:peer-left comes first (a client always destroys a dropped link
  // before it dials a new one), then a voice:peer-joined to BOTH ends of
  // each new link, except `announcer`: it learns its links from one
  // voice:peers reply instead (routes/world-socket.js reconcileWorldVoice).
  // Each pair is visited once (a < b).
  // → [{ to, event, id }] (send `{ id }` as `event` to socket `to`)
  function voiceDeltas(oldLinks, want, announcer) {
    const out = [];
    const has = (m, a, b) => { const s = m && m.get(a); return !!s && s.has(b); };
    for (const [a, set] of oldLinks || []) {
      for (const b of set) {
        if (a < b && !has(want, a, b)) {
          out.push({ to: a, event: 'voice:peer-left', id: b }, { to: b, event: 'voice:peer-left', id: a });
        }
      }
    }
    for (const [a, set] of want || []) {
      for (const b of set) {
        if (a < b && !has(oldLinks, a, b)) {
          if (a !== announcer) out.push({ to: a, event: 'voice:peer-joined', id: b });
          if (b !== announcer) out.push({ to: b, event: 'voice:peer-joined', id: a });
        }
      }
    }
    return out;
  }

  // Only the room-wide World channel is rate limited — Project reaches a
  // handful of players and Whisper reaches one, so neither needs it.
  function hasCooldown(channel) {
    return channel === 'world';
  }

  // ms until this sender may chat on World again (0 = now).
  function cooldownLeft(lastChat, now) {
    if (!lastChat) return 0;
    return Math.max(0, C.COOLDOWN_MS - (now - lastChat));
  }

  // Normalize a raw client payload. Returns { ok, channel, text, to } or
  // { ok:false, error }. Does NOT check the cooldown or resolve the whisper
  // target — those need server state.
  function normalizeMessage(raw) {
    const channel = CHANNELS.includes(raw && raw.channel) ? raw.channel : 'world';
    // Strings only: String() on a client-sent object like {"toString":1}
    // throws, and a throw inside a socket handler takes the whole server down.
    const str = (v) => (typeof v === 'string' ? v : '');
    const text = str(raw && raw.text).trim().slice(0, C.MAX_LEN);
    if (!text) return { ok: false, error: 'empty' };
    const to = channel === 'whisper' ? str(raw && raw.to).trim().slice(0, 40) : null;
    if (channel === 'whisper' && !to) return { ok: false, error: 'no-target' };
    return { ok: true, channel, text, to };
  }

  // "/w name message" (also /whisper, /msg) → { to, text }; anything else → null.
  function parseWhisperCommand(input) {
    const m = /^\/(?:w|whisper|msg)\s+(\S+)\s+([\s\S]+)$/i.exec(String(input || '').trim());
    return m ? { to: m[1], text: m[2].trim() } : null;
  }

  // Case-insensitive username match.
  function sameName(a, b) {
    return String(a || '').toLowerCase() === String(b || '').toLowerCase();
  }

  // Friendly text for a rejected send.
  function errorText(err, info) {
    switch (err) {
      case 'cooldown':   return `Slow down — you can chat in World again in ${Math.ceil(((info && info.retryInMs) || 0) / 1000)}s.`;
      case 'no-project': return 'You’re not on a project island or road — walk onto one to use Project chat.';
      case 'not-found':  return `${(info && info.to) || 'That player'} isn’t a player here.`;
      case 'not-sent':   return 'Couldn’t deliver that whisper — try again.';
      case 'self':       return 'You can’t whisper to yourself.';
      case 'rate':       return 'You’re sending messages too quickly — give it a minute.';
      case 'daily-cap':  return 'You’ve reached today’s limit for whispering someone who isn’t your friend yet.';
      case 'no-target':  return 'Pick someone to whisper to.';
      case 'empty':      return 'Type a message first.';
      default:           return 'Message not sent.';
    }
  }

  return { CHANNELS, C, projectAt, zoneKey, roadRects, buildRoads, roadAt, roadLabel, dwellStep, selectVoiceLinks, voiceDeltas, hasCooldown, cooldownLeft, normalizeMessage, parseWhisperCommand, sameName, errorText };
});
