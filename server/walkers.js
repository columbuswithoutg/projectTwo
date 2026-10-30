/************************************************
 * server/walkers.js — the shape of a saved walker selection.
 *
 * POST /api/progress/walkers used to store whatever objects the client
 * sent as long as each had a string `id` — extra keys, nested blobs, ids of
 * any length — into the schemaless `walkers` field, and friends then
 * downloaded that straight into their own walker code. Every entry is now
 * rebuilt as { id, look } or { id, stage }:
 *   id     1–80 characters (a character id from characters.js)
 *   look   the look's stable key (MAP2-02): the project id that unlocks it
 *          (a stage's `after`), or "@base" for the debut look; 1–80 of
 *          A–Z a–z 0–9 _ . - with an optional leading @
 *   stage  integer −1…50; −1 = "highest unlocked" (js/walkers.js). A
 *          non-negative stage is the legacy form (an index into the
 *          unlocked looks); the client maps it to a look key once.
 * A bare string id is the legacy form and becomes { id, stage: -1 }.
 * An entry with a valid look keeps only { id, look }; a missing or junk
 * look falls back to the stage rules.
 * Unit-tested in test/walkers.test.js.
 ************************************************/
const MAX_WALKERS = 200;
const MAX_ID_LEN = 80;
const MIN_STAGE = -1;
const MAX_STAGE = 50;
const LOOK_RE = /^@?[A-Za-z0-9_.-]{1,80}$/;

function cleanId(id) {
  return (typeof id === 'string' && id.length >= 1 && id.length <= MAX_ID_LEN) ? id : null;
}

function cleanStage(stage) {
  return (Number.isInteger(stage) && stage >= MIN_STAGE && stage <= MAX_STAGE) ? stage : -1;
}

function cleanLook(look) {
  return (typeof look === 'string' && look.length <= MAX_ID_LEN && LOOK_RE.test(look)) ? look : null;
}

function sanitizeWalkers(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const w of list) {
    if (out.length >= MAX_WALKERS) break;
    if (typeof w === 'string') {
      const id = cleanId(w);
      if (id) out.push({ id, stage: -1 });
      continue;
    }
    if (!w || typeof w !== 'object') continue;
    const id = cleanId(w.id);
    if (!id) continue;
    const look = cleanLook(w.look);
    out.push(look ? { id, look } : { id, stage: cleanStage(w.stage) });
  }
  return out;
}

module.exports = { sanitizeWalkers, cleanLook, MAX_WALKERS, MAX_ID_LEN, MIN_STAGE, MAX_STAGE };
