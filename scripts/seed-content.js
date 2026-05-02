#!/usr/bin/env node
// Idempotent content seed. Reads the four content files via the same
// contentLoader the server uses for fallbacks, then upserts each entry
// into Mongo by `id` (or upserts the singleton dialogue doc).
//
// Run once after Phase 3 deploys:
//   node scripts/seed-content.js
//
// Re-running is safe: every write is an upsert keyed on `id`. To reset
// and re-seed from JS files, pass --wipe (drops the four collections
// first). Useful when iterating during development.

require('dotenv').config();

// Match server.js: force Google DNS for the SRV lookup. Some networks
// (and the default Windows resolver) can't resolve the _mongodb._tcp
// SRV record that Atlas connection strings use, which manifests as
// ECONNREFUSED on querySrv.
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoose = require('mongoose');

if (!process.env.MONGO_URI) {
  console.error('FATAL: MONGO_URI is not set in environment.');
  process.exit(1);
}

const Project = require('../models/Project');
const Character = require('../models/Character');
const Location = require('../models/Location');
const Dialogue = require('../models/Dialogue');
const contentLoader = require('../server/contentLoader');

async function upsertMany(Model, items, label) {
  if (!Array.isArray(items) || items.length === 0) {
    console.log(`  ${label}: skipped (no items in fallback)`);
    return { upserted: 0 };
  }
  const ops = items.map(item => ({
    updateOne: {
      filter: { id: item.id },
      update: { $set: item },
      upsert: true
    }
  }));
  const result = await Model.bulkWrite(ops, { ordered: false });
  console.log(`  ${label}: matched=${result.matchedCount} upserted=${result.upsertedCount} modified=${result.modifiedCount}`);
  return result;
}

async function upsertDialogues(data) {
  if (!data || (!Object.keys(data.pairs || {}).length && !Object.keys(data.villainDefeatLines || {}).length)) {
    console.log('  dialogues: skipped (no fallback data)');
    return;
  }
  await Dialogue.findOneAndUpdate(
    {},
    {
      $set: {
        pairs: data.pairs || {},
        villainDefeatLines: data.villainDefeatLines || {},
        villainVictoryLines: data.villainVictoryLines || {}
      }
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
  const pairCount = Object.keys(data.pairs || {}).length;
  const defeatCount = Object.keys(data.villainDefeatLines || {}).length;
  const victoryCount = Object.keys(data.villainVictoryLines || {}).length;
  console.log(`  dialogues: pairs=${pairCount} defeatLines=${defeatCount} victoryLines=${victoryCount}`);
}

async function main() {
  const wipe = process.argv.includes('--wipe');

  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected.');

  if (wipe) {
    console.log('--wipe flag set; dropping content collections...');
    await Promise.all([
      Project.deleteMany({}),
      Character.deleteMany({}),
      Location.deleteMany({}),
      Dialogue.deleteMany({})
    ]);
    console.log('Wiped.');
  }

  console.log('Loading fallback content from JS files...');
  const cache = contentLoader.init();

  console.log('Seeding...');
  await upsertMany(Project, cache.projects, 'projects');
  await upsertMany(Character, cache.characters, 'characters');
  await upsertMany(Location, cache.locations, 'locations');
  await upsertDialogues(cache.dialogues);

  console.log('Done.');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
