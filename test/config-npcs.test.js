/**
 * GET /api/config/npcs (routes/config.js) feeds the admin Config tab the
 * /world hero list so /admin no longer loads the world chunk (js/boot.js).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const router = require('../routes/config');
const { NPC_IDS } = require('../js/world-npc-logic');

function callNpcs() {
  const layer = router.stack.find((l) => l.route && l.route.path === '/npcs' && l.route.methods.get);
  assert.ok(layer, 'GET /npcs is registered');
  const res = { headers: {}, body: null,
    set(k, v) { this.headers[k] = v; return this; },
    json(b) { this.body = b; return this; } };
  layer.route.stack[0].handle({}, res, () => {});
  return res;
}

test('every NPC id comes back with its preset display name', () => {
  const res = callNpcs();
  assert.deepEqual(res.body.npcs.map((n) => n.id), NPC_IDS);
  const byId = Object.fromEntries(res.body.npcs.map((n) => [n.id, n.name]));
  assert.equal(byId.npc_ironman, 'Iron Man');
  assert.equal(byId.npc_widow, 'Black Widow');
  for (const n of res.body.npcs) assert.ok(!n.name.startsWith('npc_') && n.name.length > 0, n.id);
  assert.deepEqual(res.body.bodyTypes, ['Realistic', 'Box']);
  assert.match(res.headers['Cache-Control'], /public, max-age=\d+/);
});

test('/admin loads only the admin chunk', () => {
  const boot = fs.readFileSync(path.join(__dirname, '..', 'js', 'boot.js'), 'utf8');
  assert.match(boot, /Router\.register\('\/admin', lazyRoute\(\['admin'\]/);
});
