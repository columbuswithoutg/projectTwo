#!/usr/bin/env node
// One-off: copy the 2026-10-30 wiki-check fixes from projects.js into Mongo
// (see docs/WIKI-CHECK-2026-10-30.md). Only the fields listed below are
// touched on existing rows, so any other CMS edits survive; the new titles
// are inserted whole. Rows that already hold the target values are skipped.
//
//   node scripts/apply-wiki-check-2026-10-30.js           # dry run, writes nothing
//   node scripts/apply-wiki-check-2026-10-30.js --apply   # write

const FIELDS = {
  secretinvasion: ['phase'],
  echo: ['release', 'phase'],
  guardiansholiday: ['phase'],
  whatif3: ['phase'],
  marvelzombies: ['release', 'prerequisites'],
  spidermananimated: ['release'],
  eyesofwakanda: ['release'],
  punisher2: ['episodes'],
  doomsday: ['runtime'],
  cap4: ['recommendedPrerequisites'],
  themarvels: ['recommendedPrerequisites'],
  daredevilbornagain: ['recommendedPrerequisites']
};
// The board was re-laid out to untangle roads: every existing card's position syncs too.
const LAYOUT_FIELDS = ['gridX', 'gridY'];
const NEW_IDS = ['werewolfbynight', 'iamgroot1', 'iamgroot2', 'wonderman', 'daredevilbornagain2',
  'punisheronelastkill', 'brandnewday', 'visionquest'];

async function main() {
  require('dotenv').config();
  if (require('../server/boot-checks').usePublicDns(process.env)) {
    require('dns').setServers(['8.8.8.8', '8.8.4.4']);
  }
  if (!process.env.MONGO_URI) {
    console.error('FATAL: MONGO_URI is not set in environment.');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  const { redactMongoUri } = require('./seed-content');
  const mongoose = require('mongoose');
  const Project = require('../models/Project');
  const repo = require('../server/contentLoader').init().projects;
  const byId = new Map(repo.map((p) => [p.id, p]));

  console.log(`Target DB: ${redactMongoUri(process.env.MONGO_URI)}${apply ? '' : ' (dry run)'}`);
  await mongoose.connect(process.env.MONGO_URI);

  const ops = [];
  const rows = new Map((await Project.find({}).lean()).map((r) => [r.id, r]));
  for (const p of repo) {
    if (NEW_IDS.includes(p.id)) continue;
    const id = p.id;
    const fields = [...(FIELDS[id] || []), ...LAYOUT_FIELDS];
    const want = p;
    const row = rows.get(id);
    if (!row) { console.log(`  ${id}: MISSING in db, skipped`); continue; }
    const set = {};
    for (const f of fields) {
      if (JSON.stringify(row[f]) !== JSON.stringify(want[f])) {
        set[f] = want[f];
        console.log(`  ${id}.${f}: ${JSON.stringify(row[f])} -> ${JSON.stringify(want[f])}`);
      }
    }
    if (Object.keys(set).length) ops.push({ updateOne: { filter: { id }, update: { $set: set } } });
  }
  for (const id of NEW_IDS) {
    if (rows.has(id)) { console.log(`  ${id}: already in DB, kept`); continue; }
    console.log(`  ${id}: insert`);
    ops.push({ updateOne: { filter: { id }, update: { $setOnInsert: byId.get(id) }, upsert: true } });
  }

  if (apply && ops.length) await Project.bulkWrite(ops);
  console.log(`${apply ? 'Wrote' : 'Would write'} ${ops.length} change(s).`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
