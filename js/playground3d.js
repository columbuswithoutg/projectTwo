/************************************************
 * PLAYGROUND 3D — /home view
 *
 * Three.js engine for the project-themed multi-room home. Each room is a
 * 1×1 grid cell from the user's saved homeLayout. Floors are textured
 * with the project's poster image; walls are colored from the dominant
 * colors auto-extracted via ThemeColor.extractTheme. Doorways are auto-
 * cut at every shared edge between adjacent rooms (2 wide, centered).
 *
 * Renders a box-built character (Roblox-proportioned, Minecraft-built)
 * with a third-person chase camera, WASD/joystick movement that's
 * camera-relative, procedural walking animation, and AABB wall collision.
 *
 * Public surface:
 *   Playground3D.init(container, character, layout)
 *   Playground3D.destroy()
 *   Playground3D.setCharacter(character)
 *   Playground3D.defaultCharacter()
 *
 * Three.js is loaded via the importmap in spa.html and assigned to
 * window.THREE by a module shim. If THREE isn't ready yet when init
 * runs, we wait for the 'three-ready' event before building the scene.
 *
 * Palettes (skin/hair/shirt/pants colors and hair-style indices) are
 * shared with the 2D builder modal — same data shape, same persistence,
 * so saved characters keep working unchanged.
 ************************************************/
