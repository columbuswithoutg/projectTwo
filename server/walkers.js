/************************************************
 * server/walkers.js — the shape of a saved walker selection.
 *
 * POST /api/progress/walkers used to store whatever objects the client
 * sent as long as each had a string `id` — extra keys, nested blobs, ids of
 * any length — into the schemaless `walkers` field, and friends then
 * downloaded that straight into their own walker code. Every entry is now
 * rebuilt as { id, stage }:
 *   id     1–80 characters (a character id from characters.js)
 *   stage  integer −1…50; −1 = "highest unlocked" (js/walkers.js)
 * A bare string id is the legacy form and becomes { id, stage: -1 }.
 * Unit-tested in test/walkers.test.js.
 ************************************************/
const MAX_WALKERS = 200;
const MAX_ID_LEN = 80;
const MIN_STAGE = -1;
const MAX_STAGE = 50;

function cleanId(id) {
  return (typeof id === 'string' && id.length >= 1 && id.length <= MAX_ID_LEN) ? id : null;
}

function cleanStage(stage) {
  return (Number.isInteger(stage) && stage >= MIN_STAGE && stage <= MAX_STAGE) ? stage : -1;
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
    out.push({ id, stage: cleanStage(w.stage) });
  }
  return out;
}

module.exports = { sanitizeWalkers, MAX_WALKERS, MAX_ID_LEN, MIN_STAGE, MAX_STAGE };
