/************************************************
 * Unit tests for js/world-chat-logic.js — /world chat channels
 * (world / project / whisper), the shared cooldown and island zones.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/world-chat-logic.js');

const GRID = [
  { id: 'ironman1', gridX: 0, gridY: 1 },
  { id: 'ironman2', gridX: 0, gridY: 2 },
  { id: 'hulk', gridX: -2, gridY: 3 }
];

test('projectAt: inside an island apron returns its id', () => {
  assert.equal(L.projectAt(0, 18, GRID), 'ironman1');
  assert.equal(L.projectAt(-36, 54, GRID), 'hulk');
  assert.equal(L.projectAt(7.5, 18 - 7.5, GRID), 'ironman1');
});

test('projectAt: apron edge counts, the road gap between islands does not', () => {
  assert.equal(L.projectAt(8, 18, GRID), 'ironman1');
  assert.equal(L.projectAt(8.01, 18, GRID), null);
  assert.equal(L.projectAt(0, 27, GRID), null);     // halfway between 18 and 36
  assert.equal(L.projectAt(0, 36 - 8, GRID), 'ironman2');
});

test('projectAt: bad input is null, never a throw', () => {
  assert.equal(L.projectAt(NaN, 0, GRID), null);
  assert.equal(L.projectAt(0, 18, null), null);
  assert.equal(L.projectAt(0, 18, [{ id: 'x' }]), null);
});

test('hasCooldown: only World chat is rate limited', () => {
  assert.equal(L.hasCooldown('world'), true);
  assert.equal(L.hasCooldown('project'), false);
  assert.equal(L.hasCooldown('whisper'), false);
});

test('cooldownLeft: 10s World cooldown', () => {
  assert.equal(L.C.COOLDOWN_MS, 10000);
  assert.equal(L.cooldownLeft(0, 5000), 0);
  assert.equal(L.cooldownLeft(1000, 1000), 10000);
  assert.equal(L.cooldownLeft(1000, 4000), 7000);
  assert.equal(L.cooldownLeft(1000, 11000), 0);
  assert.equal(L.cooldownLeft(1000, 99999), 0);
});

test('normalizeMessage: trims, caps at 200, defaults unknown channels to world', () => {
  assert.deepEqual(L.normalizeMessage({ text: '  hi  ' }), { ok: true, channel: 'world', text: 'hi', to: null });
  assert.equal(L.normalizeMessage({ channel: 'admin', text: 'x' }).channel, 'world');
  assert.equal(L.normalizeMessage({ channel: 'project', text: 'x' }).channel, 'project');
  assert.equal(L.normalizeMessage({ text: 'a'.repeat(500) }).text.length, 200);
  assert.deepEqual(L.normalizeMessage({ text: '   ' }), { ok: false, error: 'empty' });
  assert.deepEqual(L.normalizeMessage(null), { ok: false, error: 'empty' });
});

test('normalizeMessage: whisper needs a target', () => {
  assert.deepEqual(L.normalizeMessage({ channel: 'whisper', text: 'psst' }), { ok: false, error: 'no-target' });
  assert.deepEqual(L.normalizeMessage({ channel: 'whisper', text: 'psst', to: ' Tony ' }),
    { ok: true, channel: 'whisper', text: 'psst', to: 'Tony' });
});

test('parseWhisperCommand: /w, /whisper, /msg', () => {
  assert.deepEqual(L.parseWhisperCommand('/w Tony hello there'), { to: 'Tony', text: 'hello there' });
  assert.deepEqual(L.parseWhisperCommand('/WHISPER bob hi'), { to: 'bob', text: 'hi' });
  assert.deepEqual(L.parseWhisperCommand('/msg bob hi'), { to: 'bob', text: 'hi' });
  assert.equal(L.parseWhisperCommand('/w Tony'), null);
  assert.equal(L.parseWhisperCommand('hello /w bob hi'), null);
});

test('sameName is case-insensitive; errorText covers every rejection', () => {
  assert.ok(L.sameName('Tony', 'tony'));
  assert.ok(!L.sameName('Tony', 'Tonya'));
  assert.match(L.errorText('cooldown', { retryInMs: 6200 }), /7s/);
  assert.match(L.errorText('not-found', { to: 'bob' }), /bob/);
  for (const e of ['no-project', 'self', 'no-target', 'empty', 'weird']) assert.ok(L.errorText(e).length > 0);
});

// ── islandPeers: who shares my island (voice mesh / project scope) ──

function playersMap() {
  return new Map([
    ['s1', { projectId: 'ironman1' }],
    ['s2', { projectId: 'ironman1' }],
    ['s3', { projectId: 'hulk' }],
    ['s4', { projectId: null }],
    ['s5', { projectId: 'ironman1' }]
  ]);
}

test('islandPeers: others on the same island, never self, never other islands or roads', () => {
  assert.deepEqual(L.islandPeers('s1', playersMap()).sort(), ['s2', 's5']);
  assert.deepEqual(L.islandPeers('s3', playersMap()), []);
});

test('islandPeers: off-island or unknown self is empty', () => {
  assert.deepEqual(L.islandPeers('s4', playersMap()), []);
  assert.deepEqual(L.islandPeers('nope', playersMap()), []);
  assert.deepEqual(L.islandPeers('s1', null), []);
});

test('islandPeers: members filter applies to others but not to self', () => {
  const members = new Set(['s2']);            // s1 already removed from the voice set
  assert.deepEqual(L.islandPeers('s1', playersMap(), members), ['s2']);
});
