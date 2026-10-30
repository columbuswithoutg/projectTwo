/************************************************
 * ADMIN SANITIZE — pure validators behind the admin write routes
 *
 *   pickNumber() / diffConfig()        PUT /config (walker physics, flags)
 *   sanitizeProject()                  POST/PUT /content/projects
 *   parsePositions() / planPositions() PUT /content/projects/bulk/positions
 *   sanitizeCharacter()                POST/PUT /content/characters
 *   sanitizeLocation()                 POST/PUT /content/locations
 *   sanitizePairs()                    PUT /content/dialogues (walker pairs)
 *   sanitizeVillainLines()             PUT /content/dialogues (villain lines)
 *   parseEpisode() / checkFields()     Scene Guess stills (routes/admin-scenes.js)
 *
 * No Mongo here: the routes do the reads and writes, these only shape and
 * check the payload. Unit tests: test/admin-sanitize.test.js.
 ************************************************/
const watchRules = require('./watchRules');               // sanitizeRuntime / sanitizeEpisodes
const ProjectLogic = require('../js/project-logic');      // GRID_LIMIT (shared with the client)
const SceneLogic = require('../js/scene-guess-logic');

// id slugs are referenced from many places (project.prerequisites,
// character.debut, dialogue requires, watch progress) — we accept these
// chars and reject anything else. Renaming an id is therefore a delete +
// recreate flow, not an update; the editor disables the id field on
// existing rows.
const ID_REGEX = /^[a-z0-9_-]{1,80}$/i;

// String fields are bounded to keep documents sane and prevent a stuck
// admin from accidentally storing megabytes via copy-paste.
const STR_MAX = 280;
const STAGE_MAX = 20;
const DIALOG_LINE_MAX = 600;
const DIALOG_LINES_MAX = 12;

function trimStr(v, max = STR_MAX) {
  if (typeof v !== 'string') return '';
  return v.slice(0, max);
}

// ---------- Config ----------

function pickNumber(value, rule) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < rule.min || value > rule.max) return null;
  if (rule.integer && !Number.isInteger(value)) return null;
  return value;
}

function diffConfig(prev, next) {
  const out = {};
  const sections = ['walker', 'encounter', 'fight', 'flags', 'world'];
  for (const sec of sections) {
    const p = (prev && prev[sec]) || {};
    const n = (next && next[sec]) || {};
    for (const k of Object.keys(n)) {
      // One level of nesting (world.npcBodyTypes) — diff per NPC, not the map.
      if (n[k] && typeof n[k] === 'object') {
        const pk = (p[k] && typeof p[k] === 'object') ? p[k] : {};
        for (const kk of Object.keys(n[k])) {
          if (pk[kk] !== n[k][kk]) out[`${sec}.${k}.${kk}`] = { from: pk[kk], to: n[k][kk] };
        }
        continue;
      }
      if (p[k] !== n[k]) out[`${sec}.${k}`] = { from: p[k], to: n[k] };
    }
  }
  return out;
}

// ---------- Projects ----------

// MAP-14: board cells must be integers within ±GRID_LIMIT (60). This used
// to clamp to ±500 and truncate fractions silently; an outlying cell froze
// the client road router, so it is a field error now.
const GRID_LIMIT = ProjectLogic.GRID_LIMIT;
const GRID_MIN = -GRID_LIMIT, GRID_MAX = GRID_LIMIT;

// null when `v` is a usable board coordinate, else the field error.
function gridCoordError(v) {
  if (!Number.isInteger(v)) return 'invalid';
  if (v < GRID_MIN || v > GRID_MAX) return 'out of range';
  return null;
}

