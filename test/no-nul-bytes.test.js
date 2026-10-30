/************************************************
 * Guard: no source file under js/, test/, server/ or routes/ may hold a raw
 * NUL byte. One NUL makes ripgrep / grep / editor search treat the whole file
 * as binary (3D2-01, TOOL-15, TOOL2-02), and git skips its EOL handling.
 * Write control characters as escapes (\u0000) instead.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIRS = ['js', 'test', 'server', 'routes'];

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test('no file under js/, test/, server/, routes/ contains a NUL byte', () => {
  const files = DIRS.flatMap((d) => walk(path.join(ROOT, d), []));
  assert.ok(files.length > 50, 'expected to scan the source tree');
  const bad = files
    .filter((f) => fs.readFileSync(f).includes(0))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(bad, []);
});
