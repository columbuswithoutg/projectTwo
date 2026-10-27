/************************************************
 * Socket.IO event contract: client <-> server event names.
 *
 * Source-level check, no sockets: every `world:` / `home:` / `voice:` event
 * the client emits must have a server `on`, and every one the server emits
 * must have a client listener.
 *
 *   client: js/home-socket.js (WORLD_EVENTS / HOME_EVENTS maps, read off the
 *           real module via vm, + which keys go through socket.emit / .on),
 *           js/voice-chat.js and js/scene-guess.js (string literals).
 *   server: every .js under routes/ and server/ — a literal right after
 *           `on(` is a listener (covers socket.on and scene-guess's `on`
 *           helper); any other literal is something the server sends
 *           (socket.emit, io.to().emit, emitTo, broadcastWorld/Home, …).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const EVENT = /^(world|home|voice):[a-z0-9-]+$/;
const LITERAL = /(['"`])((?:world|home|voice):[a-z0-9-]+)\1/g;

// Events intentionally without a counterpart. Keep short; justify each.
const ALLOW_NO_SERVER_LISTENER = new Set([
  // (none)
]);
const ALLOW_NO_CLIENT_LISTENER = new Set([
  // (none)
]);

// Drop comments so an event named in prose doesn't count. Crude but safe
// here: `//` inside strings in these files only appears after ':' (URLs).
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}
const read = (rel) => stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// Classify each event literal by what precedes it on the line.
function scanLiterals(src) {
  const out = { on: new Set(), emit: new Set(), off: new Set(), other: new Set() };
  for (const m of src.matchAll(LITERAL)) {
    const before = src.slice(Math.max(0, m.index - 40), m.index);
    if (/\b(?:on|once)\(\s*$/.test(before)) out.on.add(m[2]);
    else if (/\boff\(\s*$/.test(before)) out.off.add(m[2]);
    else if (/\bemit\(\s*$/.test(before)) out.emit.add(m[2]);
    else out.other.add(m[2]);
  }
  return out;
}

function listJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJs(rel));
    else if (e.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

// ---- server ---------------------------------------------------------------
const server = { on: new Set(), emit: new Set() };
for (const rel of [...listJs('routes'), ...listJs('server')]) {
  const s = scanLiterals(read(rel));
  s.on.forEach(e => server.on.add(e));
  // Anything not registered as a listener is sent (emit, emitTo, broadcast…).
  [...s.emit, ...s.other].forEach(e => server.emit.add(e));
}

// ---- client: home-socket maps (the real objects, via vm) -----------------
const homeSrc = fs.readFileSync(path.join(ROOT, 'js', 'home-socket.js'), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(homeSrc + '\n;this.__M = Multiplayer;', ctx);
const { WORLD_EVENTS, HOME_EVENTS } = ctx.__M;

const homeCode = stripComments(homeSrc);
const keysUsed = (re) => new Set([...homeCode.matchAll(re)].map(m => m[1]));
const mapEmitKeys = keysUsed(/\.emit\(\s*events\.(\w+)/g);
const mapOnKeys = keysUsed(/\.on\(\s*events\.(\w+)/g);

const client = { on: new Set(), emit: new Set() };
for (const map of [WORLD_EVENTS, HOME_EVENTS]) {
  for (const [k, v] of Object.entries(map)) {
    if (typeof v !== 'string') continue;
    if (mapEmitKeys.has(k)) client.emit.add(v);
    if (mapOnKeys.has(k)) client.on.add(v);
  }
}
for (const rel of ['js/voice-chat.js', 'js/scene-guess.js']) {
  const s = scanLiterals(read(rel));
  s.on.forEach(e => client.on.add(e));
  s.emit.forEach(e => client.emit.add(e));
}

// ---- tests ------------------------------------------------------------------
test('the scan found the expected surface (guards against a regex gone blind)', () => {
  assert.ok(server.on.size >= 20, 'server listeners: ' + server.on.size);
  assert.ok(server.emit.size >= 25, 'server emits: ' + server.emit.size);
  assert.ok(client.on.size >= 25, 'client listeners: ' + client.on.size);
  assert.ok(client.emit.size >= 20, 'client emits: ' + client.emit.size);
  for (const e of ['world:join', 'home:join', 'voice:announce', 'world:sg-start']) assert.ok(server.on.has(e), e);
  for (const e of ['world:snapshot', 'home:house', 'voice:peers', 'world:sg-state']) assert.ok(client.on.has(e), e);
});

test('every event the client emits has a server listener', () => {
  const missing = [...client.emit].filter(e => !server.on.has(e) && !ALLOW_NO_SERVER_LISTENER.has(e)).sort();
  assert.deepEqual(missing, []);
});

test('every event the server emits has a client listener', () => {
  const missing = [...server.emit].filter(e => !client.on.has(e) && !ALLOW_NO_CLIENT_LISTENER.has(e)).sort();
  assert.deepEqual(missing, []);
});

test('allowlist entries are still needed (no stale exemptions)', () => {
  for (const e of ALLOW_NO_SERVER_LISTENER) assert.ok(client.emit.has(e) && !server.on.has(e), 'stale: ' + e);
  for (const e of ALLOW_NO_CLIENT_LISTENER) assert.ok(server.emit.has(e) && !client.on.has(e), 'stale: ' + e);
});

test('WORLD_EVENTS and HOME_EVENTS have the same keys and families', () => {
  assert.deepEqual(Object.keys(WORLD_EVENTS).sort(), Object.keys(HOME_EVENTS).sort());
  for (const [map, family] of [[WORLD_EVENTS, 'world'], [HOME_EVENTS, 'home']]) {
    for (const [k, v] of Object.entries(map)) {
      if (k === 'channels') { assert.equal(typeof v, 'boolean'); continue; }
      if (v === null) continue;
      assert.equal(typeof v, 'string', family + '.' + k);
      assert.match(v, EVENT, family + '.' + k);
      assert.ok(v.startsWith(family + ':'), `${family}.${k} = ${v}`);
    }
  }
});

test('where both maps name an event, it is the same event in each family', () => {
  for (const k of Object.keys(WORLD_EVENTS)) {
    const w = WORLD_EVENTS[k], h = HOME_EVENTS[k];
    if (typeof w !== 'string' || typeof h !== 'string') continue;
    assert.equal(w.slice('world:'.length), h.slice('home:'.length), k);
  }
});

test('every named map event is actually wired to socket.emit or socket.on', () => {
  for (const map of [WORLD_EVENTS, HOME_EVENTS]) {
    for (const [k, v] of Object.entries(map)) {
      if (typeof v !== 'string') continue;
      assert.ok(mapEmitKeys.has(k) || mapOnKeys.has(k), 'unused map key: ' + k);
    }
  }
});
