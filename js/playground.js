/************************************************
 * PLAYGROUND ENGINE — /home view
 *
 * Top-down 2D fixed-room engine. Renders a layered-SVG character built
 * via the character builder; moves it via WASD/arrows on desktop or a
 * fixed bottom-center virtual joystick on mobile (portrait-first).
 *
 * Designed for one room now (loadRoom('default')) with a clean seam to
 * support multiple connected rooms in v2 — see README "Forward-
 * compatibility notes" in the plan.
 ************************************************/
const Playground = (() => {

  // Option palettes — these are the source of truth for what the
  // character builder offers. Server-side validation in routes/profile.js
  // mirrors the count of each (max = length-1). Keep in sync.
  // Index 12 (#5aa64a) is a non-human Hulk green — added for the Avengers
  // presets. Bumping this length requires bumping the `skin` max in BOTH
  // routes/profile.js (HOME_CHARACTER_RANGES) and models/user.js.
  const SKIN_TONES   = ['#f5d4a8', '#e8b48a', '#c98c5d', '#8b5a3c', '#5d3a24', '#fce4d0', '#d6a878', '#3a2418', '#fbe7d7', '#c79a6b', '#7a5230', '#2a160a', '#5aa64a'];
  const HAIR_COLORS  = ['#1a1a1a', '#5a3a22', '#a06030', '#dca960', '#cccccc', '#9b59b6', '#e74c3c', '#3498db', '#1abc9c', '#ff69b4', '#f5f0e6', '#9c4a2b', '#3a1d5a', '#8eead0'];
  const SHIRT_COLORS = ['#e23636', '#3a85f0', '#39b54a', '#f0c040', '#9b59b6', '#ff7eb6', '#444444', '#f08020', '#ffffff', '#2c3e50', '#a52a2a', '#16a085', '#1f8a8a', '#c8b4ff', '#d8a93a', '#f5e6c8'];
  const PANTS_COLORS = ['#1f3a68', '#444444', '#222222', '#5a3a22', '#7a6a3a', '#7d4a3a', '#0e3a2e', '#3a3a3a', '#888888', '#5a2a8a', '#003366', '#8b4513', '#a89058', '#6a1a2a', '#7ab8e8', '#1a4a2a'];
  const EYE_COLORS   = ['#5a3a22', '#3a85f0', '#2c8a3a', '#a06030', '#7a7a7a', '#d6a040', '#1a1a1a', '#7a3aa6'];
  const SHOE_COLORS  = ['#1a1a1a', '#5a3a22', '#ffffff', '#8b4513', '#a02828', '#3a85f0', '#f0c040', '#7a7a7a'];

  // Body build — overall size + bulk multipliers applied by the 3D rig
  // (js/playground3d.js _buildPlayer). `scale` grows the whole figure from
  // the feet; `bulk` widens the torso/arms/legs. Index 1 (Normal, 1×/1×) is
  // the default so pre-existing saved characters render identically.
  // Server validation: max index lives in routes/profile.js + models/user.js.
  const BUILDS = [
    { name: 'Slim',   scale: 0.92, bulk: 0.90 },
    { name: 'Normal', scale: 1.00, bulk: 1.00 },
    { name: 'Large',  scale: 1.12, bulk: 1.15 },
    { name: 'Huge',   scale: 1.40, bulk: 1.55 }
  ];

  // Hero gear — index into the per-hero 3D mesh sets built in
  // js/playground3d.js (_buildGear). Index 0 (None) adds nothing.
  const GEAR_LABELS = ['None', 'Iron Man', 'Captain America', 'Thor', 'Hulk', 'Black Widow', 'Hawkeye'];

  // One-click "models" of the original six Avengers. Each `char` is a full
  // homeCharacter (every slot, including the new `build` + `gear`) expressed
  // as palette indices above. Applied wholesale by the builder modal; still
  // fully tweakable afterward. Hulk uses the green skin (skin:12).
  const CHARACTER_PRESETS = [
    { id: 'ironman', charId: 'ironman', name: 'Iron Man', char: {
        skin: 1, hairStyle: 10, hairColor: 0, shirtColor: 0, pantsColor: 12,
        eyeColor: 0, eyeShape: 0, facialHairStyle: 3, facialHairColor: 0,
        glasses: 0, hat: 0, shoeColor: 0, build: 1, gear: 1 } },
    { id: 'cap', charId: 'cap', name: 'Captain America', char: {
        skin: 0, hairStyle: 11, hairColor: 3, shirtColor: 1, pantsColor: 0,
        eyeColor: 1, eyeShape: 0, facialHairStyle: 0, facialHairColor: 3,
        glasses: 0, hat: 0, shoeColor: 0, build: 2, gear: 2 } },
    { id: 'thor', charId: 'thor', name: 'Thor', char: {
        skin: 0, hairStyle: 3, hairColor: 3, shirtColor: 10, pantsColor: 2,
        eyeColor: 1, eyeShape: 0, facialHairStyle: 4, facialHairColor: 3,
        glasses: 0, hat: 0, shoeColor: 0, build: 2, gear: 3 } },
    { id: 'hulk', charId: 'hulk', name: 'Hulk', char: {
        skin: 12, hairStyle: 10, hairColor: 0, shirtColor: 2, pantsColor: 5,
        eyeColor: 2, eyeShape: 3, facialHairStyle: 0, facialHairColor: 0,
        glasses: 0, hat: 0, shoeColor: 0, build: 3, gear: 4 } },
    { id: 'widow', charId: 'blackwidow', name: 'Black Widow', char: {
        skin: 0, hairStyle: 3, hairColor: 6, shirtColor: 6, pantsColor: 2,
        eyeColor: 2, eyeShape: 1, facialHairStyle: 0, facialHairColor: 6,
        glasses: 0, hat: 0, shoeColor: 0, build: 1, gear: 5 } },
    { id: 'hawkeye', charId: 'hawkeye', name: 'Hawkeye', char: {
        skin: 1, hairStyle: 10, hairColor: 1, shirtColor: 6, pantsColor: 2,
        eyeColor: 0, eyeShape: 0, facialHairStyle: 1, facialHairColor: 1,
        glasses: 0, hat: 0, shoeColor: 0, build: 1, gear: 6 } }
  ];

  // Hair style index → SVG path "d" attribute. Drawn in a 32×48 viewBox
  // sized to the character. The head is a circle at (cx=16, cy=13, r=7),
  // so the head outline at y=18 sits at x≈20.9 / x≈11.1, and at y=12
  // sits at x≈22.7 / x≈9.3.
  //
  // Each hair shape is designed so:
  //   - bangs end at y≈12 — just above the eyes (which are at y=13),
  //     so the hair never crosses the face features
  //   - the silhouette is rounded (Q curves) rather than ending in
  //     sharp diagonal flaps, which previously read as ears/tabs
  //   - any extension beyond the head outline is small (≤1 px) so it
  //     reads as 'a slightly larger head profile', not as 'flaps'
  // 'bald' is intentionally empty — it renders nothing.
  const HAIR_STYLES = [
    // 0 — pixie: small cap on the crown, contained within the head.
    'M 10 12 Q 11 5 16 4 Q 21 5 22 12 Q 16 9 10 12 Z',
    // 1 — bob: rounded mushroom shape, side curtains ending at chin.
    'M 8 13 Q 8 5 16 3 Q 24 5 24 13 Q 24 18 22 18 L 22 12 Q 16 9 10 12 L 10 18 Q 8 18 8 13 Z',
    // 2 — spiky: zigzag across the crown, sits above the eyes.
    'M 11 11 L 12 5 L 14 10 L 15 4 L 17 9 L 18 4 L 20 10 L 21 5 L 21 11 Q 16 9 11 11 Z',
    // 3 — long: same crown shape as bob, falls past the shoulders.
    'M 8 13 Q 8 5 16 3 Q 24 5 24 13 L 24 28 L 22 28 L 22 12 Q 16 9 10 12 L 10 28 L 8 28 Z',
    // 4 — bald: nothing
    '',
    // 5 — cap: rounded dome with a brim sticking out symmetrically.
    'M 6 13 L 6 11 L 9 11 Q 9 5 16 5 Q 23 5 23 11 L 26 11 L 26 13 Z',
    // 6 — ponytail: pixie cap + a high tied tuft on top.
    'M 10 12 Q 11 5 16 4 Q 21 5 22 12 Q 16 9 10 12 Z M 14 4 Q 14 0 16 0 Q 18 0 18 4 Q 16 2 14 4 Z',
    // 7 — mohawk: thin vertical crest down the center, head-edges bare.
    'M 14 12 L 14 2 Q 14 0 16 0 Q 18 0 18 2 L 18 12 Q 16 11 14 12 Z',
    // 8 — afro: oversized rounded halo around the head.
    'M 5 13 Q 4 5 16 2 Q 28 5 27 13 Q 22 11 16 11 Q 10 11 5 13 Z',
    // 9 — curly: bumpy crown, individual ringlets along the hairline.
    'M 9 13 Q 8 11 9 9 Q 11 7 12 8 Q 14 5 16 5 Q 18 5 20 8 Q 21 7 23 9 Q 24 11 23 13 Q 21 11 19 11 Q 17 11 16 11 Q 15 11 13 11 Q 11 11 9 13 Z',
    // 10 — buzz: super-short cap, hugs the head closely.
    'M 10 11 Q 10 7 16 6 Q 22 7 22 11 Q 16 9 10 11 Z',
    // 11 — side-part: rounded cap with a sweeping bang on one side.
    'M 9 12 Q 8 5 16 4 Q 24 5 23 12 Q 22 9 19 9 Q 17 11 14 11 Q 11 10 9 12 Z',
    // 12 — topknot: pixie cap + a round bun on top.
    'M 10 12 Q 11 6 16 5 Q 21 6 22 12 Q 16 9 10 12 Z M 14 4 Q 14 1 16 1 Q 18 1 18 4 Q 18 6 16 6 Q 14 6 14 4 Z',
    // 13 — undercut: tall top with a hard line, shaved sides.
    'M 12 12 Q 11 4 16 3 Q 21 4 20 12 Q 16 10 12 12 Z'
  ];

  // Eye shape index → { left, right } pairs of attributes for two <ellipse>
  // elements. cx/cy in the same 32×48 viewBox; rx/ry are radii. Index 0 is
  // the original round look so existing characters render identically.
  const EYE_SHAPES = [
    // 0 — round
    { left: { cx: 13, cy: 13, rx: 0.9, ry: 0.9 }, right: { cx: 19, cy: 13, rx: 0.9, ry: 0.9 } },
    // 1 — narrow (sleepy slits)
    { left: { cx: 13, cy: 13, rx: 1.2, ry: 0.45 }, right: { cx: 19, cy: 13, rx: 1.2, ry: 0.45 } },
    // 2 — wide (anime/expressive)
    { left: { cx: 13, cy: 13, rx: 1.2, ry: 1.4 }, right: { cx: 19, cy: 13, rx: 1.2, ry: 1.4 } },
    // 3 — sharp (angled outward)
    { left: { cx: 13, cy: 13, rx: 1.3, ry: 0.6, rotate: -15 }, right: { cx: 19, cy: 13, rx: 1.3, ry: 0.6, rotate: 15 } },
    // 4 — soft (gentle ovals)
    { left: { cx: 13, cy: 13.1, rx: 1.0, ry: 0.8 }, right: { cx: 19, cy: 13.1, rx: 1.0, ry: 0.8 } }
  ];

  // Facial hair style index → SVG path "d" (or '' for clean shaven).
  // The head circle is at (cx=16, cy=13, r=7) so the chin sits at y≈20 and
  // the upper lip at y≈15. Mouth is at y≈16. Each path is designed to sit
  // around the mouth without covering the eyes.
  const FACIAL_HAIR_STYLES = [
    // 0 — clean
    '',
    // 1 — stubble: a thin shadow along the jawline
    'M 10 17 Q 16 21 22 17 Q 22 19 16 20 Q 10 19 10 17 Z',
    // 2 — mustache: small bar above the mouth
    'M 13 15.4 Q 16 14.6 19 15.4 Q 18 16.2 16 16 Q 14 16.2 13 15.4 Z',
    // 3 — goatee: small patch below the mouth
    'M 14.5 17 Q 16 16.8 17.5 17 Q 18 19 16 19.6 Q 14 19 14.5 17 Z',
    // 4 — full beard: thick band around chin and jaw
    'M 10 15 Q 10 20 16 21 Q 22 20 22 15 Q 21 17 19 16 Q 16 17 13 16 Q 11 17 10 15 Z',
    // 5 — chinstrap: thin frame along the jawline
    'M 10 14.5 Q 10 20 16 20.8 Q 22 20 22 14.5 Q 21.4 15.2 21.3 17 Q 19 19.5 16 19.6 Q 13 19.5 10.7 17 Q 10.6 15.2 10 14.5 Z'
  ];

  // Glasses style index → SVG snippet (so we can have multi-element frames).
  // Sits over the eyes at y≈13. Index 0 is no glasses.
  const GLASSES_STYLES = [
    '',
    // 1 — round
    '<g stroke="#1a1a1a" stroke-width="0.5" fill="none"><circle cx="13" cy="13" r="2.2"/><circle cx="19" cy="13" r="2.2"/><path d="M 15.2 13 L 16.8 13" stroke-width="0.6"/></g>',
    // 2 — square
    '<g stroke="#1a1a1a" stroke-width="0.5" fill="none"><rect x="10.8" y="11.2" width="4.4" height="3.6" rx="0.4"/><rect x="16.8" y="11.2" width="4.4" height="3.6" rx="0.4"/><path d="M 15.2 13 L 16.8 13" stroke-width="0.6"/></g>',
    // 3 — aviator (teardrop)
    '<g stroke="#2a2a2a" stroke-width="0.5" fill="rgba(120,160,200,0.25)"><path d="M 10.6 12 Q 10.4 15.4 13 15.4 Q 15.4 15.2 15.4 12.6 Q 13.6 11.4 10.6 12 Z"/><path d="M 21.4 12 Q 21.6 15.4 19 15.4 Q 16.6 15.2 16.6 12.6 Q 18.4 11.4 21.4 12 Z"/></g>',
    // 4 — half-rim (bottom only)
    '<g stroke="#1a1a1a" stroke-width="0.55" fill="none"><path d="M 10.8 13.2 Q 13 15 15.2 13.2"/><path d="M 16.8 13.2 Q 19 15 21.2 13.2"/><path d="M 15.2 13.2 L 16.8 13.2"/></g>'
  ];

  // Hat style index → SVG snippet. Sits above the head; index 0 is no hat.
  const HAT_STYLES = [
    '',
    // 1 — beanie: rounded knit cap with a cuff
    '<g><path d="M 8 7 Q 8 1 16 1 Q 24 1 24 7 Q 24 9 22 9 L 10 9 Q 8 9 8 7 Z" fill="#3a4a8a"/><rect x="7" y="8" width="18" height="2.4" rx="0.6" fill="#243466"/></g>',
    // 2 — cap: dome with brim
    '<g><path d="M 7 9 Q 7 3 16 3 Q 25 3 25 9 Z" fill="#1f3a68"/><rect x="6" y="9" width="20" height="2" rx="0.6" fill="#142a4e"/><path d="M 16 9 L 28 11 L 27 12 L 16 11 Z" fill="#142a4e"/></g>',
    // 3 — top hat: tall cylinder with thin brim (kept inside viewBox so
    // the stack doesn't get clipped above y=0)
    '<g><rect x="4" y="9" width="24" height="1.6" rx="0.4" fill="#1a1a1a"/><rect x="10" y="0" width="12" height="9" fill="#1a1a1a"/><rect x="10" y="4" width="12" height="1.4" fill="#a02828"/></g>',
    // 4 — hood: rounded cowl behind and around the head
    '<g><path d="M 4 16 Q 4 1 16 0 Q 28 1 28 16 Q 26 9 22 7 Q 16 5 10 7 Q 6 9 4 16 Z" fill="#2a2a2a"/></g>'
  ];

  // ------ engine state ------
  const PHYSICS = {
    SPEED: 220,           // px/sec at full stick deflection
    ROOM_W: 1500,
    ROOM_H: 1000,
    SPRITE_W: 32,
    SPRITE_H: 48,
    BOB_PERIOD_MS: 280    // how often the walking bob flips
  };

  let _container = null;
  let _roomEl = null;
  let _spriteEl = null;
  let _camera = { x: 0, y: 0 }; // top-left of the visible viewport in room coords
  let _state = {
    x: PHYSICS.ROOM_W / 2,
    y: PHYSICS.ROOM_H / 2,
    facing: 1,            // 1 = right, -1 = left
    bobPhase: 0,
    bobAccum: 0
  };
  let _input = null;        // input adapter instance
  let _rafId = null;
  let _lastTime = 0;
  let _running = false;

  // ------ public API ------

  function init(container, character) {
    _container = container;
    _running = true;
    _state.x = PHYSICS.ROOM_W / 2;
    _state.y = PHYSICS.ROOM_H / 2;
    _state.facing = 1;
    _camera.x = 0;
    _camera.y = 0;

    // Build DOM. The viewport clips the room; the room is the
    // translatable layer; the sprite sits inside the room.
    container.innerHTML = '';
    const viewport = document.createElement('div');
    viewport.className = 'pg-viewport';

    _roomEl = document.createElement('div');
    _roomEl.className = 'pg-room';
    _roomEl.style.width = PHYSICS.ROOM_W + 'px';
    _roomEl.style.height = PHYSICS.ROOM_H + 'px';

    // Backdrop layer — simple authored decoration, no external art.
    const backdrop = document.createElement('div');
    backdrop.className = 'pg-backdrop';
    backdrop.innerHTML = scenerySvg();
    _roomEl.appendChild(backdrop);

    // Props layer (empty in v1; reserved z-index slot for future props).
    const propsLayer = document.createElement('div');
    propsLayer.className = 'pg-props';
    _roomEl.appendChild(propsLayer);

    _spriteEl = renderCharacter(character || defaultCharacter());
    _spriteEl.classList.add('pg-sprite');
    _spriteEl.style.left = (_state.x - PHYSICS.SPRITE_W / 2) + 'px';
    _spriteEl.style.top = (_state.y - PHYSICS.SPRITE_H / 2) + 'px';
    _roomEl.appendChild(_spriteEl);

    viewport.appendChild(_roomEl);
    container.appendChild(viewport);

    _input = makeInput(viewport);

    _lastTime = performance.now();
    _rafId = requestAnimationFrame(tick);
  }

  function destroy() {
    _running = false;
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = null;
    if (_input) {
      _input.detach();
      _input = null;
    }
    if (_container) _container.innerHTML = '';
    _container = null;
    _roomEl = null;
    _spriteEl = null;
  }

  // Re-render the character sprite without restarting the engine. Used
  // when the builder modal saves a new look mid-session.
  function setCharacter(character) {
    if (!_roomEl || !_spriteEl) return;
    const fresh = renderCharacter(character);
    fresh.classList.add('pg-sprite');
    fresh.style.left = _spriteEl.style.left;
    fresh.style.top = _spriteEl.style.top;
    fresh.style.transform = _spriteEl.style.transform;
    _roomEl.replaceChild(fresh, _spriteEl);
    _spriteEl = fresh;
  }

  // ------ frame loop ------

  function tick(now) {
    if (!_running) return;
    const dt = Math.min(0.05, (now - _lastTime) / 1000);
    _lastTime = now;

    const axis = _input ? _input.getAxis() : { x: 0, y: 0 };
    const len = Math.hypot(axis.x, axis.y);
    let nx = axis.x, ny = axis.y;
    if (len > 1) { nx /= len; ny /= len; }

    if (len > 0.05) {
      _state.x += nx * PHYSICS.SPEED * dt;
      _state.y += ny * PHYSICS.SPEED * dt;
      // Mirror the sprite to face the dominant horizontal direction —
      // pure-vertical movement keeps the previous facing.
      if (Math.abs(nx) > 0.1) _state.facing = nx > 0 ? 1 : -1;
      // Walking-bob accumulator
      _state.bobAccum += dt * 1000;
      if (_state.bobAccum >= PHYSICS.BOB_PERIOD_MS) {
        _state.bobAccum = 0;
        _state.bobPhase = _state.bobPhase ? 0 : 1;
      }
    } else {
      _state.bobAccum = 0;
      _state.bobPhase = 0;
    }

    // Clamp to room bounds (sprite center can't pass the wall).
    const halfW = PHYSICS.SPRITE_W / 2;
    const halfH = PHYSICS.SPRITE_H / 2;
    if (_state.x < halfW) _state.x = halfW;
    if (_state.y < halfH) _state.y = halfH;
    if (_state.x > PHYSICS.ROOM_W - halfW) _state.x = PHYSICS.ROOM_W - halfW;
    if (_state.y > PHYSICS.ROOM_H - halfH) _state.y = PHYSICS.ROOM_H - halfH;

    // Camera-follow: center the viewport on the player, clamped so the
    // room edge never reveals empty space outside it. On screens larger
    // than the room, the room is centered and the camera doesn't move.
    if (_roomEl && _spriteEl) {
      const vw = _roomEl.parentElement.clientWidth;
      const vh = _roomEl.parentElement.clientHeight;

      let cx = _state.x - vw / 2;
      let cy = _state.y - vh / 2;
      if (PHYSICS.ROOM_W < vw) cx = (PHYSICS.ROOM_W - vw) / 2;
      else cx = Math.max(0, Math.min(PHYSICS.ROOM_W - vw, cx));
      if (PHYSICS.ROOM_H < vh) cy = (PHYSICS.ROOM_H - vh) / 2;
      else cy = Math.max(0, Math.min(PHYSICS.ROOM_H - vh, cy));
      _camera.x = cx;
      _camera.y = cy;
      _roomEl.style.transform = `translate(${-cx}px, ${-cy}px)`;

      _spriteEl.style.left = (_state.x - halfW) + 'px';
      _spriteEl.style.top = (_state.y - halfH) + 'px';
      const bobOffset = _state.bobPhase ? -1 : 0;
      _spriteEl.style.transform =
        `scale(${_state.facing}, 1) translate(0, ${bobOffset}px)`;
    }

    _rafId = requestAnimationFrame(tick);
  }

  // ------ input ------

  function makeInput(viewport) {
    // Multi-source axis: keyboard always-on, joystick mobile-only. Whichever
    // produced a non-zero reading most recently wins.
    const keys = { up: false, down: false, left: false, right: false };
    let joyAxis = { x: 0, y: 0 };
    let joyActive = false;

    function isTextField(el) {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    }

    function onKey(e, down) {
      if (isTextField(document.activeElement)) return;
      let handled = true;
      switch (e.key) {
        case 'w': case 'W': case 'ArrowUp':    keys.up = down; break;
        case 's': case 'S': case 'ArrowDown':  keys.down = down; break;
        case 'a': case 'A': case 'ArrowLeft':  keys.left = down; break;
        case 'd': case 'D': case 'ArrowRight': keys.right = down; break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    }
    const onKeyDown = e => onKey(e, true);
    const onKeyUp = e => onKey(e, false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Touch joystick — only render on touch-capable devices. Show even on
    // touch laptops; harmless for keyboard users.
    let joyEl = null, stickEl = null, joyCenter = null, joyRadius = 56;
    let activeTouchId = null;

    if ('ontouchstart' in window) {
      joyEl = document.createElement('div');
      joyEl.className = 'pg-joy';
      stickEl = document.createElement('div');
      stickEl.className = 'pg-joy-stick';
      joyEl.appendChild(stickEl);
      viewport.appendChild(joyEl);
    }

    function joyStart(t) {
      if (!joyEl) return;
      activeTouchId = t.identifier;
      joyActive = true;
      const rect = joyEl.getBoundingClientRect();
      joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      joyRadius = rect.width / 2;
      joyMove(t);
    }
    function joyMove(t) {
      if (!joyEl || !joyCenter) return;
      let dx = t.clientX - joyCenter.x;
      let dy = t.clientY - joyCenter.y;
      const d = Math.hypot(dx, dy);
      if (d > joyRadius) { dx = dx / d * joyRadius; dy = dy / d * joyRadius; }
      stickEl.style.transform = `translate(${dx}px, ${dy}px)`;
      joyAxis = { x: dx / joyRadius, y: dy / joyRadius };
    }
    function joyEnd() {
      activeTouchId = null;
      joyActive = false;
      joyAxis = { x: 0, y: 0 };
      if (stickEl) stickEl.style.transform = 'translate(0,0)';
    }

    function onTouchStart(e) {
      if (!joyEl) return;
      for (const t of e.changedTouches) {
        if (joyEl.contains(t.target)) {
          e.preventDefault();
          joyStart(t);
          return;
        }
      }
    }
    function onTouchMove(e) {
      if (activeTouchId === null) return;
      for (const t of e.changedTouches) {
        if (t.identifier === activeTouchId) {
          e.preventDefault();
          joyMove(t);
          return;
        }
      }
    }
    function onTouchEnd(e) {
      if (activeTouchId === null) return;
      for (const t of e.changedTouches) {
        if (t.identifier === activeTouchId) {
          e.preventDefault();
          joyEnd();
          return;
        }
      }
    }
    if (joyEl) {
      // passive:false so we can preventDefault and stop pinch/scroll.
      viewport.addEventListener('touchstart', onTouchStart, { passive: false });
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd);
      window.addEventListener('touchcancel', onTouchEnd);
    }

    function getAxis() {
      // Joystick wins when actively held; otherwise sum keyboard.
      if (joyActive) return { x: joyAxis.x, y: joyAxis.y };
      let x = 0, y = 0;
      if (keys.left)  x -= 1;
      if (keys.right) x += 1;
      if (keys.up)    y -= 1;
      if (keys.down)  y += 1;
      return { x, y };
    }

    function detach() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (joyEl) {
        viewport.removeEventListener('touchstart', onTouchStart);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
        window.removeEventListener('touchcancel', onTouchEnd);
      }
    }

    return { getAxis, detach };
  }

  // ------ character renderer ------

  function defaultCharacter() {
    // Used when no homeCharacter is saved yet — renders a neutral default
    // so the engine has something to draw before the builder modal saves.
    return {
      skin: 0, hairStyle: 0, hairColor: 0, shirtColor: 1, pantsColor: 0,
      eyeColor: 6, eyeShape: 0,
      facialHairStyle: 0, facialHairColor: 0,
      glasses: 0, hat: 0, shoeColor: 0,
      build: 1, gear: 0
    };
  }

  function _eyeEl(spec, color) {
    const r = spec.rotate
      ? ` transform="rotate(${spec.rotate} ${spec.cx} ${spec.cy})"`
      : '';
    return `<ellipse cx="${spec.cx}" cy="${spec.cy}" rx="${spec.rx}" ry="${spec.ry}" fill="${color}"${r} />`;
  }

  function renderCharacter(c) {
    const skin = SKIN_TONES[c.skin ?? 0] || SKIN_TONES[0];
    const hairColor = HAIR_COLORS[c.hairColor ?? 0] || HAIR_COLORS[0];
    const shirt = SHIRT_COLORS[c.shirtColor ?? 0] || SHIRT_COLORS[0];
    const pants = PANTS_COLORS[c.pantsColor ?? 0] || PANTS_COLORS[0];
    const shoe  = SHOE_COLORS[c.shoeColor ?? 0] || SHOE_COLORS[0];
    const eye   = EYE_COLORS[c.eyeColor ?? 6] || EYE_COLORS[6];
    const beardColor = HAIR_COLORS[c.facialHairColor ?? (c.hairColor ?? 0)] || HAIR_COLORS[0];
    const hairPath = HAIR_STYLES[c.hairStyle ?? 0] || '';
    const eyeSpec  = EYE_SHAPES[c.eyeShape ?? 0] || EYE_SHAPES[0];
    const beardPath = FACIAL_HAIR_STYLES[c.facialHairStyle ?? 0] || '';
    const glassesSvg = GLASSES_STYLES[c.glasses ?? 0] || '';
    const hatSvg = HAT_STYLES[c.hat ?? 0] || '';

    const wrap = document.createElement('div');
    wrap.className = 'pg-char';
    wrap.style.width = PHYSICS.SPRITE_W + 'px';
    wrap.style.height = PHYSICS.SPRITE_H + 'px';
    wrap.innerHTML = `
      <svg viewBox="0 0 32 48" width="${PHYSICS.SPRITE_W}" height="${PHYSICS.SPRITE_H}" xmlns="http://www.w3.org/2000/svg">
        <!-- shadow -->
        <ellipse cx="16" cy="46" rx="9" ry="2" fill="rgba(0,0,0,0.35)" />
        <!-- legs / pants -->
        <rect x="11" y="32" width="4" height="12" rx="1" fill="${pants}" />
        <rect x="17" y="32" width="4" height="12" rx="1" fill="${pants}" />
        <!-- shoes -->
        <rect x="10" y="43" width="6" height="3" rx="1" fill="${shoe}" />
        <rect x="16" y="43" width="6" height="3" rx="1" fill="${shoe}" />
        <!-- torso / shirt -->
        <rect x="9" y="20" width="14" height="14" rx="2" fill="${shirt}" />
        <!-- arms (skin tone, hands tucked into shirt sides) -->
        <rect x="6" y="22" width="3" height="10" rx="1.5" fill="${skin}" />
        <rect x="23" y="22" width="3" height="10" rx="1.5" fill="${skin}" />
        <!-- neck -->
        <rect x="14" y="18" width="4" height="3" fill="${skin}" />
        <!-- head -->
        <circle cx="16" cy="13" r="7" fill="${skin}" />
        <!-- eyes -->
        ${_eyeEl(eyeSpec.left, eye)}
        ${_eyeEl(eyeSpec.right, eye)}
        <!-- mouth -->
        <path d="M 14 16 Q 16 17.5 18 16" stroke="#1a1a1a" stroke-width="0.6" fill="none" stroke-linecap="round" />
        <!-- facial hair (over face but under hair/hat) -->
        ${beardPath ? `<path d="${beardPath}" fill="${beardColor}" />` : ''}
        <!-- hair (overlays head) -->
        ${hairPath ? `<path d="${hairPath}" fill="${hairColor}" />` : ''}
        <!-- glasses sit over the eyes and hair bangs -->
        ${glassesSvg}
        <!-- hat sits on top of everything on the head -->
        ${hatSvg}
      </svg>
    `;
    return wrap;
  }

  // ------ scenery (authored room backdrop, no external assets) ------

  function scenerySvg() {
    return `
      <svg viewBox="0 0 1500 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="pg-floor" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stop-color="#2a3050" />
            <stop offset="100%" stop-color="#0e1024" />
          </radialGradient>
          <pattern id="pg-tiles" x="0" y="0" width="100" height="100" patternUnits="userSpaceOnUse">
            <rect width="100" height="100" fill="transparent" />
            <path d="M 100 0 L 0 0 0 100" stroke="rgba(201,162,39,0.06)" stroke-width="1" fill="none" />
          </pattern>
        </defs>
        <rect width="1500" height="1000" fill="url(#pg-floor)" />
        <rect width="1500" height="1000" fill="url(#pg-tiles)" />
        <!-- Soft glow rug at center -->
        <ellipse cx="750" cy="500" rx="280" ry="180" fill="rgba(201,162,39,0.06)" />
        <!-- Decorative corner tufts -->
        <circle cx="120" cy="120" r="36" fill="rgba(74,222,128,0.06)" />
        <circle cx="1380" cy="120" r="36" fill="rgba(245,99,99,0.06)" />
        <circle cx="120" cy="880" r="36" fill="rgba(79,142,247,0.06)" />
        <circle cx="1380" cy="880" r="36" fill="rgba(245,210,99,0.06)" />
        <!-- Wall border -->
        <rect x="2" y="2" width="1496" height="996" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="4" rx="12" />
      </svg>
    `;
  }

  return {
    init, destroy, setCharacter, renderCharacter, defaultCharacter,
    SKIN_TONES, HAIR_COLORS, SHIRT_COLORS, PANTS_COLORS, HAIR_STYLES,
    EYE_COLORS, EYE_SHAPES, FACIAL_HAIR_STYLES, GLASSES_STYLES, HAT_STYLES, SHOE_COLORS,
    BUILDS, GEAR_LABELS, CHARACTER_PRESETS
  };
})();
