/************************************************
 * server/contentLoader.js — the static content fallback behind
 * /api/content/* when Mongo is empty or down.
 *
 * The dialogues half patches js/walker-dialogues.js with a regex to reach
 * data the IIFE doesn't export; if that regex ever stops matching, the
 * fallback silently serves `pairs: {}`. These tests pin the real files'
 * shape, cross-check the counts against an independent vm load of each
 * content file, and check the loader complains when the patch misses.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const LOADER = require.resolve('../server/contentLoader');
const DIALOGUES = path.join(ROOT, 'js', 'walker-dialogues.js');

// Load the loader quietly (init() logs its counts).
function freshLoader() {
  delete require.cache[LOADER];
  const log = console.log;
  console.log = () => {};
  try {
    const m = require(LOADER);
    m.init();
    return m;
  } finally { console.log = log; }
}

// Independent count: run the browser file and read its top-level const.
function lengthOf(file, name) {
  const ctx = { window: {}, document: { createElement: () => ({}) }, localStorage: { getItem: () => null, setItem() {} }, __n: null };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), 'utf8') + `\n;this.__n = ${name}.length;`, ctx);
  return ctx.__n;
}

const loader = freshLoader();

test('dialogues: the regex patch reached the IIFE data (pairs > 30)', () => {
  const d = loader.get('dialogues');
  assert.ok(d && typeof d === 'object');
  const keys = Object.keys(d.pairs);
  assert.ok(keys.length > 30, `only ${keys.length} dialogue pairs`);
  // Key format is "id1|id2", each value a non-empty list of exchanges.
  for (const k of keys) {
    assert.match(k, /^[^|]+\|[^|]+$/, k);
    assert.ok(Array.isArray(d.pairs[k]) && d.pairs[k].length, k);
  }
  const first = d.pairs[keys[0]][0];
  assert.ok(Array.isArray(first.lines) && first.lines.length >= 2);
});

test('dialogues: villain defeat / victory lines are non-empty with a _default', () => {
  const d = loader.get('dialogues');
  for (const field of ['villainDefeatLines', 'villainVictoryLines']) {
    const v = d[field];
    assert.ok(Object.keys(v).length > 0, field + ' empty');
    assert.ok(Array.isArray(v._default) && v._default.length, field + '._default missing');
  }
});

test('projects / characters / locations: counts > 0 and match the source files', () => {
  const cases = [
    ['projects', 'projects.js', 'projects'],
    ['characters', 'characters.js', 'characters'],
    ['locations', 'locations.js', 'LOCATIONS']
  ];
  for (const [type, file, name] of cases) {
    const got = loader.get(type);
    assert.ok(Array.isArray(got), type);
    assert.ok(got.length > 0, type + ' empty');
    assert.equal(got.length, lengthOf(file, name), type + ' count differs from ' + file);
  }
});

test('projects are normalised: no per-user `watched` flag leaks into the fallback', () => {
  for (const p of loader.get('projects')) {
    assert.equal('watched' in p, false, p.id);
    assert.ok(p.id, 'project without id');
  }
});

test('an unknown type returns an empty list', () => {
  assert.deepEqual(loader.get('nope'), []);
});

test('when the walker-dialogues patch no longer matches, the loader says so (and does not throw)', () => {
  const realRead = fs.readFileSync;
  const errors = [];
  const realError = console.error;
  // Same file, but with its closing `return {...}; })();` reshaped so the
  // regex can't find it.
  fs.readFileSync = function (file, ...rest) {
    const out = realRead.call(this, file, ...rest);
    if (path.resolve(String(file)) === DIALOGUES) {
      return String(out).replace(/return\s*\{([^}]*)\};\s*\}\s*\)\s*\(\s*\)\s*;?/m, 'const __api = {$1}; return __api; })();');
    }
    return out;
  };
  console.error = (...a) => errors.push(a.join(' '));
  let broken;
  try {
    broken = freshLoader();
  } finally {
    fs.readFileSync = realRead;
    console.error = realError;
    delete require.cache[LOADER];
  }
  assert.deepEqual(broken.get('dialogues').pairs, {});
  assert.ok(errors.some(m => m.includes('js/walker-dialogues.js')), 'no console.error naming js/walker-dialogues.js: ' + JSON.stringify(errors));
});