function sanitizeProject(body, requireId = true) {
  const errors = {};
  const out = {};
  if (requireId) {
    if (!ID_REGEX.test(body.id || '')) errors.id = 'invalid id';
    else out.id = body.id;
  }
  if (typeof body.title !== 'string' || !body.title.trim()) errors.title = 'required';
  else out.title = trimStr(body.title);
  out.release = trimStr(body.release || '', 40);
  // Prerequisite lists are checked by checkPrereqs() (routes/admin.js)
  // against the real project list — bad, unknown, self or duplicate-list
  // ids, a list over PREREQ_MAX and lock loops are all explicit 400s now.
  // (They used to be dropped or truncated silently, and an unknown id
  // locked a project forever.)
  out.prerequisites = Array.isArray(body.prerequisites) ? body.prerequisites : (body.prerequisites == null ? [] : body.prerequisites);
  out.recommendedPrerequisites = Array.isArray(body.recommendedPrerequisites)
    ? body.recommendedPrerequisites
    : (body.recommendedPrerequisites == null ? [] : body.recommendedPrerequisites);
  out.phase = trimStr(body.phase || '', 40);
  // Board position is owned by the CMS board editor (PUT
  // /content/projects/bulk/positions). Omit the keys entirely when the
  // caller doesn't send them so `Project.create` falls back to the schema
  // default and `findOneAndUpdate`'s $set leaves the stored coords
  // untouched — otherwise every plain form save (e.g. editing just the
  // title) would silently reset the project to (0,0).
  // A coordinate that IS sent must be an integer within ±GRID_LIMIT (MAP-14).
  for (const k of ['gridX', 'gridY']) {
    if (body[k] === undefined) continue;
    const err = gridCoordError(body[k]);
    if (err) errors[k] = err;
    else out[k] = body[k];
  }
  out.location = trimStr(body.location || '', 80);
  out.image = trimStr(body.image || '', 200);
  // Watch timer: minutes for a movie, or one entry per episode for a series
  // (a non-empty episode list makes it a series and runtime is ignored).
  out.episodes = watchRules.sanitizeEpisodes(body.episodes);
  out.runtime = out.episodes.length ? 0 : watchRules.sanitizeRuntime(body.runtime);
  return { out, errors };
}

const POSITIONS_MAX = 500;

// Shape check of the board editor's payload. → { wanted: Map id → { gridX,
// gridY } } or { error, fields } (a 400).
function parsePositions(positions) {
  if (!Array.isArray(positions)) return { error: 'positions must be an array' };
  if (positions.length > POSITIONS_MAX) return { error: `At most ${POSITIONS_MAX} positions per request` };
  const seen = new Set();
  const wanted = new Map(); // id -> { gridX, gridY }
  for (const p of positions) {
    if (!p || typeof p !== 'object') return { error: 'Invalid position entry' };
    if (!ID_REGEX.test(p.id || '')) return { error: 'Invalid project id', fields: { id: String(p.id) } };
    if (seen.has(p.id)) return { error: 'Duplicate id in payload', fields: { id: p.id } };
    // Integers only — a fractional coord means a client bug, don't silently truncate it away.
    if (!Number.isInteger(p.gridX) || !Number.isInteger(p.gridY)) {
      return { error: 'gridX/gridY must be integers', fields: { id: p.id } };
    }
    // MAP-14: ±GRID_LIMIT (was ±500), and the field error names the axis.
    const ex = gridCoordError(p.gridX), ey = gridCoordError(p.gridY);
    if (ex || ey) {
      return {
        error: `Coordinates must be between ${GRID_MIN} and ${GRID_MAX}`,
        fields: { id: p.id, ...(ex ? { gridX: ex } : {}), ...(ey ? { gridY: ey } : {}) }
      };
    }
    seen.add(p.id);
    wanted.set(p.id, { gridX: p.gridX, gridY: p.gridY });
  }
  return { wanted };
}

