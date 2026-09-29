/************************************************
 * PLAYGROUND 3D — input logic (pure, unit-tested)
 *
 * The decisions js/playground3d-input.js makes about keyboard events,
 * pulled out so `node --test` can check them without a DOM:
 *   - which element is a place the user types (keys must not drive the
 *     avatar while it has focus — <select> included),
 *   - which physical key does what (KeyboardEvent.code, so WASD sits in the
 *     same spot on AZERTY / Dvorak / Cyrillic layouts),
 *   - which actions are one-shots that must ignore auto-repeat.
 *
 * UMD-ish like js/playground3d-physics.js. Must load before
 * js/playground3d-input.js.
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PG3DInputLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // An element that takes typed text or arrow keys itself: text inputs,
  // textareas, dropdowns (the whisper-to picker) and contentEditable.
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
  }

  // Physical key (KeyboardEvent.code) → action. Held actions are movement;
  // everything else is a one-shot edge trigger.
  const KEYMAP = Object.freeze({
    KeyW: 'up', ArrowUp: 'up',
    KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    Space: 'jump',
    KeyF: 'punch',
    KeyE: 'interact'
  });
  // Events without a `code` (very old browsers, some synthetic events) fall
  // back to the character.
  const KEY_FALLBACK = Object.freeze({
    w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left',
    d: 'right', arrowright: 'right', ' ': 'jump', spacebar: 'jump', f: 'punch', e: 'interact'
  });
  const HELD = new Set(['up', 'down', 'left', 'right']);

  // → action name or null.
  function actionFor(e) {
    if (!e) return null;
    if (e.code && Object.prototype.hasOwnProperty.call(KEYMAP, e.code)) return KEYMAP[e.code];
    if (e.code) return null;                       // a real code we don't use
    const k = typeof e.key === 'string' ? e.key.toLowerCase() : '';
    return Object.prototype.hasOwnProperty.call(KEY_FALLBACK, k) ? KEY_FALLBACK[k] : null;
  }

  function isHeld(action) { return HELD.has(action); }

  return { isTypingTarget, KEYMAP, actionFor, isHeld };
});
