#!/usr/bin/env node
// One-off backfill of `usernameLower` on existing users (models/user.js,
// server/username.js). New accounts get the field automatically; this
// script fills it for accounts created before it existed so the
// case-insensitive lookups can stop falling back to a regex scan.
//
//   node scripts/backfill-username-lower.js --dry-run   # report only
//   node scripts/backfill-username-lower.js             # write
//
// Idempotent: users that already have the field are skipped. Two legacy
// accounts whose names differ only by case ("Bob" / "bob") can't both own
// the lower-cased key — the OLDER one gets it, the newer one is marked
// usernameLowerConflict and keeps working through the exact-name lookup.
// Run it against production only after the deploy that added the field
// has fully replaced the old instance (an old instance still creates users
// without the field; they would heal on their next login anyway).

require('dotenv').config();

// Match server.js: force Google DNS for the Atlas SRV lookup.
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoose = require('mongoose');
const User = require('../models/user');
const { lowerName } = require('../server/username');

if (!process.env.MONGO_URI) {
  console.error('FATAL: MONGO_URI is not set in environment.');
  process.exit(1);
}
const dryRun = process.argv.includes('--dry-run');

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

  // Oldest first (ObjectIds sort by creation time), so the first account to
  // claim a lower-cased name is the one that has had it longest.
  const users = await User.find({}, { username: 1, usernameLower: 1, usernameLowerConflict: 1 })
    .sort({ _id: 1 }).lean();
  const claimed = new Map();      // lower → _id of the account that owns it
  for (const u of users) if (u.usernameLower) claimed.set(u.usernameLower, String(u._id));

  let filled = 0, skipped = 0, conflicts = 0;
  const conflictNames = [];
  for (const u of users) {
    if (u.usernameLower) { skipped++; continue; }
    const lower = lowerName(u.username);
    if (!lower) { skipped++; continue; }
    const owner = claimed.get(lower);
    if (owner && owner !== String(u._id)) {
      conflicts++;
      conflictNames.push(`${u.username} (${u._id}) — "${lower}" owned by ${owner}`);
      if (!dryRun && !u.usernameLowerConflict) {
        await User.updateOne({ _id: u._id }, { $set: { usernameLowerConflict: true } });
      }
      continue;
    }
    claimed.set(lower, String(u._id));
    filled++;
    if (dryRun) continue;
    try {
      await User.updateOne({ _id: u._id, usernameLower: { $exists: false } }, { $set: { usernameLower: lower } });
    } catch (e) {
      if (e && e.code === 11000) {
        // Raced by a live lookup that healed another account first.
        conflicts++; filled--;
        conflictNames.push(`${u.username} (${u._id}) — duplicate key at write time`);
        await User.updateOne({ _id: u._id }, { $set: { usernameLowerConflict: true } });
      } else throw e;
    }
  }

  console.log(`${dryRun ? '[dry run] ' : ''}users: ${users.length}, filled: ${filled}, already had it: ${skipped}, conflicts: ${conflicts}`);
  for (const line of conflictNames) console.log('  conflict:', line);
  if (!dryRun) {
    const missing = await User.countDocuments({ usernameLower: { $exists: false }, usernameLowerConflict: { $ne: true } });
    console.log(missing === 0
      ? 'Done — every account has usernameLower; the server switches off the regex fallback within 10 minutes (or on restart).'
      : `Done — ${missing} account(s) still missing the field (re-run to retry).`);
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
