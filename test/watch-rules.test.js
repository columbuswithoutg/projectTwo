const test = require('node:test');
const assert = require('node:assert');
const W = require('../server/watchRules');

const movie = { id: 'm', runtime: 120, phase: 'Phase 1', prerequisites: [] };
const series = { id: 's', episodes: [50, 40, 60], phase: 'Phase 1', prerequisites: [] };

test('step minutes and counts: movie vs series', () => {
  assert.strictEqual(W.stepCount(movie), 1);
  assert.strictEqual(W.stepMinutes(movie), 120);
  assert.strictEqual(W.stepCount(series), 3);
  assert.strictEqual(W.stepMinutes(series, 1), 40);
  assert.strictEqual(W.episodesOf({ episodes: [] }), null);
  assert.strictEqual(W.stepMinutes({ runtime: 0 }), 0);
});

test('credits allowance: 10 min for movies, 10% (2–10 min) per episode, ≤ half', () => {
  assert.strictEqual(W.requiredMinutes(movie), 110);
  assert.strictEqual(W.creditsMinutes(series, 0), 5);            // 50-min episode
  assert.ok(Math.abs(W.creditsMinutes({ episodes: [24] }) - 2.4) < 1e-9);
  assert.strictEqual(W.creditsMinutes({ episodes: [15] }), 2);   // floor
  assert.strictEqual(W.creditsMinutes({ episodes: [140] }), 10); // cap
  assert.strictEqual(W.creditsMinutes({ runtime: 12 }), 6);      // ≤ half a short special
  assert.strictEqual(W.requiredMinutes({ runtime: 0 }), 0);
});

test('remainingMs gates on runtime minus credits since start (with clock slack)', () => {
  const start = 1_000_000;
  const s = { startedAt: new Date(start), episode: 0 };
  assert.strictEqual(W.remainingMs(movie, s, start), 110 * 60000 - W.CLOCK_SLACK_MS);
  assert.strictEqual(W.remainingMs(movie, s, start + 110 * 60000 - W.CLOCK_SLACK_MS), 0);
  assert.ok(W.remainingMs(movie, s, start + 100 * 60000) > 0);
  // Series uses the current episode's runtime minus its credits (40 → 36).
  const e1 = { startedAt: new Date(start), episode: 1 };
  assert.ok(W.remainingMs(series, e1, start + 35 * 60000) > 0);
  assert.strictEqual(W.remainingMs(series, e1, start + 36 * 60000), 0);
  // No timer running → never ready.
  assert.strictEqual(W.remainingMs(movie, { startedAt: null }, start), Infinity);
  assert.strictEqual(W.remainingMs(movie, null, start), Infinity);
});

test('availability: prerequisites, hidden prerequisites and phase unlockers', () => {
  const p = { phase: 'Phase 1', prerequisites: ['a'], hiddenPrerequisites: ['b'] };
  assert.strictEqual(W.isAvailable(p, new Set(['a'])), false);
  assert.strictEqual(W.isAvailable(p, new Set(['a', 'b'])), true);
  const p2 = { phase: 'Phase 2', prerequisites: [] };
  assert.strictEqual(W.isAvailable(p2, new Set()), false);
  assert.strictEqual(W.isAvailable(p2, new Set(['avengers1'])), true);
});

test('recommended prerequisites never lock a project (She-Hulk without Daredevil S3)', () => {
  const shehulk = { phase: 'Phase 1', prerequisites: ['endgame'], recommendedPrerequisites: ['daredevil3'] };
  assert.strictEqual(W.isAvailable(shehulk, new Set(['endgame'])), true);
  assert.strictEqual(W.isAvailable(shehulk, new Set(['daredevil3'])), false);
  assert.strictEqual(W.lockedReason(shehulk, new Set(), (id) => id), 'Watch endgame first');
});

test('lockedReason names the phase unlocker or the missing prerequisite', () => {
  const titles = { avengers1: 'The Avengers', ironman1: 'Iron Man' };
  const t = (id) => titles[id] || id;
  assert.strictEqual(W.lockedReason({ phase: 'Phase 2', prerequisites: [] }, new Set(), t), 'Watch The Avengers first to unlock Phase 2');
  assert.strictEqual(W.lockedReason({ phase: 'Phase 1', prerequisites: [], hiddenPrerequisites: ['ironman1'] }, new Set(), t), 'Watch Iron Man first');
});

test('crafted non-string payloads are rejected instead of throwing (server crash regression)', () => {
  const Chat = require('../js/world-chat-logic');
  const House = require('../js/world-house-logic');
  const evil = { toString: 1 };
  assert.deepStrictEqual(Chat.normalizeMessage({ channel: 'world', text: evil }), { ok: false, error: 'empty' });
  assert.strictEqual(Chat.normalizeMessage({ channel: 'whisper', text: 'hi', to: evil }).ok, false);
  assert.doesNotThrow(() => House.validateHouse({ sign: evil, portrait: evil, props: [{ kind: evil, gx: 0, gy: 0 }] }));
});

test('admin runtime sanitising', () => {
  assert.strictEqual(W.sanitizeRuntime('126'), 126);
  assert.strictEqual(W.sanitizeRuntime(-5), 0);
  assert.strictEqual(W.sanitizeRuntime('abc'), 0);
  assert.strictEqual(W.sanitizeRuntime(9999), 600);
  assert.deepStrictEqual(W.sanitizeEpisodes([50, '41.6', 0, 'x', -1]), [50, 42]);
  assert.deepStrictEqual(W.sanitizeEpisodes('50,40'), []);
});

test('every static project has a watch runtime', () => {
  const projects = require('../server/contentLoader').get('projects');
  assert.ok(projects.length > 0);
  for (const p of projects) {
    const total = W.episodesOf(p) ? p.episodes.reduce((a, b) => a + b, 0) : p.runtime;
    assert.ok(total > 0, `${p.id} has no runtime`);
  }
});