const Playground3D = (() => {

  const PHYSICS = {
    SPEED: 4.0,                   // world units per second at full stick
    TURN_RATE: 12.0,              // yaw lerp speed (rad/sec equivalent)
    PLAYER_RADIUS: 0.45,          // for wall AABB collision
    STEP_PERIOD: 0.45,            // seconds per full leg-swing cycle
    BACKPEDAL_MUL: 0.6            // speed multiplier while stepping backwards
  };

  // Collision footprint of OTHER actors (remote players + NPCs) when the local
  // player bumps them. Combined with PLAYER_RADIUS this is the min separation.
  const BUMP_RADIUS = 0.40;

  const CAMERA = {
    DEFAULT_DIST: 6.5,
    MIN_DIST: 3.0,
    MAX_DIST: 14.0,
    DEFAULT_ELEV: 0.45,           // radians above horizon (home mode)
    MIN_ELEV: 0.05,
    MAX_ELEV: 1.30,
    WORLD_DEFAULT_ELEV: 0.70,     // ~40°: more top-down so room walls don't block
    WORLD_MIN_ELEV: 0.40,         // ~23°: floor so you can't tilt under the walls
    ROTATE_SPEED: 0.005,          // radians per pixel
    ZOOM_SPEED: 0.0015,           // distance per wheel delta
    FOLLOW_RATE: 4.0              // lerp speed for auto-follow azimuth
  };

  // World/grid constants — must match the editor's grid cell size and
  // server-side validation in routes/profile.js.
  const CELL = 12;                // world units per grid cell (X and Z)
  const WALL_THICKNESS = 0.3;
  const WALL_HEIGHT = 3.0;
  const DOORWAY_WIDTH = 2.0;      // gap centered on each shared cell edge
  const SKY_COLOR = 0xbfe0ff;

  // /world-mode constants — different geometry style from /home rooms.
  // Platforms are sized to match the /home room footprint (12×12) so the
  // character feels at the same scale on either map. Roads are the only
  // walkable strips between platforms — see _isInWalkable() collision.
  const WORLD = {
    SCALE: 18,                    // world units per project grid unit (room-sized + gap)
    PLATFORM_W: 12,
    PLATFORM_H: 0.4,
    PLATFORM_D: 12,
    PLATFORM_RAISE: -0.2,         // mesh center y; with PLATFORM_H=0.4 puts platform top at y=0
    ROAD_W: 2.5,                  // wide enough to comfortably walk along
    ROAD_H: 0.12,
    ROAD_RAISE: -0.08,            // mesh center y; road top sits ~2cm below platform top so the platform poster always renders on top without z-fight
    PERIMETER_PAD: 30,            // extra ground around the bounding box
    REMOTE_LERP_RATE: 8,          // per-second lerp factor for remote interp
    FADE_RATE: 12,                // per-second lerp factor for remote fade in/out (~0.2s)
    EMOTE_DURATION_MS: 1500,
    // Clean & vibrant daytime palette — bright and readable little stone town.
    WORLD_BG: 0xa9d8ff,          // bright sky / fog color
    GROUND_COLOR: 0x4f8a52,      // grass green
    ROAD_COLOR: 0xc2a878,        // warm stone path
    APRON_COLOR: 0xc7bca2,       // light stone pad around each building base
    APRON_MARGIN: 4,             // apron extends this far beyond the platform (walkable)
    // Wall fence around each platform — tall rooms (4.5u, well above the
    // ~2.2u player head and a Huge build's ~3.1u) so each node reads as an
    // enclosed room with headroom and the full-height doorway clears everyone. You can't walk off the platform except
    // through a doorway that lines up with a connecting road.
    WALL_HEIGHT: 4.5,
    WALL_THICKNESS: 0.3,
    WALL_COLOR: 0xd9cbb0,        // light stone (plaster body)
    WALL_TRIM_COLOR: 0x9a8c6f,   // baseboard / door-frame trim (darker stone)
    CEILING_COLOR: 0x6478a6,     // slate-blue roof (fallback when phase unknown)
    DOORWAY_WIDTH: 4.0,          // wide enough for the player with margin
    DOORWAY_MERGE_GAP: 1.0,      // doorways closer than this (overlap or thin sliver) collapse into one
    // Cozy-village touches. Roof tinted per MCU phase so the town reads as
    // colored districts; heights jittered per house so the skyline varies.
    ROOF_PHASE_COLORS: {         // muted, warm-leaning roof palette by phase
      'Phase 1': 0xb5563f,       // terracotta
      'Phase 2': 0x6478a6,       // slate-blue
      'Phase 3': 0x6f8f5a,       // moss green
      'Phase 4': 0x8a5a86,       // plum
      'Phase 5': 0x3f8f8f,       // teal
      'Phase 6': 0xb98a3f        // clay / amber
    },
    HEIGHT_VAR_MIN: 0.82,        // wall height = WALL_HEIGHT * lerp(min,max, rand)
    HEIGHT_VAR_MAX: 1.24,        // ~3.7u .. 5.6u
    WINDOW_W: 1.5, WINDOW_H: 1.4, // window decal size; placed on long wall segments
    WINDOW_MIN_SEG: 3.2,         // only segments at least this long get a window
    LAMP_COLOR: 0xffd98a         // warm lamp glow
  };

  // Jump physics — applies in both /home and /world. Tuned for an arcade
  // hop, max height ~1.3u, total air time ~0.7s.
  const JUMP = {
    GRAVITY: 22,                  // world units / s²
    INITIAL_V: 7.5                // initial upward velocity on spacebar
  };

  // Gap-jumping + fall/respawn (world mode). While airborne the walkability
  // check is skipped, so a jump can carry across the 2.0u (orthogonal) /
  // 2.8u (diagonal) gaps between islands: SPEED 4.0 × AIR_SPEED_MUL 1.25 ×
  // 0.68s airtime ≈ 3.4u of carry. Land on nothing → fall below the world
  // and respawn at the last safe spot. Distant islands (20u+) stay out of
  // reach by design.
  const FALL = {
    AIR_SPEED_MUL: 1.25,
    RESPAWN_DEPTH: -8,            // give up and respawn below this y
    RESPAWN_DELAY_MS: 1000,
    BROADCAST_Y_FLOOR: -2         // mirror the server's y clamp in getLocalState
  };

  // Punch + knockdown. F / the 👊 touch button throws a quick right-arm jab;
  // an actor (remote player or NPC) within RANGE gets knocked down — falls
  // backward, lies DOWN_MS with input dead (for the local victim), then gets
  // up over GETUP_MS. Networked via world:punch (see js/home-socket.js).
  const PUNCH = {
    RANGE: 1.4,
    ANIM_MS: 300,
    COOLDOWN_MS: (typeof PG3DPhysics !== 'undefined' && PG3DPhysics.PUNCH_COOLDOWN_MS) || 1000,
    DOWN_MS: 1800,
    GETUP_MS: 400,
    DOWN_ANGLE: -1.35             // root rotation.x while flat on the back
  };

  // The six shared Infinity Stones (id + glow color). Free stones sit in a
  // ring around the spawn island; held stones orbit their holder. Ownership
  // is server-authoritative (routes/world-socket.js) — the engine renders.
  const STONE_DEFS = [
    { id: 'space',   color: 0x3a85f0 },
    { id: 'mind',    color: 0xf5d020 },
    { id: 'reality', color: 0xed1d24 },
    { id: 'power',   color: 0x9b59b6 },
    { id: 'time',    color: 0x39b54a },
    { id: 'soul',    color: 0xff8020 }
  ];
  const STONE_RING_R = 4;          // ring radius around spawn (within Iron Man's floor)
  const STONE_PICKUP_D2 = 0.81;    // grab within 0.9u (feet, 3D) — same as batch 3

  // Head-top of the rig at build-scale 1 (feet at y=0): HIP_Y 0.7 + TORSO_H 0.75
  // + HEAD_SZ 0.55 + hair margin. Scaled by the player's build scale at runtime.
  // Used to cap jumps under indoor ceilings / doorway lintels.
  const PLAYER_HEAD = 2.1;

  // ── engine state ──
  let _container = null;
  let _viewport = null;
  let _renderer = null;
  let _scene = null;
  let _camera = null;
  let _player = null;            // root Group (yaw + position)
  let _rig = null;               // bones we animate (head, arms, legs, torso)
  let _walls = [];               // [{ minX, maxX, minZ, maxZ }] for collision
  let _input = null;
  let _orient = null;            // PGOrientation handle: fullscreen / lock button + rotate hint
  let _orbit = null;             // { azimuth, elevation, distance }
  let _resizeObs = null;
  let _rafId = null;
  let _onVisibility = null;       // pause the render loop while the tab is hidden
  let _threeReadyHandler = null;  // pending 'three-ready' listener (CDN still loading)
  let _lastTime = 0;
  let _running = false;
  let _stepClock = 0;             // animation phase accumulator
  let _idleClock = 0;
  let _currentChar = null;
  let _layout = null;             // { rooms: [{ projectId, gx, gy }] }
  // ── world-mode state ──
  let _mode = 'home';             // 'home' | 'world'
  let _hudLayer = null;            // HTMLDivElement overlay for nametags/bubbles/prompts
  let _worldNodes = new Map();    // projectId → { mesh, project, anchor: Vector3, walls, house, props }
  // Keeper decorations per project (WorldHouseLogic shape), fed by the view
  // from GET /api/world/houses + live world:house pushes. Kept separately from
  // the nodes so a house that arrives before its island unlocks still applies.
  let _houses = new Map();        // projectId → { wallColor, roofColor, trimColor, lampColor, sign, props }
  // Keeper tags floating over each house roof: projectId → { line1, line2, mine }.
  // Set by the view (setHouseKeepers); rendered as HUD elements in _tickHUD.
  let _keeperTags = new Map();
  const KEEPER_TAG_MAX_DIST = 80;  // world units — tags beyond this are hidden
  let _worldRoads = new Map();    // "a→b" key (sorted) → mesh
  let _remotePlayers = new Map(); // socketId → { rig, target:{x,z,yaw,walking}, current, nameEl, bubbleEls[], emoteUntil }
  let _npcs = [];                 // local Avenger NPCs patrolling their debut nodes (NOT network/voice peers)
  let _npcSpecs = [];             // declared specs [{ id, name, character, debut }] — materialized as their debut nodes unlock
  let _worldStateUnsub = null;
  let _localEmoteUntil = 0;        // ms timestamp; while > now, override right-arm pose
  let _localBubbleEls = [];        // chat bubbles floating over the LOCAL player
  let _localWalking = false;       // set each tick; read by getLocalState() for MP broadcast
  let _localBackward = false;      // walking while backpedalling — peers lean the avatar back too
  let _walkableRoads = [];         // [{ a, b, cx, cz, cosA, sinA, halfW, halfL }] for point-in-rotated-rect tests
  let _velY = 0;                   // vertical velocity for jump physics
  // ── gap-jump / fall state ──
  let _airborne = false;           // mid-jump or falling — frees XZ movement from walkability
  let _falling = false;            // landed on nothing; sinking toward respawn
  let _fallStart = 0;              // ms timestamp the fall began
  let _landAt = 0;                 // ms timestamp of the last landing (squash anim)
  const _lastSafe = { x: 0, z: 0 };// last grounded, walkable position (respawn target)
  // ── punch / knockdown state ──
  let _localPunchUntil = 0;        // jab animation window on the local rig
  let _lastPunchAt = 0;            // cooldown anchor
  let _localDownUntil = 0;         // local player knocked down — input dead
  // Sitting on a chair / lying in a bed (see _sitOn / _standUp). `_seat`
  // pins the player to the prop; `_seatCandidate` is the nearest one in
  // reach (drives the "Sit (E)" pill + touch button).
  let _seat = null;                // { nodeId, kind, gx, gy, x, z, rot, top, yaw, px, py, pz }
  let _seatCandidate = null;       // a node.props record, or null
  let _seatPromptEl = null;        // HUD pill element
  let _onPunch = null;             // view/socket callback: ({ target, npc }) on every local punch
  let _onNpcPunch = null;          // socket callback: (npcId) when a hero angry at US swings
  const _npcCombat = new Map();    // npcId → last server record; seeds heroes that materialise mid-fight
  // ── shared Infinity Stones (server-authoritative PvP; see routes/world-socket.js) ──
  const _spawnPoint = { x: 0, z: 0 }; // /world start position (Iron Man 1) — snap-respawn target
  let _initialSpawnId = null;         // island/node the player picked to spawn on (spawn picker), or null

  // ── shared, mount-persistent resources ──
  // Project poster textures are shared across mount cycles — switching between
  // /home and /world should not re-download them. Keyed by URL.
  const _textureCache = new Map();
  let _textureLoader = null;
  // Set true at the end of _initInternal, false at the top of destroy(). Texture
  // load callbacks check this before assigning to a material, so a late-firing
  // load doesn't write to a disposed scene.
  let _sceneAlive = false;
  // Reused per-frame for HUD anchor projection — set() instead of new each tick.
  let _hudAnchor = null;
  let _hudProjScratch = null;     // reused by _placeHudEl so HUD projection allocates nothing per frame

  // Cached TextureLoader. Returns the cached Texture synchronously when hit;
  // otherwise loads once and stores. The onReady callback only fires while
  // _sceneAlive is still true.
  function _loadTexture(url, onReady) {
    const THREE = window.THREE;
    if (!THREE || !url) return;
    const cached = _textureCache.get(url);
    if (cached) { onReady(cached); return; }
    _textureLoader = _textureLoader || new THREE.TextureLoader();
    _textureLoader.load(url, (tex) => {
      _textureCache.set(url, tex);
      if (_sceneAlive) onReady(tex);
    });
  }

  // ── public API ──

  function init(container, character, layout) {
    _mode = 'home';
    _container = container;
    _currentChar = character || defaultCharacter();
    _layout = (layout && Array.isArray(layout.rooms)) ? layout : { rooms: [] };
    _waitForThree(container);
  }

  // World-mode entry — builds the walkable universe map from the global
  // `projects` array + `state` (for unlock checks). Same character + camera
  // + input + animation as home mode. The caller (WorldView) wires the
  // multiplayer socket separately and uses the addRemotePlayer / chat /
  // emote APIs to render others.
  function initWorld(container, character, spawnProjectId) {
    _mode = 'world';
    _container = container;
    _currentChar = character || defaultCharacter();
    _layout = null;
    // Optional: the id of the island/node the player picked to spawn on (the
    // /world spawn picker). null → default to _worldSpawn() (Iron Man). Note
    // this only moves the PLAYER's start; _spawnPoint (stone-ring center +
    // snap-respawn target) stays canonical so it's identical for every client.
    _initialSpawnId = spawnProjectId || null;
    _waitForThree(container);
  }

  function _waitForThree(container) {
    if (window.THREE) {
      _initInternal();
    } else {
      const onReady = () => {
        window.removeEventListener('three-ready', onReady);
        _threeReadyHandler = null;
        // Container may have been swapped out before THREE arrived.
        if (_container === container) _initInternal();
      };
      // Track it so destroy() can remove it if the view is left before THREE
      // finishes loading from the CDN — otherwise the closure leaks per mount.
      _threeReadyHandler = onReady;
      window.addEventListener('three-ready', onReady);
    }
  }

  function destroy() {
    _running = false;
    _sceneAlive = false;
    _occlusion.reset();
    clearStones();
    _onStoneGrab = null;
    _localId = null;
    _onPunch = null;
    _onNpcPunch = null;
    _npcCombat.clear();
    _localPunchUntil = 0;
    _localDownUntil = 0;
    _seat = null; _seatCandidate = null; _seatPromptEl = null;
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = null;
    if (_onVisibility) { document.removeEventListener('visibilitychange', _onVisibility); _onVisibility = null; }
    if (_threeReadyHandler) { window.removeEventListener('three-ready', _threeReadyHandler); _threeReadyHandler = null; }
    if (_resizeObs) { _resizeObs.disconnect(); _resizeObs = null; }
    if (_input) { _input.detach(); _input = null; }
    if (_orient) { _orient.detach(); _orient = null; }   // exits fullscreen + unlocks if we locked
    if (_worldStateUnsub) { try { _worldStateUnsub(); } catch (_) {} _worldStateUnsub = null; }
    if (_renderer) {
      try { _renderer.dispose(); } catch (_) {}
      // dispose() alone doesn't release the WebGL context — only GC or an
      // explicit forceContextLoss does. Without this, repeated /home↔/world
      // transitions mint new contexts against the browser's ~8-16 cap and can
      // eventually black-screen the canvas on low-end devices.
      try { if (_renderer.forceContextLoss) _renderer.forceContextLoss(); } catch (_) {}
      if (_renderer.domElement && _renderer.domElement.parentNode) {
        _renderer.domElement.parentNode.removeChild(_renderer.domElement);
      }
    }
    if (_scene) _disposeRig(_scene);
    // World-mode cleanup.
    _clearNpcs();          // removes NPC name-tag DOM nodes + clears _npcs
    _npcSpecs = [];
    _worldNodes.clear();
    _houses.clear();
    _keeperTags.clear();           // tag DOM dies with the container below
    _worldRoads.clear();
    // Per-build shared materials were disposed by the _disposeRig sweep above;
    // drop the stale refs so the next mount recreates them. (PG3DHouse textures/_lampTex
    // are textures, not disposed by _disposeRig, and persist across mounts.)
    _matPlatformSide = null;
    _matApron = null;
    _ceilMatByPhase = null;
    _walkableRoads = [];
    _remotePlayers.clear();
    _hudLayer = null;
    _localEmoteUntil = 0;
    _localBubbleEls = [];
    _localWalking = false;
    _localBackward = false;
    _velY = 0;
    _showcase = null;
    _mode = 'home';
    if (_container) _container.innerHTML = '';
    _container = _viewport = _renderer = _scene = _camera = null;
    _player = _rig = null;
    _walls = [];
    _orbit = null;
  }

  function setCharacter(character) {
    _currentChar = character;
    if (!_player || !window.THREE) return;
    // Rebuild rig in place — preserve world position and yaw.
    const pos = _player.position.clone();
    const yaw = _player.rotation.y;
    _player.parent.remove(_player);
    _disposeActor(_player);
    _player = _buildPlayer(character);
    _rig = _player.userData.bones;        // re-point local rig to the new build
    _playerR = _actorRadiusFor(character);
    _player.position.copy(pos);
    _player.rotation.y = yaw;
    _scene.add(_player);
  }

  function defaultCharacter() {
    // Delegate to the 2D module's defaults so palettes stay in sync.
    if (typeof Playground !== 'undefined' && Playground.defaultCharacter) {
      return Playground.defaultCharacter();
    }
    return {
      skin: 0, hairStyle: 0, hairColor: 0, shirtColor: 1, pantsColor: 0,
      eyeColor: 6, eyeShape: 0,
      facialHairStyle: 0, facialHairColor: 0,
      glasses: 0, hat: 0, shoeColor: 0
    };
  }

  // ── init ──

  function _initInternal() {
    // Double-entry guard — a second 'three-ready' or a re-entrant call must not
    // build a second scene/renderer over the first (which would orphan a WebGL
    // context + RAF loop).
    if (_renderer) return;
    const THREE = window.THREE;
    _running = true;
    _sceneAlive = true;
    // Reset jump/fall/punch state — none of it may survive a remount
    // (leaving /world mid-fall or mid-knockdown and entering /home would
    // otherwise keep input dead or the rig tipped over).
    _velY = 0;
    _falling = false;
    _airborne = false;
    _lastSafe.x = 0;
    _lastSafe.z = 0;
    _localPunchUntil = 0;
    _lastPunchAt = 0;
    _localDownUntil = 0;
    _seat = null; _seatCandidate = null; _seatPromptEl = null;
    // Shared-stone state must not survive a remount (a stale holder map or an
    // orphaned mesh from a prior /world session would render wrong).
    clearStones();
    _spawnPoint.x = 0; _spawnPoint.z = 0;
    _hudAnchor = _hudAnchor || new THREE.Vector3();
    _hudProjScratch = _hudProjScratch || new THREE.Vector3();

    _container.innerHTML = '';
    _viewport = document.createElement('div');
    _viewport.className = 'pg3d-viewport';
    _container.appendChild(_viewport);

    // HUD overlay — name tags, chat bubbles, interaction prompts. Their
    // world-space anchors get projected to screen each tick.
    _hudLayer = document.createElement('div');
    _hudLayer.className = 'pg3d-hud';
    _viewport.appendChild(_hudLayer);

    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    _renderer.shadowMap.enabled = true;
    _renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    _renderer.domElement.className = 'pg3d-canvas';
    _viewport.appendChild(_renderer.domElement);

    _scene = new THREE.Scene();
    if (_mode === 'world') {
      // Bright daytime sky + light fog so only the far edges fade into the sky.
      _scene.background = new THREE.Color(WORLD.WORLD_BG);
      _scene.fog = new THREE.Fog(WORLD.WORLD_BG, 140, 460);
    } else {
      _scene.background = new THREE.Color(SKY_COLOR);
    }

    // Lighting — bright daylight in /world, warm daylight in /home.
    const hemi = (_mode === 'world')
      ? new THREE.HemisphereLight(0xcfe6ff, 0x6b7a55, 0.7)
      : new THREE.HemisphereLight(0xbfd9ff, 0x4a4030, 0.55);
    _scene.add(hemi);
    const sun = (_mode === 'world')
      ? new THREE.DirectionalLight(0xfff4e0, 1.0)
      : new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(8, 16, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const cam = sun.shadow.camera;
    // World mode covers a much larger area than home — widen the
    // directional light's shadow frustum so the whole map gets shade.
    if (_mode === 'world') {
      cam.left = -160; cam.right = 160; cam.top = 160; cam.bottom = -160;
      cam.near = 0.5; cam.far = 400;
    } else {
      cam.left = -32; cam.right = 32; cam.top = 32; cam.bottom = -32;
      cam.near = 0.5; cam.far = 80;
    }
    _scene.add(sun);

    _walls = [];
    let spawn;
    if (_mode === 'world') {
      _buildWorldScene();
      const worldSpawn = _worldSpawn();
      _spawnPoint.x = worldSpawn.x; _spawnPoint.z = worldSpawn.z;   // snap-respawn + stone-ring center (canonical)
      // The player's START position may differ from _spawnPoint when they picked
      // an island in the spawn picker — resolve it, else fall back to Iron Man.
      spawn = (_initialSpawnId && _projectPos(_initialSpawnId)) || worldSpawn;
    } else {
      _buildLayoutScene();
      spawn = _layoutSpawn();
    }

    // Player.
    _player = _buildPlayer(_currentChar);
    _rig = _player.userData.bones;        // local rig — animated by _tick
    _playerR = _actorRadiusFor(_currentChar);
    _player.position.set(spawn.x, 0, spawn.z);
    _lastSafe.x = spawn.x; _lastSafe.z = spawn.z;   // fall-respawn to where they actually started
    _scene.add(_player);

    // Camera.
    // Far plane wide enough to cover /world's ~360u-wide map without
    // clipping platforms / roads when the player stands at one edge.
    _camera = new THREE.PerspectiveCamera(60, 1, 0.1, 600);
    _orbit = {
      azimuth: 0,                 // 0 = behind player (looking toward -Z relative to yaw)
      // World rooms have tall solid walls, so start more top-down to see over them.
      elevation: _mode === 'world' ? CAMERA.WORLD_DEFAULT_ELEV : CAMERA.DEFAULT_ELEV,
      distance: CAMERA.DEFAULT_DIST
    };

    // Input.
    _input = PG3DInput.makeInput(_viewport, { orbit: _orbit, CAMERA, minElev: _minElev });
    // Landscape affordances (shared by /home, /world, friend homes). Attached
    // to the container, after the innerHTML wipe above, so its hint survives.
    _orient = (typeof PGOrientation !== 'undefined')
      ? PGOrientation.attach(_container, { onResize: _resizeRenderer })
      : null;

    // Initial size + resize handling.
    _resizeRenderer();
    _resizeObs = new ResizeObserver(_resizeRenderer);
    _resizeObs.observe(_viewport);

    _lastTime = performance.now();
    _rafId = requestAnimationFrame(_tick);

    // Stop rendering entirely while the tab is hidden — saves GPU/battery
    // beyond the browser's own RAF throttling. On return, reset the clock so
    // the first frame doesn't apply one huge dt of movement/animation.
    // NOTE: we intentionally do NOT freeze the shadow map (sun.shadow.autoUpdate
    // = false): player/NPC rigs cast shadows (see _buildPlayer), so freezing
    // would leave their shadows detached as they walk.
    _onVisibility = () => {
      if (document.hidden) {
        if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
      } else if (_running && !_rafId) {
        _lastTime = performance.now();
        _rafId = requestAnimationFrame(_tick);
      }
    };
    document.addEventListener('visibilitychange', _onVisibility);
  }

  function _resizeRenderer() {
    if (!_renderer || !_viewport || !_camera) return;
    const w = _viewport.clientWidth || 1;
    const h = _viewport.clientHeight || 1;
    _renderer.setSize(w, h, false);
    _camera.aspect = w / h;
    // Vertical FOV follows the aspect: 60° in landscape, opening to 80° in
    // phone portrait so the side-to-side view doesn't collapse to ~30°.
    // Trade-off: the wider portrait view draws the character a little
    // smaller — if that ever reads too small, scale _orbit.distance by
    // 60 / fov in _updateCamera rather than touching the FOV again.
    if (typeof PG3DPhysics !== 'undefined' && PG3DPhysics.fovForAspect) {
      _camera.fov = PG3DPhysics.fovForAspect(_camera.aspect);
    }
    _camera.updateProjectionMatrix();
  }

  // ── layout → scene ──

  function _findProject(projectId) {
    if (typeof projects === 'undefined' || !Array.isArray(projects)) return null;
    return projects.find(p => p && p.id === projectId) || null;
  }

  function _layoutSpawn() {
    if (!_layout || !_layout.rooms.length) return { x: 0, z: 0 };
    const r = _layout.rooms[0];
    return { x: r.gx * CELL, z: r.gy * CELL };
  }

  function _buildLayoutScene() {
    if (!_layout || !_layout.rooms.length) return;
    const THREE = window.THREE;
    const cellSet = new Set(_layout.rooms.map(r => `${r.gx},${r.gy}`));

    for (const room of _layout.rooms) {
      const project = _findProject(room.projectId);
      // Floor + walls go in either way; a missing project just yields a
      // gray placeholder so the user still has a walkable cell.
      const imgUrl = project ? `${CONFIG.IMAGE_BASE}${project.image}` : '';
      const cx = room.gx * CELL;
      const cz = room.gy * CELL;

      // Floor — textured with the project's poster.
      const floorMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      if (imgUrl) {
        _loadTexture(imgUrl, (tex) => {
          // Default ClampToEdge wrapping is fine — image stretches over
          // the full 12×12 floor cell (one copy per cell).
          floorMat.map = tex;
          floorMat.needsUpdate = true;
        });
      }
      const floorGeom = new THREE.PlaneGeometry(CELL, CELL);
      const floor = new THREE.Mesh(floorGeom, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(cx, 0, cz);
      floor.receiveShadow = true;
      floor.userData.roomId = room.projectId;
      _scene.add(floor);

      // Walls — themed from the project's poster colours.
      const wallMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
      if (imgUrl && typeof ThemeColor !== 'undefined') {
        ThemeColor.extractTheme(imgUrl).then(({ primary }) => {
          wallMat.color.set(primary);
        });
      }

      const sides = [
        { dx: 0, dy: -1 },   // N (smaller Z)
        { dx: 0, dy:  1 },   // S
        { dx: -1, dy: 0 },   // W (smaller X)
        { dx:  1, dy: 0 }    // E
      ];
      for (const s of sides) {
        const hasNeighbor = cellSet.has(`${room.gx + s.dx},${room.gy + s.dy}`);
        _buildCellSideWalls(room, s, hasNeighbor, wallMat);
      }
    }
  }

  // For a given cell + side, produce either one full wall or two flanking
  // partials with a centered DOORWAY_WIDTH gap if the side faces a
  // neighboring cell. Walls are inset by WALL_THICKNESS/2 on the cell's
  // interior side so each cell owns its own walls without overlapping
  // a neighbor's (each room sees its own theme color on its walls).
  function _buildCellSideWalls(room, side, hasDoorway, mat) {
    const HALF = CELL / 2;
    const T = WALL_THICKNESS;
    const cx = room.gx * CELL;
    const cz = room.gy * CELL;

    // Compute the *full* wall's center + size for this side.
    let centerX, centerZ, sizeX, sizeZ;
    if (side.dx === 0 && side.dy === -1) {        // N
      centerX = cx;             centerZ = cz - HALF + T / 2;
      sizeX   = CELL;           sizeZ   = T;
    } else if (side.dx === 0 && side.dy === 1) {   // S
      centerX = cx;             centerZ = cz + HALF - T / 2;
      sizeX   = CELL;           sizeZ   = T;
    } else if (side.dx === -1) {                   // W
      centerX = cx - HALF + T / 2; centerZ = cz;
      sizeX   = T;                 sizeZ   = CELL;
    } else {                                       // E
      centerX = cx + HALF - T / 2; centerZ = cz;
      sizeX   = T;                 sizeZ   = CELL;
    }

    if (!hasDoorway) {
      _addWallMesh(centerX, centerZ, sizeX, sizeZ, mat);
      return;
    }

    // Split into two flanking segments around a centered DOORWAY_WIDTH gap.
    const horizontal = sizeX > sizeZ;
    const fullLen = horizontal ? sizeX : sizeZ;
    const segLen = (fullLen - DOORWAY_WIDTH) / 2;
    if (segLen <= 0.01) return;     // doorway eats the whole wall — nothing left
    const halfDoor = DOORWAY_WIDTH / 2;
    const segOffset = halfDoor + segLen / 2;
    if (horizontal) {
      _addWallMesh(centerX - segOffset, centerZ, segLen, sizeZ, mat);
      _addWallMesh(centerX + segOffset, centerZ, segLen, sizeZ, mat);
    } else {
      _addWallMesh(centerX, centerZ - segOffset, sizeX, segLen, mat);
      _addWallMesh(centerX, centerZ + segOffset, sizeX, segLen, mat);
    }
  }

  function _addWallMesh(cx, cz, sx, sz, mat) {
    const THREE = window.THREE;
    const geom = new THREE.BoxGeometry(sx, WALL_HEIGHT, sz);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(cx, WALL_HEIGHT / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    _scene.add(mesh);
    _walls.push({
      minX: cx - sx / 2, maxX: cx + sx / 2,
      minZ: cz - sz / 2, maxZ: cz + sz / 2
    });
  }

  // ── character rig ──

  // Avatar mesh builders, the shared geometry cache and the hero-gear
  // material live in playground3d-avatar.js (loaded before this file);
  // aliased here so the engine code below is unchanged.
  const _sharedGeom = PG3DAvatar.sharedGeom;
  const _gearMat = PG3DAvatar.gearMat;
  const _palette = PG3DAvatar.palette;
  const _buildBoxPlayer = PG3DAvatar.buildBoxPlayer;
  const _buildProceduralPlayer = PG3DAvatar.buildProceduralPlayer;
  const _buildHat = PG3DAvatar.buildHat;
  const _buildGlasses = PG3DAvatar.buildGlasses;
  const _buildHelmet = PG3DAvatar.buildHelmet;
  const _buildEmblem = PG3DAvatar.buildEmblem;
  const _buildProp = PG3DAvatar.buildProp;
  const _buildAccessories = PG3DAvatar.buildAccessories;

  // Walk a subtree and dispose every geometry + material it owns. Used
  // both by the engine's destroy() (on the whole scene) and by createPreview's
  // rig swap (on a single rig group). Textures are owned by _textureCache and
  // are intentionally not disposed here.
  function _disposeRig(obj) {
    obj.traverse(o => {
      // Cache-owned geometries survive across rigs — never dispose them here.
      if (o.geometry && !(o.geometry.userData && o.geometry.userData.shared)) {
        o.geometry.dispose();
      }
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => m.dispose());
      }
    });
  }

  // ── realistic (rigged glTF) characters ──
  // PG3DHumanoid streams assets/models/humanoid/v1/*.glb (CC0 Quaternius).
  // Until they're ready — and permanently if they fail, or with ?rig=legacy /
  // localStorage pg3dRig=legacy — every character stays procedural, so the
  // engine never depends on that download.
  const _legacyRig = (() => {
    try {
      if (/[?&]rig=legacy\b/.test(location.search)) return true;
      return localStorage.getItem('pg3dRig') === 'legacy';
    } catch (_) { return false; }
  })();

  // Body type slot (Playground.BODY_TYPES): 0 Realistic, 1 Box.
  function _isBoxBody(c) {
    return !!c && c.bodyType === 1;
  }

  // Note: no GLTFLoader check — PG3DHumanoid waits for the addons itself, so
  // characters built during boot still upgrade once they arrive.
  function _humanoidUsable() {
    return !_legacyRig && typeof PG3DHumanoid !== 'undefined' &&
      typeof PG3DHumanoidLogic !== 'undefined' && !!window.THREE;
  }

  // Collision footprint for a character: bulky builds are wider than the base
  // 0.45u, so a Hulk-type can't clip through walls, doorways or other players.
  // Grows with the square root of the silhouette width — see the unit tests in
  // test/physics.test.js (actorRadius).
  function _actorRadiusFor(c) {
    const base = PHYSICS.PLAYER_RADIUS;
    if (!c || typeof PG3DHumanoidLogic === 'undefined' || !PG3DPhysics.actorRadius) return base;
    return PG3DPhysics.actorRadius(base, PG3DHumanoidLogic.bodyShapeFor(c).widthFactor);
  }
  let _playerR = PHYSICS.PLAYER_RADIUS;      // local player's footprint (build-scaled)

  // Playground.HAIR styles → the 6 hair meshes the pack ships (nearest match).
  const _HAIR_MESH = [
    'Hair_BuzzedFemale', 'Hair_Long', 'Hair_SimpleParted', 'Hair_Long', null, 'Hair_Buzzed',
    'Hair_Buns', 'Hair_Buzzed', 'Hair_Buns', 'Hair_SimpleParted', 'Hair_Buzzed', 'Hair_SimpleParted',
    'Hair_Buns', 'Hair_Buzzed'
  ];
  // Playground.SHIRT_STYLES / PANTS_STYLES → how far the cloth runs down the limb.
  const _SLEEVES = ['short', 'none', 'long', 'long', 'short', 'short', 'long', 'short', 'none'];
  const _LEGS = ['long', 'long', 'long', 'short', 'short', 'long', 'long'];

  // Character slots → PG3DHumanoid look. Clothing is tinted onto the body
  // (the CC0 pack ships no garments), so styles map to colours + hems.
  function _lookFor(c) {
    c = c || {};
    const hidden = (typeof Playground !== 'undefined' && Playground.characterHidden)
      ? Playground.characterHidden(c) : {};
    const suit = c.suit ?? 0;
    const suitHex = suit > 0 ? _palette('SUIT_COLORS', c.suitColor) : null;
    // Clothing that needs real geometry rather than a tint — skirts, coats,
    // armour, capes. The logic module decides what to build; colours are
    // resolved here, where the palettes live.
    const garments = (typeof PG3DHumanoidLogic !== 'undefined' && PG3DHumanoidLogic.garmentsFor)
      ? PG3DHumanoidLogic.garmentsFor(c) : null;
    if (garments) {
      const hexOf = (slot) => slot === 'suit' ? _palette('SUIT_COLORS', c.suitColor)
        : slot === 'outer' ? _palette('SHIRT_COLORS', c.outerwearColor)
        : slot === 'accessory' ? _palette('ACCESSORY_COLORS', c.accessoryColor)
        : _palette('PANTS_COLORS', c.pantsColor);
      for (const piece of [garments.shell, garments.skirt, garments.cape]) {
        if (piece) piece.hex = hexOf(piece.color);
      }
      // Two-tone shells (armour): the accent parts take a second colour.
      if (garments.shell && garments.shell.accent && garments.shell.accentParts) {
        garments.shell.accentHex = hexOf(garments.shell.accent);
      }
      // Detail layers: the first colour in the list that resolves. Accent
      // slots on Auto (0) resolve to null, so the Box body's default follows.
      const accent = (pal, field) => (field ?? 0) > 0 ? _palette(pal, field - 1) : null;
      const shade = (hex, k) => {
        const r = Math.round(((hex >> 16) & 255) * k), g = Math.round(((hex >> 8) & 255) * k), b = Math.round((hex & 255) * k);
        return (r << 16) | (g << 8) | b;
      };
      const detailHex = {
        shoe: () => _palette('SHOE_COLORS', c.shoeColor),
        shoeAccent: () => accent('SHOE_COLORS', c.shoeColor2),
        shirt: () => _palette('SHIRT_COLORS', c.shirtColor),
        shirtAccent: () => accent('SHIRT_COLORS', c.shirtColor2),
        shirtShade: () => shade(_palette('SHIRT_COLORS', c.shirtColor), 0.78),
        pants: () => _palette('PANTS_COLORS', c.pantsColor),
        pantsAccent: () => accent('PANTS_COLORS', c.pantsColor2),
        pantsShade: () => shade(_palette('PANTS_COLORS', c.pantsColor), 0.85),
        outer: () => _palette('SHIRT_COLORS', c.outerwearColor),
        outerAccent: () => accent('SHIRT_COLORS', c.outerwearColor2),
        accessory: () => _palette('ACCESSORY_COLORS', c.accessoryColor),
        skin: () => _palette('SKIN_TONES', c.skin),
        white: () => 0xf0f0f0,
        dark: () => 0x1a1a1a,
        seamDark: () => 0x111111
      };
      for (const d of garments.details || []) {
        d.hex = null;
        for (const slot of [].concat(d.color)) {
          const hex = detailHex[slot] ? detailHex[slot]() : null;
          if (hex != null) { d.hex = hex; break; }
        }
      }
    }
    // A Ripped top (no suit) means the whole outfit is torn — bare chest and
    // arms, bare feet, and long trousers ripped off at mid-shin (the Hulk).
    const ripped = suit === 0 && (c.shirtStyle ?? 0) === 8;
    const accessoryHex = _palette('ACCESSORY_COLORS', c.accessoryColor);
    return {
      model: (c.gender ?? 0) === 2 ? 'female' : 'male',
      build: c.build ?? 1,
      skin: _palette('SKIN_TONES', c.skin),
      top: ripped ? null : (suitHex || _palette('SHIRT_COLORS', c.shirtColor)),
      bottom: suitHex || _palette('PANTS_COLORS', c.pantsColor),
      // Sandals leave the foot bare (the sole + strap are detail layers).
      shoes: (ripped || (c.shoeStyle ?? 0) === 6) ? null : _palette('SHOE_COLORS', c.shoeColor),
      gloves: (c.gloves ?? 0) > 0 ? accessoryHex : null,
      // Fingerless gloves stop at the knuckles.
      glovesCut: (c.gloves ?? 0) === 1 ? 0.5 : 2,
      // Gauntlets run up the forearm: Thor's vambraces, Widow's bracers.
      bracers: (c.gloves ?? 0) === 3 ? accessoryHex : null,
      hair: _palette('HAIR_COLORS', c.hairColor),
      eyes: _palette('EYE_COLORS', c.eyeColor),
      sleeves: suit > 0 ? 'long' : (_SLEEVES[c.shirtStyle ?? 0] || 'short'),
      // A skirt / dress / robe hangs as real geometry, so the legs under it
      // stay bare; otherwise the trouser style decides how far the cloth runs.
      // Coat tails are over trousers, so only a real skirt bares the legs.
      legs: (garments && garments.skirt && garments.skirt.kind !== 'coat') ? 'bare'
        : suit > 0 ? ((suit === 2 || suit === 3) ? 'short' : 'long')
        : (ripped && (_LEGS[c.pantsStyle ?? 0] || 'long') === 'long') ? 'torn'
        : (_LEGS[c.pantsStyle ?? 0] || 'long'),
      garments,
      hairStyle: hidden.hairStyle ? null : (_HAIR_MESH[c.hairStyle ?? 0] || null),
      beard: !hidden.facialHairStyle && (c.facialHairStyle ?? 0) > 0
    };
  }

  // Swap a procedural character for its rigged model, cross-fading over 250ms
  // so there's no pop. `instant` skips the fade — used when the assets are
  // already loaded (nothing has been shown yet), including every synchronous
  // /customize thumbnail. Any failure leaves the procedural body untouched.
  function _upgradeActor(root, c, instant) {
    if (!root || root.userData.humanoid || root.userData.disposed) return;
    let inst;
    try {
      inst = PG3DHumanoid.createInstance(_lookFor(c));
    } catch (err) {
      console.warn('[pg3d] humanoid build failed — staying procedural', err);
      return;
    }
    const old = root.children.slice();
    root.add(inst.object);
    root.userData.humanoid = inst;
    root.userData.bones = null;          // procedural pose code must stop here
    root.updateMatrixWorld(true);        // attachSlot reads world transforms
    _attachRealisticGear(root, c, inst);
    inst.setState('idle');
    inst.update(0);                      // pose before the first render
    const mats = [];
    for (const o of old) o.traverse(m => {
      if (!m.material) return;
      for (const mat of (Array.isArray(m.material) ? m.material : [m.material])) mats.push(mat);
    });
    const fadeTo = () => (root.userData.fade == null ? 1 : root.userData.fade);
    if (instant) {
      for (const o of old) { root.remove(o); _disposeRig(o); }
      inst.setOpacity(fadeTo());
      return;
    }
    const t0 = performance.now();
    const step = () => {
      if (root.userData.disposed) return;
      const k = Math.min(1, (performance.now() - t0) / 250);
      inst.setOpacity(k * fadeTo());
      for (const m of mats) { m.transparent = true; m.opacity = 1 - k; }
      if (k < 1) { requestAnimationFrame(step); return; }
      for (const o of old) { root.remove(o); _disposeRig(o); }
      inst.setOpacity(fadeTo());
    };
    requestAnimationFrame(step);
  }

  // Re-mount the procedural hero pieces (hat / helmet / glasses / chest emblem
  // / held prop) onto the rigged body's bones, so they follow the animation.
  // They were authored around a 0.55u cube head and a blocky torso, hence the
  // per-slot scale. Gloves are a hand tint (see _lookFor); belt + mask still
  // need re-fitting and stay off for now.
  const GEAR_HEAD_SZ = 0.55;     // head size the procedural pieces assume
  const GEAR_ARM_LEN = 0.7;      // hand hangs at y = −ARM_LEN in prop space

  // _buildAccessories takes one ctx of parents + dims; on a rigged body every
  // piece mounts on its own slot, so the same slot stands in for each parent
  // and the unused dimensions are zeroed.
  function _gearCtx(slot, dims, styles, mat) {
    return {
      head: slot, torso: slot, leftArm: slot, rightArm: slot,
      dims: Object.assign({ HEAD_SZ: 0, TORSO_W: 0, TORSO_H: 0, TORSO_D: 0, ARM_LEN: 0, ARM_W: 0, ARM_D: 0 }, dims),
      styles: Object.assign({ gloves: 0, belt: 0, mask: 0 }, styles),
      mat
    };
  }

  function _attachRealisticGear(root, c, inst) {
    if (!inst || !inst.attachSlot) return;
    const THREE = window.THREE;
    const hidden = (typeof Playground !== 'undefined' && Playground.characterHidden)
      ? Playground.characterHidden(c) : {};
    const mat = (pal, idx, o) => _gearMat(_palette(pal, idx), o);

    const accMat = mat('ACCESSORY_COLORS', c.accessoryColor, { metal: 0.3, rough: 0.55 });
    const maskIdx = hidden.mask ? 0 : (c.mask ?? 0);
    // Centred on the real head and scaled to its width (the pieces assume a
    // 0.55u cube head), so it fits both the male and female bodies.
    const headSlot = inst.attachSlot('head', { center: true, fit: GEAR_HEAD_SZ });
    if (headSlot) {
      if (!hidden.hat) {
        const hat = _buildHat(c.hat ?? 0, GEAR_HEAD_SZ, _palette('SHIRT_COLORS', c.shirtColor));
        if (hat) headSlot.add(hat);
      }
      if (!hidden.glasses) {
        const glasses = _buildGlasses(c.glasses ?? 0, GEAR_HEAD_SZ);
        if (glasses) headSlot.add(glasses);
      }
      const helmet = _buildHelmet(c.helmet ?? 0, mat('SHIRT_COLORS', c.helmetColor, { metal: 0.7, rough: 0.35 }), GEAR_HEAD_SZ);
      if (helmet) headSlot.add(helmet);
      if (maskIdx) _buildAccessories(_gearCtx(headSlot, { HEAD_SZ: GEAR_HEAD_SZ }, { mask: maskIdx }, accMat));
      if (!headSlot.children.length) headSlot.removeFromParent();
    }

    // Belt at the waist; a sash lies across the chest instead. Dimensions are
    // the realistic body's, so the builder's torso-relative maths still lands.
    const beltIdx = c.belt ?? 0;
    if (beltIdx) {
      const sash = beltIdx === 3;
      const slot = inst.attachSlot(sash ? 'chest' : 'pelvis', { center: true, y: sash ? 0.04 : 0.06, scale: 1 });
      if (slot) {
        _buildAccessories(_gearCtx(slot, { TORSO_W: 0.30, TORSO_H: 0.08, TORSO_D: 0.22 }, { belt: beltIdx }, accMat));
      }
    }

    if ((c.emblem ?? 0) > 0) {
      // Scaled to the chest's width; TORSO_D then puts it just proud of the
      // sternum (the builder offsets by TORSO_D/2 + 0.14).
      const chestSlot = inst.attachSlot('chest', { center: true, y: 0.04, fit: 0.85 });
      const emblem = chestSlot && _buildEmblem(c.emblem, mat('SHIRT_COLORS', c.emblemColor), { TORSO_D: 0.30 });
      if (emblem) chestSlot.add(emblem); else if (chestSlot) chestSlot.removeFromParent();
    }

    // Heels (shoe style 5): a tapered heel block behind each heel. The rigged
    // foot stands flat, so it reads from the side, like the Box body's nub.
    const suitOn = (c.suit ?? 0) > 0;
    const rippedTop = !suitOn && (c.shirtStyle ?? 0) === 8;
    const footBox = inst.partBox && inst.partBox('foot');
    if ((c.shoeStyle ?? 0) === 5 && !rippedTop && footBox && inst.anchors) {
      const heelMat = _gearMat(_palette('SHOE_COLORS', c.shoeColor), { rough: 0.4 });
      for (const side of ['L', 'R']) {
        const bone = inst.anchors['foot.' + side];
        const slot = bone && inst.attachSlot('foot.' + side, { scale: 1 });
        if (!slot) continue;
        const ankle = inst.body.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
        const h = 0.1;
        const heel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.014, h, 14), heelMat);
        heel.name = 'gear:heel';
        heel.castShadow = true;
        // Centred just behind the heel so most of it shows (inside the foot it vanished).
        heel.position.set(0, footBox.min[1] + h / 2 - ankle.y, footBox.min[2] - 0.006 - ankle.z);
        slot.add(heel);
      }
    }

    // Hoodie (top style or outerwear): a smooth hood lying at the back of the
    // neck — a bowl opening forward, the Box body's hood block made round.
    const outerHood = (c.outerwear ?? 0) === 4;
    const hoodHex = outerHood ? _palette('SHIRT_COLORS', c.outerwearColor)
      : (!suitOn && (c.shirtStyle ?? 0) === 3) ? _palette('SHIRT_COLORS', c.shirtColor) : null;
    const torsoBox = inst.partBox && inst.partBox('torso');
    if (hoodHex != null && torsoBox) {
      const slot = inst.attachSlot('chest', { center: true, scale: 1 });
      if (slot) {
        const w = torsoBox.size[0];
        const hood = new THREE.Mesh(
          new THREE.SphereGeometry(1, 22, 12, Math.PI, Math.PI, 0, Math.PI * 0.72),
          new THREE.MeshStandardMaterial({ color: hoodHex, roughness: 0.85, side: THREE.DoubleSide })
        );
        hood.name = 'gear:hood';
        hood.castShadow = true;
        hood.scale.set(w * 0.4, w * 0.38, w * 0.36);
        hood.position.set(0, torsoBox.size[1] * 0.5 - 0.09, -torsoBox.size[2] * 0.5 + 0.02);
        hood.rotation.x = 0.35;                         // tip back so it lies on the shoulders
        slot.add(hood);
      }
    }

    // Polo with an accent colour: a bow tie at the collar (as on the Box body).
    if (!suitOn && (c.shirtStyle ?? 0) === 4 && (c.shirtColor2 ?? 0) > 0 && torsoBox) {
      const slot = inst.attachSlot('chest', { center: true, scale: 1 });
      if (slot) {
        const tieMat = _gearMat(_palette('SHIRT_COLORS', c.shirtColor2 - 1), { rough: 0.6 });
        const y = torsoBox.size[1] * 0.5 - 0.06, z = torsoBox.size[2] * 0.5 + 0.005;
        for (const s of [-1, 1]) {
          const wing = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.05, 10), tieMat);
          wing.name = 'gear:bowtie';
          wing.rotation.z = s * Math.PI / 2;          // point inward to the knot
          wing.position.set(s * 0.025, y, z);
          slot.add(wing);
        }
      }
    }

    // Iron Man helmet ⇒ powered armour: repulsor glow in each palm.
    if ((c.helmet ?? 0) === 1 && inst.anchors) {
      for (const side of ['L', 'R']) {
        const g = inst.attachSlot('hand.' + side, { scale: 1 });
        const hand = inst.anchors['hand.' + side];
        if (!g || !hand) continue;
        // Middle of the palm: halfway to the average knuckle (bone-local, so
        // it rides the hand through every clip).
        const ks = hand.children.filter(b => b.isBone && !/thumb/i.test(b.name));
        if (ks.length) {
          const p = new THREE.Vector3();
          for (const k of ks) p.add(k.position);
          g.position.copy(p.divideScalar(ks.length).multiplyScalar(0.55));
        }
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10),
          _gearMat(0xbff4ff, { emissive: 0x9fe6ff, emissiveIntensity: 1.8, rough: 0.3 }));
        orb.name = 'gear:repulsor';
        g.add(orb);
      }
    }

    if ((c.prop ?? 0) > 0) {
      // Whole-arm frames: the builder grips at y = −ARM_LEN from the shoulder,
      // so the slot spans shoulder→hand and every offset scales with the arm.
      const l = inst.attachSlot('hand.L', { armSpan: GEAR_ARM_LEN });
      const r = inst.attachSlot('hand.R', { armSpan: GEAR_ARM_LEN });
      if (l && r) {
        // Back-mounted pieces (the quiver) hang off the chest; the builder
        // offsets them behind the torso centre.
        const back = inst.attachSlot('chest', { center: true, y: 0.02, scale: 1 });
        _buildProp(c.prop, mat('SHIRT_COLORS', c.propColor, { metal: 0.5, rough: 0.45 }), {
          leftArm: l, rightArm: r, torso: back, dims: { ARM_LEN: GEAR_ARM_LEN }
        });
        if (back && !back.children.length) back.removeFromParent();
        // The builder grips at y = −ARM_LEN and offsets sideways/forward for a
        // chunky blocky arm. Slide the grip onto the palm (the slot origin) and
        // tuck those offsets in, or the prop floats beside a slim real wrist.
        for (const [side, slot] of [['L', l], ['R', r]]) {
          for (const child of slot.children) {
            child.position.y += GEAR_ARM_LEN;
            child.position.x = 0;          // sideways nudge was for a fat blocky arm
            child.position.z *= 0.15;      // keep a hint of "in front of the fingers"
          }
          // Close the hand that actually holds something.
          if (slot.children.length && inst.setFist) inst.setFist(side, 1);
        }
      }
    }
  }

  // Dispose a character built by _buildPlayer (either rig type). Shared
  // geometry//textures survive — see _sharedGeom and the humanoid variants.
  function _disposeActor(root) {
    if (!root) return;
    root.userData.disposed = true;
    const inst = root.userData.humanoid;
    if (inst) { try { inst.dispose(); } catch (_) {} root.userData.humanoid = null; }
    _disposeRig(root);
  }

  // One animation entry point for every character. Returns false for
  // procedural rigs so the caller runs the old hand-posed code.
  //   s: { speed, airborne, velY, falling, landAt, downUntil, getupUntil,
  //        hitUntil, hitClip, punchUntil, punchClip, emoteUntil, overlaySeq }
  let _coarsePointer = null;   // touch device → tighter LOD tiers

  function _animateActor(root, s, dt, now) {
    const inst = root && root.userData.humanoid;
    if (!inst) return false;
    // Level of detail: distant characters animate at a lower rate (or freeze),
    // and only nearby ones cast shadows. Keeps a crowded /world cheap.
    if (_coarsePointer === null) {
      _coarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    }
    const dist = _camera ? _camera.position.distanceTo(root.position) : 0;
    const tier = PG3DHumanoidLogic.lodTier(dist, true, _coarsePointer);
    inst.setShadows(tier.castShadow);
    if (!tier.animate) return true;                       // frozen: hold the pose
    if (tier.interval > 0) {
      root.userData.animAcc = (root.userData.animAcc || 0) + dt;
      if (root.userData.animAcc < tier.interval) return true;
      dt = root.userData.animAcc;
      root.userData.animAcc = 0;
    }
    const st = PG3DHumanoidLogic.selectAnimState({
      now,
      speed: s.speed || 0,
      backward: !!s.backward,
      maxSpeed: PHYSICS.SPEED,
      airborne: !!s.airborne,
      velY: s.velY || 0,
      falling: !!s.falling,
      landAt: s.landAt || 0,
      downUntil: s.downUntil || 0,
      getupUntil: s.getupUntil || 0,
      hitUntil: s.hitUntil || 0,
      punchUntil: s.punchUntil || 0,
      emoteUntil: s.emoteUntil || 0,
      pose: s.pose || null
    });
    // Overlays are keyed by name + a caller-bumped sequence, so two hits in a
    // row (or a jab straight into a cross) restart the clip instead of
    // running on from the first one. Callers without a seq behave as before.
    const key = st.overlay ? st.overlay + ':' + (s.overlaySeq | 0) : null;
    if (key !== root.userData.overlayKey) {
      root.userData.overlayKey = key;
      // The free clip set has no wave, so the emote borrows the talking idle.
      if (st.overlay === 'hit') inst.play(s.hitClip || 'Hit_Chest', { restart: true, once: true, fade: 0.05, timeScale: 1.3 });
      else if (st.overlay === 'punch') inst.play(s.punchClip || 'Punch_Jab', { restart: true, once: true, fade: 0.08, timeScale: 1.7 });
      else if (st.overlay === 'wave') inst.play('Idle_Talking_Loop', { restart: true, fade: 0.2 });
      else inst.setState(st.base, st.timeScale, true);   // resume the base clip
    } else if (!st.overlay) {
      inst.setState(st.base, st.timeScale);
    }
    if (inst.setBackpedal) inst.setBackpedal(!!s.backward && (st.base === 'walk' || st.base === 'run'));
    inst.update(dt);
    return true;
  }

  // Builds a character: procedural immediately, upgraded to the rigged model
  // when (and if) the assets land. The contract is unchanged — a root Group
  // with its origin at the feet, facing −Z, scaled by the build.
  function _buildPlayer(c) {
    // Box characters never load the rigged model — they keep the blocky body.
    if (_isBoxBody(c)) {
      const box = _buildBoxPlayer(c);
      box.userData.boxBody = true;   // blocky proportions → see PREVIEW_REGIONS_BOX
      return box;
    }
    const root = _buildProceduralPlayer(c);
    if (!_humanoidUsable()) return root;
    // Already loaded → swap synchronously, so callers that render the very
    // next frame (thumbnails) get the real model.
    if (PG3DHumanoid.status() === 'ready') { _upgradeActor(root, c, true); return root; }
    const gen = (root.userData.buildGen || 0) + 1;
    root.userData.buildGen = gen;
    PG3DHumanoid.whenReady().then(() => {
      if (root.userData.buildGen === gen) _upgradeActor(root, c);
    }).catch(() => {});
    return root;
  }
  // ── tick / animation ──

  // Shared walk pose — one implementation for the local player, remote
  // players, and NPCs (was three duplicated blocks). Swings the hip/shoulder
  // pivots exactly as before and adds knee/elbow bend on the second limb
  // segments (guarded, so a rig without lowers still animates).
  // Character faces -Z; rotation.x > 0 moves a hanging limb toward +Z (back).
  // `back` = backpedalling: a subtle lean back (~9°, pivoting at the feet)
  // with the head tipped forward to keep the gaze level, and shorter strides.
  const BACKPEDAL_LEAN = 0.16;
  function _walkPose(bones, phase, back) {
    const swing = Math.sin(phase) * (back ? 0.42 : 0.6);   // ~34° peak (24° backpedalling)
    bones.leftLeg.rotation.x = swing;
    bones.rightLeg.rotation.x = -swing;
    bones.leftArm.rotation.x = -swing * 0.7;
    bones.rightArm.rotation.x = swing * 0.7;
    // Knee bends while its leg swings back (push-off), never forward.
    if (bones.leftLegLower)  bones.leftLegLower.rotation.x  = Math.max(0, Math.sin(phase)) * 0.9;
    if (bones.rightLegLower) bones.rightLegLower.rotation.x = Math.max(0, -Math.sin(phase)) * 0.9;
    // Elbows keep a slight ready-bend that deepens with the swing.
    const elbow = -(0.25 + Math.abs(swing) * 0.3);
    if (bones.leftArmLower)  bones.leftArmLower.rotation.x  = elbow;
    if (bones.rightArmLower) bones.rightArmLower.rotation.x = elbow;
    bones.body.position.y = Math.abs(Math.sin(phase)) * 0.04;
    bones.body.rotation.z = 0;   // cancel any idle sway while walking
    // The face is on the body's local +Z side (the eyes sit at +Z), so a
    // NEGATIVE rotation.x tips the top away from the face: a lean back.
    // Checked in /world: the head moves with the direction of travel while
    // backpedalling. Eased, not snapped, so walking forward again straightens
    // up smoothly.
    const lean = back ? -BACKPEDAL_LEAN : 0;
    bones.body.rotation.x += (lean - bones.body.rotation.x) * 0.2;
    if (bones.head) bones.head.rotation.x += (-lean * 0.8 - bones.head.rotation.x) * 0.2;
  }

  // Punch jab — right arm thrusts forward and snaps back over ANIM_MS.
  // Character faces -Z, so "forward" is negative rotation.x on a hanging arm.
  function _applyJabPose(bones, punchUntil, now) {
    const t = Math.max(0, Math.min(1, 1 - (punchUntil - now) / PUNCH.ANIM_MS));
    const extend = Math.sin(t * Math.PI);            // 0 → out → back
    bones.rightArm.rotation.x = -(0.3 + 1.25 * extend);
    bones.rightArm.rotation.z = 0;
    if (bones.rightArmLower) bones.rightArmLower.rotation.x = 0;  // straight jab
  }

  // ── Sitting / lying ──
  // One eased pose layer for every actor (local player, remote players).
  // `pose` is 'sit' | 'lie' | null; the weight lives on root.userData so a
  // pose eases in and back out (0.1 s) instead of snapping. Rigged bodies get
  // their leg offsets from the humanoid handle (setPose); box / procedural
  // bodies are hand-posed here. Lying tips the whole root onto its back —
  // the same axis the knockdown uses, so both rig types work.
  const POSE_EASE = 10;   // 1/s
  function _applyPose(root, pose, dt) {
    if (!root) return false;
    const ud = root.userData;
    if (pose) ud.poseKind = pose;
    const target = pose ? 1 : 0;
    let w = ud.poseW || 0;
    w += (target - w) * (1 - Math.exp(-(dt || 0.016) * POSE_EASE));
    if (w < 0.002 && !pose) w = 0;
    ud.poseW = w;
    const kind = ud.poseKind;
    const inst = ud.humanoid;
    if (inst && inst.setPose) inst.setPose(pose === 'sit' ? 'sit' : null);
    // Lie: root onto its back, head toward local −z (the headboard). The tilt
    // must happen about the body's own sideways axis (after yaw), not world
    // X — with three.js's default 'XYZ' order a bed turned 90° laid the body
    // across it.
    root.rotation.order = 'YXZ';
    root.rotation.x = (kind === 'lie') ? -Math.PI / 2 * w : 0;
    const bones = ud.bones;
    if (bones && kind === 'sit' && w > 0) {
      const thigh = -Math.PI / 2 * w, shin = Math.PI / 2 * w;   // forward is local +z
      bones.leftLeg.rotation.x = thigh;
      bones.rightLeg.rotation.x = thigh;
      if (bones.leftLegLower)  bones.leftLegLower.rotation.x  = shin;
      if (bones.rightLegLower) bones.rightLegLower.rotation.x = shin;
      bones.leftArm.rotation.x = -0.35 * w;
      bones.rightArm.rotation.x = -0.35 * w;
      if (bones.leftArmLower)  bones.leftArmLower.rotation.x  = -0.6 * w;
      if (bones.rightArmLower) bones.rightArmLower.rotation.x = -0.6 * w;
      bones.body.rotation.x = 0;
      bones.body.position.y = 0;
    }
    return w > 0;
  }

  // Sit on a chair / lie in a bed. `pr` is a node.props record (kind, x, z,
  // rot, top, nodeId). The seat transform is derived from the prop: a chair
  // seats you at its centre facing the way it faces, hips at seat height; a
  // bed lays you along it with your head at the headboard.
  function _sitOn(pr) {
    if (!_player || !pr) return;
    const scale = _player.scale.y || 1;
    const yaw = (pr.rot || 0) * Math.PI / 2;
    let px = pr.x, pz = pr.z, py;
    if (pr.kind === 'bed') {
      // Feet at the foot edge (local +z; the bed is 2 long, centred on pr).
      // 0.85 left the head ~0.2 past the headboard on both body types.
      px = pr.x + Math.sin(yaw) * 1.0;
      pz = pr.z + Math.cos(yaw) * 1.0;
      py = pr.top + 0.12 * scale;
    } else {
      const inst = _player.userData.humanoid;
      const hipY = (inst && inst.hipsY > 0) ? inst.hipsY : 0.7;
      py = pr.top - hipY * scale + 0.02;
    }
    _seat = { nodeId: pr.nodeId, kind: pr.kind, gx: pr.gx, gy: pr.gy, x: pr.x, z: pr.z, rot: pr.rot || 0, top: pr.top, yaw, px, py, pz };
    _velY = 0; _falling = false;
    _localWalking = false; _localBackward = false;
    _player.position.set(px, py, pz);
    _player.rotation.y = yaw;
  }

  // Is a player-sized box at (x, z) with feet at feetY inside anything solid?
  function _blockedAt(x, z, feetY) {
    const r = _playerR;
    for (const w of _walls) {
      if (!PG3DPhysics.blocksAt(w, feetY)) continue;
      if (x + r <= w.minX || x - r >= w.maxX || z + r <= w.minZ || z - r >= w.maxZ) continue;
      return true;
    }
    return false;
  }

  // Stand up: step off the prop to the first free side (front, left, right,
  // back), never leaving the player embedded in the prop's collision box.
  function _standUp() {
    if (!_seat || !_player) return;
    const s = _seat;
    _seat = null;
    const fp = (typeof PG3DProps !== 'undefined') ? PG3DProps.footprint(s.kind) : { hx: 0.5, hz: 0.5 };
    const odd = (s.rot % 2) === 1;
    const hx = odd ? fp.hz : fp.hx, hz = odd ? fp.hx : fp.hz;
    const r = _playerR + 0.08;
    const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
    const dirs = [[sy, cy], [cy, -sy], [-cy, sy], [-sy, -cy]];
    let placed = null;
    for (const [dx, dz] of dirs) {
      const ext = Math.abs(dx) > Math.abs(dz) ? hx : hz;
      const x = s.x + dx * (ext + r), z = s.z + dz * (ext + r);
      if (_mode === 'world' && !_isInWalkable(x, z)) continue;
      if (_blockedAt(x, z, 0)) continue;
      placed = { x, z };
      break;
    }
    if (!placed) placed = { x: s.x, z: s.z };
    _player.rotation.x = 0;
    _player.position.set(placed.x, _groundAt(placed.x, placed.z), placed.z);
    _velY = 0;
  }

  function _groundAt(x, z) {
    return PG3DPhysics.groundAt(x, z, _playerR || PHYSICS.PLAYER_RADIUS, _walls);
  }

  // Nearest chair / bed on the island the player stands on, within reach of
  // its edge. Drives the "Sit (E)" pill and the touch button.
  const SEAT_REACH = 0.9;
  function _scanSeats() {
    _seatCandidate = null;
    if (!_player || _mode !== 'world') return;
    const px = _player.position.x, pz = _player.position.z;
    let best = null, bestD2 = SEAT_REACH * SEAT_REACH;
    for (const node of _worldNodes.values()) {
      if (!node.props || !node.props.length) continue;
      if (Math.abs(px - node.mesh.position.x) > WORLD.PLATFORM_W / 2 + 1 || Math.abs(pz - node.mesh.position.z) > WORLD.PLATFORM_W / 2 + 1) continue;
      for (const pr of node.props) {
        if (!pr.aabb || (pr.kind !== 'chair' && pr.kind !== 'bed')) continue;
        const dx = Math.max(pr.aabb.minX - px, 0, px - pr.aabb.maxX);
        const dz = Math.max(pr.aabb.minZ - pz, 0, pz - pr.aabb.maxZ);
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; best = pr; }
      }
    }
    _seatCandidate = best;
  }

  // Knockdown — tip the whole rig backward while downUntil is in the future,
  // ease back upright once it passes. Frame-eased so both directions read as
  // motion rather than snaps; local player, remote players, and NPCs all
  // route through here.
  function _applyDownPose(rootObj, downUntil, now) {
    if (!rootObj) return;
    const target = downUntil > now ? PUNCH.DOWN_ANGLE : 0;
    const cur = rootObj.rotation.x;
    if (cur === target) return;
    const next = cur + (target - cur) * 0.22;
    rootObj.rotation.order = 'YXZ';   // fall backward relative to facing (see _applyPose)
    rootObj.rotation.x = (target === 0 && Math.abs(next) < 0.01) ? 0 : next;
  }

  // Damp all animated joints back toward rest. k ∈ [0,1] per frame.
  function _dampPose(bones, k) {
    const d = 1 - k;
    bones.leftLeg.rotation.x  *= d;
    bones.rightLeg.rotation.x *= d;
    bones.leftArm.rotation.x  *= d;
    bones.rightArm.rotation.x *= d;
    if (bones.leftLegLower)  bones.leftLegLower.rotation.x  *= d;
    if (bones.rightLegLower) bones.rightLegLower.rotation.x *= d;
    if (bones.leftArmLower)  bones.leftArmLower.rotation.x  *= d;
    if (bones.rightArmLower) bones.rightArmLower.rotation.x *= d;
    bones.body.position.y *= d;
    bones.body.rotation.x *= d;
    if (bones.head) bones.head.rotation.x *= d;
  }

  function _tick(now) {
    if (!_running) return;
    const dt = Math.min(0.05, (now - _lastTime) / 1000);
    _lastTime = now;

    const axis = _input ? _input.getAxis() : { x: 0, y: 0 };
    let len = Math.hypot(axis.x, axis.y);
    let nx = axis.x, ny = axis.y;
    if (len > 1) { nx /= len; ny /= len; len = 1; }

    // Camera-relative movement: with the third-person camera positioned
    // behind the player at azimuth `a`, the camera's horizontal forward
    // (the direction it's looking, away from itself) is (sin a, cos a),
    // and its right (right-handed basis with up=+Y) is (-cos a, sin a).
    // Joystick/W maps to forward; D maps to camera-right, A to camera-left.
    const forward = { x:  Math.sin(_orbit.azimuth), z:  Math.cos(_orbit.azimuth) };
    const right   = { x: -Math.cos(_orbit.azimuth), z:  Math.sin(_orbit.azimuth) };
    const moveX = forward.x * (-ny) + right.x * nx;
    const moveZ = forward.z * (-ny) + right.z * nx;

    // Backpedal. ny > 0 is "pull back" (S / joystick down). Reversing used to
    // yaw the character 180° to face its movement direction, and the camera
    // auto-follow below then swung the azimuth all the way round with it —
    // which is why backing up felt like the whole screen rotated. Holding the
    // yaw means the character steps backwards and the view stays put.
    // A strong sideways component still reads as a turn, so diagonals are
    // unchanged; only near-straight-back qualifies.
    const backpedal = ny > 0.35 && Math.abs(nx) <= Math.abs(ny) * 0.8;

    // The surface under the feet: 0 on the floor, a prop's top when standing
    // on a crate / table / chair / bookshelf / bed (PG3DPhysics.groundAt).
    const g0 = PG3DPhysics.groundAt(_player.position.x, _player.position.z, _playerR, _walls);
    // Airborne (mid-jump or falling) frees XZ movement from the walkability
    // check — the landing branch below decides what happens on touchdown.
    _airborne = _falling || _player.position.y > g0 + 0.01;
    // Knocked down = input dead until you get back up.
    const _down = _localDownUntil > now;
    // One-shot requests, read once so the seat logic and the jump / punch
    // code below agree on the same keypress.
    const jumpReq = !!(_input && _input.consumeJump && _input.consumeJump());
    const punchReq = !!(_input && _input.consumePunch && _input.consumePunch());
    const interactReq = !!(_input && _input.consumeInteract && _input.consumeInteract());
    // Sitting / lying: any intent to move (or a knockdown) stands you up;
    // E toggles — sit on / lie in the nearest chair or bed, or get up.
    if (_seat && (len > 0.05 || jumpReq || punchReq || _down)) _standUp();
    if (interactReq) {
      if (_seat) _standUp();
      else if (_seatCandidate && !_falling && !_down && _player.position.y <= g0 + 0.01) _sitOn(_seatCandidate);
    }
    const seated = !!_seat;

    let moved = false;
    if (len > 0.05 && !_falling && !_down && !seated) {   // input is dead while falling, down or seated
      moved = true;
      // Slight air-speed boost so a running jump clears the island gaps.
      // Backing up is slower than going forward, the way it is on foot.
      const step = PHYSICS.SPEED * (_airborne ? FALL.AIR_SPEED_MUL : 1)
                 * (backpedal ? PHYSICS.BACKPEDAL_MUL : 1) * len * dt;
      // Move on each axis separately so collision response can slide along walls.
      _moveWithCollision(moveX * step, 0);
      _moveWithCollision(0, moveZ * step);

      // Yaw toward movement direction — skipped while backpedalling so the
      // character keeps facing where it was already looking.
      if (!backpedal) {
        const targetYaw = Math.atan2(moveX, moveZ);
        _player.rotation.y = _lerpAngle(_player.rotation.y, targetYaw, Math.min(1, PHYSICS.TURN_RATE * dt));
      }
    }
    _localWalking = moved;
    _localBackward = moved && backpedal;

    // Remember the last grounded, walkable spot — the fall-respawn target.
    // Never a spot on top of a prop: a respawn there would land inside it.
    if (!_falling && !seated && _player.position.y <= 0.01 && g0 === 0 &&
        (_mode !== 'world' || _isInWalkable(_player.position.x, _player.position.z))) {
      _lastSafe.x = _player.position.x;
      _lastSafe.z = _player.position.z;
    }

    // Jump physics — applies in both /home and /world. Space (or the
    // input adapter's consumeJump()) sets initial upward velocity if
    // grounded (on the floor or on a prop); gravity decelerates each frame
    // until we come back down onto whatever is underneath.
    if (jumpReq && !seated) {
      if (_player.position.y <= g0 + 0.01 && !_falling && !_down) _velY = JUMP.INITIAL_V;
    }

    // Punch — quick jab; a remote player or NPC within reach gets knocked
    // down. Fires the _onPunch callback on EVERY punch (target or whiff) so
    // peers see the swing; the socket layer relays it (world mode only).
    const _punchCd = PG3DPhysics.punchCooldown(now, _lastPunchAt, PUNCH.COOLDOWN_MS);
    if (punchReq && !seated) {
      // Pressed too early → a small shake on the button instead of a swing.
      if (!_punchCd.ready && _input.denyPunch) _input.denyPunch();
      if (!_falling && !_down && _punchCd.ready) {
        _lastPunchAt = now;
        _localPunchUntil = now + PUNCH.ANIM_MS;
        const actors = [];
        if (_mode === 'world') {
          for (const [id, rp] of _remotePlayers) {
            actors.push({ id: 'rp:' + id, x: rp.current.x, z: rp.current.z, y: rp.current.y || 0 });
          }
          for (let i = 0; i < _npcs.length; i++) {
            if ((_npcs[i].koUntil || 0) > now) continue;   // out cold — not a target
            actors.push({ id: 'npc:' + i, x: _npcs[i].x, z: _npcs[i].z, y: 0 });
          }
        }
        const hit = PG3DPhysics.pickPunchTarget(
          _player.position.x, _player.position.z, _player.position.y, actors, PUNCH.RANGE);
        let targetSocket = null;
        let targetNpc = null;
        if (hit && hit.startsWith('npc:')) {
          // A hero flinches at once; its HP, anger and knock-out come back
          // from the server (world:npc-update) so every player agrees.
          const n = _npcs[+hit.slice(4)];
          if (n) {
            _npcFlinch(n, now);
            n.optimisticUntil = n.hitUntil;
            targetNpc = n.id;
          }
        } else if (hit) {
          targetSocket = hit.slice(3);
          const rp = _remotePlayers.get(targetSocket);
          if (rp) rp.downUntil = now + PUNCH.DOWN_MS;   // optimistic — relay confirms
        }
        if (_onPunch) { try { _onPunch({ target: targetSocket, npc: targetNpc }); } catch (_) {} }
      }
    }
    // Drain the cooldown sweep on the punch button.
    if (_input && _input.setPunchCooldown) {
      _input.setPunchCooldown(PG3DPhysics.punchCooldown(now, _lastPunchAt, PUNCH.COOLDOWN_MS).frac);
    }
    if (seated) {
      // Pinned to the seat / mattress; the pose layer does the rest.
      _player.position.set(_seat.px, _seat.py, _seat.pz);
      _player.rotation.y = _seat.yaw;
      _velY = 0;
    } else {
      // Ground under the feet after this frame's horizontal move. A lip
      // shorter than PG3DPhysics.STEP is stepped up onto, not bumped into.
      const g = PG3DPhysics.groundAt(_player.position.x, _player.position.z, _playerR, _walls);
      if (!_falling && _velY === 0 && _player.position.y < g) _player.position.y = g;
      if (_falling || _velY !== 0 || _player.position.y > g) {
        // Ceiling cap: under a building roof / in a doorway, keep the head below
        // the lintel so a jump can't punch through. Outdoors cap is null → full hop.
        const cap = (_mode === 'world' && !_falling)
          ? _ceilingCap(_player.position.x, _player.position.z)
          : null;
        const s = PG3DPhysics.stepVertical(_player.position.y, _velY, dt, JUMP.GRAVITY, cap, g);
        _player.position.y = s.y;
        _velY = s.velY;

        if (_falling) {
          // Sinking below the world — fade out and respawn at the last safe spot.
          if (PG3DPhysics.shouldRespawn(now, _fallStart, _player.position.y, FALL)) _respawn();
        } else if (s.landed) {
          if (g > 0 || _mode !== 'world' || _isInWalkable(_player.position.x, _player.position.z)) {
            _player.position.y = g;   // the floor, or the top of the prop we came down on
            _velY = 0;
            _landAt = now;           // trigger the landing-squash animation
          } else {
            // Landed on nothing — the gap won. Keep integrating below y=0.
            _falling = true;
            _fallStart = now;
          }
        }
      }
    }

    // Third-person auto-follow: when the player is moving and the user
    // isn't actively orbiting the camera, lerp the camera's azimuth toward
    // the character's yaw so the camera trails behind the back.
    if (moved && _input && !_input.isOrbiting()) {
      _orbit.azimuth = _lerpAngle(_orbit.azimuth, _player.rotation.y,
        Math.min(1, CAMERA.FOLLOW_RATE * dt));
    }

    // Animation — rigged characters run a clip state machine; everything
    // below is the procedural fallback.
    const _rigged = _animateActor(_player, {
      // Real ground speed (backpedalling is slower), so the steps slow to match.
      speed: moved ? PHYSICS.SPEED * len * (backpedal ? PHYSICS.BACKPEDAL_MUL : 1) : 0,
      backward: moved && backpedal,
      airborne: _airborne,
      velY: _velY,
      falling: _falling,
      landAt: _landAt,
      downUntil: _localDownUntil,
      getupUntil: _localDownUntil ? _localDownUntil + PUNCH.GETUP_MS : 0,
      punchUntil: _localPunchUntil,
      emoteUntil: _localEmoteUntil,
      pose: _seat ? (_seat.kind === 'bed' ? 'lie' : 'sit') : null
    }, dt, now);

    if (_rigged) {
      // no-op: the clip drives every joint
    } else if (moved && _rig) {
      // Run the phase backwards while backpedalling — same reason the rigged
      // path flips its time scale: otherwise the legs stride forward while the
      // body travels back.
      _stepClock += backpedal ? -dt : dt;
      _idleClock = 0;
      const phase = (_stepClock / PHYSICS.STEP_PERIOD) * Math.PI * 2;
      _walkPose(_rig, phase, backpedal);
    } else if (_rig) {
      _idleClock += dt;
      _dampPose(_rig, Math.min(1, dt * 8));
      // Subtle breathing + a faint weight-shift sway.
      const breath = Math.sin(_idleClock * 1.6) * 0.012 + 1;
      _rig.body.scale.y = breath;
      _rig.body.rotation.z = Math.sin(_idleClock * 0.8) * 0.02;
    }

    // Landing squash — a brief compress-and-recover after touching down
    // from a jump. Overrides the breathing scale for ~180ms (imperceptible)
    // and composes with everything else via body scale only.
    if (_rigged) {
      // landing/punch/emote/knockdown all come from clips
    } else if (_rig && now - _landAt < 180) {
      const t = (now - _landAt) / 180;
      _rig.body.scale.y = 0.85 + 0.15 * t;
      const xz = 1.08 - 0.08 * t;
      _rig.body.scale.x = xz;
      _rig.body.scale.z = xz;
    } else if (_rig && _rig.body.scale.x !== 1) {
      _rig.body.scale.x = 1;
      _rig.body.scale.z = 1;
    }

    // Right-arm overrides: punch jab (highest priority), then wave emote.
    if (_rigged) {
      // clip-driven
    } else if (_rig && _rig.rightArm && _localPunchUntil > now) {
      _applyJabPose(_rig, _localPunchUntil, now);
    } else if (_rig && _rig.rightArm && _localEmoteUntil > now) {
      const phase = (now - (_localEmoteUntil - WORLD.EMOTE_DURATION_MS)) / 200;
      _rig.rightArm.rotation.x = -Math.PI * 0.9;
      _rig.rightArm.rotation.z = Math.sin(phase) * 0.4;
      if (_rig.rightArmLower) _rig.rightArmLower.rotation.x = 0;   // straight arm overhead
    } else if (_rig && _rig.rightArm) {
      _rig.rightArm.rotation.z = 0;
    }

    // Sitting / lying pose (both rig types), else the knockdown pose — falls
    // backward while down, eases upright after. (Rigged characters play a
    // knockdown clip instead; tipping the root too would make them fall over
    // twice.)
    const localPose = _seat ? (_seat.kind === 'bed' ? 'lie' : 'sit') : null;
    if (localPose || (_player.userData.poseW || 0) > 0) _applyPose(_player, localPose, dt);
    else if (!_rigged) _applyDownPose(_player, _localDownUntil, now);

    // World-mode-only ticks (no-ops in home mode).
    if (_mode === 'world') {
      _tickRemotePlayers(dt, now);
      _tickNpcs(dt, now);
      _tickStones(dt, now);
      _tickRoomCeilings();
      _tickHUD(now);
    }

    _updateCamera();
    // No see-through fading while a house is showcased: the player is inside
    // it, so every wall between the outside camera and them would fade away.
    if (!_showcase) _occlusion.tick(dt, now, _scene, _camera, _player);
    _renderer.render(_scene, _camera);
    _rafId = requestAnimationFrame(_tick);
  }

  // ── See-through occluders ──
  // Implemented in playground3d-occlusion.js; one instance per engine.
  const _occlusion = PG3DOcclusion.create();

  function _moveWithCollision(dx, dz) {
    const r = _playerR;
    const startX = _player.position.x;
    const startZ = _player.position.z;
    let x = startX + dx;
    let z = startZ + dz;
    for (const w of _walls) {
      // A standable prop stops blocking once the feet are near its top.
      if (!PG3DPhysics.blocksAt(w, _player.position.y)) continue;
      // Player AABB (approx capsule by box) overlaps wall AABB.
      const minX = x - r, maxX = x + r;
      const minZ = z - r, maxZ = z + r;
      if (maxX <= w.minX || minX >= w.maxX || maxZ <= w.minZ || minZ >= w.maxZ) continue;
      // Resolve along the axis we're moving on.
      if (dx !== 0 && dz === 0) {
        if (dx > 0) x = w.minX - r - 0.001;
        else        x = w.maxX + r + 0.001;
      } else if (dz !== 0 && dx === 0) {
        if (dz > 0) z = w.minZ - r - 0.001;
        else        z = w.maxZ + r + 0.001;
      } else {
        // Combined-axis fallback (shouldn't happen — we move per-axis).
        // Push out along the smallest penetration.
        const penX = dx > 0 ? (w.minX - r - x) : (w.maxX + r - x);
        const penZ = dz > 0 ? (w.minZ - r - z) : (w.maxZ + r - z);
        if (Math.abs(penX) < Math.abs(penZ)) x += penX; else z += penZ;
      }
    }
    // Solid bump against other actors (remote players + NPCs): you can't walk
    // through them. Resolved per-axis like walls, so you slide along instead of
    // sticking. Runs before the walkability check so a bump can't shove you off
    // a road/platform.
    const a = _collideActors(x, z, dx, dz, r);
    x = a.x; z = a.z;
    // World-mode walkability: must end up on a node or road. Stepping
    // off into open ground is rejected for whichever axis caused it,
    // giving natural slide-along-edge behavior because outer movement
    // already comes in per-axis. Skipped while airborne — a jump may
    // carry across a gap; the landing branch in _tick judges touchdown.
    if (_mode === 'world' && !_airborne && !_isInWalkable(x, z)) {
      if (dx !== 0 && dz === 0) x = startX;
      else if (dz !== 0 && dx === 0) z = startZ;
      else { x = startX; z = startZ; }
    }
    _player.position.x = x;
    _player.position.z = z;
  }

  // Resolve a candidate (x,z) against every other actor (remote players + local
  // NPCs), treating each as a circle of BUMP_RADIUS. Pushes the moving axis back
  // to the contact edge — same per-axis pattern as the wall loop — so the player
  // slides around people instead of phasing through them. The local player is in
  // neither list, so there's no self-collision; collision is in the XZ plane
  // regardless of jump height (avatars are taller than the jump apex anyway).
  function _collideActors(x, z, dx, dz, r) {
    // Each actor carries its own build-scaled footprint (see _actorRadiusFor);
    // BUMP_RADIUS is the fallback for anyone built before that was known.
    const hit = (ox, oz, oR) => {
      const sep = r + (oR || BUMP_RADIUS);
      const sep2 = sep * sep;
      const ddx = x - ox, ddz = z - oz;
      if (ddx * ddx + ddz * ddz >= sep2) return;          // no overlap
      if (dx !== 0 && dz === 0) {
        const reach = Math.sqrt(Math.max(0, sep2 - ddz * ddz));
        x = dx > 0 ? ox - reach - 0.001 : ox + reach + 0.001;
      } else if (dz !== 0 && dx === 0) {
        const reach = Math.sqrt(Math.max(0, sep2 - ddx * ddx));
        z = dz > 0 ? oz - reach - 0.001 : oz + reach + 0.001;
      }
    };
    for (const rp of _remotePlayers.values()) hit(rp.current.x, rp.current.z, rp.radius);
    for (const npc of _npcs) hit(npc.x, npc.z, npc.radius || NPC_RADIUS);
    return { x, z };
  }

  // ── Shared Infinity Stones (world mode) ──
  // Six stones, one of each, shared across the room. Ownership is
  // server-authoritative (routes/world-socket.js); the engine renders free
  // stones on their fixed ring slots and held stones orbiting their holder,
  // and detects the local player reaching a free stone (optimistic grab).
  let _stones = new Map();         // stoneId → { mesh, holder, ringX, ringZ, spin }
  let _onStoneGrab = null;         // view→socket bridge: fires when we reach a FREE stone
  let _heldByLocal = new Set();    // stone ids the LOCAL player currently holds
  let _localId = null;             // our socket.id (set by home-socket on connect)
  let _grabbing = new Set();       // stones we optimistically grabbed, awaiting server confirm

  function setStoneGrabHandler(fn) { _onStoneGrab = fn; }
  function setLocalId(id) { _localId = id; }
  function getLocalStoneCount() { return _heldByLocal.size; }

  // ── punch / knockdown public surface (wired by js/home-socket.js) ──

  function setPunchHandler(fn) { _onPunch = fn; }

  // A peer threw a punch — play their jab.
  function playRemotePunch(id) {
    const rp = _remotePlayers.get(id);
    if (rp) rp.punchUntil = performance.now() + PUNCH.ANIM_MS;
  }

  // A peer (not us) got hit — topple their rig.
  function knockdownRemote(id) {
    const rp = _remotePlayers.get(id);
    if (rp) rp.downUntil = performance.now() + PUNCH.DOWN_MS;
  }

  // WE got hit — fall over, input dead until back up.
  function knockdownLocal() {
    if (_seat) _standUp();
    _localDownUntil = performance.now() + PUNCH.DOWN_MS;
    _localWalking = false;
    _localBackward = false;
  }

  // Build the 6 stone meshes once the world scene exists. Ring positions are
  // derived from the spawn island (Iron Man 1) — identical for every client,
  // so free stones sit in the same place for everyone regardless of which
  // other islands they've unlocked.
  function _buildStoneMeshes() {
    if (_stones.size || !_scene || _mode !== 'world') return;
    const THREE = window.THREE;
    const geo = _sharedGeom('stoneOcta', () => new THREE.OctahedronGeometry(0.28, 0));
    STONE_DEFS.forEach((def, i) => {
      const mat = new THREE.MeshLambertMaterial({ color: def.color });
      mat.emissive = new THREE.Color(def.color);   // self-lit — reads as magical
      mat.emissiveIntensity = 0.55;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      _scene.add(mesh);
      const ang = (i / STONE_DEFS.length) * Math.PI * 2;
      _stones.set(def.id, {
        mesh, holder: null,
        ringX: _spawnPoint.x + Math.cos(ang) * STONE_RING_R,
        ringZ: _spawnPoint.z + Math.sin(ang) * STONE_RING_R,
        spin: Math.random() * Math.PI * 2
      });
    });
  }

  function clearStones() {
    for (const s of _stones.values()) {
      if (s.mesh.parent) s.mesh.parent.remove(s.mesh);
      if (s.mesh.material) s.mesh.material.dispose();   // geometry is shared
    }
    _stones.clear();
    _heldByLocal.clear();
    _grabbing.clear();
  }

  function _recomputeHeld() {
    _heldByLocal.clear();
    for (const [id, s] of _stones) if (s.holder && s.holder === _localId) _heldByLocal.add(id);
  }

  // Authoritative full state from the server: { stoneId: holderSocketId|null }.
  function setWorldStones(stateMap) {
    if (_mode !== 'world') return;
    _buildStoneMeshes();
    for (const [id, s] of _stones) {
      s.holder = (stateMap && Object.prototype.hasOwnProperty.call(stateMap, id)) ? (stateMap[id] || null) : null;
      _grabbing.delete(id);           // authoritative refresh clears optimism
    }
    _recomputeHeld();
  }

  // Single-stone ownership change (grab / steal / drop).
  function setStoneHeld(stone, holder) {
    const s = _stones.get(stone);
    if (!s) return;
    s.holder = holder || null;
    _grabbing.delete(stone);
    _recomputeHeld();
  }

  // Per-frame: spin/bob each stone, position free ones on their ring slot and
  // held ones orbiting their holder, and detect the local player reaching a
  // free stone (optimistic grab → server confirms via setStoneHeld).
  function _tickStones(dt, now) {
    if (!_stones.size || !_player) return;
    const px = _player.position.x, py = _player.position.y, pz = _player.position.z;
    for (const [id, s] of _stones) {
      s.spin += dt * 2.2;
      const bob = Math.sin(now / 400 + s.spin) * 0.08;
      s.mesh.rotation.y = s.spin;
      if (!s.holder) {
        // Free — sits on its ring slot; walk/jump onto it to claim.
        s.mesh.visible = !_grabbing.has(id);
        s.mesh.position.set(s.ringX, 0.55 + bob, s.ringZ);
        if (!_grabbing.has(id) && !_falling) {
          const dx = px - s.ringX, dy = py - 0.55, dz = pz - s.ringZ;
          if (dx * dx + dy * dy + dz * dz < STONE_PICKUP_D2) {
            _grabbing.add(id);        // optimistic; server reconciles ownership
            s.mesh.visible = false;
            if (_onStoneGrab) { try { _onStoneGrab(id); } catch (_) {} }
          }
        }
      } else {
        // Held — orbit above the holder's head if we render them, else hide
        // (carried by someone whose island we don't have loaded).
        let hp = null, headY = 0;
        if (s.holder === _localId) { hp = _player.position; headY = 2.2; }
        else { const rp = _remotePlayers.get(s.holder); if (rp) { hp = rp.rig.position; headY = 2.0; } }
        if (hp) {
          s.mesh.visible = true;
          s.mesh.position.set(hp.x + Math.cos(s.spin) * 0.5, hp.y + headY + bob, hp.z + Math.sin(s.spin) * 0.5);
        } else {
          s.mesh.visible = false;
        }
      }
    }
  }

  // Snap fade: dust a snapped-victim REMOTE by forcing its opacity toward 0
  // for a beat (reuses the remote fade system); their real position arrives
  // via world:pos as their own client teleports them to spawn.
  function _snapFadeRemote(id) {
    const rp = _remotePlayers.get(id);
    if (rp) rp.snapFadeUntil = performance.now() + 700;
  }

  // WE were dusted — fade to black, teleport to spawn (Iron Man 1), fade back.
  function snapRespawnLocal() {
    if (!_player) return;
    _falling = false; _velY = 0; _localDownUntil = 0;
    _seat = null; _player.rotation.x = 0;
    _player.position.set(_spawnPoint.x, _groundAt(_spawnPoint.x, _spawnPoint.z), _spawnPoint.z);
    _lastSafe.x = _spawnPoint.x; _lastSafe.z = _spawnPoint.z;
    if (_viewport) {
      let fade = _viewport.querySelector('.pg3d-fade');
      if (!fade) { fade = document.createElement('div'); fade.className = 'pg3d-fade'; _viewport.appendChild(fade); }
      fade.classList.add('show');
      setTimeout(() => fade.classList.remove('show'), 420);
    }
  }

  // A snap happened: dust the listed victims (local → respawn, remotes → fade).
  function applySnap(payload) {
    const victims = (payload && Array.isArray(payload.victims)) ? payload.victims : [];
    for (const vid of victims) {
      if (vid === _localId) snapRespawnLocal();
      else _snapFadeRemote(vid);
    }
  }

  // Teleport back to the last safe (grounded + walkable) position after a
  // fall, with a quick fade so the snap reads as a respawn, not a glitch.
  function _respawn() {
    _falling = false;
    _velY = 0;
    _seat = null; _player.rotation.x = 0;
    _player.position.set(_lastSafe.x, _groundAt(_lastSafe.x, _lastSafe.z), _lastSafe.z);
    if (_viewport) {
      let fade = _viewport.querySelector('.pg3d-fade');
      if (!fade) {
        fade = document.createElement('div');
        fade.className = 'pg3d-fade';
        _viewport.appendChild(fade);
      }
      fade.classList.add('show');
      setTimeout(() => fade.classList.remove('show'), 280);
    }
  }

  // Max feet-Y the player may reach at (x,z) before the head hits a building
  // ceiling, or null when not under any roof (open sky → unrestricted jump).
  // The doorway lintel underside (H - 0.45) is the lowest indoor ceiling, so
  // capping to it also clears the flat roof. Footprint is expanded by M so the
  // doorway threshold (right on the platform edge) is covered too.
  function _ceilingCap(x, z) {
    if (!_worldNodes.size) return null;
    const halfP = WORLD.PLATFORM_W / 2;
    const M = 0.5;
    const headTop = PLAYER_HEAD * ((_player && _player.scale && _player.scale.y) || 1);
    let cap = null;
    for (const node of _worldNodes.values()) {
      if (Math.abs(x - node.mesh.position.x) > halfP + M) continue;
      if (Math.abs(z - node.mesh.position.z) > halfP + M) continue;
      const H = node.wallHeight || WORLD.WALL_HEIGHT;
      const c = Math.max(0, (H - 0.45) - headTop);   // feet-Y so head stays below lintel
      cap = (cap == null) ? c : Math.min(cap, c);
    }
    return cap;
  }

  // Minimum camera elevation — higher in /world so you can't tilt under the
  // tall room walls; normal floor everywhere else.
  function _minElev() {
    return _mode === 'world' ? CAMERA.WORLD_MIN_ELEV : CAMERA.MIN_ELEV;
  }

  // House showcase (the keeper's editor is open): instead of following the
  // player — who is standing INSIDE the house, under a roof that is hidden
  // for them — the camera circles the house slowly from outside so every
  // roof / wall / window change is visible as it is made. Cleared when the
  // editor closes; the normal orbit resumes untouched.
  let _showcase = null;            // { projectId, since }
  const SHOWCASE = { RADIUS: 24, ABOVE_ROOF: 4, TURN: 0.22 /* rad/s */, START: Math.PI * 0.8 };

  function setHouseShowcase(projectId) {
    const node = _worldNodes.get(projectId);
    if (!node || _mode !== 'world') { _showcase = null; return false; }
    _showcase = { projectId, since: performance.now() };
    _occlusion.reset();            // nothing stays faded from the follow camera
    return true;
  }
  function clearHouseShowcase() { _showcase = null; }

  function _updateCamera() {
    if (!_camera || !_player || !_orbit) return;
    if (_showcase) {
      const node = _worldNodes.get(_showcase.projectId);
      if (node && node.mesh) {
        const cx = node.mesh.position.x, cz = node.mesh.position.z;
        const t = (performance.now() - _showcase.since) / 1000;
        const a = SHOWCASE.START + t * SHOWCASE.TURN;
        const topY = node.roofTopY || ((node.wallHeight || WORLD.WALL_HEIGHT) + 0.2);
        _camera.position.set(cx + Math.sin(a) * SHOWCASE.RADIUS, topY + SHOWCASE.ABOVE_ROOF, cz + Math.cos(a) * SHOWCASE.RADIUS);
        _camera.lookAt(cx, (node.wallHeight || WORLD.WALL_HEIGHT) * 0.45, cz);
        return;
      }
    }
    const targetX = _player.position.x;
    // Chest level — lower while lying down so the bed stays in frame.
    const lying = _seat && _seat.kind === 'bed';
    const targetY = _player.position.y + (lying ? 0.45 : 1.15) * (_player.scale.y || 1);
    const targetZ = _player.position.z;
    const d = _orbit.distance;
    const e = _orbit.elevation;
    const a = _orbit.azimuth;
    // Camera sits BEHIND the character: when a equals the player's yaw,
    // the camera is directly behind looking toward the character's back
    // (and beyond). Minus signs put the camera opposite the facing dir.
    const cx = targetX - Math.sin(a) * Math.cos(e) * d;
    const cz = targetZ - Math.cos(a) * Math.cos(e) * d;
    const cy = targetY + Math.sin(e) * d;
    _camera.position.set(cx, cy, cz);
    _camera.lookAt(targetX, targetY, targetZ);
  }

  function _lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  // ────────────────────────────────────────────────────────────────────
  // WORLD MODE — walkable universe map
  // ────────────────────────────────────────────────────────────────────

  // True when the player has watched nothing at all. Only then does /world
  // need a synthetic entry point — otherwise the world is built purely from
  // what they've actually seen.
  function _nothingWatched() {
    if (typeof state === 'undefined' || !state.data) return true;
    return state.data.size === 0;
  }

  // Which projects exist in /world. Watched ones, and nothing else — the world
  // is a record of where you've been, so an unwatched island would be a place
  // you can walk around before you've seen the film. The single exception is a
  // brand-new account with zero watched projects: without it their world would
  // be an empty field, so the canonical start node (Iron Man) is materialized
  // as the lone entry point until they watch something.
  function _isProjectUnlocked(p) {
    if (!p) return false;
    if (typeof state !== 'undefined' && state.isWatched && state.isWatched(p.id)) return true;
    if (!_nothingWatched()) return false;
    const startId = (typeof CONFIG !== 'undefined' && CONFIG.START_NODE_ID) || 'ironman1';
    return p.id === startId;
  }

  function _worldSpawn() {
    // Spawn near the first unlocked node so a brand-new user lands on
    // Iron Man (which has no prereqs and is always unlocked).
    if (typeof projects !== 'undefined' && Array.isArray(projects)) {
      const first = projects.find(p => _isProjectUnlocked(p));
      if (first) return { x: first.gridX * WORLD.SCALE, z: first.gridY * WORLD.SCALE };
    }
    return { x: 0, z: 0 };
  }

  // World-space center of a project's platform, or null if the id is unknown
  // or the project isn't unlocked/positioned. Used to spawn/teleport the player
  // onto a chosen island.
  function _projectPos(id) {
    if (typeof projects === 'undefined' || !Array.isArray(projects)) return null;
    const p = projects.find(q => q.id === id);
    if (!p || !_isProjectUnlocked(p)) return null;
    if (typeof p.gridX !== 'number' || typeof p.gridY !== 'number') return null;
    return { x: p.gridX * WORLD.SCALE, z: p.gridY * WORLD.SCALE };
  }

  // Teleport the local player onto a chosen island node, with the same
  // fade-to-black-and-back used by respawns. Used by the post-snap spawn
  // picker (WorldView) so a dusted player can pick where to reassemble.
  function teleportToNode(id) {
    if (!_player || _mode !== 'world') return;
    const pos = _projectPos(id);
    if (!pos) return;
    _falling = false; _velY = 0; _localDownUntil = 0;
    _seat = null; _player.rotation.x = 0;
    _player.position.set(pos.x, _groundAt(pos.x, pos.z), pos.z);
    _lastSafe.x = pos.x; _lastSafe.z = pos.z;
    if (_viewport) {
      let fade = _viewport.querySelector('.pg3d-fade');
      if (!fade) { fade = document.createElement('div'); fade.className = 'pg3d-fade'; _viewport.appendChild(fade); }
      fade.classList.add('show');
      setTimeout(() => fade.classList.remove('show'), 420);
    }
  }

  function _buildWorldScene() {
    if (typeof projects === 'undefined' || !Array.isArray(projects)) return;
    const THREE = window.THREE;

    // Compute bounding box of ALL projects so the ground & perimeter
    // cover the eventual reveal area, even before everything is unlocked.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of projects) {
      if (typeof p.gridX !== 'number' || typeof p.gridY !== 'number') continue;
      const x = p.gridX * WORLD.SCALE, z = p.gridY * WORLD.SCALE;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (!isFinite(minX)) { minX = -50; maxX = 50; minZ = -50; maxZ = 50; }
    const pad = WORLD.PERIMETER_PAD;
    const groundW = (maxX - minX) + pad * 2;
    const groundD = (maxZ - minZ) + pad * 2;
    const groundCx = (minX + maxX) / 2;
    const groundCz = (minZ + maxZ) / 2;

    // Ground.
    const groundMat = new THREE.MeshLambertMaterial({ color: WORLD.GROUND_COLOR });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundW, groundD), groundMat);
    ground.rotation.x = -Math.PI / 2;
    // Sit ground slightly below the platform/road tops (y=0) so platforms
    // read as gently raised over the grass without z-fighting.
    ground.position.set(groundCx, -0.05, groundCz);
    ground.receiveShadow = true;
    _scene.add(ground);

    // Invisible perimeter walls — same AABB list the existing collision
    // system already consumes. Player can't walk off the ground.
    const halfW = groundW / 2, halfD = groundD / 2;
    const t = 1.0;  // wall thickness (invisible — just collision)
    _walls.push({ minX: groundCx - halfW - t, maxX: groundCx - halfW,     minZ: groundCz - halfD - t, maxZ: groundCz + halfD + t });
    _walls.push({ minX: groundCx + halfW,     maxX: groundCx + halfW + t, minZ: groundCz - halfD - t, maxZ: groundCz + halfD + t });
    _walls.push({ minX: groundCx - halfW - t, maxX: groundCx + halfW + t, minZ: groundCz - halfD - t, maxZ: groundCz - halfD     });
    _walls.push({ minX: groundCx - halfW - t, maxX: groundCx + halfW + t, minZ: groundCz + halfD,     maxZ: groundCz + halfD + t });

    // Initial node/road materialization. The state subscription handles
    // newly-unlocked nodes mid-session.
    _rebuildWorldNodes();
    if (typeof state !== 'undefined' && state.subscribe) {
      _worldStateUnsub = state.subscribe(() => _rebuildWorldNodes());
    }
  }

  // Idempotently materialize every project that has just become unlocked.
  // Called once at scene-build and again on every state change.
  function _rebuildWorldNodes() {
    if (_mode !== 'world' || !_scene || typeof projects === 'undefined') return;
    const THREE = window.THREE;

    for (const p of projects) {
      if (!_isProjectUnlocked(p)) continue;
      if (_worldNodes.has(p.id)) continue;
      if (typeof p.gridX !== 'number' || typeof p.gridY !== 'number') continue;

      // Platform.
      const x = p.gridX * WORLD.SCALE;
      const z = p.gridY * WORLD.SCALE;
      const geom = new THREE.BoxGeometry(WORLD.PLATFORM_W, WORLD.PLATFORM_H, WORLD.PLATFORM_D);
      // Per-face materials so only the top face shows the poster. `side` is a
      // shared town-wide material; `top` stays unique (it carries the poster).
      const side = _platformSideMat();
      const top  = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const url = (typeof CONFIG !== 'undefined' && CONFIG.IMAGE_BASE && p.image)
        ? `${CONFIG.IMAGE_BASE}${p.image}` : '';
      if (url) {
        _loadTexture(url, (tex) => { top.map = tex; top.needsUpdate = true; });
      }
      // BoxGeometry material slots: +x, -x, +y(top), -y(bottom), +z, -z
      const mats = [side, side, top, side, side, side];
      const mesh = new THREE.Mesh(geom, mats);
      mesh.position.set(x, WORLD.PLATFORM_RAISE, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.projectId = p.id;
      _scene.add(mesh);

      // Per-house wall height, jittered deterministically from the project id so
      // the skyline varies but a given house stays the same height every visit.
      // Stored on the node so _buildNodeWalls reuses the exact same value. (The
      // footprint stays uniform — roads/apron/collision all assume PLATFORM_W.)
      const hr = _nodeRand(p.id);
      const wallHeight = WORLD.WALL_HEIGHT * (WORLD.HEIGHT_VAR_MIN + (WORLD.HEIGHT_VAR_MAX - WORLD.HEIGHT_VAR_MIN) * hr);

      // Ceiling — a solid roof sitting just above the wall tops so the room reads
      // as an enclosed building from outside. It's hide-able (see
      // _tickRoomCeilings): the roof of whichever room the player is inside turns
      // off so they can still see in. A thin SLAB (not a flat plane) gives it real
      // thickness, so it never sits coplanar with the wall tops — that coplanarity
      // is what caused the z-fighting shimmer along the roof edges. Tinted by the
      // project's phase so the town reads as colored districts. Not collidable.
      const ROOF_T = 0.2;
      const ceilMat = _ceilingMat(p.phase);
      const ceiling = new THREE.Mesh(new THREE.BoxGeometry(WORLD.PLATFORM_W, ROOF_T, WORLD.PLATFORM_D), ceilMat);
      // Slab bottom rests at this house's wall tops with a tiny downward overlap
      // (-0.02) so there's no seam between roof and walls; platform top is y=0.
      ceiling.position.set(x, wallHeight + ROOF_T / 2 - 0.02, z);
      _scene.add(ceiling);

      // Apron — a stone RING framing the building base (hole the size of the
      // platform so the poster floor is never covered). It hides the road strips
      // emerging around the building, and is walkable (see _isInWalkable) so the
      // player can move around the building's exterior.
      const apOuter = (WORLD.PLATFORM_W + WORLD.APRON_MARGIN) / 2;  // = 8
      const apInner = WORLD.PLATFORM_W / 2;                          // = 6 (platform footprint)
      const apronShape = new THREE.Shape();
      apronShape.moveTo(-apOuter, -apOuter);
      apronShape.lineTo(apOuter, -apOuter);
      apronShape.lineTo(apOuter, apOuter);
      apronShape.lineTo(-apOuter, apOuter);
      apronShape.lineTo(-apOuter, -apOuter);
      const apronHole = new THREE.Path();
      apronHole.moveTo(-apInner, -apInner);
      apronHole.lineTo(-apInner, apInner);
      apronHole.lineTo(apInner, apInner);
      apronHole.lineTo(apInner, -apInner);
      apronHole.lineTo(-apInner, -apInner);
      apronShape.holes.push(apronHole);
      // Shared apron material (decal-style polygon offset so the ring renders
      // over the ground/roads beneath it without z-fighting).
      const apron = new THREE.Mesh(new THREE.ShapeGeometry(apronShape), _apronMat());
      apron.rotation.x = -Math.PI / 2;
      // Sit just above the road tops (-0.02) so the ring covers the road strips
      // around the building; the platform poster (y=0) shows through the hole.
      apron.position.set(x, -0.01, z);
      apron.receiveShadow = true;
      _scene.add(apron);

      // The 'anchor' is still used by the active-node prompt placement
      // tick — kept even though we no longer render a floating title.
      const anchor = new THREE.Vector3(x, WORLD.PLATFORM_RAISE + WORLD.PLATFORM_H / 2 + 1.6, z);
      const node = { mesh, project: p, anchor, walls: [], ceiling, apron, wallHeight, decor: [], props: [], house: null, roofExtra: null, roofTopY: 0 };
      // Keeper decorations, if this island already has some (colours are read
      // inside _buildNodeWalls, so neighbour-triggered rebuilds keep them).
      node.house = _houses.get(p.id) || null;
      _worldNodes.set(p.id, node);
      _syncKeeperTag(node);

      // Roads to any already-unlocked prereq.
      const prereqs = Array.isArray(p.prerequisites) ? p.prerequisites : [];
      for (const preId of prereqs) {
        const pre = _worldNodes.get(preId);
        if (!pre) continue;
        _buildWorldRoad(p.id, preId);
      }
      // …and from any already-unlocked successor pointing at us.
      for (const q of projects) {
        if (q.id === p.id) continue;
        if (!_worldNodes.has(q.id)) continue;
        if (!q.prerequisites || !q.prerequisites.includes(p.id)) continue;
        _buildWorldRoad(q.id, p.id);
      }

      // Build this node's wall fence. Then re-build walls on every
      // neighbor that just gained a road to us, so their fence has a
      // fresh doorway facing this node.
      _buildNodeWalls(node);
      _applyRoof(node);
      _buildProps(node);
      for (const neighbor of _getConnectedNodes(p.id)) {
        if (neighbor.project.id !== p.id) _buildNodeWalls(neighbor);
      }
    }

    // Spawn any Avenger whose debut node just became available.
    _materializeNpcs();
  }

  // All currently-visible nodes that connect to this project via roads.
  // Used when (re)building wall fences so doorways align with roads.
  function _getConnectedNodes(id) {
    const me = _worldNodes.get(id);
    if (!me) return [];
    const out = [];
    const prereqs = Array.isArray(me.project.prerequisites) ? me.project.prerequisites : [];
    for (const preId of prereqs) {
      const pre = _worldNodes.get(preId);
      if (pre) out.push(pre);
    }
    for (const q of projects) {
      if (q.id === id) continue;
      const succ = _worldNodes.get(q.id);
      if (!succ) continue;
      if (Array.isArray(q.prerequisites) && q.prerequisites.includes(id)) out.push(succ);
    }
    return out;
  }

  // Pick the side a road exits through, and where along that side the
  // doorway should be centered. Roads from the platform center toward a
  // neighbor cross exactly one boundary of the AABB; the dominant axis
  // (|dx| vs |dz|) tells us which side. Diagonals don't get a corner
  // doorway — they get a doorway on the dominant side at the exact
  // intersection point, so the doorway lines up with the road.
  function _doorwayOnSide(node, other) {
    const cx = node.mesh.position.x, cz = node.mesh.position.z;
    const ox = other.mesh.position.x, oz = other.mesh.position.z;
    const dx = ox - cx, dz = oz - cz;
    const HALF = WORLD.PLATFORM_W / 2;
    if (Math.abs(dx) >= Math.abs(dz)) {
      const side = dx > 0 ? 'E' : 'W';
      // Exit Z along the side (parametric line until x = ±HALF).
      const exitZ = Math.abs(dx) > 0.001 ? cz + dz * (HALF / Math.abs(dx)) : cz;
      return { side, coord: Math.max(cz - HALF + 0.5, Math.min(cz + HALF - 0.5, exitZ)) };
    }
    const side = dz > 0 ? 'S' : 'N';
    const exitX = Math.abs(dz) > 0.001 ? cx + dx * (HALF / Math.abs(dz)) : cx;
    return { side, coord: Math.max(cx - HALF + 0.5, Math.min(cx + HALF - 0.5, exitX)) };
  }

  // Build (or rebuild) the four-sided wall fence around a platform with
  // doorways cut at every connecting-road exit. Removing old walls also
  // drops them from the _walls collision list so the player can pass.
  function _buildNodeWalls(node) {
    const THREE = window.THREE;
    // Tear down any existing walls first — they may be stale because
    // a neighbor just unlocked and we now need a new doorway there.
    if (node.walls && node.walls.length) {
      const aabbsToDrop = new Set();
      for (const w of node.walls) {
        if (w.mesh.parent) w.mesh.parent.remove(w.mesh);
        if (w.mesh.geometry) w.mesh.geometry.dispose();
        if (w.mesh.material) w.mesh.material.dispose();
        aabbsToDrop.add(w.aabb);
      }
      _walls = _walls.filter(a => !aabbsToDrop.has(a));
    }
    node.walls = [];
    // Tear down any existing lock icons too — a neighbor may have just
    // unlocked, turning its locked-wall icon into an open doorway.
    if (node.lockIcons && node.lockIcons.length) {
      for (const icon of node.lockIcons) {
        if (icon.parent) icon.parent.remove(icon);
        if (icon.geometry) icon.geometry.dispose();
        if (icon.material) {
          if (icon.material.map) icon.material.map.dispose();
          icon.material.dispose();
        }
      }
    }
    node.lockIcons = [];
    // Tear down cozy decor (windows, door frames, stoops, lamps) too — doorway
    // positions move when neighbors unlock, so it's all rebuilt below.
    if (node.decor && node.decor.length) {
      for (const d of node.decor) _disposeDecor(d);
    }
    node.decor = [];

    // We always build the four-sided fence (even with no unlocked
    // connections) so that sides facing a still-locked neighbor read as a
    // solid wall we can hang a lock icon on. Doorways are cut only at
    // unlocked connections; the player is confined to platforms/roads by
    // _isInWalkable regardless, so a fully-walled lone platform is fine.
    // Openings come from the roads alone (never from the keeper's house), so
    // the door stays put no matter how the house is decorated.
    const openingsBySide = _sideOpenings(node);

    const cx = node.mesh.position.x, cz = node.mesh.position.z;
    const HALF = WORLD.PLATFORM_W / 2;
    const T = WORLD.WALL_THICKNESS;
    const H = node.wallHeight || WORLD.WALL_HEIGHT;   // per-house jittered height
    const wallY = WORLD.PLATFORM_RAISE + WORLD.PLATFORM_H / 2 + H / 2;
    // Keeper finishes / colours (WorldHouseLogic fields on node.house) with the
    // engine defaults as fallback — so an undecorated house looks exactly as
    // before and a decorated one survives every wall rebuild.
    const house = node.house || null;
    const wallStyle = (house && house.wallStyle) || 'plaster';
    const windowStyle = (house && house.windowStyle) || 'cross';
    const houseWindows = (house && Array.isArray(house.windows)) ? house.windows : null;   // null = auto
    // Wall finish texture — ONE per style, shared by the whole town. Each panel
    // gets its own material (so the per-wall material.dispose() teardown is
    // safe) but points at the shared map; material.dispose() never frees maps.
    const glassWall = wallStyle === 'glass';           // see-through walls: no texture, no windows carved
    const wallTex = (typeof PG3DHouse !== 'undefined' && !glassWall) ? PG3DHouse.wallTexture(THREE, wallStyle) : null;
    const wallColor = _houseColor(node, 'wallColor', WORLD.WALL_COLOR);
    const glassTint = (house && house.wallColor != null) ? wallColor : null;   // keeper tint, else pale glass
    const trimColor = _houseColor(node, 'trimColor', WORLD.WALL_TRIM_COLOR);
    const lampColor = _houseColor(node, 'lampColor', WORLD.LAMP_COLOR);
    const signText = (house && house.sign) ? String(house.sign) : '';
    let signPlaced = false;

    // Decor (trim/stoop/lamp) helpers — non-colliding, tracked in node.decor.
    const trimMat = () => new THREE.MeshLambertMaterial({ color: trimColor });
    const stoopMat = () => new THREE.MeshLambertMaterial({ color: WORLD.APRON_COLOR });
    const addDecor = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.castShadow = true; _scene.add(mesh); node.decor.push(mesh); };
    // The keeper's sign hangs on the first door lintel (or, for a doorless
    // island, centred on the south wall — see after buildSide below).
    const placeSign = (x, y, z, rotY, maxW) => {
      if (signPlaced || !signText) return;
      const sign = _makeSign(signText, trimColor, maxW);
      if (!sign) return;
      sign.rotation.y = rotY;
      addDecor(sign, x, y, z);
      signPlaced = true;
    };

    // Frame a doorway's ACTUAL opening [gStart, gEnd] (already clipped to the
    // platform edge by the caller) with trim jambs + a lintel, a stoop step on
    // the apron outside it, and a lamp beside it. Deriving everything from the
    // real opening edges — not the nominal doorway width — keeps the frame flush
    // with the wall gap even when the doorway is clamped near a corner. `fixed`
    // is the side's edge coordinate; the wall plane sits T/2 inside it.
    function buildDoorFrame(sideName, gStart, gEnd, fixed, horizontal) {
      const w = gEnd - gStart;
      if (w < 0.3) return;                       // degenerate / fully-clipped gap
      const mid = (gStart + gEnd) / 2;
      const outSign = (sideName === 'N' || sideName === 'W') ? -1 : 1;
      const line = fixed - outSign * T / 2;      // wall plane on the fixed axis
      const jW = 0.3, jD = T + 0.12;             // jamb cross-section
      const lintelY = H - 0.225;                 // top of opening (platform top = y=0)
      if (horizontal) {
        addDecor(new THREE.Mesh(new THREE.BoxGeometry(jW, H, jD), trimMat()), gStart, wallY, line);
        addDecor(new THREE.Mesh(new THREE.BoxGeometry(jW, H, jD), trimMat()), gEnd,   wallY, line);
        addDecor(new THREE.Mesh(new THREE.BoxGeometry(w + jW, 0.45, jD), trimMat()), mid, lintelY, line);
        addDecor(new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, 1.2), stoopMat()), mid, 0.06, line + outSign * 0.7);
        const lamp = _makeLamp(gEnd + 0.4, line + outSign * 0.5, lampColor);
        if (lamp) { _scene.add(lamp); node.decor.push(lamp); }
        // Sign on the lintel's outer face; N faces -z (π), S faces +z (0).
        placeSign(mid, lintelY, line + outSign * (jD / 2 + 0.02), outSign < 0 ? Math.PI : 0, w);
      } else {
        addDecor(new THREE.Mesh(new THREE.BoxGeometry(jD, H, jW), trimMat()), line, wallY, gStart);
        addDecor(new THREE.Mesh(new THREE.BoxGeometry(jD, H, jW), trimMat()), line, wallY, gEnd);
        addDecor(new THREE.Mesh(new THREE.BoxGeometry(jD, 0.45, w + jW), trimMat()), line, lintelY, mid);
        addDecor(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, w), stoopMat()), line + outSign * 0.7, 0.06, mid);
        const lamp = _makeLamp(line + outSign * 0.5, gEnd + 0.4, lampColor);
        if (lamp) { _scene.add(lamp); node.decor.push(lamp); }
        // W faces -x (-π/2), E faces +x (π/2).
        placeSign(line + outSign * (jD / 2 + 0.02), lintelY, mid, outSign < 0 ? -Math.PI / 2 : Math.PI / 2, w);
      }
    }

    // For each side, compute wall segments around its doorway gaps and
    // build a thin box per segment. Walls are inset by T/2 so they sit
    // visibly ON the platform rather than at its edge.
    function buildSide(sideName, axisStart, axisEnd, fixed, horizontal) {
      const openings = openingsBySide[sideName];

      // Solid wall segments = the complement of the merged openings.
      let segs = [], cursor = axisStart;
      for (const [a, b] of openings) {
        if (a > cursor + 0.05) segs.push([cursor, a]);
        cursor = Math.max(cursor, b);
      }
      if (cursor < axisEnd - 0.05) segs.push([cursor, axisEnd]);

      // One frame per merged opening so the trim matches the real wall gap.
      for (const [a, b] of openings) buildDoorFrame(sideName, a, b, fixed, horizontal);

      // Wall plane coordinate on the fixed axis for this side (T/2 inside the edge).
      const perp = horizontal
        ? (sideName === 'N' ? fixed + T / 2 : fixed - T / 2)
        : (sideName === 'W' ? fixed + T / 2 : fixed - T / 2);
      // Build one wall panel (box) spanning [aStart,aEnd] along the side axis and
      // [y0,y1] vertically. Textured plaster by default; pass a plain color for the
      // sill/header that frame a carved window. Tracked in node.walls for teardown;
      // collision is the whole segment (pushed once per segment, not per panel).
      function addWallPanel(aStart, aEnd, y0, y1, plainColor) {
        const wlen = aEnd - aStart, wh = y1 - y0;
        if (wlen <= 0.02 || wh <= 0.02) return;
        const px = horizontal ? (aStart + aEnd) / 2 : perp;
        const pz = horizontal ? perp : (aStart + aEnd) / 2;
        const py = (y0 + y1) / 2;                    // platform top is y=0
        const gx = horizontal ? wlen : T;
        const gz = horizontal ? T : wlen;
        // Lambert output is map × color: the shared finish texture is painted
        // on a white base, so the per-panel `color` carries the wall colour
        // (engine default or the keeper's pick) at no extra texture cost.
        const mat = (plainColor != null)
          ? new THREE.MeshLambertMaterial({ color: plainColor })
          : (glassWall && typeof PG3DHouse !== 'undefined') ? PG3DHouse.glassWallMaterial(THREE, glassTint)
          : (wallTex ? new THREE.MeshLambertMaterial({ map: wallTex, color: wallColor })
                     : new THREE.MeshLambertMaterial({ color: wallColor }));
        const geom = new THREE.BoxGeometry(gx, wh, gz);
        // World-anchored UVs: every panel samples ONE continuous tile grid, so
        // brick courses run straight through the fillers / sill / header around
        // a window instead of restarting (and stretching) per box.
        if (mat.map && typeof PG3DHouse !== 'undefined') _anchorWallUVs(geom, px, py, pz);
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(px, py, pz);
        mesh.castShadow = !mat.transparent;          // glass casts no solid shadow
        mesh.receiveShadow = !mat.transparent;
        _scene.add(mesh);
        node.walls.push({ mesh });
      }

      // Where the windows go on this side, as panes { c: centre, w: width, n: cells }.
      //   auto (windows: null)  — one centred pane per stretch ≥ WINDOW_MIN_SEG,
      //                           exactly the undecorated look;
      //   keeper (array)        — the cells they picked, minus any that would
      //                           touch a doorway (WorldHouseLogic.windowBlocked,
      //                           the same test the editor runs); adjacent cells
      //                           merge into one wide pane (windowRuns);
      //   glass walls           — none: the whole wall is already see-through.
      // The doorway itself is never moved for a window: the door wins.
      const WW = WORLD.WINDOW_W, WM = (typeof WorldHouseLogic !== 'undefined') ? WorldHouseLogic.C.WINDOW_MARGIN : 0.35;
      const winY = Math.min(H - WORLD.WINDOW_H / 2 - 0.25, H * 0.55);
      const sillTop = winY - WORLD.WINDOW_H / 2, headBot = winY + WORLD.WINDOW_H / 2;
      const outSign = (sideName === 'N' || sideName === 'W') ? -1 : 1;
      let picked = [];
      if (houseWindows && !glassWall && typeof WorldHouseLogic !== 'undefined') {
        const offsetOpenings = openings.map(([a, b]) => [a - axisStart, b - axisStart]);
        const cells = houseWindows
          .filter(w => w.side === sideName && !WorldHouseLogic.windowBlocked(w.pos, offsetOpenings))
          .map(w => w.pos);
        picked = WorldHouseLogic.windowRuns(cells).map(r => ({ c: axisStart + r.centre, w: r.width, n: r.cells }));
      }

      for (const [s, e] of segs) {
        const len = e - s;
        if (len <= 0.1) continue;
        const firstIdx = node.walls.length;

        const wins = glassWall ? []
          : houseWindows ? picked.filter(p => p.c - p.w / 2 >= s + WM && p.c + p.w / 2 <= e - WM)
          : (len >= WORLD.WINDOW_MIN_SEG ? [{ c: (s + e) / 2, w: WW, n: 1 }] : []);

        if (!wins.length) {
          addWallPanel(s, e, 0, H);                       // plain solid segment
        } else {
          // Carve each window: fillers between panes + a sill below + a header
          // above, leaving holes you can actually see through (glass below).
          let cursor = s;
          for (const { c: center, w: pw, n: cellsN } of wins) {
            const winL = center - pw / 2, winR = center + pw / 2;
            addWallPanel(cursor, winL, 0, H);             // filler up to this pane
            addWallPanel(winL, winR, 0, sillTop);         // sill — same finish as the wall
            addWallPanel(winL, winR, headBot, H);         // header — same finish as the wall
            cursor = winR;
            // Translucent glass pane sitting in the hole — see-through to the interior.
            const glass = (typeof PG3DHouse !== 'undefined') ? PG3DHouse.windowGlass(THREE, windowStyle, pw, WORLD.WINDOW_H, cellsN) : null;
            if (glass) {
              glass.position.set(horizontal ? center : perp, winY, horizontal ? perp : center);
              glass.rotation.y = (sideName === 'N') ? Math.PI
                               : (sideName === 'S') ? 0
                               : (sideName === 'W') ? -Math.PI / 2 : Math.PI / 2;
              _scene.add(glass);
              node.decor.push(glass);
            }
            // Shutters: two trim-coloured boards on the outer face, either side.
            if (windowStyle === 'shutters') {
              const SW = 0.22, SD = 0.08;
              const face = perp + outSign * (T / 2 + SD / 2);
              for (const sx of [winL - SW / 2 - 0.02, winR + SW / 2 + 0.02]) {
                const board = new THREE.Mesh(
                  new THREE.BoxGeometry(horizontal ? SW : SD, WORLD.WINDOW_H, horizontal ? SD : SW),
                  trimMat()
                );
                addDecor(board, horizontal ? sx : face, winY, horizontal ? face : sx);
              }
            }
          }
          addWallPanel(cursor, e, 0, H);                  // filler after the last pane
        }

        // Collision: the whole segment blocks movement (a window has a sill, so you
        // can't walk through it). Keep ONE full-segment AABB regardless of carving,
        // attached to the first panel built so teardown drops it from _walls.
        if (node.walls.length > firstIdx) {
          const fullMx = horizontal ? (s + e) / 2 : perp;
          const fullMz = horizontal ? perp : (s + e) / 2;
          const fullSx = horizontal ? len : T;
          const fullSz = horizontal ? T : len;
          const aabb = {
            minX: fullMx - fullSx / 2, maxX: fullMx + fullSx / 2,
            minZ: fullMz - fullSz / 2, maxZ: fullMz + fullSz / 2
          };
          _walls.push(aabb);
          node.walls[firstIdx].aabb = aabb;
        }
      }
    }

    buildSide('N', cx - HALF, cx + HALF, cz - HALF, true);
    buildSide('S', cx - HALF, cx + HALF, cz + HALF, true);
    _buildSideRest(node, cx, cz, HALF, T, H, buildSide, placeSign);
  }

  // Door openings per side, in world coordinates along that side's axis.
  // Derived from the roads alone: for every unlocked neighbour, the side and
  // point where its road leaves the platform (_doorwayOnSide), clipped to the
  // platform and merged when two openings overlap or leave only a thin sliver
  // (< DOORWAY_MERGE_GAP) — so two roads converging on a side become a single
  // doorway with one frame instead of overlapping frames / a lone thin post.
  // Centres are sorted and clamping preserves order, so a single left-to-right
  // merge is correct. Shared by _buildNodeWalls and getHouseLayout so the
  // editor's picture of the fixed door is exactly what gets built.
  function _sideOpenings(node) {
    const sides = { N: [], S: [], E: [], W: [] };
    for (const other of _getConnectedNodes(node.project.id)) {
      const { side, coord } = _doorwayOnSide(node, other);
      sides[side].push(coord);
    }
    const cx = node.mesh.position.x, cz = node.mesh.position.z;
    const HALF = WORLD.PLATFORM_W / 2, D = WORLD.DOORWAY_WIDTH;
    const out = {};
    for (const s of ['N', 'S', 'E', 'W']) {
      const axisStart = (s === 'N' || s === 'S') ? cx - HALF : cz - HALF;
      const axisEnd = axisStart + 2 * HALF;
      const openings = [];
      for (const dCenter of [...sides[s]].sort((a, b) => a - b)) {
        const a = Math.max(axisStart, dCenter - D / 2);
        const b = Math.min(axisEnd,   dCenter + D / 2);
        if (b - a < 0.1) continue;
        const last = openings[openings.length - 1];
        if (last && a - last[1] < WORLD.DOORWAY_MERGE_GAP) {
          last[1] = Math.max(last[1], b);   // overlap or thin sliver → merge
        } else {
          openings.push([a, b]);
        }
      }
      out[s] = openings;
    }
    return out;
  }

  // The fixed door layout of one house for the editor: openings per side in
  // edge-offset units (0..PLATFORM_W from the side's start corner), the same
  // units WorldHouseLogic.windowBlocked / openingsToCells work in. Null until
  // the node exists (the editor then treats every wall cell as free).
  function getHouseLayout(projectId) {
    const node = _worldNodes.get(projectId);
    if (!node || !node.mesh) return null;
    const cx = node.mesh.position.x, cz = node.mesh.position.z;
    const HALF = WORLD.PLATFORM_W / 2;
    const world = _sideOpenings(node);
    const out = {};
    for (const s of ['N', 'S', 'E', 'W']) {
      const axisStart = (s === 'N' || s === 'S') ? cx - HALF : cz - HALF;
      out[s] = world[s].map(([a, b]) => [a - axisStart, b - axisStart]);
    }
    return out;
  }

  // Rewrite a wall panel box's UVs from world position so the shared finish
  // texture tiles continuously across every panel of the town (PG3DHouse
  // TILE_W × TILE_H world units per tile). Vertical faces map their along-wall
  // axis to u and height to v; the thin top/bottom faces just take x/z.
  function _anchorWallUVs(geom, px, py, pz) {
    const pos = geom.attributes.position, nrm = geom.attributes.normal, uv = geom.attributes.uv;
    if (!pos || !nrm || !uv) return;
    const TW = PG3DHouse.TILE_W, TH = PG3DHouse.TILE_H;
    for (let i = 0; i < uv.count; i++) {
      const wx = px + pos.getX(i), wy = py + pos.getY(i), wz = pz + pos.getZ(i);
      const nx = Math.abs(nrm.getX(i)), nz = Math.abs(nrm.getZ(i));
      if (nz > 0.5)      uv.setXY(i, wx / TW, wy / TH);
      else if (nx > 0.5) uv.setXY(i, wz / TW, wy / TH);
      else               uv.setXY(i, wx / TW, wz / TH);
    }
    uv.needsUpdate = true;
  }

  // Second half of _buildNodeWalls, split only to keep the door-frame closure
  // readable: the E/W fences, the doorless-island sign fallback, and the lock
  // decals for still-locked neighbours.
  function _buildSideRest(node, cx, cz, HALF, T, H, buildSide, placeSign) {
    buildSide('W', cz - HALF, cz + HALF, cx - HALF, false);
    buildSide('E', cz - HALF, cz + HALF, cx + HALF, false);
    // No doorway to hang the sign on (lone island): centre it high on the
    // south wall's outer face instead.
    placeSign(cx, H - 0.6, cz + HALF + 0.03, 0, 3.2);

    // Hang a lock icon on the wall facing each still-locked neighbor — at the
    // spot where the road WOULD exit once that neighbor is unlocked. This hints
    // a path exists without revealing the destination node or its road.
    const iconY = WORLD.PLATFORM_RAISE + WORLD.PLATFORM_H / 2 + H * 0.5;
    // Lay the decal just inside the wall's inner face (walls are inset T/2 from
    // the platform edge) so it sits flush on the wall, normal facing interior.
    const inset = T + 0.02;
    for (const ln of _getLockedNeighbors(node)) {
      const { side, coord } = _doorwayOnSide(node, { mesh: { position: { x: ln.x, z: ln.z } } });
      let ix, iz, rotY;
      if (side === 'N')      { ix = coord;             iz = cz - HALF + inset; rotY = 0; }
      else if (side === 'S') { ix = coord;             iz = cz + HALF - inset; rotY = Math.PI; }
      else if (side === 'W') { ix = cx - HALF + inset; iz = coord;             rotY = Math.PI / 2; }
      else                   { ix = cx + HALF - inset; iz = coord;             rotY = -Math.PI / 2; }  // 'E'
      const icon = _makeLockDecal(ix, iconY, iz, rotY);
      if (icon) { _scene.add(icon); node.lockIcons.push(icon); }
    }
  }

  // Graph neighbors of this (unlocked) node that are NOT yet built/unlocked.
  // Looks both at this node's prerequisites and at projects that list this
  // node as a prerequisite, returning each locked neighbor's world position.
  function _getLockedNeighbors(node) {
    if (typeof projects === 'undefined' || !Array.isArray(projects)) return [];
    const me = node.project;
    const seen = new Set();
    const out = [];
    const consider = (q) => {
      if (!q || q.id === me.id) return;
      if (_worldNodes.has(q.id)) return;  // already built → it's unlocked, gets a real road
      if (typeof q.gridX !== 'number' || typeof q.gridY !== 'number') return;
      if (seen.has(q.id)) return;
      seen.add(q.id);
      out.push({ project: q, x: q.gridX * WORLD.SCALE, z: q.gridY * WORLD.SCALE });
    };
    for (const preId of (Array.isArray(me.prerequisites) ? me.prerequisites : [])) {
      consider(projects.find(p => p.id === preId));
    }
    for (const q of projects) {
      if (Array.isArray(q.prerequisites) && q.prerequisites.includes(me.id)) consider(q);
    }
    return out;
  }

  // Open the roof of whichever room the player is standing in (fade it to
  // see-through) so they can still see inside, while every other room keeps its
  // solid roof. Smoothly cross-fades when moving between rooms.
  function _tickRoomCeilings() {
    if (!_player) return;
    const halfP = WORLD.PLATFORM_W / 2;
    const MARGIN = 0.75;   // hysteresis dead-band (world units)
    const px = _player.position.x, pz = _player.position.z;
    const showcased = _showcase ? _showcase.projectId : null;
    for (const node of _worldNodes.values()) {
      if (!node.ceiling) continue;
      // A showcased house (its editor is open) keeps its roof on: the camera
      // is circling it from outside so the keeper can see the roof change.
      if (node.project.id === showcased) {
        node.ceiling.visible = true;
        if (node.roofExtra) node.roofExtra.visible = true;
        continue;
      }
      // Hide the solid roof of the room the player is inside so they can see in;
      // every other building keeps its roof. Opaque visibility toggle avoids the
      // flicker that transparent opacity-fading caused. A hysteresis dead-band
      // around the platform edge stops the roof popping on/off when the player
      // lingers in a doorway (which sits right on the edge): hide once inside,
      // only re-show once clearly outside, and hold the current state in between.
      const dx = Math.abs(px - node.mesh.position.x);
      const dz = Math.abs(pz - node.mesh.position.z);
      if (dx <= halfP && dz <= halfP) {
        node.ceiling.visible = false;           // inside → open the roof
      } else if (dx > halfP + MARGIN || dz > halfP + MARGIN) {
        node.ceiling.visible = true;            // clearly outside → solid roof
      }                                         // in-between → keep current state
      // The pitched part (gable / hip / chimney) follows the slab.
      if (node.roofExtra) node.roofExtra.visible = node.ceiling.visible;
    }
  }

  // A flat padlock decal laid against a wall face, hand-drawn on a canvas (emoji
  // fonts render inconsistently across platforms, so we draw the shape
  // ourselves). Unlike a billboard sprite it stays stuck to the wall as the
  // camera rotates. `rotationY` orients the plane so its face points toward the
  // platform interior. Returns null on THREE builds lacking canvas-texture.
  function _makeLockDecal(x, y, z, rotationY) {
    const THREE = window.THREE;
    if (!THREE || !THREE.CanvasTexture) return null;
    const S = 128;
    const canvas = document.createElement('canvas');
    canvas.width = S; canvas.height = S;
    const ctx = canvas.getContext('2d');

    // Dark disc behind the lock for contrast against the gold wall.
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 58, 0, Math.PI * 2);
    ctx.fill();

    const gold = '#ffd24a';
    ctx.strokeStyle = gold;
    ctx.fillStyle = gold;
    ctx.lineCap = 'round';

    // Shackle (open-top arc).
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(S / 2, 58, 20, Math.PI, 0);
    ctx.stroke();

    // Body (rounded rectangle).
    const bx = 40, by = 58, bw = 48, bh = 44, r = 8;
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
    ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
    ctx.arcTo(bx, by + bh, bx, by, r);
    ctx.arcTo(bx, by, bx + bw, by, r);
    ctx.closePath();
    ctx.fill();

    // Keyhole.
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.beginPath();
    ctx.arc(S / 2, by + 16, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(S / 2 - 2.5, by + 16, 5, 16);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotationY || 0;
    return mesh;
  }

  // Deterministic [0,1) hash of a project id (FNV-1a). Used to jitter per-house
  // height etc. so a given house looks the same on every rebuild/reload —
  // Math.random() would re-roll and make the town flicker between visits.
  function _nodeRand(id) {
    let h = 2166136261;
    const s = String(id);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
  }

  // Roof tint for a house, keyed by its MCU phase so the town reads as colored
  // districts. Falls back to the neutral slate roof for unknown/missing phases.
  function _phaseRoofColor(phase) {
    const c = WORLD.ROOF_PHASE_COLORS[phase];
    return (typeof c === 'number') ? c : WORLD.CEILING_COLOR;
  }

  // ── per-build shared world materials ──
  // Hoisted out of the per-node loop so a fully-unlocked town allocates ONE
  // platform-side and ONE apron material, plus one ceiling material per phase,
  // instead of ~3 fresh materials per house. The platform TOP stays unique (it
  // carries each project's poster). Platform/apron/ceiling are never torn down
  // individually (only walls/decor are), so cross-node sharing is safe. They're
  // owned by the scene and disposed by destroy()'s _disposeRig sweep, so destroy
  // resets these refs to null and they're lazily recreated on the next mount.
  let _matPlatformSide = null;
  let _matApron = null;
  let _ceilMatByPhase = null;        // Map<colorInt, MeshLambertMaterial>

  function _platformSideMat() {
    const THREE = window.THREE;
    if (!_matPlatformSide) _matPlatformSide = new THREE.MeshLambertMaterial({ color: 0x8a7f68 });
    return _matPlatformSide;
  }
  function _apronMat() {
    const THREE = window.THREE;
    if (!_matApron) {
      _matApron = new THREE.MeshLambertMaterial({
        color: WORLD.APRON_COLOR,
        side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
      });
    }
    return _matApron;
  }
  function _ceilingMat(phase) {
    const THREE = window.THREE;
    if (!_ceilMatByPhase) _ceilMatByPhase = new Map();
    const color = _phaseRoofColor(phase);
    let m = _ceilMatByPhase.get(color);
    if (!m) { m = new THREE.MeshLambertMaterial({ color }); _ceilMatByPhase.set(color, m); }
    return m;
  }

  // One shared lamp-glow texture for the whole town (like the PG3DHouse wall textures). Each lamp
  // keeps its own cheap SpriteMaterial pointing at it; _disposeDecor skips this
  // map on teardown so it survives wall rebuilds.
  let _lampTex = null;
  function _lampTexture() {
    const THREE = window.THREE;
    if (!THREE || !THREE.CanvasTexture) return null;
    if (_lampTex) return _lampTex;
    const S = 64;
    const canvas = document.createElement('canvas');
    canvas.width = S; canvas.height = S;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(255,217,138,0.9)');
    grad.addColorStop(1, 'rgba(255,217,138,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, S, S);
    _lampTex = new THREE.CanvasTexture(canvas);
    return _lampTex;
  }

  // ── Keeper-decorated houses (WorldHouseLogic) ──

  // Palette colour for one of the house's slots, or the engine default.
  function _houseColor(node, slot, fallback) {
    const h = node && node.house;
    const idx = h ? h[slot] : null;
    if (idx == null || typeof WorldHouseLogic === 'undefined') return fallback;
    const c = WorldHouseLogic.PALETTE[idx];
    return (typeof c === 'number') ? c : fallback;
  }

  // Roof: the shared per-phase material by default; a per-node material the
  // node owns (and disposes) when the keeper picked a roof colour. Then the
  // shape on top of the slab — gable / hip / chimney (PG3DHouse.roofExtra) —
  // sharing the slab's material so one roof colour covers all of it. The slab
  // itself always stays: it is the ceiling _tickRoomCeilings hides when you
  // walk in, and the pitched group follows its visibility.
  function _applyRoof(node) {
    const THREE = window.THREE;
    if (!THREE || !node || !node.ceiling) return;
    if (node.ownsRoofMat) {
      try { node.ceiling.material.dispose(); } catch (_) {}
      node.ownsRoofMat = false;
    }
    const house = node.house || null;
    const idx = house ? house.roofColor : null;
    if (idx != null && typeof WorldHouseLogic !== 'undefined' && typeof WorldHouseLogic.PALETTE[idx] === 'number') {
      node.ceiling.material = new THREE.MeshLambertMaterial({ color: WorldHouseLogic.PALETTE[idx] });
      node.ownsRoofMat = true;
    } else {
      node.ceiling.material = _ceilingMat(node.project.phase);
    }

    const H = node.wallHeight || WORLD.WALL_HEIGHT;
    const slabTop = H + 0.18;                  // slab centre H + 0.08, thickness 0.2
    if (node.roofExtra) {
      if (typeof PG3DHouse !== 'undefined') PG3DHouse.disposeRoofExtra(node.roofExtra);
      if (node.roofWallMat) { try { node.roofWallMat.dispose(); } catch (_) {} node.roofWallMat = null; }
      node.roofExtra = null;
    }
    node.roofTopY = slabTop;
    if (!house || typeof PG3DHouse === 'undefined' || !_scene) return;
    const style = house.roofStyle || 'flat';
    if (style === 'flat' && !house.chimney) return;
    // Gable ends wear the wall finish + colour so the house reads as one body
    // (see-through too when the walls are glass).
    const wallMat = (house.wallStyle === 'glass')
      ? PG3DHouse.glassWallMaterial(THREE, house.wallColor != null ? _houseColor(node, 'wallColor', WORLD.WALL_COLOR) : null)
      : new THREE.MeshLambertMaterial({ color: _houseColor(node, 'wallColor', WORLD.WALL_COLOR), map: PG3DHouse.wallTexture(THREE, house.wallStyle || 'plaster') || null });
    node.roofWallMat = wallMat;
    const group = PG3DHouse.roofExtra(THREE, {
      style, dir: house.roofDir, chimney: !!house.chimney,
      roofMat: node.ceiling.material, wallMat,
      trimColor: _houseColor(node, 'trimColor', WORLD.WALL_TRIM_COLOR),
      baseY: slabTop - 0.02,
      centreX: node.mesh.position.x, centreZ: node.mesh.position.z
    });
    if (!group) return;
    group.position.set(node.mesh.position.x, 0, node.mesh.position.z);
    group.visible = node.ceiling.visible;
    _scene.add(group);
    node.roofExtra = group;
    node.roofTopY = group.userData.topY || slabTop;
  }

  // A wooden name plank: canvas text (never HTML, so any characters are safe)
  // on a plane sized to the doorway. Disposed with the rest of node.decor.
  function _makeSign(text, trimColor, maxW) {
    const THREE = window.THREE;
    if (!THREE || !THREE.CanvasTexture) return null;
    const W = 512, H = 96;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const hex = (n) => '#' + ('000000' + (n >>> 0).toString(16)).slice(-6);
    ctx.fillStyle = '#3a2e20';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = hex(trimColor != null ? trimColor : WORLD.WALL_TRIM_COLOR);
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, W - 12, H - 12);
    ctx.fillStyle = '#f5e9c8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 54;
    ctx.font = `bold ${size}px sans-serif`;
    while (size > 22 && ctx.measureText(text).width > W - 48) {
      size -= 4;
      ctx.font = `bold ${size}px sans-serif`;
    }
    ctx.fillText(text, W / 2, H / 2 + 2);
    const tex = new THREE.CanvasTexture(canvas);
    const width = Math.min(3.2, Math.max(1.2, (maxW || 3.2) - 0.4));
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width * (H / W)),
      new THREE.MeshBasicMaterial({ map: tex })
    );
    return mesh;
  }

  // (Re)place the keeper's interior props: dispose the old ones, drop their
  // collision boxes, build the new set on the inner 10×10 grid. Solid props
  // register an AABB in _walls exactly like wall segments do.
  function _buildProps(node) {
    const THREE = window.THREE;
    if (!THREE || !node || !_scene) return;
    if (node.props && node.props.length) {
      const drop = new Set();
      for (const pr of node.props) {
        _disposeDecor(pr.obj);
        if (pr.aabb) drop.add(pr.aabb);
      }
      if (drop.size) _walls = _walls.filter(a => !drop.has(a));
    }
    node.props = [];
    const list = (node.house && Array.isArray(node.house.props)) ? node.house.props : [];
    if (!list.length || typeof PG3DProps === 'undefined' || typeof WorldHouseLogic === 'undefined') return;
    const cx = node.mesh.position.x, cz = node.mesh.position.z;
    const portrait = (node.house && typeof node.house.portrait === 'string') ? node.house.portrait : '';
    const opts = {
      THREE,
      lampTex: _lampTexture(),
      lampColor: _houseColor(node, 'lampColor', WORLD.LAMP_COLOR),
      trimColor: _houseColor(node, 'trimColor', WORLD.WALL_TRIM_COLOR),
      roofColor: _houseColor(node, 'roofColor', _phaseRoofColor(node.project.phase)),
      hasPortrait: !!portrait
    };
    // Bookshelves standing side by side become ONE run of shelving that fills
    // its cells edge to edge (one object, one collision box).
    const runs = (WorldHouseLogic.propRuns ? WorldHouseLogic.propRuns(list, 'bookshelf') : []).filter(r => r.cells > 1);
    const inRun = new Set();
    for (const r of runs) for (const i of r.indices) inRun.add(i);

    // Place one built object for a prop (or a run) and register its box.
    const place = (obj, spec) => {
      // spec: { kind, gx, gy (anchor, may be fractional for runs), rot, width }
      const rot = spec.rot || 0;
      const odd = rot % 2 === 1;
      const fp = PG3DProps.footprint(spec.kind, spec.width);
      const local = WorldHouseLogic.cellToLocal(spec.gx, spec.gy);
      // Multi-cell props (bed) sit at the midpoint of their cells.
      const off = WorldHouseLogic.propCentreOffset ? WorldHouseLogic.propCentreOffset(spec) : { dx: 0, dy: 0 };
      let x = cx + local.x + off.dx, z = cz + local.z + off.dy;
      if (spec.kind === 'frame') {
        // Hang it on the wall's inner face (walls are inset T/2 from the
        // platform edge, so the face is HALF - T from the centre), facing in.
        const face = WORLD.PLATFORM_W / 2 - WORLD.WALL_THICKNESS - 0.01;
        switch (WorldHouseLogic.frameWall(spec)) {
          case 'N': z = cz - face; break;
          case 'S': z = cz + face; break;
          case 'W': x = cx - face; break;
          default:  x = cx + face; break;   // 'E'
        }
      } else {
        // Any solid prop on an edge cell hugs that wall: slide it from the
        // cell centre until its side touches the wall's inner face. Wall-
        // backed kinds (bookshelf / chair / bed) were already turned to face
        // the room by validation, so it's their back that meets the wall.
        const side = fp.solid && WorldHouseLogic.wallHug ? WorldHouseLogic.wallHug(spec.kind, spec.gx, spec.gy) : null;
        if (side) {
          const hxr = odd ? fp.hz : fp.hx, hzr = odd ? fp.hx : fp.hz;   // extents after rotation
          const depth = (side === 'N' || side === 'S') ? hzr : hxr;
          const flush = WORLD.PLATFORM_W / 2 - WORLD.WALL_THICKNESS - depth - 0.01;
          switch (side) {
            case 'N': z = cz - flush; break;
            case 'S': z = cz + flush; break;
            case 'W': x = cx - flush; break;
            default:  x = cx + flush; break;   // 'E'
          }
        }
      }
      obj.position.set(x, 0, z);
      obj.rotation.y = rot * Math.PI / 2;
      _scene.add(obj);
      let aabb = null;
      if (fp.solid) {
        const hx = odd ? fp.hz : fp.hx, hz = odd ? fp.hx : fp.hz;
        aabb = { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
        if (fp.top != null) aabb.top = fp.top;     // standable
        _walls.push(aabb);
      }
      node.props.push({ obj, aabb, kind: spec.kind, gx: spec.gx, gy: spec.gy, x, z, rot, top: fp.top, nodeId: node.project.id });
    };

    for (const r of runs) {
      const obj = PG3DProps.make('bookshelf', { ...opts, width: r.cells });
      if (obj) place(obj, { kind: 'bookshelf', gx: r.centre.gx, gy: r.centre.gy, rot: r.rot, width: r.cells });
    }
    list.forEach((p, i) => {
      if (inRun.has(i)) return;
      const obj = PG3DProps.make(p.kind, opts);
      if (!obj) return;
      // The keeper's portrait hangs in every frame. The texture comes from the
      // shared cache, so the material is flagged keepMap and _disposeDecor
      // leaves it alone on rebuild.
      if (p.kind === 'frame' && portrait && obj.userData.picture) {
        const mat = obj.userData.picture.material;
        mat.userData.keepMap = true;
        _loadTexture(portrait, (tex) => {
          if (typeof THREE.SRGBColorSpace !== 'undefined') tex.colorSpace = THREE.SRGBColorSpace;
          mat.map = tex;
          mat.needsUpdate = true;
        });
      }
      place(obj, p);
    });

    // If the local player was sitting on this island and their seat is gone
    // (editor preview rebuild / prop removed), stand them up cleanly.
    if (_seat && _seat.nodeId === node.project.id) {
      const still = node.props.find(pr => pr.kind === _seat.kind && pr.gx === _seat.gx && pr.gy === _seat.gy);
      if (!still) _standUp();
      else { _seat.x = still.x; _seat.z = still.z; }
    }
  }

  function _applyHouseToNode(node, house) {
    node.house = house || null;
    _applyRoof(node);
    _buildNodeWalls(node);
    _buildProps(node);
  }

  // Replace every known house at once (initial GET). Only nodes whose house
  // actually changed are rebuilt, so an undecorated town costs nothing.
  function setHouses(map) {
    const next = new Map();
    for (const [id, h] of Object.entries(map || {})) if (h) next.set(id, h);
    _houses = next;
    if (_mode !== 'world' || !_scene) return;
    for (const node of _worldNodes.values()) {
      const prev = node.house || null;
      const now = _houses.get(node.project.id) || null;
      if (prev === now || (!prev && !now)) continue;
      _applyHouseToNode(node, now);
    }
  }

  // One house changed (keeper saved it, or the local editor is previewing).
  function applyHouse(projectId, house) {
    if (house) _houses.set(projectId, house); else _houses.delete(projectId);
    const node = _worldNodes.get(projectId);
    if (node && _mode === 'world' && _scene) _applyHouseToNode(node, house || null);
  }

  function getHouse(projectId) {
    return _houses.get(projectId) || null;
  }

  // Create / update / remove the HUD tag for one node from _keeperTags.
  function _syncKeeperTag(node) {
    if (!node || !_hudLayer) return;
    const tag = _keeperTags.get(node.project.id);
    if (!tag) {
      if (node.keeperEl) { if (node.keeperEl.parentNode) node.keeperEl.parentNode.removeChild(node.keeperEl); node.keeperEl = null; }
      return;
    }
    let el = node.keeperEl;
    if (!el) {
      el = document.createElement('div');
      el.className = 'pg3d-nametag pg3d-keeper-tag';
      el.innerHTML = '<span class="pg3d-keeper-line1"></span><span class="pg3d-keeper-line2"></span>';
      el.style.display = 'none';
      _hudLayer.appendChild(el);
      node.keeperEl = el;
    }
    el.classList.toggle('mine', !!tag.mine);
    el.classList.toggle('unclaimed', !!tag.unclaimed);
    const l1 = el.querySelector('.pg3d-keeper-line1');
    const l2 = el.querySelector('.pg3d-keeper-line2');
    if (l1) l1.textContent = tag.line1 || '';
    if (l2) { l2.textContent = tag.line2 || ''; l2.style.display = tag.line2 ? '' : 'none'; }
  }

  // Replace every keeper tag at once: { projectId: { line1, line2, mine, unclaimed } }.
  // Text is set via textContent, so usernames never reach innerHTML.
  function setHouseKeepers(tags) {
    _keeperTags = new Map();
    for (const [id, t] of Object.entries(tags || {})) if (t && t.line1) _keeperTags.set(id, t);
    for (const node of _worldNodes.values()) _syncKeeperTag(node);
  }

  // A small lamp beside a doorway: a thin post, an emissive head, and a soft
  // additive glow sprite so it reads as glowing in the fog. Intentionally uses
  // NO real PointLight — one dynamic light per doorway would wreck framerate and
  // the single-shadow budget; the emissive head + sprite fake it cheaply.
  function _makeLamp(x, z, color) {
    const THREE = window.THREE;
    if (!THREE) return null;
    const lampColor = (color != null) ? color : WORLD.LAMP_COLOR;
    const group = new THREE.Group();
    const postH = 2.2;
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, postH, 6),
      new THREE.MeshLambertMaterial({ color: 0x3a342a })
    );
    post.position.set(x, postH / 2, z);
    post.castShadow = true;
    group.add(post);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.34, 0.34),
      new THREE.MeshBasicMaterial({ color: lampColor })
    );
    head.position.set(x, postH + 0.12, z);
    group.add(head);
    const lampTex = _lampTexture();
    if (lampTex && THREE.Sprite) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: lampTex, color: lampColor,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
      }));
      sprite.scale.set(1.6, 1.6, 1);
      sprite.position.set(x, postH + 0.12, z);
      group.add(sprite);
    }
    return group;
  }

  // Dispose a mesh/group's geometry, material, and any texture maps. Used to tear
  // down per-house decor (windows, frames, lamps) cleanly on wall rebuild.
  function _disposeDecor(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) {
        const shared = m.map === _lampTex || (m.userData && m.userData.keepMap)
          || (typeof PG3DHouse !== 'undefined' && PG3DHouse.isShared(m.map));
        if (m.map && !shared) m.map.dispose();
        m.dispose();
      }
    });
    if (obj.parent) obj.parent.remove(obj);
  }

  function _buildWorldRoad(aId, bId) {
    const a = _worldNodes.get(aId);
    const b = _worldNodes.get(bId);
    if (!a || !b) return;
    const key = aId < bId ? `${aId}→${bId}` : `${bId}→${aId}`;
    if (_worldRoads.has(key)) return;
    const THREE = window.THREE;
    const ax = a.mesh.position.x, az = a.mesh.position.z;
    const bx = b.mesh.position.x, bz = b.mesh.position.z;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    const angle = Math.atan2(dx, dz);

    // Road runs center-to-center so the walkable strip from platform A
    // smoothly meets the walkable strip from platform B with no gap.
    // Its top sits ~2cm BELOW the platform top (via ROAD_RAISE) so the
    // platform poster always renders on top inside the platform AABB
    // without polygonOffset (which was clipping the road at the camera's
    // far plane and made distant roads vanish).
    const mat = new THREE.MeshLambertMaterial({ color: WORLD.ROAD_COLOR });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(WORLD.ROAD_W, WORLD.ROAD_H, len), mat);
    mesh.position.set((ax + bx) / 2, WORLD.ROAD_RAISE, (az + bz) / 2);
    mesh.rotation.y = angle;
    mesh.receiveShadow = true;
    _scene.add(mesh);
    _worldRoads.set(key, mesh);

    // Walkable corridor is the full center-to-center rectangle so stepping
    // from inside a platform onto its connecting road is continuous.
    _walkableRoads.push({
      a: aId, b: bId,                 // node ids at each end (HUD vicinity)
      cx: (ax + bx) / 2,
      cz: (az + bz) / 2,
      cosA: Math.cos(angle),
      sinA: Math.sin(angle),
      halfW: WORLD.ROAD_W / 2,
      halfL: len / 2
    });
  }

  // Point-in-region test: world position (x, z) is walkable iff it's
  // inside ANY unlocked node's AABB OR ANY road's rotated rectangle.
  // The ground outside nodes/roads is not walkable in /world.
  // Kept as a hand-rolled loop (no per-call allocation — runs twice per
  // input frame); the same math lives in PG3DPhysics.isWalkable where the
  // unit tests exercise it (js/playground3d-physics.js).
  function _isInWalkable(x, z) {
    // Node platforms + their walkable stone apron (axis-aligned).
    const halfA = (WORLD.PLATFORM_W + WORLD.APRON_MARGIN) / 2;
    for (const node of _worldNodes.values()) {
      const dx = x - node.mesh.position.x;
      const dz = z - node.mesh.position.z;
      if (Math.abs(dx) <= halfA && Math.abs(dz) <= halfA) return true;
    }
    // Roads (rotated rectangles). World→local rotation by -angle:
    //   local_x =  dx * cosA - dz * sinA
    //   local_z =  dx * sinA + dz * cosA
    for (const r of _walkableRoads) {
      const dx = x - r.cx;
      const dz = z - r.cz;
      const lx = dx * r.cosA - dz * r.sinA;
      const lz = dx * r.sinA + dz * r.cosA;
      if (Math.abs(lx) <= r.halfW && Math.abs(lz) <= r.halfL) return true;
    }
    return false;
  }

  // ── HUD projection (call each tick) ──

  // Projects `v` to screen space, MUTATING it in place (v.project). Sole caller
  // is _placeHudEl, which passes a reusable scratch vector — so HUD projection
  // allocates nothing per frame (was two Vector3 clones per element per tick).
  function _projectAnchor(v) {
    if (!_camera || !_viewport) return null;
    v.project(_camera);
    if (v.z > 1) return null;            // behind camera
    return {
      x: (v.x * 0.5 + 0.5) * _viewport.clientWidth,
      y: (-v.y * 0.5 + 0.5) * _viewport.clientHeight,
      depth: v.z
    };
  }

  function _placeHudEl(el, anchor, yOffset) {
    _hudProjScratch.copy(anchor);
    if (typeof yOffset === 'number') _hudProjScratch.y += yOffset;
    const p = _projectAnchor(_hudProjScratch);
    if (!p) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.transform = `translate(-50%, -100%) translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
  }

  // Where the player is, for deciding which world labels to show:
  //   inside  — node id whose platform (walls) contains (x, z), else null
  //   near    — node ids "one road away": when inside, just that house; on a
  //             house's apron, that house plus every house one road from it;
  //             on a road, the two houses at its ends
  //   roads   — the road rects the player is standing on
  // Reuses module-scoped containers so the per-frame call allocates nothing.
  const _vic = { inside: null, near: new Set(), roads: [] };
  function _roadHas(r, x, z) {
    const dx = x - r.cx, dz = z - r.cz;
    return Math.abs(dx * r.cosA - dz * r.sinA) <= r.halfW &&
           Math.abs(dx * r.sinA + dz * r.cosA) <= r.halfL;
  }
  function _nodeAt(x, z, half) {
    for (const [id, node] of _worldNodes) {
      if (Math.abs(x - node.mesh.position.x) <= half && Math.abs(z - node.mesh.position.z) <= half) return id;
    }
    return null;
  }
  function _computeVicinity(x, z) {
    _vic.near.clear();
    _vic.roads.length = 0;
    _vic.inside = _nodeAt(x, z, WORLD.PLATFORM_W / 2);
    if (_vic.inside) { _vic.near.add(_vic.inside); return _vic; }
    const onApron = _nodeAt(x, z, (WORLD.PLATFORM_W + WORLD.APRON_MARGIN) / 2);
    if (onApron) _vic.near.add(onApron);
    for (const r of _walkableRoads) {
      if (onApron && (r.a === onApron || r.b === onApron)) { _vic.near.add(r.a); _vic.near.add(r.b); }
      if (_roadHas(r, x, z)) { _vic.roads.push(r); _vic.near.add(r.a); _vic.near.add(r.b); }
    }
    return _vic;
  }
  // Should a label for something standing at (x, z) show? Inside a house,
  // only things in that same house; outside, things on a nearby house's
  // platform/apron or on the road I'm on.
  function _inVicinity(v, x, z) {
    if (v.inside) return _nodeAt(x, z, WORLD.PLATFORM_W / 2) === v.inside;
    const at = _nodeAt(x, z, (WORLD.PLATFORM_W + WORLD.APRON_MARGIN) / 2);
    if (at) return v.near.has(at);
    for (const r of v.roads) if (_roadHas(r, x, z)) return true;
    return false;
  }

  function _tickHUD(now) {
    if (_mode !== 'world' || !_hudLayer) return;
    const vic = _player ? _computeVicinity(_player.position.x, _player.position.z) : null;

    // Remote-player tags + bubbles. _hudAnchor is module-scoped and reused
    // each frame to avoid per-tick GC churn — set() instead of new.
    for (const rp of _remotePlayers.values()) {
      // Top of head, build-scaled (a Huge build stands 1.4× taller), and
      // following the rig's Y so a tag rises with a jumping peer.
      const headY = 2.05 * (rp.rig.scale.y || 1);
      _hudAnchor.set(rp.rig.position.x, (rp.rig.position.y || 0) + headY + 0.3, rp.rig.position.z);
      if (rp.nameEl) _placeHudEl(rp.nameEl, _hudAnchor, 0);
      let stack = 0.4;
      for (const b of rp.bubbleEls) {
        stack += 0.5;
        _placeHudEl(b, _hudAnchor, stack);
      }
    }

    // NPC hero tags (name + health pips) — float above each NPC's
    // (build-scaled) head, sinking toward the floor while it's out cold.
    for (const npc of _npcs) {
      const lying = (npc.koUntil || 0) > now || (npc.koGetupUntil || 0) > now;
      const tagTarget = lying ? Math.min(npc.headY, 1.1) : npc.headY;
      if (npc.tagY == null) npc.tagY = npc.headY;
      npc.tagY += (tagTarget - npc.tagY) * 0.04;
      _hudAnchor.set(npc.x, npc.tagY, npc.z);
      if (npc.nameEl) {
        if (!vic || _inVicinity(vic, npc.x, npc.z)) _placeHudEl(npc.nameEl, _hudAnchor, 0);
        else npc.nameEl.style.display = 'none';
      }
      // Floating "−1"s rise and fade over NPC_DMG_MS.
      const dmg = npc.dmgEls;
      if (dmg && dmg.length) {
        for (let i = dmg.length - 1; i >= 0; i--) {
          const d = dmg[i];
          const age = (now - d.bornAt) / NPC_DMG_MS;
          if (age >= 1) { if (d.el.parentNode) d.el.parentNode.removeChild(d.el); dmg.splice(i, 1); continue; }
          _placeHudEl(d.el, _hudAnchor, 0.35 + age * 0.7);
          d.el.style.opacity = String(1 - age * age);
        }
      }
    }

    // Keeper tags over each house roof — who owns it and how far you are from
    // taking it over. Only for houses one road away (just your own house while
    // you're inside one), and never beyond KEEPER_TAG_MAX_DIST.
    if (_player) {
      const px = _player.position.x, pz = _player.position.z;
      for (const [id, node] of _worldNodes) {
        const el = node.keeperEl;
        if (!el) continue;
        const nx = node.mesh.position.x, nz = node.mesh.position.z;
        const dx = px - nx, dz = pz - nz;
        if (!vic.near.has(id) || dx * dx + dz * dz > KEEPER_TAG_MAX_DIST * KEEPER_TAG_MAX_DIST) { el.style.display = 'none'; continue; }
        // Above the roof's highest point, so a gable / chimney never swallows it.
        _hudAnchor.set(nx, (node.roofTopY || (node.wallHeight || WORLD.WALL_HEIGHT) + 0.18) + 0.5, nz);
        _placeHudEl(el, _hudAnchor, 0);
      }
    }

    // "Sit (E)" / "Lie down (E)" over the nearest chair / bed; hidden while
    // seated. The touch button mirrors it (setInteractLabel).
    _scanSeats();
    const cand = (!_seat && _seatCandidate) ? _seatCandidate : null;
    if (cand && _hudLayer) {
      if (!_seatPromptEl) {
        _seatPromptEl = document.createElement('div');
        _seatPromptEl.className = 'pg3d-nodelabel pg3d-seatprompt';
        _hudLayer.appendChild(_seatPromptEl);
      }
      const label = cand.kind === 'bed' ? 'Lie down' : 'Sit';
      const text = _coarsePointer ? label : `${label} (E)`;
      if (_seatPromptEl.textContent !== text) _seatPromptEl.textContent = text;
      _hudAnchor.set(cand.x, (cand.top || 0.5) + 0.9, cand.z);
      _placeHudEl(_seatPromptEl, _hudAnchor, 0);
    } else if (_seatPromptEl) {
      _seatPromptEl.style.display = 'none';
    }
    if (_input && _input.setInteractLabel) {
      _input.setInteractLabel(_seat ? 'Stand up' : (cand ? (cand.kind === 'bed' ? 'Lie down' : 'Sit') : null));
    }

    // Local player's own chat bubbles, over the head.
    if (_localBubbleEls.length && _player) {
      _hudAnchor.set(_player.position.x, _player.position.y + 2.05 * (_player.scale.y || 1), _player.position.z);
      let stack = 0.4;
      for (const b of _localBubbleEls) {
        stack += 0.5;
        _placeHudEl(b, _hudAnchor, stack);
      }
    }
  }

  // ── local NPCs (Avengers patrolling their debut nodes) ──
  // Purely client-side wanderers — deliberately kept OUT of _remotePlayers so
  // they never register as network or voice peers. They reuse the rig builder,
  // the walk-cycle math, _isInWalkable, and the HUD projection helpers.

  const NPC_SPEED = 1.5;     // world units / sec — a leisurely stroll
  const NPC_RADIUS = 0.40;   // NPC body footprint for wall / player avoidance
  // Chebyshev distance from the node centre of the patrol loop. The platform is
  // 12 wide (half 6) with its wall just outside that, and the walkable apron
  // reaches half-extent 8 — so a square ring at 7 is always clear of the walls
  // and always on walkable stone, at every node, without needing to probe.
  const NPC_RING = 7.0;

  // Shared clock. NPC motion is a pure function of this, so two clients that
  // agree on the time draw every hero in exactly the same place. Set from the
  // server's timestamp in the world:snapshot payload (js/home-socket.js);
  // until that lands — or if the socket never connects — it stays 0 and the
  // device's own clock is used, which is already within a second or so.
  let _worldClockSkew = 0;
  function setWorldClockOffset(ms) {
    if (typeof ms === 'number' && isFinite(ms)) _worldClockSkew = ms;
  }
  // Seconds since the epoch, on the shared clock.
  function _sharedNow() {
    return (Date.now() + _worldClockSkew) / 1000;
  }

  // Public: declare which heroes should roam. Each spec is
  // { id, name, character, debut }. Stored so a hero can pop in the moment its
  // debut node unlocks mid-session (re-invoked from _rebuildWorldNodes).
  function setWorldNpcs(specs) {
    _npcSpecs = Array.isArray(specs) ? specs : [];
    _materializeNpcs();
  }

  // Spawn any spec whose debut node now exists and isn't already spawned.
  function _materializeNpcs() {
    if (_mode !== 'world' || !_scene || !window.THREE) return;
    for (const spec of _npcSpecs) {
      if (_npcs.some(n => n.id === spec.id)) continue;   // already roaming
      const node = _worldNodes.get(spec.debut);
      if (!node) continue;                                // debut node still locked
      const homeX = node.mesh.position.x;
      const homeZ = node.mesh.position.z;

      const rig = _buildPlayer(spec.character || defaultCharacter());
      // The patrol is derived from the hero's id alone, so two clients build an
      // identical one: same lap offset, same direction, same pace, same pause
      // rhythm. Heroes sharing a node (Thor + Hawkeye at thor1) get different
      // offsets and so never stack.
      const maxHp = _npcMaxHp(spec.id);
      const npc = {
        id: spec.id, name: spec.name, rig, nameEl: null,
        homeX, homeZ,
        patrol: PG3DPhysics.npcPatrol(spec.id, NPC_RING, NPC_SPEED),
        x: homeX, z: homeZ, yaw: 0,
        walking: false,
        radius: _actorRadiusFor(spec.character || defaultCharacter()),
        headY: 2.05 * (((rig.scale && rig.scale.y) || 1)) + 0.3,
        // Combat (server-authoritative — see the NPC combat section below).
        hp: maxHp, maxHp, target: null, holdT: 0, pathOffsetMs: 0, koUntil: 0, koGetupUntil: 0, aggroUntil: 0,
        hitUntil: 0, hitSeq: 0, animSeq: 0, optimisticUntil: 0, punchUntil: 0, swingCount: 0,
        lastSwingAt: 0, hpEl: null, pipEls: [], dmgEls: []
      };
      // Place them on the path immediately so they never pop in at the node
      // centre for a frame.
      const p0 = _npcPathPoint(npc, _sharedNow());
      npc.x = p0.x; npc.z = p0.z; npc.yaw = p0.yaw;

      // Name tag with a row of health pips under it (one per hit point).
      const nameEl = document.createElement('div');
      nameEl.className = 'pg3d-nametag pg3d-npc-nametag';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'pg3d-npc-name';
      nameSpan.textContent = spec.name || '';
      const hpEl = document.createElement('div');
      hpEl.className = 'pg3d-npc-hp good';
      for (let i = 0; i < maxHp; i++) {
        const pip = document.createElement('span');
        pip.className = 'pg3d-npc-hp-pip filled';
        hpEl.appendChild(pip);
        npc.pipEls.push(pip);
      }
      nameEl.appendChild(nameSpan);
      nameEl.appendChild(hpEl);
      if (_hudLayer) _hudLayer.appendChild(nameEl);
      npc.nameEl = nameEl;
      npc.hpEl = hpEl;

      // A hero whose node unlocks mid-fight starts in the server's state —
      // hurt, angry, or lying at its hold point — rather than fresh.
      const rec = _npcCombat.get(spec.id);
      if (rec) {
        _applyNpcRecord(npc, rec, performance.now());
        const h = _npcPathPoint(npc, npc.holdT || _sharedNow());
        npc.x = h.x; npc.z = h.z;
      }
      rig.position.set(npc.x, 0, npc.z);
      rig.rotation.y = npc.yaw;
      _scene.add(rig);

      _npcs.push(npc);
    }
  }

  // Deterministic [0, 1) from a string, and the hero's position at shared-clock
  // time `t`. Both live in PG3DPhysics so they can be unit-tested without THREE
  // or a DOM — see test/physics.test.js.
  function _hash01(s) { return PG3DPhysics.hash01(s); }
  // `t` is shared-clock seconds. Time a hero has spent held in fights
  // (pathOffsetMs, from the server) is subtracted so its patrol resumes from
  // where it stopped rather than jumping ahead.
  function _npcPathPoint(npc, t) {
    return PG3DPhysics.npcPathPoint(npc.patrol, npc.homeX, npc.homeZ, NPC_RING, t - (npc.pathOffsetMs || 0) / 1000);
  }

  // Push an NPC's RENDERED position clear of the local player if they overlap.
  // Purely cosmetic and purely local: npc.x/npc.z are re-derived from the path
  // every frame, so this never accumulates and never desyncs anyone.
  function _npcAvoidPlayer(npc) {
    if (!_player) return;
    const sep = (npc.radius || NPC_RADIUS) + PHYSICS.PLAYER_RADIUS;
    let dx = npc.x - _player.position.x;
    let dz = npc.z - _player.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= sep * sep) return;
    let d = Math.sqrt(d2);
    if (d < 1e-4) { dx = 1; dz = 0; d = 1; }   // exactly coincident — pick an axis
    npc.x = _player.position.x + (dx / d) * sep;
    npc.z = _player.position.z + (dz / d) * sep;
  }

  function _tickNpcs(dt, now) {
    if (!_npcs.length) return;
    // One shared-clock reading for the whole batch — every hero is evaluated
    // at the same instant, and that instant is the same on every client.
    const t = _sharedNow();
    for (const npc of _npcs) {
      const bones = npc.rig.userData.bones;
      // patrol / aggro / ko / getup — from the server's record, on this tab's
      // clock. Held = the server has paused this hero's patrol clock (stopAt),
      // or a local phase is still playing out (get-up after the KO expired).
      const phase = _npcPhase(npc, now);
      const held = npc.holdT > 0 || phase !== 'patrol';
      const isKo = phase === 'ko';
      if (npc.hudKo !== isKo) { npc.hudKo = isKo; _syncNpcHp(npc, now); }

      // Rigged NPCs animate from last frame's walking flag — a frame of lag
      // no one can see, and it keeps the steering code below untouched.
      const npcRigged = _animateActor(npc.rig, {
        speed: npc.walking ? npc.patrol.speed : 0,
        downUntil: npc.koUntil || 0,
        getupUntil: npc.koGetupUntil || 0,
        hitUntil: npc.hitUntil || 0, hitClip: npc.hitClip,
        punchUntil: npc.punchUntil || 0, punchClip: npc.punchClip,
        overlaySeq: npc.animSeq || 0
      }, dt, now);
      const dampIdle = () => {
        if (!bones || npcRigged) return;
        _dampPose(bones, Math.min(1, dt * 8));
        // Sway phase is hashed, not random, and runs off the shared clock —
        // so even the idle weight-shift is in step across clients.
        if (npc.swayPhase === undefined) npc.swayPhase = _hash01(npc.id + 'w') * Math.PI * 2;
        bones.body.rotation.z = Math.sin(t * 0.8 + npc.swayPhase) * 0.02;
      };

      // Knock-out pose runs in every branch on the legacy rig (falling over,
      // lying, getting up); rigged bodies play the clips instead.
      if (!npcRigged) _applyDownPose(npc.rig, npc.koUntil || 0, now);

      // Canonical position for this instant — identical on every client.
      // While held, the patrol clock is frozen at stopAt, so this is the spot
      // the hero stopped on; afterwards it continues from that same spot.
      const p = _npcPathPoint(npc, npc.holdT || t);

      if (held) {
        // Ease onto the hold point (absorbs the hitter's optimistic freeze,
        // and the frame or two before the server's stopAt arrives).
        const k = Math.min(1, dt * 8);
        npc.x += (p.x - npc.x) * k;
        npc.z += (p.z - npc.z) * k;
        npc.walking = false;
        if (phase === 'aggro') {
          // Square up to the attacker; if that's us and we're in reach, swing.
          const tp = _npcTargetPos(npc);
          if (tp) npc.yaw = _lerpAngle(npc.yaw, Math.atan2(tp.x - npc.x, tp.z - npc.z), Math.min(1, dt * 10));
          if (npc.target === _localId) _npcMaybeSwing(npc, now);
        }
        _npcAvoidPlayer(npc);
        npc.rig.position.set(npc.x, 0, npc.z);
        npc.rig.rotation.y = npc.yaw;
        dampIdle();
        continue;
      }

      npc.x = p.x;
      npc.z = p.z;
      // Render-only sidestep so a hero doesn't walk through a player standing
      // on their line. Deliberately applied AFTER the canonical position and
      // never fed back into it — the path stays the shared truth, this is just
      // what this one screen draws.
      _npcAvoidPlayer(npc);
      npc.yaw = _lerpAngle(npc.yaw, p.yaw, Math.min(1, dt * 6));   // round the corners
      npc.walking = p.walking;
      npc.rig.position.set(npc.x, 0, npc.z);
      npc.rig.rotation.y = npc.yaw;

      if (!npc.walking) { dampIdle(); continue; }

      // Walk-cycle swing — shared pose with the player / remote players. Phase
      // comes off the shared clock too, so even the leg positions match.
      const walkPhase = (t / PHYSICS.STEP_PERIOD) * Math.PI * 2;
      if (bones && !npcRigged) _walkPose(bones, walkPhase);
    }
  }

  function _clearNpcs() {
    for (const npc of _npcs) {
      if (npc.rig && npc.rig.parent) npc.rig.parent.remove(npc.rig);
      if (npc.rig) _disposeActor(npc.rig);
      if (npc.nameEl && npc.nameEl.parentNode) npc.nameEl.parentNode.removeChild(npc.nameEl);
      for (const d of (npc.dmgEls || [])) if (d.el.parentNode) d.el.parentNode.removeChild(d.el);
    }
    _npcs.length = 0;
  }

  // ── NPC combat (server-authoritative; see routes/world-socket.js) ──
  // Every hero's HP, knock-out and target live on the server and arrive as
  // world:npcs / world:npc-update. Server-time deadlines are converted to
  // this tab's performance.now() clock; the hold point (stopAt) stays on the
  // shared clock because the patrol path is evaluated on it.

  const NPCC = (typeof WorldNpcLogic !== 'undefined') ? WorldNpcLogic.C : {
    KO_MS: 8000, KO_GETUP_MS: 1500, AGGRO_MS: 6000, NPC_PUNCH_COOLDOWN_MS: 1400, NPC_FIRST_SWING_MS: 650,
    NPC_GRACE_MS: 900, NPC_PUNCH_RANGE: 1.6, NPC_PUNCH_ANIM_MS: 450, HIT_MS: 380
  };
  const NPC_DMG_MS = 800;          // floating "−1" lifetime

  function _sharedNowMs() { return Date.now() + _worldClockSkew; }
  function _serverMsToPerf(ms) { return ms ? performance.now() + (ms - _sharedNowMs()) : 0; }
  function _npcMaxHp(id) {
    const s = (typeof WorldNpcLogic !== 'undefined') && WorldNpcLogic.NPC_STATS[id];
    return s ? s.maxHp : 3;
  }

  // patrol → aggro (holding, facing its target) → ko (lying) → getup.
  function _npcPhase(npc, now) {
    if ((npc.koUntil || 0) > now) return 'ko';
    if ((npc.koGetupUntil || 0) > now) return 'getup';
    if (npc.target && (npc.aggroUntil || 0) > now) return 'aggro';
    return 'patrol';
  }

  function _applyNpcRecord(npc, rec, now) {
    if (typeof rec.hp === 'number') npc.hp = rec.hp;
    if (typeof rec.maxHp === 'number') npc.maxHp = rec.maxHp;
    // A fresh grudge gets a wind-up: the flinch plays before the first
    // counter-punch instead of the two landing in the same frame.
    if (rec.target && !npc.target) {
      npc.lastSwingAt = Math.max(npc.lastSwingAt || 0, now - NPCC.NPC_PUNCH_COOLDOWN_MS + NPCC.NPC_FIRST_SWING_MS);
    }
    npc.target = rec.target || null;
    npc.holdT = rec.stopAt ? rec.stopAt / 1000 : 0;
    npc.pathOffsetMs = rec.pathOffsetMs || 0;
    const ko = _serverMsToPerf(rec.koUntil);
    // A NEW knock-out schedules its get-up; a cleared one (the server's
    // 'getup' event) keeps the get-up window that was already computed.
    if (ko && Math.abs(ko - (npc.koUntil || 0)) > 50) npc.koGetupUntil = ko + NPCC.KO_GETUP_MS;
    npc.koUntil = ko;
    if (rec.getupUntil) npc.koGetupUntil = _serverMsToPerf(rec.getupUntil);
    npc.aggroUntil = _serverMsToPerf(rec.aggroUntil);
    _syncNpcHp(npc, now);
  }

  function _syncNpcHp(npc, now) {
    if (!npc.hpEl) return;
    for (let i = 0; i < npc.pipEls.length; i++) npc.pipEls[i].classList.toggle('filled', i < npc.hp);
    const cls = (typeof WorldNpcLogic !== 'undefined') ? WorldNpcLogic.healthClass(npc.hp, npc.maxHp)
      : (npc.hp / npc.maxHp >= 0.67 ? 'good' : npc.hp / npc.maxHp >= 0.34 ? 'warn' : 'low');
    npc.hpEl.classList.remove('good', 'warn', 'low');
    npc.hpEl.classList.add(cls);
    npc.hpEl.classList.toggle('ko', (npc.koUntil || 0) > now);
    npc.hpEl.setAttribute('aria-label', `${npc.hp} of ${npc.maxHp} hits left`);
  }

  // Flinch: hit clip overlay + red flash. Bumps animSeq so back-to-back hits restart the clip.
  function _npcFlinch(npc, now) {
    npc.hitSeq = (npc.hitSeq || 0) + 1;
    npc.animSeq = (npc.animSeq || 0) + 1;
    npc.hitUntil = now + NPCC.HIT_MS;
    npc.hitClip = (typeof WorldNpcLogic !== 'undefined') ? WorldNpcLogic.hitClip(npc.hitSeq) : 'Hit_Chest';
    const inst = npc.rig && npc.rig.userData.humanoid;
    if (inst && inst.setHitFlash) inst.setHitFlash(1);
  }

  function _spawnNpcDamage(npc, now) {
    if (!_hudLayer) return;
    const el = document.createElement('div');
    el.className = 'pg3d-dmg';
    el.textContent = '−1';
    _hudLayer.appendChild(el);
    (npc.dmgEls || (npc.dmgEls = [])).push({ el, bornAt: now });
  }

  // Where the hero's target stands right now (us, or a remote rig).
  function _npcTargetPos(npc) {
    if (!npc.target) return null;
    if (npc.target === _localId) return _player ? _player.position : null;
    const rp = _remotePlayers.get(npc.target);
    return rp ? rp.current : null;
  }

  // The hero is angry at US: ask the server for a swing when we're in reach
  // and back on our feet. The knockdown only lands on the server's echo.
  function _npcMaybeSwing(npc, now) {
    if (!_player || !_onNpcPunch) return;
    if (now - (npc.lastSwingAt || 0) < NPCC.NPC_PUNCH_COOLDOWN_MS) return;
    // Not while we're down or getting up, and not for a moment after — the
    // player gets a window to hit back (or step away) instead of a lock.
    if (_falling || _localDownUntil + PUNCH.GETUP_MS + NPCC.NPC_GRACE_MS > now) return;
    const hit = PG3DPhysics.pickPunchTarget(npc.x, npc.z, 0,
      [{ id: 'me', x: _player.position.x, z: _player.position.z, y: _player.position.y }], NPCC.NPC_PUNCH_RANGE);
    if (hit !== 'me') return;
    npc.lastSwingAt = now;
    try { _onNpcPunch(npc.id); } catch (_) {}
  }

  // ── public NPC-combat surface (wired by js/home-socket.js) ──

  function setNpcPunchHandler(fn) { _onNpcPunch = fn; }

  // Full state on join / reconnect.
  function setWorldNpcState(npcs) {
    _npcCombat.clear();
    const now = performance.now();
    for (const id of Object.keys(npcs || {})) {
      const rec = npcs[id];
      if (!rec || typeof rec !== 'object') continue;
      _npcCombat.set(id, rec);
      const npc = _npcs.find(n => n.id === id);
      if (npc) _applyNpcRecord(npc, rec, now);
    }
  }

  // One hero changed: hit / ko / getup / heal / aggro-expire / target-left.
  function applyNpcUpdate(u) {
    if (!u || typeof u.npc !== 'string') return;
    _npcCombat.set(u.npc, u);
    const npc = _npcs.find(n => n.id === u.npc);
    if (!npc) return;
    const now = performance.now();
    _applyNpcRecord(npc, u, now);
    if (u.event === 'hit' || u.event === 'ko') {
      // The hitter already flinched optimistically; everyone else does it now.
      if (!((npc.optimisticUntil || 0) > now)) _npcFlinch(npc, now);
      npc.optimisticUntil = 0;
      _spawnNpcDamage(npc, now);
    }
  }

  // A hero swung at its target (server echo) — play the swing on every screen.
  function playNpcPunch(id) {
    const npc = _npcs.find(n => n.id === id);
    if (!npc) return;
    npc.swingCount = (npc.swingCount || 0) + 1;
    npc.animSeq = (npc.animSeq || 0) + 1;
    npc.punchClip = (typeof WorldNpcLogic !== 'undefined') ? WorldNpcLogic.swingClip(npc.swingCount) : 'Punch_Jab';
    npc.punchUntil = performance.now() + NPCC.NPC_PUNCH_ANIM_MS;
  }

  // Socket reconnect: our old id is gone, so nobody can be angry at it.
  function resetNpcCombat() {
    _npcCombat.clear();
    for (const npc of _npcs) {
      npc.target = null; npc.aggroUntil = 0;
      npc.hitUntil = 0; npc.punchUntil = 0; npc.optimisticUntil = 0;
    }
  }

  // ── remote player API ──

  function addRemotePlayer(id, character, username, x, z, yaw, y, pose) {
    if (!_scene || !window.THREE) return;
    if (_remotePlayers.has(id)) return;
    const rig = _buildPlayer(character || defaultCharacter());
    rig.position.set(x || 0, y || 0, z || 0);
    rig.rotation.y = yaw || 0;
    _scene.add(rig);

    const nameEl = document.createElement('div');
    nameEl.className = 'pg3d-nametag';
    nameEl.textContent = username || 'Anon';
    if (_hudLayer) _hudLayer.appendChild(nameEl);

    _remotePlayers.set(id, {
      rig,
      radius: _actorRadiusFor(character || defaultCharacter()),
      target: { x: x || 0, y: y || 0, z: z || 0, yaw: yaw || 0, walking: false, pose: (pose === 'sit' || pose === 'lie') ? pose : null },
      current: { x: x || 0, y: y || 0, z: z || 0, yaw: yaw || 0 },
      stepClock: 0,
      nameEl,
      username: username || 'Anon',
      bubbleEls: [],
      emoteUntil: 0,
      opacity: 1,          // current fade level (1 = fully visible)
      appliedOpacity: 1    // last value pushed to materials/HUD (skip redundant work)
    });
  }

  // Snapshot for voice-chat distance attenuation. Reads the lerped (current)
  // position so volume tracks what the user actually sees on screen.
  function getRemotePlayers() {
    const out = [];
    _remotePlayers.forEach((rp, id) => {
      out.push({
        id,
        x: rp.current.x,
        y: rp.current.y || 0,
        z: rp.current.z,
        username: rp.username
      });
    });
    return out;
  }

  // Toggle the .speaking class on a remote player's nametag. Used by
  // VoiceManager to highlight whoever is currently transmitting audio.
  function setRemotePlayerSpeaking(id, isSpeaking) {
    const rp = _remotePlayers.get(id);
    if (!rp || !rp.nameEl) return;
    rp.nameEl.classList.toggle('speaking', !!isSpeaking);
  }

  function updateRemotePlayer(id, x, z, yaw, walking, y, backward, pose) {
    const rp = _remotePlayers.get(id);
    if (!rp) return;
    rp.target.x = x;
    rp.target.z = z;
    rp.target.y = (typeof y === 'number' && Number.isFinite(y)) ? y : 0;
    rp.target.yaw = yaw;
    rp.target.walking = !!walking;
    rp.target.backward = !!walking && !!backward;
    rp.target.pose = (pose === 'sit' || pose === 'lie') ? pose : null;
  }

  function removeRemotePlayer(id) {
    const rp = _remotePlayers.get(id);
    if (!rp) return;
    if (rp.rig.parent) rp.rig.parent.remove(rp.rig);
    // Shared geometry AND textures must survive: the humanoid models share one
    // set of textures across every character, so disposing maps here used to
    // blank out everyone else's avatar.
    _disposeActor(rp.rig);
    if (rp.nameEl && rp.nameEl.parentNode) rp.nameEl.parentNode.removeChild(rp.nameEl);
    for (const b of rp.bubbleEls) if (b.parentNode) b.parentNode.removeChild(b);
    _remotePlayers.delete(id);
  }

  // Drop ALL remote players (rigs + HUD). Used by the multiplayer client on a
  // socket reconnect: Socket.IO assigns a fresh socket.id on reconnect, so the
  // server resends a full snapshot; without clearing first, addRemotePlayer
  // early-returns on the now-stale ids and peers freeze at their drop-time
  // position. Iterating over a copy of the keys since removeRemotePlayer mutates.
  function clearRemotePlayers() {
    for (const id of [..._remotePlayers.keys()]) removeRemotePlayer(id);
  }

  function showRemoteChat(id, username, text) {
    const rp = _remotePlayers.get(id);
    if (!rp || !_hudLayer) return;
    const el = document.createElement('div');
    el.className = 'pg3d-bubble';
    el.textContent = text;
    el.style.opacity = String(rp.opacity == null ? 1 : rp.opacity);
    _hudLayer.appendChild(el);
    rp.bubbleEls.push(el);
    setTimeout(() => {
      if (!_sceneAlive || !el.parentNode) return;
      el.classList.add('fading');
      setTimeout(() => {
        if (!_sceneAlive) return;
        if (el.parentNode) el.parentNode.removeChild(el);
        rp.bubbleEls = rp.bubbleEls.filter(b => b !== el);
      }, 600);
    }, 3500);
  }

  function playRemoteEmote(id, kind) {
    const rp = _remotePlayers.get(id);
    if (!rp || kind !== 'wave') return;
    rp.emoteUntil = performance.now() + WORLD.EMOTE_DURATION_MS;
  }

  function playLocalEmote(kind) {
    if (kind !== 'wave') return;
    _localEmoteUntil = performance.now() + WORLD.EMOTE_DURATION_MS;
  }

  // Float a chat bubble over the LOCAL player's own head. Mirrors showRemoteChat
  // (which only handles remote ids) so the sender sees the same bubble peers do.
  function showLocalChat(text) {
    if (!_hudLayer || !_player) return;
    const el = document.createElement('div');
    el.className = 'pg3d-bubble';
    el.textContent = text;
    _hudLayer.appendChild(el);
    _localBubbleEls.push(el);
    setTimeout(() => {
      if (!_sceneAlive || !el.parentNode) return;
      el.classList.add('fading');
      setTimeout(() => {
        if (!_sceneAlive) return;
        if (el.parentNode) el.parentNode.removeChild(el);
        _localBubbleEls = _localBubbleEls.filter(b => b !== el);
      }, 600);
    }, 3500);
  }

  // Push a remote player's current fade level onto its rig materials and HUD.
  // Skips redundant work when the level hasn't changed since last applied.
  function _applyRemoteOpacity(rp) {
    if (rp.opacity === rp.appliedOpacity) return;
    rp.appliedOpacity = rp.opacity;
    const o = rp.opacity;
    const vis = o > 0.02;
    rp.rig.visible = vis;
    rp.rig.userData.fade = o;          // the humanoid upgrade fades in to this
    const inst = rp.rig.userData.humanoid;
    if (vis && inst) {
      inst.setOpacity(o);
    } else if (vis) {
      rp.rig.traverse(m => {
        if (!m.material) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach(mat => { mat.transparent = o < 1; mat.opacity = o; });
      });
    }
    if (rp.nameEl) rp.nameEl.style.opacity = String(o);
    for (const b of rp.bubbleEls) b.style.opacity = String(o);
  }

  // Per-tick interpolation + walking animation for remote players.
  function _tickRemotePlayers(dt, now) {
    for (const rp of _remotePlayers.values()) {
      const k = Math.min(1, dt * WORLD.REMOTE_LERP_RATE);
      rp.current.x += (rp.target.x - rp.current.x) * k;
      rp.current.z += (rp.target.z - rp.current.z) * k;
      rp.current.y = (rp.current.y || 0) + (((rp.target.y || 0)) - (rp.current.y || 0)) * k;
      rp.current.yaw = _lerpAngle(rp.current.yaw, rp.target.yaw, k);
      rp.rig.position.x = rp.current.x;
      rp.rig.position.y = rp.current.y;
      rp.rig.position.z = rp.current.z;
      rp.rig.rotation.y = rp.current.yaw;

      // Fade the avatar out when it stands on geometry the local viewer can't
      // see (locked nodes/roads aren't built for us), so it doesn't appear to
      // walk through empty space — and fade back in on return. World-mode only.
      const dusted = rp.snapFadeUntil && rp.snapFadeUntil > now;
      const visTarget = (dusted || (_mode === 'world' && !_isInWalkable(rp.current.x, rp.current.z))) ? 0 : 1;
      const fadeK = Math.min(1, dt * WORLD.FADE_RATE);
      rp.opacity += (visTarget - rp.opacity) * fadeK;
      if (Math.abs(rp.opacity - visTarget) < 0.01) rp.opacity = visTarget;
      _applyRemoteOpacity(rp);

      // Rigged peers: speed/airborne come from the smoothed position, so the
      // network protocol is unchanged. "Airborne" is measured from the ground
      // under them (a peer standing on a crate is not falling), and a seated /
      // lying peer is never walking or airborne.
      const rpVelY = ((rp.current.y || 0) - (rp.prevY || 0)) / Math.max(dt, 0.001);
      rp.prevY = rp.current.y || 0;
      const pose = (rp.downUntil > now) ? null : (rp.target.pose || null);
      const posing = !!pose || (rp.rig.userData.poseW || 0) > 0;
      const rpGround = PG3DPhysics.groundAt(rp.current.x, rp.current.z, rp.radius || PHYSICS.PLAYER_RADIUS, _walls);
      if (_animateActor(rp.rig, {
        speed: (rp.target.walking && !pose) ? PHYSICS.SPEED * (rp.target.backward ? PHYSICS.BACKPEDAL_MUL : 0.8) : 0,
        backward: !!rp.target.backward && !pose,
        airborne: !pose && (rp.current.y || 0) > rpGround + 0.05,
        velY: rpVelY,
        downUntil: rp.downUntil || 0,
        getupUntil: rp.downUntil ? rp.downUntil + PUNCH.GETUP_MS : 0,
        punchUntil: rp.punchUntil || 0,
        emoteUntil: rp.emoteUntil || 0,
        pose
      }, dt, now)) {
        if (posing) _applyPose(rp.rig, pose, dt);
        else _applyDownPose(rp.rig, rp.downUntil || 0, now);
        continue;
      }

      const bones = rp.rig.userData.bones;
      if (!bones) continue;
      if (rp.target.walking && !pose) {
        rp.stepClock += rp.target.backward ? -dt : dt;
        const phase = (rp.stepClock / PHYSICS.STEP_PERIOD) * Math.PI * 2;
        _walkPose(bones, phase, rp.target.backward);
      } else {
        rp.stepClock = 0;
        _dampPose(bones, Math.min(1, dt * 8));
        // Stateless idle sway, phase-offset per peer so a crowd doesn't sync.
        if (rp.swayPhase === undefined) rp.swayPhase = Math.random() * Math.PI * 2;
        bones.body.rotation.z = Math.sin(now * 0.0008 + rp.swayPhase) * 0.02;
      }
      // Right-arm overrides: punch jab first, then the wave emote.
      if (rp.punchUntil > now && bones.rightArm) {
        _applyJabPose(bones, rp.punchUntil, now);
      } else if (rp.emoteUntil > now && bones.rightArm) {
        const t = (now - (rp.emoteUntil - WORLD.EMOTE_DURATION_MS)) / 200;
        bones.rightArm.rotation.x = -Math.PI * 0.9;
        bones.rightArm.rotation.z = Math.sin(t) * 0.4;
        if (bones.rightArmLower) bones.rightArmLower.rotation.x = 0;
      } else if (bones.rightArm) {
        bones.rightArm.rotation.z = 0;
      }
      // Sitting / lying beats the knockdown tilt (a seated peer who is hit
      // stands up first on their own client, so the two never overlap).
      if (posing) _applyPose(rp.rig, pose, dt);
      else _applyDownPose(rp.rig, rp.downUntil || 0, now);
    }
  }

  // ── public world-only getters / actions ──

  function getLocalState() {
    if (!_player) return null;
    return {
      x: _player.position.x,
      // Floored during falls to mirror the server's clamp; peers see the
      // avatar sink to the floor value while the unwalkable-ground fade
      // dissolves it, then it reappears at the respawn point.
      y: Math.max(FALL.BROADCAST_Y_FLOOR, _player.position.y),
      z: _player.position.z,
      yaw: _player.rotation.y,
      // Walking = local stepClock advanced recently (set in the main tick).
      walking: !!_localWalking,
      backward: !!_localBackward,
      // Seated on a chair / lying in a bed — persistent, so peers (and late
      // joiners, via the server's snapshot) render the pose.
      pose: _seat ? (_seat.kind === 'bed' ? 'lie' : 'sit') : null
    };
  }


  // ── preview framing ──
  //
  // The customizer frames whichever body region the open tab edits (face,
  // torso, feet…) instead of always showing the whole figure. Regions are
  // fractions of the rig's measured height (0 = ground, 1 = crown), so they
  // hold for the blocky body, the rigged humanoids and every build scale.
  //   lo/hi  — vertical band of the body height to fit
  //   w      — the band's width, as a fraction of the body height (the rig's
  //            own width is useless here: rigged bodies measure in an A-pose)
  //   elev   — camera height above the band's centre, in band-spans
  //   pad    — extra breathing room around the band
  const PREVIEW_REGIONS = {
    full:  null,   // the classic pose (see _frameCamera)
  // Measured on the rigged bodies: the head is ~13% of the height and ~13%
  // wide, shoulders ~35% wide, hands hang around 40–50% up.
    head:  { lo: 0.79, hi: 1.00, w: 0.16, elev: 0.05, pad: 1.40 },
    chest: { lo: 0.55, hi: 0.84, w: 0.40, elev: 0.05, pad: 1.30 },
    torso: { lo: 0.42, hi: 0.86, w: 0.42, elev: 0.05, pad: 1.25 },
    waist: { lo: 0.38, hi: 0.60, w: 0.32, elev: 0.05, pad: 1.40 },
    hands: { lo: 0.28, hi: 0.66, w: 0.55, elev: 0.02, pad: 1.25 },
    legs:  { lo: 0.02, hi: 0.54, w: 0.36, elev: 0.02, pad: 1.25 },
    feet:  { lo: 0.00, hi: 0.17, w: 0.28, elev: 0.28, pad: 1.35 }
  };
  // The blocky "Box" body: a cube head that is ~27% of the height and ~30%
  // wide, legs ~34%, torso between. Same keys as PREVIEW_REGIONS.
  const PREVIEW_REGIONS_BOX = {
    full:  null,
    head:  { lo: 0.70, hi: 1.00, w: 0.34, elev: 0.05, pad: 1.30 },
    chest: { lo: 0.46, hi: 0.72, w: 0.50, elev: 0.05, pad: 1.30 },
    torso: { lo: 0.34, hi: 0.72, w: 0.50, elev: 0.05, pad: 1.25 },
    waist: { lo: 0.30, hi: 0.48, w: 0.45, elev: 0.05, pad: 1.40 },
    hands: { lo: 0.22, hi: 0.62, w: 0.70, elev: 0.02, pad: 1.25 },
    legs:  { lo: 0.02, hi: 0.40, w: 0.45, elev: 0.02, pad: 1.25 },
    feet:  { lo: 0.00, hi: 0.14, w: 0.40, elev: 0.28, pad: 1.35 }
  };
  const PREVIEW_FULL = { pos: [0, 1.4, 5.8], look: [0, 1.0, 0] };

  // Ground-to-crown height and widest horizontal reach of a rig, skipping
  // subtrees tagged `userData.noFrame` (held props that can tower over the
  // head). Only y-extents and radius are used, so the group's yaw is harmless.
  const _frameBox = { minY: 0, maxY: 0, radius: 0, blocky: false };
  function _measureRig(rig) {
    const THREE = window.THREE;
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    let any = false;
    _frameBox.blocky = !!(rig.userData && rig.userData.boxBody);
    rig.updateMatrixWorld(true);
    const walk = (o) => {
      if (!o.visible || (o.userData && o.userData.noFrame)) return;
      if (o.isMesh && o.geometry) {
        if (o.isSkinnedMesh && typeof o.computeBoundingBox === 'function') {
          // Posed bounds: the rigged bodies reshape through bone scales (big
          // heads, Huge torsos) so the bind-pose geometry box runs ~15% short.
          o.computeBoundingBox();
          tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld);
        } else {
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        }
        if (isFinite(tmp.min.y) && isFinite(tmp.max.y)) { box.union(tmp); any = true; }
      }
      for (const ch of o.children) walk(ch);
    };
    walk(rig);
    if (!any) { _frameBox.minY = 0; _frameBox.maxY = 2; _frameBox.radius = 0.6; return _frameBox; }
    _frameBox.minY = Math.min(0, box.min.y);
    _frameBox.maxY = box.max.y;
    _frameBox.radius = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z), 0.2);
    return _frameBox;
  }

  // Camera pose (position + look-at) that frames `region` of a rig measured by
  // _measureRig, for a camera of the given vertical FOV and aspect. `zoom` > 1
  // moves closer. The classic full-body pose is kept verbatim so nothing that
  // showed the whole figure before looks different now.
  function _frameCamera(region, fovDeg, aspect, zoom) {
    zoom = zoom || 1;
    const spec = (_frameBox.blocky ? PREVIEW_REGIONS_BOX : PREVIEW_REGIONS)[region];
    if (!spec) {
      const p = PREVIEW_FULL.pos, l = PREVIEW_FULL.look;
      // Zoom toward the look-at point along the classic view line.
      return {
        pos: [l[0] + (p[0] - l[0]) / zoom, l[1] + (p[1] - l[1]) / zoom, l[2] + (p[2] - l[2]) / zoom],
        look: l.slice()
      };
    }
    const H = Math.max(0.5, _frameBox.maxY - _frameBox.minY);
    const bandLo = _frameBox.minY + H * spec.lo;
    const bandHi = _frameBox.minY + H * spec.hi;
    const span = (bandHi - bandLo) * spec.pad;
    const width = H * spec.w * spec.pad;
    const halfV = Math.tan((fovDeg * Math.PI / 180) / 2);
    const halfH = halfV * Math.max(0.3, aspect);
    const dist = Math.max(span / 2 / halfV, width / 2 / halfH, 0.6) / zoom;
    const cy = (bandLo + bandHi) / 2;
    return {
      pos: [0, cy + span * spec.elev, dist],
      look: [0, cy, 0]
    };
  }

  // ── standalone 3D preview ──
  //
  // Self-contained mini-renderer for the character builder modal. Owns its
  // own WebGL renderer, scene, camera, lights, RAF loop and a single rig
  // group — does NOT touch any module-level engine state, so it can run
  // simultaneously with the main /home or /world scene without conflict.
  //
  // Handle: { setCharacter, focus(region), zoomBy(f), setZoom(z), getZoom,
  //           destroy }. Drag spins the figure; the wheel and a two-finger
  //           pinch zoom it; focus() glides the camera onto a body region.
  function createPreview(container, character) {
    let renderer = null, scene = null, camera = null;
    let rig = null, rotGroup = null, rafId = null;
    let dragging = false, lastX = 0, yaw = 0;
    const autoYawVel = 0.4; // rad/s when not being dragged
    let alive = false;
    // Framing: which region is targeted, the user's zoom on top of it, and
    // the pose the camera is gliding toward. Re-measured periodically because
    // a rigged body arrives asynchronously and replaces the procedural one.
    let region = 'full', zoom = 1, measureAt = 0, snapCam = true;
    // Max keeps the camera (near plane 0.1) outside the head at full zoom.
    const ZOOM_MIN = 0.5, ZOOM_MAX = 2.2;
    const camLook = { x: 0, y: 1.0, z: 0 };
    const pointers = new Map();     // active pointers (pinch tracking)
    let pinchDist = 0;
    let pending = character;

    function _size() {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      return { w, h };
    }

    function start() {
      const THREE = window.THREE;
      const { w, h } = _size();
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.className = 'pg-preview-canvas';
      renderer.domElement.style.touchAction = 'none';
      renderer.domElement.style.cursor = 'grab';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      container.appendChild(renderer.domElement);

      scene = new THREE.Scene();

      // Lighting — bright ambient + key light angled from the front-right.
      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const key = new THREE.DirectionalLight(0xffffff, 0.85);
      key.position.set(2, 4, 3);
      key.castShadow = true;
      key.shadow.mapSize.set(512, 512);
      const sc = key.shadow.camera;
      sc.left = -2; sc.right = 2; sc.top = 2; sc.bottom = -2;
      sc.near = 0.5; sc.far = 12;
      scene.add(key);

      // Subtle ground disc so the character isn't floating in pure
      // transparency; receives the key light's shadow.
      const discMat = new THREE.MeshLambertMaterial({ color: 0x0a0a14, transparent: true, opacity: 0.55 });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.9, 28), discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.receiveShadow = true;
      scene.add(disc);

      camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 50);
      camera.position.set(0, 1.4, 5.8);
      camera.lookAt(0, 1.0, 0);

      rotGroup = new THREE.Group();
      scene.add(rotGroup);
      rig = _buildPlayer(pending);
      rotGroup.add(rig);

      _attachPointer();
      _attachResize();

      alive = true;
      let last = performance.now();
      const loop = (now) => {
        if (!alive) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (!dragging) yaw += autoYawVel * dt;
        rotGroup.rotation.y = yaw;
        // Rigged characters breathe/idle in the customiser preview.
        const inst = rig && rig.userData.humanoid;
        if (inst) inst.update(dt);
        _updateCamera(now, dt);
        renderer.render(scene, camera);
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    }

    // Glide the camera toward the pose that frames the current region at the
    // current zoom. The rig is re-measured twice a second (cheap: a handful
    // of bounding boxes) so the async procedural → rigged swap re-frames.
    function _updateCamera(now, dt) {
      if (!camera || !rig) return;
      if (now >= measureAt) { _measureRig(rig); measureAt = now + 500; }
      const t = _frameCamera(region, camera.fov, camera.aspect, zoom);
      if (snapCam) {
        camera.position.set(t.pos[0], t.pos[1], t.pos[2]);
        camLook.x = t.look[0]; camLook.y = t.look[1]; camLook.z = t.look[2];
        snapCam = false;
      } else {
        const k = 1 - Math.exp(-9 * dt);      // ~0.35 s settle
        camera.position.x += (t.pos[0] - camera.position.x) * k;
        camera.position.y += (t.pos[1] - camera.position.y) * k;
        camera.position.z += (t.pos[2] - camera.position.z) * k;
        camLook.x += (t.look[0] - camLook.x) * k;
        camLook.y += (t.look[1] - camLook.y) * k;
        camLook.z += (t.look[2] - camLook.z) * k;
      }
      camera.lookAt(camLook.x, camLook.y, camLook.z);
    }

    function setZoom(z) {
      zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +z || 1));
      return zoom;
    }
    function zoomBy(f) { return setZoom(zoom * (f || 1)); }
    function getZoom() { return zoom; }

    // Frame a body region ('full' | 'head' | 'chest' | 'torso' | 'waist' |
    // 'hands' | 'legs' | 'feet'). Unknown names fall back to the full figure.
    // Switching region resets the user's zoom so the new framing lands clean.
    function focus(name) {
      const next = PREVIEW_REGIONS.hasOwnProperty(name) ? name : 'full';
      if (next === region) return;
      region = next;
      zoom = 1;
      measureAt = 0;
    }

    function _attachPointer() {
      const el = renderer.domElement;
      const pinchGap = () => {
        const pts = [...pointers.values()];
        return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      };
      const onDown = (e) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        if (pointers.size === 2) {
          // Second finger: switch from spinning to pinch-zooming.
          dragging = false;
          pinchDist = pinchGap();
        } else {
          dragging = true;
          lastX = e.clientX;
        }
        el.style.cursor = 'grabbing';
        e.preventDefault();
      };
      const onMove = (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size >= 2) {
          const d = pinchGap();
          if (pinchDist > 0) setZoom(zoom * (d / pinchDist));
          pinchDist = d;
          return;
        }
        if (!dragging) return;
        yaw += (e.clientX - lastX) * 0.012;
        lastX = e.clientX;
      };
      const onUp = (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        try { el.releasePointerCapture(e.pointerId); } catch (_) {}
        if (pointers.size === 1) {
          // Pinch ended with a finger still down → resume spinning from it.
          const rest = [...pointers.values()][0];
          dragging = true;
          lastX = rest.x;
          pinchDist = 0;
        } else if (pointers.size === 0) {
          dragging = false;
          pinchDist = 0;
          el.style.cursor = 'grab';
        }
      };
      const onWheel = (e) => {
        e.preventDefault();
        // ~13% per mouse notch; trackpads send many small deltas.
        const step = Math.exp(-e.deltaY * 0.0012);
        setZoom(zoom * step);
      };
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      el.addEventListener('lostpointercapture', onUp);
      el.addEventListener('wheel', onWheel, { passive: false });
    }

    let resizeObs = null;
    function _attachResize() {
      if (typeof ResizeObserver === 'undefined') return;
      resizeObs = new ResizeObserver(() => {
        if (!renderer || !camera) return;
        const { w, h } = _size();
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      });
      resizeObs.observe(container);
    }

    function setCharacter(c) {
      pending = c;
      if (!rig || !rotGroup) return;
      rotGroup.remove(rig);
      _disposeRig(rig);
      rig = _buildPlayer(c);
      rotGroup.add(rig);
      measureAt = 0;   // a new body may be a different height/build
    }

    function destroy() {
      alive = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
      if (rig && rotGroup) { rotGroup.remove(rig); _disposeRig(rig); }
      if (scene) _disposeRig(scene);
      if (renderer) {
        try { renderer.dispose(); } catch (_) {}
        // Release the WebGL context (the customize preview is opened/closed
        // repeatedly; dispose() alone leaves the context for GC).
        try { if (renderer.forceContextLoss) renderer.forceContextLoss(); } catch (_) {}
        if (renderer.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      }
      renderer = scene = camera = rig = rotGroup = null;
    }

    // Three.js may not be ready yet — gate the same way the engine does.
    if (window.THREE) {
      start();
    } else {
      const onReady = () => {
        window.removeEventListener('three-ready', onReady);
        // Container may have been detached by the time THREE arrives.
        if (container.isConnected) start();
      };
      window.addEventListener('three-ready', onReady);
    }

    // `_debug` — measurement + camera readback for verification scripts.
    const _debug = () => ({
      region, zoom, box: { ..._measureRig(rig) },
      cam: camera ? camera.position.toArray() : null, look: { ...camLook }
    });
    return { setCharacter, focus, zoomBy, setZoom, getZoom, destroy, _debug };
  }

  // ── shared offscreen thumbnail renderer ──
  //
  // The /customize option tiles want a real 3D preview of every choice, but one
  // live WebGL context per tile would blow past the browser's ~16-context cap.
  // Instead a SINGLE hidden renderer is reused: for each character we build the
  // same rig _buildPlayer() makes, render one frame at a fixed 3/4 yaw, and read
  // it back as a PNG data URL for an <img>. Camera + lighting mirror
  // createPreview() so a tile matches the big rotatable preview.
  let _thumbR = null, _thumbScene = null, _thumbCam = null, _thumbGroup = null;

  function _ensureThumb(w, h) {
    const THREE = window.THREE;
    if (!THREE) return false;
    if (!_thumbR) {
      // preserveDrawingBuffer so toDataURL() reliably reads back the frame.
      _thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      _thumbR.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      _thumbScene = new THREE.Scene();
      _thumbScene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const key = new THREE.DirectionalLight(0xffffff, 0.85);
      key.position.set(2, 4, 3);
      _thumbScene.add(key);
      _thumbCam = new THREE.PerspectiveCamera(32, w / h, 0.1, 50);
      _thumbCam.position.set(0, 1.4, 5.8);
      _thumbCam.lookAt(0, 1.0, 0);
      _thumbGroup = new THREE.Group();
      _thumbScene.add(_thumbGroup);
    }
    _thumbR.setSize(w, h, false);
    _thumbCam.aspect = w / h;
    _thumbCam.updateProjectionMatrix();
    return true;
  }

  // Render one character to a PNG data URL (null if THREE/WebGL unavailable).
  // opts: { w, h, yaw, focus }. `focus` names a body region (see
  // PREVIEW_REGIONS) so an option tile shows the part it changes — a face
  // tile fills with the head instead of a whole tiny figure. Synchronous;
  // callers spread batches across frames.
  function renderThumbnail(character, opts) {
    opts = opts || {};
    const w = opts.w || 132, h = opts.h || 176;
    if (!_ensureThumb(w, h)) return null;
    const rig = _buildPlayer(character);
    _thumbGroup.rotation.y = (opts.yaw != null) ? opts.yaw : 0.42;  // gentle 3/4 view
    _thumbGroup.add(rig);
    _measureRig(rig);
    const pose = _frameCamera(opts.focus || 'full', _thumbCam.fov, _thumbCam.aspect, 1);
    _thumbCam.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    _thumbCam.lookAt(pose.look[0], pose.look[1], pose.look[2]);
    let url = null;
    try {
      _thumbR.render(_thumbScene, _thumbCam);
      url = _thumbR.domElement.toDataURL('image/png');
    } catch (_) { url = null; }
    _thumbGroup.remove(rig);
    _disposeActor(rig);
    return url;
  }

  // Release the shared thumbnail context (call when leaving /customize).
  function disposeThumbnails() {
    if (_thumbR) {
      try { _thumbR.dispose(); } catch (_) {}
      try { if (_thumbR.forceContextLoss) _thumbR.forceContextLoss(); } catch (_) {}
    }
    _thumbR = _thumbScene = _thumbCam = _thumbGroup = null;
  }

  return {
    init, initWorld, destroy, setCharacter, defaultCharacter, createPreview,
    renderThumbnail, disposeThumbnails,
    // World/multiplayer surface — no-ops in home mode.
    addRemotePlayer, updateRemotePlayer, removeRemotePlayer, clearRemotePlayers,
    showRemoteChat, showLocalChat, playRemoteEmote, playLocalEmote,
    getLocalState,
    // Shared Infinity Stone PvP — server-authoritative (routes/world-socket.js).
    setWorldStones, setStoneHeld, setStoneGrabHandler, setLocalId,
    getLocalStoneCount, applySnap, snapRespawnLocal, clearStones,
    // Punch + knockdown — relayed via world:punch (js/home-socket.js).
    setPunchHandler, playRemotePunch, knockdownRemote, knockdownLocal,
    // Spawn picker — choose which disconnected island to (re)spawn on.
    // isProjectUnlocked is exported so WorldView's island grouping uses the
    // engine's own rule instead of a second, drifting copy of it.
    teleportToNode, isProjectUnlocked: _isProjectUnlocked,
    // Local NPC surface — Avenger wanderers in /world. setWorldClockOffset
    // feeds them the server's clock so every client patrols them identically.
    setWorldNpcs, setWorldClockOffset,
    // NPC fights — HP / KO / aggro are server-authoritative (world:npcs,
    // world:npc-update, world:npc-punch in js/home-socket.js).
    setWorldNpcState, applyNpcUpdate, playNpcPunch, setNpcPunchHandler, resetNpcCombat,
    // Voice-chat surface — distance attenuation + speaking indicator.
    getRemotePlayers, setRemotePlayerSpeaking,
    // Keeper-decorated houses (GET /api/world/houses + world:house pushes).
    setHouses, applyHouse, getHouse, getHouseLayout, setHouseKeepers,
    setHouseShowcase, clearHouseShowcase,
    // Debugging aids for the browser preview (same idea as PG3DHumanoid._debug):
    // live NPC records, the local knockdown deadline, and a raw teleport so a
    // fight can be staged without steering the character by hand.
    _debug: {
      npcs() { return _npcs; },
      player() { return _player; },
      localDownUntil() { return _localDownUntil; },
      orbit() { return _orbit ? { distance: _orbit.distance, azimuth: _orbit.azimuth, elevation: _orbit.elevation } : null; },
      camera() { return _camera ? { fov: _camera.fov, aspect: _camera.aspect } : null; },
      vicinity() { if (!_player) return null; const v = _computeVicinity(_player.position.x, _player.position.z); return { inside: v.inside, near: [...v.near], roads: v.roads.length }; },
      teleport(x, z) { if (_player) { _seat = null; _player.rotation.x = 0; _player.position.set(x, _groundAt(x, z), z); _lastSafe.x = x; _lastSafe.z = z; } },
      seat() { return _seat; },
      seatCandidate() { return _seatCandidate; },
      // Advance one frame by hand when the tab is throttled (rAF frozen).
      // Cancels the queued frame first so the loop never doubles up.
      step() { if (!_running) return; if (_rafId) cancelAnimationFrame(_rafId); _tick(performance.now()); }
    }
  };
})();
