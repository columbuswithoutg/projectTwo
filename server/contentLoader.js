const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load the four content files into a Node-side cache at boot. These files
// were written for the browser — they declare top-level `const` globals
// (`projects`, `characters`, `LOCATIONS`, `WALKER_DIALOGUES`). In script
// mode, top-level `const`/`let` create lexical bindings that are NOT
// added to the global object, so we can't read them off the sandbox
// directly. We append a capture epilogue that re-assigns each known
// identifier onto a known sandbox property using `this.__c`.
//
// This cache is the SAFETY NET. The /api/content/* endpoints prefer
// Mongo; they only fall back to this when Mongo is unreachable or empty.

const ROOT = path.resolve(__dirname, '..');
const FILES = {
  projects:   path.join(ROOT, 'projects.js'),
  characters: path.join(ROOT, 'characters.js'),
  locations:  path.join(ROOT, 'locations.js'),
  dialogues:  path.join(ROOT, 'js', 'walker-dialogues.js')
};

let cache = null;

function makeSandbox() {
  return {
    window: {},
    document: { createElement: () => ({}) },
    localStorage: { getItem: () => null, setItem: () => {} },
    Math, JSON, Object, Array, String, Number, Boolean, Date, RegExp, Map, Set,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    __c: {}
  };
}

// Append `this.__c.NAME = NAME` lines for each global identifier we want
// to capture out of the file. Only adds entries that exist (typeof guard
// keeps the runtime safe if the file evolves).
function captureEpilogue(names) {
  return '\n;' + names.map(n =>
    `if (typeof ${n} !== 'undefined') this.__c.${n} = ${n};`
  ).join('\n');
}

function evalFile(file, names) {
  const src = fs.readFileSync(file, 'utf8') + captureEpilogue(names);
  const sandbox = makeSandbox();
  vm.runInNewContext(src, sandbox, { filename: file, timeout: 5000 });
  return sandbox.__c;
}

// Strip per-character per-user state (`watched: false`) that lived in
// projects.js as a hack for client-side defaults. Real watch state is
// per-user in Mongo.
function normalizeProject(p) {
  const { watched, ...rest } = p;
  return rest;
}

// For walker-dialogues.js, the raw data lives inside an IIFE and isn't
// exposed by the IIFE's return. We patch the source in-memory: replace
// the final return so it ALSO exports __pairs/__vdl/__vvl. Then read
// them off WALKER_DIALOGUES on the sandbox.
function evalDialoguesFile() {
  let src = fs.readFileSync(FILES.dialogues, 'utf8');
  // Match the last `return { ... };` at the bottom of the IIFE. Anchored
  // with `}\)\(\)` afterward to be specific to the IIFE close, so we
  // don't accidentally rewrite an early `return` inside a helper.
  src = src.replace(
    /return\s*\{([^}]*)\};\s*\}\s*\)\s*\(\s*\)\s*;?/m,
    'return { __pairs: typeof pairs !== "undefined" ? pairs : {}, __vdl: typeof villainDefeatLines !== "undefined" ? villainDefeatLines : {}, __vvl: typeof villainVictoryLines !== "undefined" ? villainVictoryLines : {}, $1 };})();'
  );
  src += captureEpilogue(['WALKER_DIALOGUES']);
  const sandbox = makeSandbox();
  vm.runInNewContext(src, sandbox, { filename: FILES.dialogues, timeout: 5000 });
  const wd = sandbox.__c.WALKER_DIALOGUES || {};
  return {
    pairs: wd.__pairs || {},
    villainDefeatLines: wd.__vdl || {},
    villainVictoryLines: wd.__vvl || {}
  };
}

function loadAll() {
  const out = { projects: [], characters: [], locations: [], dialogues: null, loadErrors: {} };

  try {
    const c = evalFile(FILES.projects, ['projects']);
    out.projects = Array.isArray(c.projects) ? c.projects.map(normalizeProject) : [];
  } catch (err) {
    out.loadErrors.projects = err.message;
    console.error('contentLoader: projects.js failed:', err.message);
  }

  try {
    const c = evalFile(FILES.characters, ['characters']);
    out.characters = Array.isArray(c.characters) ? c.characters : [];
  } catch (err) {
    out.loadErrors.characters = err.message;
    console.error('contentLoader: characters.js failed:', err.message);
  }

  try {
    const c = evalFile(FILES.locations, ['LOCATIONS']);
    out.locations = Array.isArray(c.LOCATIONS) ? c.LOCATIONS : [];
  } catch (err) {
    out.loadErrors.locations = err.message;
    console.error('contentLoader: locations.js failed:', err.message);
  }

  try {
    out.dialogues = evalDialoguesFile();
  } catch (err) {
    out.loadErrors.dialogues = err.message;
    console.error('contentLoader: walker-dialogues.js failed:', err.message);
    out.dialogues = { pairs: {}, villainDefeatLines: {}, villainVictoryLines: {} };
  }

  return out;
}

function init() {
  if (cache) return cache;
  cache = loadAll();
  const counts = `projects=${cache.projects.length}, characters=${cache.characters.length}, locations=${cache.locations.length}, dialogue-pairs=${Object.keys(cache.dialogues?.pairs || {}).length}`;
  console.log(`contentLoader: static fallback loaded (${counts})`);
  return cache;
}

function get(type) {
  if (!cache) init();
  if (type === 'dialogues') return cache.dialogues;
  return cache[type] || [];
}

module.exports = { init, get };
