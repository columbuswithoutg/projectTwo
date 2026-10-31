// ADM3-01: every action string passed to logAudit must be in the AuditLog
// enum, or Mongoose rejects the write and logAudit's catch only logs it.
// The admin audit tab's filter list must offer every enum value too.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');

const ROOT = path.join(__dirname, '..');

function jsFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter(f => f.endsWith('.js')).map(f => path.join(abs, f));
}

// Matches `logAudit(req, 'x'`, multi-line `logAudit(\n  req,\n  "x"`, and
// any first-argument shape (`req`, `request`, `this.req` ...).
const CALL_RE = /\blogAudit\s*\(\s*[\w.$]+\s*,\s*(['"`])([^'"`]+)\1/g;
// Any logAudit call whose second argument is NOT a string literal — those
// can't be checked statically, so the test refuses them outright. The
// lookbehind skips the `function logAudit(req, action, ...)` definition.
const ANY_CALL_RE = /(?<!function\s+)\blogAudit\s*\(\s*[\w.$]+\s*,\s*([^\s])/g;

function collectActions() {
  const found = new Map(); // action -> [file:line]
  const dynamic = [];
  for (const file of [...jsFiles('routes'), ...jsFiles('server')]) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    const lineOf = idx => src.slice(0, idx).split('\n').length;
    for (const m of src.matchAll(CALL_RE)) {
      const where = `${rel}:${lineOf(m.index)}`;
      if (!found.has(m[2])) found.set(m[2], []);
      found.get(m[2]).push(where);
    }
    for (const m of src.matchAll(ANY_CALL_RE)) {
      if (!/['"`]/.test(m[1])) dynamic.push(`${rel}:${lineOf(m.index)}`);
    }
  }
  return { found, dynamic };
}

test('the scan finds the logAudit calls (sanity: regex still matches the code)', () => {
  const { found } = collectActions();
  for (const a of ['ban', 'contentEdit', 'quoteImport', 'scoreReset', 'undoWatch', 'resolveRequest']) {
    assert.ok(found.has(a), `expected to find a logAudit(req, '${a}', ...) call`);
  }
});

test('no logAudit call passes a non-literal action', () => {
  const { dynamic } = collectActions();
  assert.deepStrictEqual(dynamic, [], 'dynamic action names cannot be checked against the enum');
});

// validate() runs offline (no connection); validateSync() is deprecated in Mongoose 9.
async function validationError(doc) {
  try { await new AuditLog(doc).validate(); return null; } catch (err) { return err; }
}

test('every logAudit action validates against the AuditLog schema', async () => {
  const { found } = collectActions();
  const actor = new mongoose.Types.ObjectId();
  const bad = [];
  for (const [action, where] of found) {
    const err = await validationError({ actor, actorUsername: 'qa', action, target: null, meta: null });
    if (err) bad.push(`${action} (${where.join(', ')}): ${err.message}`);
  }
  assert.deepStrictEqual(bad, []);
});

test('an unknown action is still rejected (the enum is enforced)', async () => {
  const err = await validationError({ actor: new mongoose.Types.ObjectId(), actorUsername: 'qa', action: 'notAnAction' });
  assert.ok(err && err.errors.action, 'expected an enum validation error');
});

test('the admin audit tab filter list covers every enum value', () => {
  const enumValues = AuditLog.schema.path('action').enumValues;
  const src = fs.readFileSync(path.join(ROOT, 'js/views/admin/audit.js'), 'utf8');
  const m = src.match(/const ACTIONS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, 'ACTIONS array not found in js/views/admin/audit.js');
  const client = [...m[1].matchAll(/['"`]([^'"`]+)['"`]/g)].map(x => x[1]);
  const missing = enumValues.filter(a => !client.includes(a));
  const extra = client.filter(a => !enumValues.includes(a));
  assert.deepStrictEqual(missing, [], 'enum values missing from the client filter');
  assert.deepStrictEqual(extra, [], 'client filter values not in the enum');
});
