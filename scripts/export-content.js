/************************************************
 * EXPORT CONTENT — Mongo → static fallback files
 *
 * The inverse of scripts/seed-content.js: snapshots the CMS-edited
 * collections (Project, Character, Location, Dialogue) back into the
 * version-controlled static fallbacks, so admin edits can be committed
 * as disaster-recovery data instead of drifting away from the repo.
 *
 *   node scripts/export-content.js            # rewrite the files
 *   node scripts/export-content.js --dry-run  # report what would change
 *
 * projects.js / characters.js / locations.js: only the `var NAME = [...]`
 * data block is replaced — surrounding comments and (in characters.js)
 * the fight/weapon tables are preserved verbatim.
 *
 * Dialogues can't be surgically written back (their fallback lives inside
 * the js/walker-dialogues.js IIFE), so they export to
 * data/dialogues-export.json as a manual-restore artifact.
 ************************************************/
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);   // same Windows-SRV workaround as server.js

const mongoose = require('mongoose');
const Project = require('../models/Project');
const Character = require('../models/Character');
const Location = require('../models/Location');
const Dialogue = require('../models/Dialogue');

const DRY = process.argv.includes('--dry-run');
const ROOT = path.join(__dirname, '..');

// Serialize one item as a compact single-line object literal, dropping
// Mongo bookkeeping fields.
function itemLine(item) {
  const { _id, __v, createdAt, updatedAt, ...rest } = item;
  return '  ' + JSON.stringify(rest) + ',';
}

// Replace the `var NAME = [ ... ];` span (the `];` must sit at column 0,
// which is how all three files are formatted).
function replaceBlock(source, varName, items) {
  const startRe = new RegExp('^var ' + varName + ' = \\[', 'm');
  const start = source.search(startRe);
  if (start === -1) throw new Error(`var ${varName} = [ not found`);
  const end = source.indexOf('\n];', start);
  if (end === -1) throw new Error(`closing ]; for ${varName} not found`);
  const block = 'var ' + varName + ' = [\n' + items.map(itemLine).join('\n') + '\n];';
  return source.slice(0, start) + block + source.slice(end + 3);
}

async function exportFile(file, varName, model, sort) {
  const items = await model.find({}).sort(sort).lean();
  if (!items.length) {
    console.log(`- ${file}: collection empty, skipped (nothing to export)`);
    return;
  }
  const full = path.join(ROOT, file);
  const source = fs.readFileSync(full, 'utf8');
  const next = replaceBlock(source, varName, items);
  if (next === source) {
    console.log(`- ${file}: unchanged (${items.length} items)`);
    return;
  }
  if (DRY) {
    console.log(`- ${file}: WOULD rewrite ${varName} with ${items.length} items`);
  } else {
    fs.writeFileSync(full, next);
    console.log(`- ${file}: rewrote ${varName} with ${items.length} items`);
  }
}

async function exportDialogues() {
  const doc = await Dialogue.findOne({}).lean();
  if (!doc) {
    console.log('- dialogues: no document, skipped');
    return;
  }
  const { _id, __v, createdAt, updatedAt, ...data } = doc;
  const out = path.join(ROOT, 'data', 'dialogues-export.json');
  if (DRY) {
    console.log('- data/dialogues-export.json: WOULD write '
      + Object.keys(data.pairs || {}).length + ' pairs');
    return;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  console.log('- data/dialogues-export.json: written ('
    + Object.keys(data.pairs || {}).length + ' pairs)');
}

(async () => {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log(DRY ? 'Dry run — no files will be written.\n' : 'Exporting…\n');
  try {
    await exportFile('projects.js', 'projects', Project, { gridY: 1, gridX: 1 });
    await exportFile('characters.js', 'characters', Character, { name: 1 });
    await exportFile('locations.js', 'LOCATIONS', Location, { id: 1 });
    await exportDialogues();
    console.log('\nDone. Review the diff (`git diff`) before committing.');
  } finally {
    await mongoose.disconnect();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
