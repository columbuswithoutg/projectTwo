#!/usr/bin/env node
// Content seed. Reads the four content files via the same contentLoader
// the server uses for fallbacks, then writes each entry into Mongo keyed
// on `id` (plus the singleton dialogue doc).
//
//   node scripts/seed-content.js                # insert missing rows only
//   node scripts/seed-content.js --dry-run      # report, write nothing
//   node scripts/seed-content.js --overwrite    # also reset existing rows
//   node scripts/seed-content.js --wipe --yes   # drop + re-seed
//
// Default is insert-only ($setOnInsert): rows already in Mongo, and so
// every CMS edit (board positions, titles, images, dialogues), are left
// untouched, which makes a re-run against production safe. --overwrite
// resets existing rows to the repo copy (the old behaviour). --wipe drops
// the four collections first (CMS-only rows are lost) and refuses to run
// without --yes. --dry-run prints, per collection, the ids that would be
// inserted / overwritten; it still reads the DB. Every run prints the
// target DB host (credentials redacted) before touching anything.

function parseArgs(argv) {
  return {
    wipe: argv.includes('--wipe'),
    yes: argv.includes('--yes'),
    dryRun: argv.includes('--dry-run'),
    overwrite: argv.includes('--overwrite')
  };
}

// "mongodb+srv://user:pass@cluster0.x.mongodb.net/db?opts" ->
// "mongodb+srv://cluster0.x.mongodb.net/db" (no credentials, no options).
function redactMongoUri(uri) {
  const m = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/?#]*@)?([^/?#]*)(\/[^?#]*)?/i.exec(String(uri || ''));
  if (!m) return '(unparseable MONGO_URI)';
  return `${m[1]}://${m[2]}${m[3] && m[3] !== '/' ? m[3] : ''}`;
}

// Pure planner for one collection: which ids are new, which already exist
// (overwritten with --overwrite, otherwise kept), plus the bulkWrite ops.
// Items without an `id` are counted and never written.
function planUpserts(items, existingIds, { overwrite = false } = {}) {
  const existing = new Set(existingIds || []);
  const plan = { insert: [], overwrite: [], keep: [], invalid: 0, ops: [] };
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item.id !== 'string' || !item.id) { plan.invalid++; continue; }
    if (!existing.has(item.id)) plan.insert.push(item.id);
    else if (overwrite) plan.overwrite.push(item.id);
    else plan.keep.push(item.id);
    plan.ops.push({
      updateOne: {
        filter: { id: item.id },
        update: overwrite ? { $set: item } : { $setOnInsert: item },
        upsert: true
      }
    });
  }
  return plan;
}

function describePlan(label, plan, dryRun) {
  const would = dryRun ? 'would ' : '';
  const lines = [`  ${label}: ${would}insert ${plan.insert.length}, ${would}overwrite ${plan.overwrite.length}, keep ${plan.keep.length}`
    + (plan.invalid ? `, skipped ${plan.invalid} without an id` : '')];
  if (plan.insert.length) lines.push(`    insert: ${plan.insert.join(', ')}`);
  if (plan.overwrite.length) lines.push(`    overwrite: ${plan.overwrite.join(', ')}`);
  return lines.join('\n');
}

function dialogueFields(data) {
  return {
    pairs: data.pairs || {},
    villainDefeatLines: data.villainDefeatLines || {},
    villainVictoryLines: data.villainVictoryLines || {}
  };
}

async function seedCollection(Model, items, label, opts, summary) {
  if (!Array.isArray(items) || items.length === 0) {
    console.log(`  ${label}: skipped (no items in fallback)`);
    summary.push(`${label} skipped`);
    return;
  }
  const existingIds = opts.wiped ? [] : (await Model.find({}, { id: 1, _id: 0 }).lean()).map(d => d.id);
  const plan = planUpserts(items, existingIds, opts);
  console.log(describePlan(label, plan, opts.dryRun));
  summary.push(`${label} +${plan.insert.length}/~${plan.overwrite.length}/=${plan.keep.length}`);
  if (opts.dryRun || plan.ops.length === 0) return;
  const result = await Model.bulkWrite(plan.ops, { ordered: false });
  console.log(`    written: upserted=${result.upsertedCount} matched=${result.matchedCount} modified=${result.modifiedCount}`);
}