// The wanted moves merged over the saved positions (`all`: [{ id, gridX,
// gridY }]), checked for collisions on the MERGED state. Writes nothing.
// → { next: [{ id, gridX, gridY }] every project after the moves,
//     changes: [{ id, from, to }] the moves that differ from what's saved,
//     conflicts: [{ gridX, gridY, ids }] cells two or more projects would share }
function planPositions(all, wanted) {
  const cells = new Map(); // "gx,gy" -> [id]
  const next = [];
  const changes = [];
  for (const p of all) {
    const to = wanted.get(p.id) || { gridX: p.gridX | 0, gridY: p.gridY | 0 };
    const key = `${to.gridX},${to.gridY}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(p.id);
    next.push({ id: p.id, gridX: to.gridX, gridY: to.gridY });
    if (wanted.has(p.id) && (to.gridX !== p.gridX || to.gridY !== p.gridY)) {
      changes.push({ id: p.id, from: { gridX: p.gridX, gridY: p.gridY }, to });
    }
  }
  const conflicts = [...cells.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => {
      const [gridX, gridY] = key.split(',').map(Number);
      return { gridX, gridY, ids };
    });
  return { next, changes, conflicts };
}

// ---------- Characters ----------

function sanitizeCharacter(body, requireId = true) {
  const errors = {};
  const out = {};
  if (requireId) {
    if (!ID_REGEX.test(body.id || '')) errors.id = 'invalid id';
    else out.id = body.id;
  }
  if (typeof body.name !== 'string' || !body.name.trim()) errors.name = 'required';
  else out.name = trimStr(body.name);
  out.debut = trimStr(body.debut || '', 80);
  out.image = trimStr(body.image || '', 200);
  // ADM2-06: an over-long summary is a field error (it used to be cut at
  // DIALOG_LINE_MAX silently, mid-word).
  out.summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  if (out.summary.length > DIALOG_LINE_MAX) errors.summary = `over ${DIALOG_LINE_MAX} characters`;
  out.stages = Array.isArray(body.stages)
    ? body.stages
        .map(s => s && typeof s === 'object' ? {
          after: trimStr(s.after || '', 80),
          image: trimStr(s.image || '', 200),
          look:  trimStr(s.look || '', STR_MAX)
        } : null)
        .filter(s => s && s.after)
        .slice(0, STAGE_MAX)
    : [];
  return { out, errors };
}

// ---------- Locations ----------

// The numeric fields and what counts as valid (they must be finite too).
const LOCATION_NUMBERS = {
  worldX: () => true,
  worldY: () => true,
  width: (v) => v > 0,
  height: (v) => v > 0,
  clusterRadius: (v) => v >= 0
};

// `requireId` true = create (POST), false = edit (PUT).
function sanitizeLocation(body, requireId = true) {
  const errors = {};
  const out = {};
  if (requireId) {
    if (!ID_REGEX.test(body.id || '')) errors.id = 'invalid id';
    else out.id = body.id;
  }
  if (typeof body.label !== 'string' || !body.label.trim()) errors.label = 'required';
  else out.label = trimStr(body.label);
  // ADM-11: these used to fall back to 0 / the defaults when not finite, so
  // a blank or garbled box moved the location to (0,0) or reset its size.
  // Now: missing on create → 'required'; sent but not a usable number →
  // 'invalid'; missing on an edit → key omitted, so the PUT's $set keeps
  // the stored value.
  for (const [k, ok] of Object.entries(LOCATION_NUMBERS)) {
    const v = body[k];
    if (v === undefined) {
      if (requireId) errors[k] = 'required';
      continue;
    }
    if (!Number.isFinite(v) || !ok(v)) errors[k] = 'invalid';
    else out[k] = v;
  }
  out.region = trimStr(body.region || '', 60);
  return { out, errors };
}

// ---------- Dialogues ----------

// Pair keys must be "id1|id2" where both halves are valid ids and are
// in canonical (alphabetical) order. Reject anything that doesn't match;
// otherwise the runtime getDialogue lookup (which sorts the args before
// joining) will silently miss admin-saved entries with a non-canonical key.
const PAIR_KEY_REGEX = /^([a-z0-9_-]{1,80})\|([a-z0-9_-]{1,80})$/i;

// ADM-07: one list of dialogue lines → { lines, error }. Lines are trimmed
// and blank ones dropped; more than DIALOG_LINES_MAX lines or a line over
// DIALOG_LINE_MAX characters is an error (it used to be cut silently, and
// villain lists kept empty strings). The editor (js/views/admin/
// cms-dialogues.js) blocks both before sending — this is the backstop.
function cleanLines(raw) {
  const lines = (Array.isArray(raw) ? raw : [])
    .filter(l => typeof l === 'string')
    .map(l => l.trim())
    .filter(Boolean);
  if (lines.length > DIALOG_LINES_MAX) return { lines, error: `at most ${DIALOG_LINES_MAX} lines` };
  const i = lines.findIndex(l => l.length > DIALOG_LINE_MAX);
  if (i >= 0) return { lines, error: `line ${i + 1} is over ${DIALOG_LINE_MAX} characters` };
  return { lines, error: null };
}

// → { out, errors }. errors keys: "pairs.<key>.<exchange index>".
function sanitizePairs(input) {
  const out = {};
  const errors = {};
  if (!input || typeof input !== 'object') return { out, errors };
  for (const [key, exchanges] of Object.entries(input)) {
    const m = PAIR_KEY_REGEX.exec(key);
    if (!m) continue;
    const [, a, b] = m;
    const sortedKey = [a, b].sort().join('|');
    if (sortedKey !== key) continue; // require canonical order
    if (!Array.isArray(exchanges)) continue;
    const cleaned = exchanges
      .map((e, i) => {
        if (!e || typeof e !== 'object') return null;
        const c = cleanLines(e.lines);
        if (c.error) errors[`pairs.${key}.${i}`] = c.error;
        return {
          requires: trimStr(e.requires || '', 80),
          startsWith: e.startsWith ? trimStr(e.startsWith, 80) : undefined,
          lines: c.lines
        };
      })
      .filter(e => e && e.requires && e.lines.length >= 2);
    if (cleaned.length > 0) out[key] = cleaned;
  }
  return { out, errors };
}

// → { out, errors }. `field` names the error keys: "<field>.<villain id>".
function sanitizeVillainLines(input, field = 'villainLines') {
  const out = {};
  const errors = {};
  if (!input || typeof input !== 'object') return { out, errors };
  for (const [key, lines] of Object.entries(input)) {
    if (!ID_REGEX.test(key)) continue;
    if (!Array.isArray(lines)) continue;
    const c = cleanLines(lines);
    if (c.error) errors[`${field}.${key}`] = c.error;
    if (c.lines.length > 0) out[key] = c.lines;
  }
  return { out, errors };
}

// ---------- Scene Guess stills ----------

// Episode field from a form: '' / 'null' / missing → null, else an integer.
function parseEpisode(v) {
  if (v == null || v === '' || v === 'null') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) ? n : NaN;
}

// { ok, fields: { timeSec, episode } } or { ok:false, error } for a still on `tl`.
function checkFields(tl, time, episode) {
  const timeSec = SceneLogic.parseTime(time);
  const ep = tl && tl.kind === 'series' ? parseEpisode(episode) : (episode == null || episode === '' || episode === 'null' ? null : NaN);
  if (timeSec == null) return { ok: false, error: 'Enter the time as h:mm:ss, m:ss or seconds.' };
  if (Number.isNaN(ep)) return { ok: false, error: tl && tl.kind === 'series' ? 'Pick an episode.' : 'Movies have no episodes.' };
  const v = SceneLogic.validStill(tl, { timeSec, episode: ep });
  return v.ok ? { ok: true, fields: { timeSec, episode: ep } } : v;
}

module.exports = {
  ID_REGEX, STR_MAX, STAGE_MAX, DIALOG_LINE_MAX, DIALOG_LINES_MAX, GRID_LIMIT, GRID_MIN, GRID_MAX, POSITIONS_MAX,
  trimStr, pickNumber, diffConfig,
  sanitizeProject, parsePositions, planPositions,
  sanitizeCharacter, sanitizeLocation,
  sanitizePairs, sanitizeVillainLines,
  parseEpisode, checkFields
};
