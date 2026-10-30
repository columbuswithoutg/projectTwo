/************************************************
 * routes/world-socket.js interval callbacks (RT2-05): the voice rebalance
 * timer and the NPC ticker run through guard(), like every socket handler,
 * so a throw in reconcileWorldVoice / NpcLogic.tickNpc is logged instead of
 * becoming an uncaughtException that restarts the server.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../routes/world-socket.js'), 'utf8');

test('the voice rebalance timer callback is wrapped in guard()', () => {
  assert.match(src, /voiceTimer = setInterval\(guard\('world\.voiceRebalance', /);
});

test('the NPC ticker callback is wrapped in guard()', () => {
  assert.match(src, /npcTicker = setInterval\(guard\('world\.npcTick', /);
  // ...and the wrapper closes before the tick interval argument.
  assert.match(src, /\}\), NpcLogic\.C\.TICK_MS\);/);
});

test('a guarded timer callback that throws does not throw out of the timer', () => {
  const { guard } = require('../routes/world-socket.js');
  const orig = console.error;
  const seen = [];
  console.error = (...a) => seen.push(a);
  try {
    const tick = guard('world.npcTick', () => { throw new Error('bad npc state'); });
    assert.doesNotThrow(() => tick());
  } finally { console.error = orig; }
  assert.equal(seen[0][0], '[ws] world.npcTick failed:');
});