async function seedDialogues(Dialogue, data, opts, summary) {
  if (!data || (!Object.keys(data.pairs || {}).length && !Object.keys(data.villainDefeatLines || {}).length)) {
    console.log('  dialogues: skipped (no fallback data)');
    summary.push('dialogues skipped');
    return;
  }
  const exists = opts.wiped ? false : Boolean(await Dialogue.exists({}));
  const action = !exists ? 'insert' : opts.overwrite ? 'overwrite' : 'keep';
  const fields = dialogueFields(data);
  console.log(`  dialogues: ${opts.dryRun && action !== 'keep' ? 'would ' : ''}${action} (pairs=${Object.keys(fields.pairs).length}`
    + ` defeatLines=${Object.keys(fields.villainDefeatLines).length} victoryLines=${Object.keys(fields.villainVictoryLines).length})`);
  summary.push(`dialogues ${action}`);
  if (opts.dryRun || action === 'keep') return;
  await Dialogue.findOneAndUpdate(
    {},
    action === 'overwrite' ? { $set: fields } : { $setOnInsert: fields },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

async function main() {
  require('dotenv').config();

  // Match server.js: force Google DNS for the SRV lookup. Some networks
  // (and the default Windows resolver) can't resolve the _mongodb._tcp
  // SRV record that Atlas connection strings use, which manifests as
  // ECONNREFUSED on querySrv. Off in production unless FORCE_PUBLIC_DNS=1
  // (server/boot-checks.js).
  if (require('../server/boot-checks').usePublicDns(process.env)) {
    require('dns').setServers(['8.8.8.8', '8.8.4.4']);
  }

  if (!process.env.MONGO_URI) {
    console.error('FATAL: MONGO_URI is not set in environment.');
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  const mode = (args.overwrite ? 'overwrite' : 'insert-only') + (args.wipe ? ' + wipe' : '');
  console.log(`Target DB: ${redactMongoUri(process.env.MONGO_URI)}`);
  console.log(`Mode: ${mode}${args.dryRun ? ' (dry run, nothing is written)' : ''}`);

  if (args.wipe && !args.yes && !args.dryRun) {
    console.error('--wipe deletes every project, character, location and dialogue row on the DB above,');
    console.error('including rows that only exist in the CMS. Re-run with --wipe --yes to confirm (or add --dry-run to preview).');
    process.exit(1);
  }

  const mongoose = require('mongoose');
  const Project = require('../models/Project');
  const Character = require('../models/Character');
  const Location = require('../models/Location');
  const Dialogue = require('../models/Dialogue');
  const contentLoader = require('../server/contentLoader');

  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected.');

  const collections = [[Project, 'projects'], [Character, 'characters'], [Location, 'locations'], [Dialogue, 'dialogues']];
  if (args.wipe) {
    const counts = await Promise.all(collections.map(([M]) => M.countDocuments({})));
    const desc = collections.map(([, label], i) => `${label}=${counts[i]}`).join(' ');
    if (args.dryRun) {
      console.log(`--wipe: would delete ${desc}`);
    } else {
      console.log(`--wipe --yes: deleting ${desc}...`);
      await Promise.all(collections.map(([M]) => M.deleteMany({})));
      console.log('Wiped.');
    }
  }

  console.log('Loading fallback content from JS files...');
  const cache = contentLoader.init();

  console.log(args.dryRun ? 'Planning (dry run)...' : 'Seeding...');
  const opts = { overwrite: args.overwrite, dryRun: args.dryRun, wiped: args.wipe };
  const summary = [];
  await seedCollection(Project, cache.projects, 'projects', opts, summary);
  await seedCollection(Character, cache.characters, 'characters', opts, summary);
  await seedCollection(Location, cache.locations, 'locations', opts, summary);
  await seedDialogues(Dialogue, cache.dialogues, opts, summary);

  console.log(`${args.dryRun ? '[dry run] ' : ''}Done (${mode}; +inserted/~overwritten/=kept): ${summary.join('; ')}`);
  await mongoose.disconnect();
  process.exit(0);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}

module.exports = { parseArgs, redactMongoUri, planUpserts, describePlan };
