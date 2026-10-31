#!/usr/bin/env node
'use strict';
// Reads a node:test TAP log and prints one GitHub workflow annotation per
// failing test, so the failing names (and the first lines of each failure
// block) show up in the Checks UI and through the public API even when the
// raw job log is not readable anonymously. TODO tests are not failures.
//
//   node --test --test-reporter=tap > test.tap || status=$?
//   node scripts/ci-annotate-tests.js test.tap
//
// Exits 0 always; the caller decides the job status from the test run itself.
const fs = require('fs');

const file = process.argv[2] || 'test.tap';
let text = '';
try {
  text = fs.readFileSync(file, 'utf8');
} catch (e) {
  console.log(`ci-annotate-tests: cannot read ${file}: ${e.message}`);
  process.exit(0);
}

const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');
const lines = text.split('\n');
let count = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!/^\s*not ok\b/.test(line) || /# TODO/i.test(line)) continue;
  count++;
  const ctx = lines.slice(i + 1, i + 30).join('\n');
  console.log(`::error title=Failing test::${esc(line.trim())}%0A${esc(ctx)}`);
}
console.log(`failing tests (excluding TODO): ${count}`);
