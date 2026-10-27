/************************************************
 * js/playground3d-input-logic.js — which key does what in /world and
 * /home, which elements swallow keys, and held vs one-shot actions.
 * UMD-ish, so it loads with a plain require.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/playground3d-input-logic.js');

test('actionFor maps every physical code in KEYMAP', () => {
  const expected = {
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    Space: 'jump', KeyF: 'punch', KeyE: 'interact'
  };
  assert.deepEqual({ ...L.KEYMAP }, expected);
  for (const [code, action] of Object.entries(expected)) assert.equal(L.actionFor({ code }), action, code);
  assert.ok(Object.isFrozen(L.KEYMAP));
});

test('code beats key: AZERTY Z on the W key still moves up', () => {
  assert.equal(L.actionFor({ code: 'KeyW', key: 'z' }), 'up');
  assert.equal(L.actionFor({ code: 'KeyA', key: 'q' }), 'left');
  // Dvorak: the physical D key types "e", but it is still "right", not interact.
  assert.equal(L.actionFor({ code: 'KeyD', key: 'e' }), 'right');
  // Cyrillic layout: the S key types a Cyrillic letter.
  assert.equal(L.actionFor({ code: 'KeyS', key: 'ы' }), 'down');
});

test('an unused code returns null even if its key would match', () => {
  // AZERTY: the physical Z key types "w" — must not move.
  assert.equal(L.actionFor({ code: 'KeyZ', key: 'w' }), null);
  assert.equal(L.actionFor({ code: 'KeyQ', key: 'a' }), null);
  assert.equal(L.actionFor({ code: 'Enter', key: 'Enter' }), null);
});

test('key fallback when code is absent (case-insensitive)', () => {
  assert.equal(L.actionFor({ key: 'w' }), 'up');
  assert.equal(L.actionFor({ key: 'W' }), 'up');
  assert.equal(L.actionFor({ code: '', key: 'ArrowLeft' }), 'left');
  assert.equal(L.actionFor({ key: 'f' }), 'punch');
  assert.equal(L.actionFor({ key: 'E' }), 'interact');
  assert.equal(L.actionFor({ key: 'x' }), null);
});

test('Space: the code, " " and legacy "Spacebar" all jump', () => {
  assert.equal(L.actionFor({ code: 'Space', key: ' ' }), 'jump');
  assert.equal(L.actionFor({ key: ' ' }), 'jump');
  assert.equal(L.actionFor({ key: 'Spacebar' }), 'jump');
});

test('actionFor tolerates junk input', () => {
  assert.equal(L.actionFor(null), null);
  assert.equal(L.actionFor(undefined), null);
  assert.equal(L.actionFor({}), null);
  assert.equal(L.actionFor({ key: 42 }), null);
  // Inherited Object properties are not keys.
  assert.equal(L.actionFor({ code: 'toString' }), null);
  assert.equal(L.actionFor({ key: 'constructor' }), null);
});

test('isHeld: movement is held, everything else is a one-shot (ignores auto-repeat)', () => {
  for (const a of ['up', 'down', 'left', 'right']) assert.equal(L.isHeld(a), true, a);
  for (const a of ['jump', 'punch', 'interact', null, undefined, '']) assert.equal(L.isHeld(a), false, String(a));
  // Every action the keymap can produce is classified one way or the other.
  const actions = [...new Set(Object.values(L.KEYMAP))];
  assert.deepEqual(actions.filter(L.isHeld).sort(), ['down', 'left', 'right', 'up']);
  assert.deepEqual(actions.filter(a => !L.isHeld(a)).sort(), ['interact', 'jump', 'punch']);
});

test('isTypingTarget: text fields, dropdowns and contentEditable swallow keys', () => {
  assert.equal(L.isTypingTarget({ tagName: 'INPUT' }), true);
  assert.equal(L.isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(L.isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(L.isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
});

test('isTypingTarget: ordinary elements and nothing at all do not', () => {
  assert.equal(L.isTypingTarget({ tagName: 'DIV' }), false);
  assert.equal(L.isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(L.isTypingTarget({ tagName: 'CANVAS', isContentEditable: false }), false);
  assert.equal(L.isTypingTarget(null), false);
  assert.equal(L.isTypingTarget(undefined), false);
});

test('isTypingTarget reads isContentEditable, not the contentEditable attribute', () => {
  // Browsers set isContentEditable whenever contentEditable === 'true' (and
  // for inherited editability, which the attribute alone misses), so the
  // module reads only isContentEditable. An attribute-only stub is not a target.
  assert.equal(L.isTypingTarget({ tagName: 'DIV', contentEditable: 'true' }), false);
  assert.equal(L.isTypingTarget({ tagName: 'DIV', contentEditable: 'true', isContentEditable: true }), true);
});
