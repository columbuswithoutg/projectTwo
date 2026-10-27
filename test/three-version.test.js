const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The Three.js version lives in ONE JS constant (js/three-shim.mjs
// THREE_VERSION), but spa.html's importmap has to repeat it as a literal —
// an importmap is static JSON. A mismatch would load two different Three
// builds into one page (the shim's RoundedBoxGeometry/addon URLs vs the
// importmap's `three`), so pin them together here.
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('three-shim THREE_VERSION matches every unpkg three@ URL in spa.html and the shim', () => {
  const shim = read('js/three-shim.mjs');
  const m = shim.match(/THREE_VERSION\s*=\s*'([^']+)'/);
  assert.ok(m, 'THREE_VERSION constant not found in js/three-shim.mjs');
  const version = m[1];

  const spa = read('spa.html');
  const map = spa.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(map, 'importmap not found in spa.html');
  const imports = JSON.parse(map[1]).imports;
  assert.ok(imports.three && imports['three/addons/'], 'importmap must map three and three/addons/');
  for (const url of Object.values(imports)) {
    assert.ok(url.includes('three@' + version + '/'), url + ' does not use three@' + version);
  }
  // No other hard-coded version may creep back into the shim.
  const literals = shim.match(/three@\d[\w.-]*/g) || [];
  assert.deepEqual(literals, [], 'hard-coded three@<version> in js/three-shim.mjs: ' + literals.join(', '));
});
