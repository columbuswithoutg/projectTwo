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
    STEP_PERIOD: 0.45             // seconds per full leg-swing cycle
  };

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
    // Wall fence around each platform — room-height (3.0u, above the ~2.2u
    // player head) so each node reads as an enclosed room and the full-height
    // doorway clears the character. You can't walk off the platform except
    // through a doorway that lines up with a connecting road.
    WALL_HEIGHT: 3.0,
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
    HEIGHT_VAR_MAX: 1.24,        // ~2.5u .. 3.7u
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
  let _orbit = null;             // { azimuth, elevation, distance }
  let _resizeObs = null;
  let _rafId = null;
  let _lastTime = 0;
  let _running = false;
  let _stepClock = 0;             // animation phase accumulator
  let _idleClock = 0;
  let _currentChar = null;
  let _layout = null;             // { rooms: [{ projectId, gx, gy }] }
  // ── world-mode state ──
  let _mode = 'home';             // 'home' | 'world'
  let _hudLayer = null;            // HTMLDivElement overlay for nametags/bubbles/prompts
  let _worldNodes = new Map();    // projectId → { mesh, project, anchor: Vector3, walls }
  let _worldRoads = new Map();    // "a→b" key (sorted) → mesh
  let _remotePlayers = new Map(); // socketId → { rig, target:{x,z,yaw,walking}, current, nameEl, bubbleEls[], emoteUntil }
  let _npcs = [];                 // local Avenger NPCs patrolling their debut nodes (NOT network/voice peers)
  let _npcSpecs = [];             // declared specs [{ id, name, character, debut }] — materialized as their debut nodes unlock
  let _worldStateUnsub = null;
  let _activeNode = null;          // project currently within PROXIMITY
  let _activePromptEl = null;
  let _localEmoteUntil = 0;        // ms timestamp; while > now, override right-arm pose
  let _projectClickHandler = null; // set by view to handle prompt clicks
  let _localWalking = false;       // set each tick; read by getLocalState() for MP broadcast
  let _walkableRoads = [];         // [{ cx, cz, cos, sin, halfW, halfL }] for point-in-rotated-rect tests
  let _velY = 0;                   // vertical velocity for jump physics

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
  function initWorld(container, character) {
    _mode = 'world';
    _container = container;
    _currentChar = character || defaultCharacter();
    _layout = null;
    _waitForThree(container);
  }

  function _waitForThree(container) {
    if (window.THREE) {
      _initInternal();
    } else {
      const onReady = () => {
        window.removeEventListener('three-ready', onReady);
        // Container may have been swapped out before THREE arrived.
        if (_container === container) _initInternal();
      };
      window.addEventListener('three-ready', onReady);
    }
  }

  function destroy() {
    _running = false;
    _sceneAlive = false;
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = null;
    if (_resizeObs) { _resizeObs.disconnect(); _resizeObs = null; }
    if (_input) { _input.detach(); _input = null; }
    if (_worldStateUnsub) { try { _worldStateUnsub(); } catch (_) {} _worldStateUnsub = null; }
    if (_renderer) {
      _renderer.dispose();
      if (_renderer.domElement && _renderer.domElement.parentNode) {
        _renderer.domElement.parentNode.removeChild(_renderer.domElement);
      }
    }
    if (_scene) _disposeRig(_scene);
    // World-mode cleanup.
    _clearNpcs();          // removes NPC name-tag DOM nodes + clears _npcs
    _npcSpecs = [];
    _worldNodes.clear();
    _worldRoads.clear();
    _walkableRoads = [];
    _remotePlayers.clear();
    _activeNode = null;
    _activePromptEl = null;
    _hudLayer = null;
    _localEmoteUntil = 0;
    _projectClickHandler = null;
    _localWalking = false;
    _velY = 0;
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
    _player = _buildPlayer(character);
    _rig = _player.userData.bones;        // re-point local rig to the new build
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
    const THREE = window.THREE;
    _running = true;
    _sceneAlive = true;
    _hudAnchor = _hudAnchor || new THREE.Vector3();

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
      spawn = _worldSpawn();
    } else {
      _buildLayoutScene();
      spawn = _layoutSpawn();
    }

    // Player.
    _player = _buildPlayer(_currentChar);
    _rig = _player.userData.bones;        // local rig — animated by _tick
    _player.position.set(spawn.x, 0, spawn.z);
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
    _input = _makeInput(_viewport);

    // Initial size + resize handling.
    _resizeRenderer();
    _resizeObs = new ResizeObserver(_resizeRenderer);
    _resizeObs.observe(_viewport);

    _lastTime = performance.now();
    _rafId = requestAnimationFrame(_tick);
  }

  function _resizeRenderer() {
    if (!_renderer || !_viewport || !_camera) return;
    const w = _viewport.clientWidth || 1;
    const h = _viewport.clientHeight || 1;
    _renderer.setSize(w, h, false);
    _camera.aspect = w / h;
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

  // Walk a subtree and dispose every geometry + material it owns. Used
  // both by the engine's destroy() (on the whole scene) and by createPreview's
  // rig swap (on a single rig group). Textures are owned by _textureCache and
  // are intentionally not disposed here.
  function _disposeRig(obj) {
    obj.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => m.dispose());
      }
    });
  }

  function _buildPlayer(c) {
    const THREE = window.THREE;
    const skinHex = _palette('SKIN_TONES', c.skin);
    const shirtHex = _palette('SHIRT_COLORS', c.shirtColor);
    const pantsHex = _palette('PANTS_COLORS', c.pantsColor);
    const hairHex = _palette('HAIR_COLORS', c.hairColor);
    const shoeHex = _palette('SHOE_COLORS', c.shoeColor);
    const eyeHex  = _palette('EYE_COLORS', c.eyeColor);
    const beardHex = _palette('HAIR_COLORS', c.facialHairColor ?? c.hairColor);
    const styleIdx = c.hairStyle ?? 0;
    const eyeShapeIdx = c.eyeShape ?? 0;
    const beardIdx = c.facialHairStyle ?? 0;
    const glassesIdx = c.glasses ?? 0;
    const hatIdx = c.hat ?? 0;
    // Build (size/bulk) + hero gear. `?? 1`/`?? 0` keep pre-existing saved
    // characters (which have neither field) at Normal build / no gear.
    const buildIdx = c.build ?? 1;
    const gearIdx = c.gear ?? 0;
    const buildDef = (typeof Playground !== 'undefined' && Playground.BUILDS && Playground.BUILDS[buildIdx])
      || { scale: 1, bulk: 1 };
    const bulk = buildDef.bulk;

    const skinMat  = new THREE.MeshLambertMaterial({ color: skinHex });
    const shirtMat = new THREE.MeshLambertMaterial({ color: shirtHex });
    const pantsMat = new THREE.MeshLambertMaterial({ color: pantsHex });
    const hairMat  = new THREE.MeshLambertMaterial({ color: hairHex });
    const shoeMat  = new THREE.MeshLambertMaterial({ color: shoeHex });
    const eyeMat   = new THREE.MeshLambertMaterial({ color: eyeHex });
    const beardMat = new THREE.MeshLambertMaterial({ color: beardHex });

    const mkBox = (w, h, d, mat, cast = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.castShadow = cast;
      return m;
    };

    // Root — moved/yawed by the engine. Origin at feet center.
    const root = new THREE.Group();

    // Body group — for breathing scale that doesn't affect feet placement.
    const body = new THREE.Group();
    root.add(body);

    // Legs (with pivots at the hip so we can swing them).
    const HIP_Y = 0.7;
    const LEG_LEN = 0.7;
    const LEG_W = 0.32 * bulk;
    const LEG_D = 0.32 * bulk;
    const FOOT_H = 0.18;

    const mkLeg = (xOffset) => {
      const pivot = new THREE.Group();
      pivot.position.set(xOffset, HIP_Y, 0);
      const leg = mkBox(LEG_W, LEG_LEN, LEG_D, pantsMat);
      leg.position.y = -LEG_LEN / 2;
      pivot.add(leg);
      const foot = mkBox(LEG_W * 1.6, FOOT_H, LEG_D * 1.4, shoeMat);
      // Foot center sits half its own height above the leg's bottom, so
      // the foot's bottom face is flush with the leg bottom (y=0 in the
      // root's frame). Previously it hung 0.16u below the leg bottom and
      // visibly clipped into the floor.
      foot.position.set(0, -LEG_LEN + FOOT_H / 2, 0.05);
      pivot.add(foot);
      return pivot;
    };
    const leftLeg = mkLeg(-0.18 * bulk);
    const rightLeg = mkLeg(0.18 * bulk);
    body.add(leftLeg);
    body.add(rightLeg);

    // Torso. Width/depth widen with `bulk` so a Huge build reads as broad,
    // not just a bigger copy; height stays fixed (overall scale handles tall).
    const TORSO_W = 0.85 * bulk, TORSO_H = 0.75, TORSO_D = 0.45 * bulk;
    const torso = mkBox(TORSO_W, TORSO_H, TORSO_D, shirtMat);
    torso.position.y = HIP_Y + TORSO_H / 2;
    body.add(torso);

    // Arms (pivot at the shoulder, hangs down).
    const SHOULDER_Y = HIP_Y + TORSO_H - 0.05;
    const ARM_LEN = 0.7;
    const ARM_W = 0.22 * bulk, ARM_D = 0.22 * bulk;

    const mkArm = (xSign) => {
      const pivot = new THREE.Group();
      pivot.position.set(xSign * (TORSO_W / 2 + ARM_W / 2 - 0.02), SHOULDER_Y, 0);
      const arm = mkBox(ARM_W, ARM_LEN, ARM_D, skinMat);
      arm.position.y = -ARM_LEN / 2;
      // Sleeve (top portion shirt-colored).
      const sleeve = mkBox(ARM_W * 1.02, ARM_LEN * 0.4, ARM_D * 1.02, shirtMat);
      sleeve.position.y = -ARM_LEN * 0.2;
      pivot.add(arm);
      pivot.add(sleeve);
      return pivot;
    };
    const leftArm = mkArm(-1);
    const rightArm = mkArm(1);
    body.add(leftArm);
    body.add(rightArm);

    // Head + face.
    const HEAD_SZ = 0.55;
    const head = new THREE.Group();
    head.position.y = HIP_Y + TORSO_H + HEAD_SZ / 2 + 0.02;
    const headBox = mkBox(HEAD_SZ, HEAD_SZ, HEAD_SZ, skinMat);
    head.add(headBox);
    // Eyes — shape varies by eyeShape index. Positive Z is "front".
    const eyeFrontZ = HEAD_SZ / 2 + 0.001;
    const eyeShapeDims = _eyeShapeDims(eyeShapeIdx);
    const leftEye = new THREE.Mesh(
      new THREE.BoxGeometry(eyeShapeDims.w, eyeShapeDims.h, 0.02),
      eyeMat
    );
    leftEye.position.set(-0.12, 0.04, eyeFrontZ);
    leftEye.rotation.z = eyeShapeDims.rot || 0;
    head.add(leftEye);
    const rightEye = new THREE.Mesh(
      new THREE.BoxGeometry(eyeShapeDims.w, eyeShapeDims.h, 0.02),
      eyeMat
    );
    rightEye.position.set(0.12, 0.04, eyeFrontZ);
    rightEye.rotation.z = -(eyeShapeDims.rot || 0);
    head.add(rightEye);
    // Mouth — small dark bar.
    const mouthMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), mouthMat);
    mouth.position.set(0, -0.12, HEAD_SZ / 2 + 0.001);
    head.add(mouth);

    // Facial hair — sits on the front of the head; built per-style.
    const beard = _buildFacialHair(beardIdx, beardMat, HEAD_SZ);
    if (beard) head.add(beard);

    // Hair — per-style box arrangement on top of head.
    const hair = _buildHair(styleIdx, hairMat, HEAD_SZ);
    if (hair) head.add(hair);

    // Glasses — sit just in front of the eye plane.
    const glasses = _buildGlasses(glassesIdx, HEAD_SZ);
    if (glasses) head.add(glasses);

    // Hat — sits above the hair on top of the head. Cap variant borrows
    // the shirt color so it can match the outfit.
    const hat = _buildHat(hatIdx, HEAD_SZ, shirtHex);
    if (hat) head.add(hat);

    body.add(head);

    // Hero gear (helmet / shield / cape / weapons) — attaches extra meshes to
    // the head/torso/arm groups built above. No-op when gearIdx is 0.
    _buildGear(gearIdx, {
      head, torso, body, leftArm, rightArm,
      dims: { HEAD_SZ, TORSO_W, TORSO_H, TORSO_D, HIP_Y, ARM_LEN }
    });

    // Build scale — grows the whole figure from the feet (root origin is at
    // foot level, so feet stay planted). Untouched by the tick, which only
    // animates body.scale (breathing) and root position/rotation.
    root.scale.setScalar(buildDef.scale);

    // Default forward: character faces -Z by convention. The engine yaws
    // the root via root.rotation.y to face the movement direction.
    // userData.bones is read both by the local _tick() (via the module-
    // level _rig set by the local-only call sites) and by
    // _tickRemotePlayers() (via the remote rig stored in _remotePlayers).
    root.userData.bones = {
      body, head, torso, leftArm, rightArm, leftLeg, rightLeg
    };
    return root;
  }

  function _buildHair(styleIdx, mat, headSize) {
    const THREE = window.THREE;
    const grp = new THREE.Group();
    const top = headSize / 2;
    switch (styleIdx) {
      case 0: { // pixie — flat thin cap on crown
        const cap = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.02, 0.10, headSize * 1.02), mat);
        cap.castShadow = true;
        cap.position.y = top - 0.02;
        grp.add(cap);
        break;
      }
      case 1: { // bob — top + side flaps
        const cap = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.05, 0.18, headSize * 1.05), mat);
        cap.position.y = top - 0.04;
        cap.castShadow = true;
        grp.add(cap);
        const lflap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, headSize * 1.0), mat);
        lflap.position.set(-headSize / 2 - 0.02, -0.10, 0);
        lflap.castShadow = true;
        grp.add(lflap);
        const rflap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, headSize * 1.0), mat);
        rflap.position.set(headSize / 2 + 0.02, -0.10, 0);
        rflap.castShadow = true;
        grp.add(rflap);
        break;
      }
      case 2: { // spiky — four small angled boxes
        for (let i = 0; i < 4; i++) {
          const s = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 0.14), mat);
          s.castShadow = true;
          const ang = (i / 4) * Math.PI * 2;
          s.position.set(Math.cos(ang) * 0.12, top + 0.08, Math.sin(ang) * 0.12);
          s.rotation.set(0.2 * Math.cos(ang), ang, 0.2 * Math.sin(ang));
          grp.add(s);
        }
        break;
      }
      case 3: { // long — top + back rectangle to shoulders
        const cap = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.05, 0.16, headSize * 1.05), mat);
        cap.position.y = top - 0.03;
        cap.castShadow = true;
        grp.add(cap);
        const back = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.0, 0.85, 0.10), mat);
        back.position.set(0, -0.35, -headSize / 2 - 0.04);
        back.castShadow = true;
        grp.add(back);
        break;
      }
      case 4:   // bald — nothing
        return null;
      case 5: { // cap — dome + brim
        const dome = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.05, 0.20, headSize * 1.05), mat);
        dome.position.y = top + 0.02;
        dome.castShadow = true;
        grp.add(dome);
        const brim = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.4, 0.04, headSize * 0.6), mat);
        brim.position.set(0, top - 0.04, headSize / 2 + 0.04);
        brim.castShadow = true;
        grp.add(brim);
        break;
      }
      case 6: { // ponytail — thin cap + long tied tail hanging behind
        const cap = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.04, 0.14, headSize * 1.04), mat);
        cap.position.y = top - 0.02;
        cap.castShadow = true;
        grp.add(cap);
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.14), mat);
        tail.position.set(0, -0.10, -headSize / 2 - 0.05);
        tail.castShadow = true;
        grp.add(tail);
        break;
      }
      case 7: { // mohawk — narrow vertical crest down the centerline
        const crest = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.30, headSize * 1.10), mat);
        crest.position.y = top + 0.12;
        crest.castShadow = true;
        grp.add(crest);
        break;
      }
      case 8: { // afro — oversized rounded halo
        const halo = new THREE.Mesh(new THREE.SphereGeometry(headSize * 0.85, 14, 12), mat);
        halo.position.y = top - 0.05;
        halo.castShadow = true;
        grp.add(halo);
        break;
      }
      case 9: { // curly — base cap + scattered ringlet bumps
        const cap = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.04, 0.12, headSize * 1.04), mat);
        cap.position.y = top - 0.02;
        cap.castShadow = true;
        grp.add(cap);
        const bumps = [
          [ 0.14, 0.04,  0.14], [-0.14, 0.04,  0.14],
          [ 0.14, 0.04, -0.14], [-0.14, 0.04, -0.14],
          [ 0.00, 0.10,  0.00]
        ];
        for (const [px, py, pz] of bumps) {
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), mat);
          b.position.set(px, top + py, pz);
          b.castShadow = true;
          grp.add(b);
        }
        break;
      }
      case 10: { // buzz — extremely thin cap hugging the crown
        const cap = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.01, 0.05, headSize * 1.01), mat);
        cap.position.y = top - 0.01;
        cap.castShadow = true;
        grp.add(cap);
        break;
      }
      case 11: { // side-part — asymmetric cap with a swept bang up front
        const cap = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.04, 0.14, headSize * 1.04), mat);
        cap.position.y = top - 0.02;
        cap.castShadow = true;
        grp.add(cap);
        const sweep = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.10, 0.18), mat);
        sweep.position.set(-headSize * 0.18, top + 0.04, headSize * 0.32);
        sweep.rotation.z = 0.4;
        sweep.castShadow = true;
        grp.add(sweep);
        break;
      }
      case 12: { // topknot — pixie cap + a small bun on top
        const cap = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.02, 0.10, headSize * 1.02), mat);
        cap.position.y = top - 0.02;
        cap.castShadow = true;
        grp.add(cap);
        const knot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), mat);
        knot.position.y = top + 0.18;
        knot.castShadow = true;
        grp.add(knot);
        break;
      }
      case 13: { // undercut — tall block on top, shaved sides
        const top1 = new THREE.Mesh(new THREE.BoxGeometry(headSize * 0.82, 0.26, headSize * 1.0), mat);
        top1.position.y = top + 0.08;
        top1.castShadow = true;
        grp.add(top1);
        break;
      }
    }
    return grp;
  }

  // Eye-shape index → box width/height (depth stays at 0.02 from the
  // caller). Index 0 is round (0.06×0.06) so existing characters look
  // identical when eyeShape is null/0.
  function _eyeShapeDims(idx) {
    switch (idx) {
      case 1: return { w: 0.12, h: 0.04 };               // narrow / sleepy
      case 2: return { w: 0.10, h: 0.12 };               // wide / expressive
      case 3: return { w: 0.13, h: 0.05, rot: -0.26 };   // sharp / angled
      case 4: return { w: 0.09, h: 0.07 };               // soft / oval
      case 0:
      default: return { w: 0.06, h: 0.06 };              // round (legacy)
    }
  }

  function _buildFacialHair(styleIdx, mat, headSize) {
    const THREE = window.THREE;
    if (!styleIdx) return null;
    const grp = new THREE.Group();
    const front = headSize / 2 + 0.005;
    switch (styleIdx) {
      case 1: { // stubble — thin sheet across the lower face
        const sheet = new THREE.Mesh(new THREE.BoxGeometry(headSize * 0.92, 0.16, 0.02), mat);
        sheet.position.set(0, -0.16, front);
        grp.add(sheet);
        break;
      }
      case 2: { // mustache — small bar above mouth
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.03), mat);
        bar.position.set(0, -0.08, front);
        grp.add(bar);
        break;
      }
      case 3: { // goatee — small patch below mouth
        const patch = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.10, 0.03), mat);
        patch.position.set(0, -0.20, front);
        grp.add(patch);
        break;
      }
      case 4: { // full beard — wraps chin and jaw
        const front_ = new THREE.Mesh(new THREE.BoxGeometry(headSize * 0.95, 0.22, 0.04), mat);
        front_.position.set(0, -0.18, front);
        grp.add(front_);
        const left = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, headSize * 0.7), mat);
        left.position.set(-headSize / 2 - 0.005, -0.16, 0);
        grp.add(left);
        const right = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, headSize * 0.7), mat);
        right.position.set(headSize / 2 + 0.005, -0.16, 0);
        grp.add(right);
        const stache = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.04), mat);
        stache.position.set(0, -0.08, front);
        grp.add(stache);
        break;
      }
      case 5: { // chinstrap — thin band running jawline
        const left = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, headSize * 0.6), mat);
        left.position.set(-headSize / 2 - 0.005, -0.12, 0);
        grp.add(left);
        const right = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, headSize * 0.6), mat);
        right.position.set(headSize / 2 + 0.005, -0.12, 0);
        grp.add(right);
        const chin = new THREE.Mesh(new THREE.BoxGeometry(headSize * 0.9, 0.05, 0.04), mat);
        chin.position.set(0, -0.22, front);
        grp.add(chin);
        break;
      }
    }
    grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return grp;
  }

  function _buildGlasses(styleIdx, headSize) {
    const THREE = window.THREE;
    if (!styleIdx) return null;
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const grp = new THREE.Group();
    const z = headSize / 2 + 0.025;
    const xL = -0.12, xR = 0.12, y = 0.04;
    switch (styleIdx) {
      case 1: { // round
        const lensL = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 8, 16), frameMat);
        lensL.position.set(xL, y, z); lensL.rotation.y = 0; grp.add(lensL);
        const lensR = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 8, 16), frameMat);
        lensR.position.set(xR, y, z); grp.add(lensR);
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.015), frameMat);
        bridge.position.set(0, y, z); grp.add(bridge);
        break;
      }
      case 2: { // square
        const mkFrame = (x) => {
          const f = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.10, 0.02), frameMat);
          f.position.set(x, y, z);
          return f;
        };
        grp.add(mkFrame(xL));
        grp.add(mkFrame(xR));
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.015, 0.015), frameMat);
        bridge.position.set(0, y, z); grp.add(bridge);
        break;
      }
      case 3: { // aviator — slightly larger teardrops
        const lensMat = new THREE.MeshLambertMaterial({ color: 0x4a6a8a, transparent: true, opacity: 0.6 });
        const mkLens = (x) => {
          const g = new THREE.Group();
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.012, 8, 18), frameMat);
          g.add(ring);
          const fill = new THREE.Mesh(new THREE.CircleGeometry(0.09, 18), lensMat);
          g.add(fill);
          g.position.set(x, y - 0.01, z);
          return g;
        };
        grp.add(mkLens(xL));
        grp.add(mkLens(xR));
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.012), frameMat);
        bridge.position.set(0, y + 0.02, z); grp.add(bridge);
        break;
      }
      case 4: { // half-rim — bottom arc only
        const mkBottom = (x) => {
          const arc = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.01, 6, 12, Math.PI), frameMat);
          arc.rotation.z = Math.PI; // open side up
          arc.position.set(x, y, z);
          return arc;
        };
        grp.add(mkBottom(xL));
        grp.add(mkBottom(xR));
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.012), frameMat);
        bridge.position.set(0, y, z); grp.add(bridge);
        break;
      }
    }
    return grp;
  }

  function _buildHat(styleIdx, headSize, shirtHex) {
    const THREE = window.THREE;
    if (!styleIdx) return null;
    const top = headSize / 2;
    const grp = new THREE.Group();
    switch (styleIdx) {
      case 1: { // beanie — knit cap with cuff
        const mat = new THREE.MeshLambertMaterial({ color: 0x3a4a8a });
        const cuffMat = new THREE.MeshLambertMaterial({ color: 0x243466 });
        const cap = new THREE.Mesh(new THREE.SphereGeometry(headSize * 0.62, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
        cap.position.y = top;
        cap.castShadow = true;
        grp.add(cap);
        const cuff = new THREE.Mesh(new THREE.CylinderGeometry(headSize * 0.62, headSize * 0.62, 0.10, 16), cuffMat);
        cuff.position.y = top + 0.02;
        cuff.castShadow = true;
        grp.add(cuff);
        break;
      }
      case 2: { // cap — dome + brim, painted with shirt color
        const mat = new THREE.MeshLambertMaterial({ color: shirtHex });
        const dome = new THREE.Mesh(new THREE.SphereGeometry(headSize * 0.60, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
        dome.position.y = top;
        dome.castShadow = true;
        grp.add(dome);
        const brim = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.3, 0.04, headSize * 0.55), mat);
        brim.position.set(0, top - 0.01, headSize * 0.45);
        brim.castShadow = true;
        grp.add(brim);
        break;
      }
      case 3: { // top hat — tall cylinder + thin brim with red band
        const mat = new THREE.MeshLambertMaterial({ color: 0x111111 });
        const bandMat = new THREE.MeshLambertMaterial({ color: 0xa02828 });
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(headSize * 0.80, headSize * 0.80, 0.04, 20), mat);
        brim.position.y = top + 0.02;
        brim.castShadow = true;
        grp.add(brim);
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(headSize * 0.50, headSize * 0.50, 0.55, 20), mat);
        stack.position.y = top + 0.32;
        stack.castShadow = true;
        grp.add(stack);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(headSize * 0.51, headSize * 0.51, 0.06, 20), bandMat);
        band.position.y = top + 0.08;
        band.castShadow = true;
        grp.add(band);
        break;
      }
      case 4: { // hood — cowl around the head, tucked behind
        const mat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
        const cowl = new THREE.Mesh(new THREE.SphereGeometry(headSize * 0.78, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2 + 0.3), mat);
        cowl.position.set(0, top - 0.05, -0.05);
        cowl.castShadow = true;
        grp.add(cowl);
        break;
      }
    }
    return grp;
  }

  // Hero gear — per-Avenger mesh sets (gear index from js/playground.js
  // GEAR_LABELS / CHARACTER_PRESETS). Index 0 (None) adds nothing. Pieces are
  // attached directly to the rig's head/torso/arm groups so they move with the
  // body, swing with the arms, and get disposed with the rest of the rig.
  function _buildGear(gearIdx, ctx) {
    if (!gearIdx) return;
    const THREE = window.THREE;
    const { head, torso, leftArm, rightArm, dims } = ctx;
    const { HEAD_SZ, TORSO_W, TORSO_H, TORSO_D, ARM_LEN } = dims;
    const mk = (w, h, d, color, emissive) => new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color, emissive: emissive || 0x000000 })
    );
    const cyl = (rt, rb, h, color, emissive) => new THREE.Mesh(
      new THREE.CylinderGeometry(rt, rb, h, 20),
      new THREE.MeshLambertMaterial({ color, emissive: emissive || 0x000000 })
    );
    const added = [];
    const add = (parent, mesh) => { parent.add(mesh); added.push(mesh); return mesh; };

    switch (gearIdx) {
      case 1: { // Iron Man — red/gold helmet, arc reactor, gold forearm cuffs
        const RED = 0xb1232b, GOLD = 0xd9a420, ARC = 0x9fe6ff;
        add(head, mk(HEAD_SZ * 1.07, HEAD_SZ * 1.07, HEAD_SZ * 1.07, RED)); // shell over the face
        const face = add(head, mk(HEAD_SZ * 0.82, HEAD_SZ * 0.7, 0.06, GOLD));
        face.position.set(0, -0.02, HEAD_SZ / 2 + 0.02);
        [-0.12, 0.12].forEach(x => {
          const eye = add(head, mk(0.13, 0.045, 0.02, ARC, ARC));
          eye.position.set(x, 0.06, HEAD_SZ / 2 + 0.06);
        });
        const arc = add(torso, cyl(0.09, 0.09, 0.04, ARC, ARC));
        arc.rotation.x = Math.PI / 2;
        arc.position.set(0, 0.08, TORSO_D / 2 + 0.02);
        [leftArm, rightArm].forEach(a => {
          const cuff = add(a, mk(0.27, 0.18, 0.27, GOLD));
          cuff.position.y = -ARM_LEN * 0.86;
        });
        break;
      }
      case 2: { // Captain America — back shield, blue cowl, chest star
        const BLUE = 0x2a4a9a, RED = 0xb1232b, WHITE = 0xf0f0f0;
        const cowl = add(head, mk(HEAD_SZ * 1.06, HEAD_SZ * 0.62, HEAD_SZ * 1.06, BLUE));
        cowl.position.set(0, HEAD_SZ * 0.2, -0.02);
        const aMark = add(head, mk(0.1, 0.12, 0.02, WHITE));
        aMark.position.set(0, HEAD_SZ * 0.24, HEAD_SZ / 2 + 0.02);
        const shield = new THREE.Group();
        shield.add(cyl(0.42, 0.42, 0.05, RED));
        shield.add(cyl(0.31, 0.31, 0.06, WHITE));
        shield.add(cyl(0.21, 0.21, 0.07, RED));
        shield.add(cyl(0.12, 0.12, 0.08, BLUE));
        shield.add(mk(0.12, 0.12, 0.1, WHITE));
        shield.rotation.x = Math.PI / 2;
        shield.position.set(0, 0.05, -TORSO_D / 2 - 0.08);
        add(torso, shield);
        const cStar = add(torso, mk(0.14, 0.14, 0.02, WHITE));
        cStar.position.set(0, 0.12, TORSO_D / 2 + 0.01);
        break;
      }
      case 3: { // Thor — red cape, Mjölnir, silver helmet band + wings
        const CAPE = 0x8a1f24, METAL = 0xb8bcc4, SILVER = 0xd8dce4;
        const cape = add(torso, mk(TORSO_W * 1.08, TORSO_H + 0.55, 0.05, CAPE));
        cape.position.set(0, -0.18, -TORSO_D / 2 - 0.03);
        const hammer = new THREE.Group();
        const handle = mk(0.06, 0.5, 0.06, 0x5a3a22); handle.position.y = -0.18; hammer.add(handle);
        const headBlk = mk(0.24, 0.2, 0.2, METAL); headBlk.position.y = 0.1; hammer.add(headBlk);
        hammer.position.set(0, -ARM_LEN - 0.02, 0.08);
        add(rightArm, hammer);
        const band = add(head, cyl(HEAD_SZ * 0.56, HEAD_SZ * 0.56, 0.1, SILVER));
        band.position.y = HEAD_SZ * 0.42;
        [-1, 1].forEach(s => {
          const wing = add(head, mk(0.04, 0.22, 0.12, SILVER));
          wing.position.set(s * (HEAD_SZ * 0.55), HEAD_SZ * 0.5, 0);
          wing.rotation.z = s * 0.5;
        });
        break;
      }
      case 4: // Hulk — no gear; his identity is the green skin + Huge build.
        break;
      case 5: { // Black Widow — utility belt, hip batons, hourglass emblem
        const BLACK = 0x161616, GOLD = 0xd9a420, RED = 0xb1232b;
        const belt = add(torso, mk(TORSO_W * 1.04, 0.12, TORSO_D * 1.04, BLACK));
        belt.position.set(0, -TORSO_H / 2 + 0.02, 0);
        const buckle = add(torso, mk(0.12, 0.1, 0.03, GOLD));
        buckle.position.set(0, -TORSO_H / 2 + 0.02, TORSO_D / 2 + 0.01);
        [-1, 1].forEach(s => {
          const baton = add(torso, mk(0.06, 0.26, 0.06, BLACK));
          baton.position.set(s * (TORSO_W / 2 + 0.02), -TORSO_H / 2 - 0.05, 0.02);
        });
        const hourglass = add(torso, mk(0.1, 0.16, 0.02, RED));
        hourglass.position.set(0, 0.12, TORSO_D / 2 + 0.01);
        break;
      }
      case 6: { // Hawkeye — bow in hand, back quiver, tactical eye strap
        const DARK = 0x3a2d5a, TIP = 0xcfd4dc, STRAP = 0x1a1a1a;
        const bowGrp = new THREE.Group();
        const bow = new THREE.Mesh(
          new THREE.TorusGeometry(0.4, 0.025, 8, 20, Math.PI * 1.25),
          new THREE.MeshLambertMaterial({ color: DARK })
        );
        bow.rotation.y = Math.PI / 2;
        bow.rotation.z = Math.PI * 0.375;
        bowGrp.add(bow);
        const string = mk(0.012, 0.76, 0.012, 0xdddddd); bowGrp.add(string);
        bowGrp.position.set(0, -ARM_LEN, 0.12);
        add(leftArm, bowGrp);
        const quiver = add(torso, cyl(0.07, 0.07, 0.5, STRAP));
        quiver.position.set(-0.18, 0.05, -TORSO_D / 2 - 0.06);
        quiver.rotation.x = 0.3; quiver.rotation.z = 0.4;
        [-0.04, 0, 0.04].forEach(o => {
          const tip = add(torso, mk(0.015, 0.18, 0.015, TIP));
          tip.position.set(-0.18 + o, 0.34, -TORSO_D / 2 - 0.02);
          tip.rotation.z = 0.4;
        });
        const strap = add(head, mk(HEAD_SZ * 0.92, 0.1, 0.02, STRAP));
        strap.position.set(0, 0.05, HEAD_SZ / 2 + 0.01);
        break;
      }
    }
    added.forEach(p => p.traverse(o => { if (o.isMesh) o.castShadow = true; }));
  }

  function _palette(name, idx) {
    const arr = (typeof Playground !== 'undefined') ? Playground[name] : null;
    if (!arr) return 0xffffff;
    const v = arr[idx ?? 0] || arr[0];
    // Convert "#rrggbb" to int.
    return parseInt(v.replace('#', ''), 16);
  }

  // ── input ──

  function _makeInput(viewport) {
    const keys = { up: false, down: false, left: false, right: false };
    let joyAxis = { x: 0, y: 0 };
    let joyActive = false;
    // Jump is a one-shot edge trigger: keydown sets the flag; the tick
    // consumes it (and resets) when applying the impulse. This stops
    // hold-space from auto-bouncing.
    let jumpRequested = false;

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
        case ' ': case 'Spacebar':
          // Suppress the browser's default (page scroll) regardless of
          // direction; only the keydown sets the one-shot request flag.
          if (down) jumpRequested = true;
          break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    }
    const onKeyDown = e => onKey(e, true);
    const onKeyUp   = e => onKey(e, false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Mouse-drag to orbit camera; wheel to zoom.
    let mouseDragging = false;
    let lastMouse = { x: 0, y: 0 };
    function onMouseDown(e) {
      if (e.button !== 0) return;
      // The joystick's pointerdown handler may have just activated and
      // captured this pointer for itself — don't double-engage the camera.
      if (activeJoyPointerId !== null) return;
      mouseDragging = true;
      lastMouse.x = e.clientX;
      lastMouse.y = e.clientY;
    }
    function onMouseMove(e) {
      if (!mouseDragging || !_orbit) return;
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      lastMouse.x = e.clientX;
      lastMouse.y = e.clientY;
      _orbit.azimuth -= dx * CAMERA.ROTATE_SPEED;
      _orbit.elevation = Math.max(_minElev(),
        Math.min(CAMERA.MAX_ELEV, _orbit.elevation - dy * CAMERA.ROTATE_SPEED));
    }
    function onMouseUp() { mouseDragging = false; }
    function onWheel(e) {
      if (!_orbit) return;
      _orbit.distance = Math.max(CAMERA.MIN_DIST,
        Math.min(CAMERA.MAX_DIST, _orbit.distance + e.deltaY * CAMERA.ZOOM_SPEED));
      e.preventDefault();
    }
    viewport.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    viewport.addEventListener('wheel', onWheel, { passive: false });

    // Touch joystick (mobile) + one-finger camera drag (anywhere outside joystick).
    let joyEl = null, stickEl = null, joyCenter = null, joyRadius = 56;
    let activeJoyTouchId = null;
    let activeCamTouchId = null;
    let lastCamTouch = { x: 0, y: 0 };

    // Always create the joystick element. CSS gates visibility via a
    // (pointer: coarse) / narrow-viewport media query so it shows on
    // mobile and stays out of the way on desktop.
    const hasTouch = ('ontouchstart' in window) ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
    try { console.log('[Playground3D] touch=' + hasTouch); } catch (_) {}
    joyEl = document.createElement('div');
    joyEl.className = 'pg-joy';
    stickEl = document.createElement('div');
    stickEl.className = 'pg-joy-stick';
    joyEl.appendChild(stickEl);
    // Appended to <body>, not viewport, so its z-index lives at the
    // root stacking context — otherwise sibling overlays like
    // .world-chat-row (z-index: 6) would paint over the joystick even
    // though the joystick has z-index: 50 inside .pg-stage's context.
    document.body.appendChild(joyEl);

    // Joystick activation — three redundant entry points (pointer, mouse,
    // document-level pointer) all funnel through engageJoystick().
    let activeJoyPointerId = null;
    // Pointer-event-based camera-orbit drag — kicks in when a touch
    // misses the joystick. Separate id from activeJoyPointerId so the
    // two finger tracks don't collide.
    let activeCamPointerId = null;
    const lastCamPointer = { x: 0, y: 0 };

    function moveJoystick(cx, cy) {
      if (!joyCenter) return;
      let dx = cx - joyCenter.x;
      let dy = cy - joyCenter.y;
      const d = Math.hypot(dx, dy);
      if (d > joyRadius) { dx = dx / d * joyRadius; dy = dy / d * joyRadius; }
      stickEl.style.transform = `translate(${dx}px, ${dy}px)`;
      joyAxis = { x: dx / joyRadius, y: dy / joyRadius };
    }
    function releaseJoystick() {
      activeJoyPointerId = null;
      joyActive = false;
      joyAxis = { x: 0, y: 0 };
      if (stickEl) stickEl.style.transform = 'translate(0,0)';
    }
    function engageJoystick(cx, cy, pid, type, e) {
      const rect = joyEl.getBoundingClientRect();
      if (rect.width < 1) return false;
      const jcx = rect.left + rect.width / 2;
      const jcy = rect.top  + rect.height / 2;
      const dx  = cx - jcx;
      const dy  = cy - jcy;
      const hit = Math.hypot(dx, dy) <= rect.width / 2;
      if (!hit) return false;
      if (activeJoyPointerId !== null) return false;
      if (e) { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} }
      activeJoyPointerId = pid;
      joyActive = true;
      joyCenter = { x: jcx, y: jcy };
      joyRadius = rect.width / 2;
      if (e && typeof viewport.setPointerCapture === 'function' && typeof pid === 'number') {
        try { viewport.setPointerCapture(pid); } catch (_) {}
      }
      return true;
    }

    // Pointer events (modern; mouse + touch + pen). Named so detach()
    // can remove them.
    const onPointerDown = (e) => {
      if (engageJoystick(e.clientX, e.clientY, e.pointerId, 'pdown', e)) {
        moveJoystick(e.clientX, e.clientY);
        return;
      }
      // Joystick miss — on touch, treat the drag as a camera orbit so
      // swiping outside the joystick looks around the character (mirrors
      // desktop mouse-drag behavior).
      if (e.pointerType === 'touch' && activeCamPointerId === null) {
        activeCamPointerId = e.pointerId;
        lastCamPointer.x = e.clientX;
        lastCamPointer.y = e.clientY;
        if (typeof viewport.setPointerCapture === 'function') {
          try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
        }
      }
    };
    const onPointerMove = (e) => {
      if (e.pointerId === activeJoyPointerId) {
        moveJoystick(e.clientX, e.clientY);
        return;
      }
      if (e.pointerId === activeCamPointerId && _orbit) {
        const dx = e.clientX - lastCamPointer.x;
        const dy = e.clientY - lastCamPointer.y;
        lastCamPointer.x = e.clientX;
        lastCamPointer.y = e.clientY;
        _orbit.azimuth -= dx * CAMERA.ROTATE_SPEED;
        _orbit.elevation = Math.max(_minElev(),
          Math.min(CAMERA.MAX_ELEV, _orbit.elevation - dy * CAMERA.ROTATE_SPEED));
      }
    };
    const onPointerUp = (e) => {
      if (e.pointerId === activeJoyPointerId) {
        try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
        releaseJoystick();
        return;
      }
      if (e.pointerId === activeCamPointerId) {
        try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
        activeCamPointerId = null;
      }
    };
    const onPointerCancel = (e) => {
      if (e.pointerId === activeJoyPointerId) releaseJoystick();
      if (e.pointerId === activeCamPointerId) activeCamPointerId = null;
    };
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerCancel);

    // Mouse-event fallback for browsers where pointer events don't fire
    // or are intercepted. Uses a sentinel pointerId 'mouse' so the
    // pointer-event listeners above don't accidentally route mouse moves
    // (they'd compare e.pointerId === 'mouse' which is false for a real
    // pointer event).
    const onJoyMouseDown = (e) => {
      if (e.button !== 0) return;
      if (engageJoystick(e.clientX, e.clientY, 'mouse', 'mdown', e)) {
        moveJoystick(e.clientX, e.clientY);
      }
    };
    const onJoyMouseMove = (e) => {
      if (activeJoyPointerId === 'mouse') moveJoystick(e.clientX, e.clientY);
    };
    const onJoyMouseUp = () => {
      if (activeJoyPointerId === 'mouse') releaseJoystick();
    };
    viewport.addEventListener('mousedown', onJoyMouseDown);
    window.addEventListener('mousemove', onJoyMouseMove);
    window.addEventListener('mouseup', onJoyMouseUp);

    // Document-level capture-phase listener — last-resort safety net for
    // stacking quirks where viewport's pointerdown never reaches us.
    // Hit-test gates engagement to clicks actually inside joyEl's rect,
    // so it never steals clicks from elsewhere.
    const onDocPointerDown = (e) => {
      if (activeJoyPointerId !== null) return;
      if (engageJoystick(e.clientX, e.clientY, e.pointerId, 'doc-pdown', e)) {
        moveJoystick(e.clientX, e.clientY);
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);

    function joyStart(t) {
      activeJoyTouchId = t.identifier;
      joyActive = true;
      const rect = joyEl.getBoundingClientRect();
      joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      joyRadius = rect.width / 2;
      try { console.log('[Playground3D] joyStart id=' + t.identifier + ' rect=' + rect.width + 'x' + rect.height + ' center=' + joyCenter.x.toFixed(0) + ',' + joyCenter.y.toFixed(0)); } catch (_) {}
      joyMove(t);
    }
    function joyMove(t) {
      let dx = t.clientX - joyCenter.x;
      let dy = t.clientY - joyCenter.y;
      const d = Math.hypot(dx, dy);
      if (d > joyRadius) { dx = dx / d * joyRadius; dy = dy / d * joyRadius; }
      stickEl.style.transform = `translate(${dx}px, ${dy}px)`;
      joyAxis = { x: dx / joyRadius, y: dy / joyRadius };
    }
    function joyEnd() {
      activeJoyTouchId = null;
      joyActive = false;
      joyAxis = { x: 0, y: 0 };
      if (stickEl) stickEl.style.transform = 'translate(0,0)';
      try { console.log('[Playground3D] joyEnd'); } catch (_) {}
    }

    function onTouchStart(e) {
      try {
        const t0 = e.changedTouches[0];
        const tag = t0 && t0.target && (t0.target.className || t0.target.tagName);
        const hit = joyEl && t0 && joyEl.contains(t0.target);
        console.log('[Playground3D] touchstart n=' + e.changedTouches.length + ' target=' + tag + ' joyHit=' + hit);
      } catch (_) {}
      // The pointerdown path may have just activated the joystick — don't
      // also engage the touch-based joystick branch or the camera-orbit
      // drag, otherwise both would race the same finger.
      if (activeJoyPointerId !== null) return;
      for (const t of e.changedTouches) {
        // Joystick gets priority hit-test.
        if (joyEl && joyEl.contains(t.target)) {
          e.preventDefault();
          joyStart(t);
          return;
        }
      }
      // Otherwise — start a camera-orbit drag with the first new touch.
      if (activeCamTouchId === null) {
        const t = e.changedTouches[0];
        activeCamTouchId = t.identifier;
        lastCamTouch.x = t.clientX;
        lastCamTouch.y = t.clientY;
      }
    }
    function onTouchMove(e) {
      for (const t of e.changedTouches) {
        if (t.identifier === activeJoyTouchId) {
          e.preventDefault();
          joyMove(t);
        } else if (t.identifier === activeCamTouchId && _orbit) {
          const dx = t.clientX - lastCamTouch.x;
          const dy = t.clientY - lastCamTouch.y;
          lastCamTouch.x = t.clientX;
          lastCamTouch.y = t.clientY;
          _orbit.azimuth -= dx * CAMERA.ROTATE_SPEED;
          _orbit.elevation = Math.max(_minElev(),
            Math.min(CAMERA.MAX_ELEV, _orbit.elevation - dy * CAMERA.ROTATE_SPEED));
        }
      }
    }
    function onTouchEnd(e) {
      for (const t of e.changedTouches) {
        if (t.identifier === activeJoyTouchId) {
          e.preventDefault();
          joyEnd();
        } else if (t.identifier === activeCamTouchId) {
          activeCamTouchId = null;
        }
      }
    }
    // Touch listeners are always attached. Devices without touch input
    // simply never dispatch these events; no overhead.
    viewport.addEventListener('touchstart', onTouchStart, { passive: false });
    // joyEl now lives outside the viewport DOM subtree, so taps on it
    // wouldn't fire viewport's touchstart on older Android WebViews
    // that don't synthesize pointer events. Bind directly as a safety net.
    joyEl.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);

    function getAxis() {
      if (joyActive) return { x: joyAxis.x, y: joyAxis.y };
      let x = 0, y = 0;
      if (keys.left)  x -= 1;
      if (keys.right) x += 1;
      if (keys.up)    y -= 1;
      if (keys.down)  y += 1;
      return { x, y };
    }

    // True while the user is actively dragging the camera (mouse held or
    // touch-orbit in progress). Tick uses this to suspend auto-follow so
    // the user's manual rotation isn't fought by the follow lerp.
    function isOrbiting() {
      return mouseDragging || activeCamTouchId !== null;
    }

    // One-shot jump request. Tick reads and clears once per keydown so
    // that hold-space doesn't auto-bounce repeatedly.
    function consumeJump() {
      if (!jumpRequested) return false;
      jumpRequested = false;
      return true;
    }

    function detach() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      viewport.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', onPointerUp);
      viewport.removeEventListener('pointercancel', onPointerCancel);
      viewport.removeEventListener('mousedown', onJoyMouseDown);
      window.removeEventListener('mousemove', onJoyMouseMove);
      window.removeEventListener('mouseup', onJoyMouseUp);
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      viewport.removeEventListener('touchstart', onTouchStart);
      if (joyEl) joyEl.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      // joyEl is appended to <body>, not viewport — won't get cleaned up
      // by Playground3D's container.innerHTML='' on init/destroy. Pull it
      // out explicitly so re-init doesn't leak nodes.
      if (joyEl && joyEl.parentNode) joyEl.parentNode.removeChild(joyEl);
    }

    return { getAxis, isOrbiting, consumeJump, detach };
  }

  // ── tick / animation ──

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

    let moved = false;
    if (len > 0.05) {
      moved = true;
      const step = PHYSICS.SPEED * len * dt;
      // Move on each axis separately so collision response can slide along walls.
      _moveWithCollision(moveX * step, 0);
      _moveWithCollision(0, moveZ * step);

      // Yaw toward movement direction.
      const targetYaw = Math.atan2(moveX, moveZ);
      _player.rotation.y = _lerpAngle(_player.rotation.y, targetYaw, Math.min(1, PHYSICS.TURN_RATE * dt));
    }
    _localWalking = moved;

    // Jump physics — applies in both /home and /world. Space (or the
    // input adapter's consumeJump()) sets initial upward velocity if
    // grounded; gravity decelerates each frame until we hit y=0 again.
    if (_input && _input.consumeJump && _input.consumeJump()) {
      if (_player.position.y <= 0.01) _velY = JUMP.INITIAL_V;
    }
    if (_velY !== 0 || _player.position.y > 0) {
      _velY -= JUMP.GRAVITY * dt;
      _player.position.y += _velY * dt;
      if (_player.position.y <= 0) {
        _player.position.y = 0;
        _velY = 0;
      }
    }

    // Third-person auto-follow: when the player is moving and the user
    // isn't actively orbiting the camera, lerp the camera's azimuth toward
    // the character's yaw so the camera trails behind the back.
    if (moved && _input && !_input.isOrbiting()) {
      _orbit.azimuth = _lerpAngle(_orbit.azimuth, _player.rotation.y,
        Math.min(1, CAMERA.FOLLOW_RATE * dt));
    }

    // Animation.
    if (moved && _rig) {
      _stepClock += dt;
      _idleClock = 0;
      const phase = (_stepClock / PHYSICS.STEP_PERIOD) * Math.PI * 2;
      const swing = Math.sin(phase) * 0.6;        // ~34° peak
      _rig.leftLeg.rotation.x = swing;
      _rig.rightLeg.rotation.x = -swing;
      _rig.leftArm.rotation.x = -swing * 0.7;
      _rig.rightArm.rotation.x = swing * 0.7;
      _rig.body.position.y = Math.abs(Math.sin(phase)) * 0.04;
    } else if (_rig) {
      _idleClock += dt;
      // Damp limbs back to zero.
      const k = Math.min(1, dt * 8);
      _rig.leftLeg.rotation.x  *= 1 - k;
      _rig.rightLeg.rotation.x *= 1 - k;
      _rig.leftArm.rotation.x  *= 1 - k;
      _rig.rightArm.rotation.x *= 1 - k;
      _rig.body.position.y *= 1 - k;
      // Subtle breathing.
      const breath = Math.sin(_idleClock * 1.6) * 0.012 + 1;
      _rig.body.scale.y = breath;
    }

    // Local wave emote — overrides right-arm pose while active. Doesn't
    // interrupt walking; it just replaces the right arm's animation pose.
    if (_rig && _rig.rightArm && _localEmoteUntil > now) {
      const phase = (now - (_localEmoteUntil - WORLD.EMOTE_DURATION_MS)) / 200;
      _rig.rightArm.rotation.x = -Math.PI * 0.9;
      _rig.rightArm.rotation.z = Math.sin(phase) * 0.4;
    } else if (_rig && _rig.rightArm) {
      _rig.rightArm.rotation.z = 0;
    }

    // World-mode-only ticks (no-ops in home mode).
    if (_mode === 'world') {
      _tickRemotePlayers(dt, now);
      _tickNpcs(dt, now);
      _tickRoomCeilings();
      _tickHUD(now);
    }

    _updateCamera();
    _renderer.render(_scene, _camera);
    _rafId = requestAnimationFrame(_tick);
  }

  function _moveWithCollision(dx, dz) {
    const r = PHYSICS.PLAYER_RADIUS;
    const startX = _player.position.x;
    const startZ = _player.position.z;
    let x = startX + dx;
    let z = startZ + dz;
    for (const w of _walls) {
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
    // World-mode walkability: must end up on a node or road. Stepping
    // off into open ground is rejected for whichever axis caused it,
    // giving natural slide-along-edge behavior because outer movement
    // already comes in per-axis.
    if (_mode === 'world' && !_isInWalkable(x, z)) {
      if (dx !== 0 && dz === 0) x = startX;
      else if (dz !== 0 && dx === 0) z = startZ;
      else { x = startX; z = startZ; }
    }
    _player.position.x = x;
    _player.position.z = z;
  }

  // Minimum camera elevation — higher in /world so you can't tilt under the
  // tall room walls; normal floor everywhere else.
  function _minElev() {
    return _mode === 'world' ? CAMERA.WORLD_MIN_ELEV : CAMERA.MIN_ELEV;
  }

  function _updateCamera() {
    if (!_camera || !_player || !_orbit) return;
    const targetX = _player.position.x;
    const targetY = _player.position.y + 1.0;   // chest level
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

  function _isProjectUnlocked(p) {
    // Strict: only watched projects are visible in /world. Start nodes
    // (no prereqs — e.g. Iron Man) are always visible so a fresh user
    // has an entry point; otherwise their world would be empty.
    if (typeof state !== 'undefined' && state.isWatched && state.isWatched(p.id)) return true;
    return !p.prerequisites || p.prerequisites.length === 0;
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
      // Per-face materials so only the top face shows the poster.
      const side = new THREE.MeshLambertMaterial({ color: 0x8a7f68 });
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
      const ceilMat = new THREE.MeshLambertMaterial({ color: _phaseRoofColor(p.phase) });
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
      const apron = new THREE.Mesh(new THREE.ShapeGeometry(apronShape), new THREE.MeshLambertMaterial({
        color: WORLD.APRON_COLOR,
        side: THREE.DoubleSide,
        // Decal-style offset so the ring reliably renders over the ground and the
        // roads beneath it without z-fighting (it never overlaps the poster).
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
      }));
      apron.rotation.x = -Math.PI / 2;
      // Sit just above the road tops (-0.02) so the ring covers the road strips
      // around the building; the platform poster (y=0) shows through the hole.
      apron.position.set(x, -0.01, z);
      apron.receiveShadow = true;
      _scene.add(apron);

      // The 'anchor' is still used by the active-node prompt placement
      // tick — kept even though we no longer render a floating title.
      const anchor = new THREE.Vector3(x, WORLD.PLATFORM_RAISE + WORLD.PLATFORM_H / 2 + 1.6, z);
      const node = { mesh, project: p, anchor, walls: [], ceiling, apron, wallHeight, decor: [] };
      _worldNodes.set(p.id, node);

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

    const connections = _getConnectedNodes(node.project.id);
    // We always build the four-sided fence (even with no unlocked
    // connections) so that sides facing a still-locked neighbor read as a
    // solid wall we can hang a lock icon on. Doorways are cut only at
    // unlocked connections below; the player is confined to platforms/roads
    // by _isInWalkable regardless, so a fully-walled lone platform is fine.
    const sides = { N: [], S: [], E: [], W: [] };
    for (const other of connections) {
      const { side, coord } = _doorwayOnSide(node, other);
      sides[side].push(coord);
    }

    const cx = node.mesh.position.x, cz = node.mesh.position.z;
    const HALF = WORLD.PLATFORM_W / 2;
    const T = WORLD.WALL_THICKNESS;
    const H = node.wallHeight || WORLD.WALL_HEIGHT;   // per-house jittered height
    const D = WORLD.DOORWAY_WIDTH;
    const wallY = WORLD.PLATFORM_RAISE + WORLD.PLATFORM_H / 2 + H / 2;
    // Plaster wall texture with a baked baseboard/trim — ONE texture shared by the
    // whole town. Each segment gets its own material (so the existing per-wall
    // material.dispose() teardown is safe) but points at the shared texture map;
    // material.dispose() does not free the map, so the shared texture survives.
    const wallTex = _wallTexture();

    // Decor (trim/stoop/lamp) helpers — non-colliding, tracked in node.decor.
    const trimMat = () => new THREE.MeshLambertMaterial({ color: WORLD.WALL_TRIM_COLOR });
    const stoopMat = () => new THREE.MeshLambertMaterial({ color: WORLD.APRON_COLOR });
    const addDecor = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.castShadow = true; _scene.add(mesh); node.decor.push(mesh); };

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
        const lamp = _makeLamp(gEnd + 0.4, line + outSign * 0.5);
        if (lamp) { _scene.add(lamp); node.decor.push(lamp); }
      } else {
        addDecor(new THREE.Mesh(new THREE.BoxGeometry(jD, H, jW), trimMat()), line, wallY, gStart);
        addDecor(new THREE.Mesh(new THREE.BoxGeometry(jD, H, jW), trimMat()), line, wallY, gEnd);
        addDecor(new THREE.Mesh(new THREE.BoxGeometry(jD, 0.45, w + jW), trimMat()), line, lintelY, mid);
        addDecor(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, w), stoopMat()), line + outSign * 0.7, 0.06, mid);
        const lamp = _makeLamp(line + outSign * 0.5, gEnd + 0.4);
        if (lamp) { _scene.add(lamp); node.decor.push(lamp); }
      }
    }

    // For each side, compute wall segments around its doorway gaps and
    // build a thin box per segment. Walls are inset by T/2 so they sit
    // visibly ON the platform rather than at its edge.
    function buildSide(sideName, axisStart, axisEnd, fixed, horizontal) {
      const sorted = [...sides[sideName]].sort((a, b) => a - b);
      // Build clipped opening intervals, then collapse any that overlap or are
      // separated by only a thin wall sliver (< DOORWAY_MERGE_GAP) into one
      // opening — so two roads converging on a side become a single doorway with
      // one frame instead of overlapping frames / a lone thin post. Centers are
      // sorted and clamping preserves order, so a single left-to-right merge is
      // correct. Operates only on unlocked doorways, so a side with one path
      // still yields exactly one opening.
      const openings = [];
      for (const dCenter of sorted) {
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
        const gx = horizontal ? wlen : T;
        const gz = horizontal ? T : wlen;
        const mat = (plainColor != null)
          ? new THREE.MeshLambertMaterial({ color: plainColor })
          : (wallTex ? new THREE.MeshLambertMaterial({ map: wallTex, color: 0xffffff })
                     : new THREE.MeshLambertMaterial({ color: WORLD.WALL_COLOR }));
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(gx, wh, gz), mat);
        mesh.position.set(px, (y0 + y1) / 2, pz);   // platform top is y=0
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        _scene.add(mesh);
        node.walls.push({ mesh });
      }

      for (const [s, e] of segs) {
        const len = e - s;
        if (len <= 0.1) continue;
        const firstIdx = node.walls.length;

        if (len < WORLD.WINDOW_MIN_SEG) {
          addWallPanel(s, e, 0, H);                       // plain solid segment
        } else {
          // Carve a real window: side fillers + a sill below + a header above,
          // leaving a hole you can actually see through (filled with glass below).
          const center = (s + e) / 2;
          const winY = Math.min(H - WORLD.WINDOW_H / 2 - 0.25, H * 0.55);
          const winL = center - WORLD.WINDOW_W / 2, winR = center + WORLD.WINDOW_W / 2;
          const sillTop = winY - WORLD.WINDOW_H / 2, headBot = winY + WORLD.WINDOW_H / 2;
          addWallPanel(s, winL, 0, H);                    // left filler
          addWallPanel(winR, e, 0, H);                    // right filler
          addWallPanel(winL, winR, 0, sillTop);           // sill — same plaster as the wall
          addWallPanel(winL, winR, headBot, H);           // header — same plaster as the wall
          // Translucent glass pane sitting in the hole — see-through to the interior.
          const glass = _makeWindowGlass();
          if (glass) {
            glass.position.set(horizontal ? center : perp, winY, horizontal ? perp : center);
            glass.rotation.y = (sideName === 'N') ? Math.PI
                             : (sideName === 'S') ? 0
                             : (sideName === 'W') ? -Math.PI / 2 : Math.PI / 2;
            _scene.add(glass);
            node.decor.push(glass);
          }
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
    buildSide('W', cz - HALF, cz + HALF, cx - HALF, false);
    buildSide('E', cz - HALF, cz + HALF, cx + HALF, false);

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
    for (const node of _worldNodes.values()) {
      if (!node.ceiling) continue;
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

  // One shared plaster/stucco wall texture, drawn once and cached. Just a faint,
  // uniform speckle over the stone wall color — no baked baseboard/trim lines, so
  // every wall panel (full segments plus the fillers/sill/header around a carved
  // window) looks identical and the window reads as a clean hole, not a patch.
  let _wallTex = null;
  function _wallTexture() {
    const THREE = window.THREE;
    if (!THREE || !THREE.CanvasTexture) return null;
    if (_wallTex) return _wallTex;
    const W = 64, H = 128;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const hex = (n) => '#' + ('000000' + (n >>> 0).toString(16)).slice(-6);
    // Plaster body.
    ctx.fillStyle = hex(WORLD.WALL_COLOR);
    ctx.fillRect(0, 0, W, H);
    // Faint stucco speckle (deterministic so the cache is stable; no Math.random).
    let seed = 0x1234567;
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 900; i++) {
      const a = 0.05 + rnd() * 0.06;
      ctx.fillStyle = (rnd() > 0.5) ? `rgba(255,255,255,${a})` : `rgba(80,66,44,${a})`;
      ctx.fillRect(rnd() * W, rnd() * H, 1, 1);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    _wallTex = tex;
    return tex;
  }

  // A translucent glass pane for a carved window opening. The panes are mostly
  // clear (low-alpha tint) so you can see the interior through the wall hole,
  // with an opaque frame + mullion cross so it still reads as a window. Caller
  // positions/orients it in the hole.
  function _makeWindowGlass() {
    const THREE = window.THREE;
    if (!THREE || !THREE.CanvasTexture) return null;
    const S = 128;
    const canvas = document.createElement('canvas');
    canvas.width = S; canvas.height = S;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, S, S);                      // start fully transparent
    // Faint glass tint + a soft sheen across the top so it reads as glass.
    ctx.fillStyle = 'rgba(200,222,240,0.12)';
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, 0, S, S * 0.42);
    // Opaque frame + mullion cross.
    ctx.fillStyle = '#6e5a3a';
    const fr = 8;
    ctx.fillRect(0, 0, S, fr); ctx.fillRect(0, S - fr, S, fr);
    ctx.fillRect(0, 0, fr, S); ctx.fillRect(S - fr, 0, fr, S);
    ctx.fillRect(S / 2 - 3, 0, 6, S); ctx.fillRect(0, S / 2 - 3, S, 6);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    return new THREE.Mesh(new THREE.PlaneGeometry(WORLD.WINDOW_W, WORLD.WINDOW_H), mat);
  }

  // A small lamp beside a doorway: a thin post, an emissive head, and a soft
  // additive glow sprite so it reads as glowing in the fog. Intentionally uses
  // NO real PointLight — one dynamic light per doorway would wreck framerate and
  // the single-shadow budget; the emissive head + sprite fake it cheaply.
  function _makeLamp(x, z) {
    const THREE = window.THREE;
    if (!THREE) return null;
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
      new THREE.MeshBasicMaterial({ color: WORLD.LAMP_COLOR })
    );
    head.position.set(x, postH + 0.12, z);
    group.add(head);
    if (THREE.CanvasTexture && THREE.Sprite) {
      const S = 64;
      const canvas = document.createElement('canvas');
      canvas.width = S; canvas.height = S;
      const ctx = canvas.getContext('2d');
      const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      grad.addColorStop(0, 'rgba(255,217,138,0.9)');
      grad.addColorStop(1, 'rgba(255,217,138,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, S, S);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
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
        if (m.map && m.map !== _wallTex) m.map.dispose();
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

  function _projectAnchor(anchor) {
    if (!_camera || !_viewport) return null;
    const v = anchor.clone().project(_camera);
    if (v.z > 1) return null;            // behind camera
    return {
      x: (v.x * 0.5 + 0.5) * _viewport.clientWidth,
      y: (-v.y * 0.5 + 0.5) * _viewport.clientHeight,
      depth: v.z
    };
  }

  function _placeHudEl(el, anchor, yOffset) {
    const a = anchor.clone();
    if (typeof yOffset === 'number') a.y += yOffset;
    const p = _projectAnchor(a);
    if (!p) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.transform = `translate(-50%, -100%) translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
  }

  function _tickHUD(now) {
    if (_mode !== 'world' || !_hudLayer) return;

    // Active-node "click to view" prompt — re-evaluate nearest node.
    let nearest = null, nearestDist = Infinity;
    const px = _player.position.x, pz = _player.position.z;
    for (const node of _worldNodes.values()) {
      const dx = node.mesh.position.x - px;
      const dz = node.mesh.position.z - pz;
      const d = Math.hypot(dx, dz);
      if (d < nearestDist) { nearest = node; nearestDist = d; }
    }
    if (nearest && nearestDist <= WORLD.PROXIMITY) {
      if (_activeNode !== nearest.project) {
        _activeNode = nearest.project;
        if (!_activePromptEl) {
          _activePromptEl = document.createElement('div');
          _activePromptEl.className = 'pg3d-prompt';
          _activePromptEl.addEventListener('click', _openActiveNode);
          _hudLayer.appendChild(_activePromptEl);
        }
        _activePromptEl.innerHTML = `📺 Click to view <em></em>`;
        _activePromptEl.querySelector('em').textContent = nearest.project.title || nearest.project.id;
      }
      _placeHudEl(_activePromptEl, nearest.anchor, 0.6);
    } else {
      _activeNode = null;
      if (_activePromptEl) _activePromptEl.style.display = 'none';
    }

    // Remote-player tags + bubbles. _hudAnchor is module-scoped and reused
    // each frame to avoid per-tick GC churn — set() instead of new.
    for (const rp of _remotePlayers.values()) {
      const headY = 1.6;     // approx top-of-head Y in local rig space
      _hudAnchor.set(rp.rig.position.x, headY + 0.4, rp.rig.position.z);
      if (rp.nameEl) _placeHudEl(rp.nameEl, _hudAnchor, 0);
      let stack = 0.4;
      for (const b of rp.bubbleEls) {
        stack += 0.5;
        _placeHudEl(b, _hudAnchor, stack);
      }
    }

    // NPC hero tags — float above each NPC's (build-scaled) head.
    for (const npc of _npcs) {
      _hudAnchor.set(npc.x, npc.headY, npc.z);
      if (npc.nameEl) _placeHudEl(npc.nameEl, _hudAnchor, 0);
    }
  }

  function _openActiveNode() {
    if (!_activeNode) return;
    if (_projectClickHandler) _projectClickHandler(_activeNode);
    else if (typeof showPopup === 'function') showPopup(_activeNode);
  }

  // ── local NPCs (Avengers patrolling their debut nodes) ──
  // Purely client-side wanderers — deliberately kept OUT of _remotePlayers so
  // they never register as network or voice peers. They reuse the rig builder,
  // the walk-cycle math, _isInWalkable, and the HUD projection helpers.

  const NPC_SPEED = 1.5;     // world units / sec — a leisurely stroll
  const NPC_TURN  = 0.5;     // radians to steer per blocked sub-step (hug the ring)

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
      // Start on the SQUARE apron ring at a deterministic per-hero angle so
      // heroes sharing a node (Thor + Hawkeye at thor1) don't stack. The apron
      // is axis-aligned, so scale the polar radius by 1/max(|cos|,|sin|) to land
      // at a fixed Chebyshev distance (≈7) — squarely on the ring, off the poster.
      const angle0 = _hashAngle(spec.id);
      const m0 = Math.max(Math.abs(Math.cos(angle0)), Math.abs(Math.sin(angle0))) || 1;
      const r0 = 7.0 / m0;
      const x = homeX + Math.cos(angle0) * r0;
      const z = homeZ + Math.sin(angle0) * r0;
      const dir = (_hashAngle(spec.id + 'd') > Math.PI) ? 1 : -1;
      const heading = angle0 + dir * Math.PI / 2;   // tangent → start strolling around the ring
      rig.position.set(x, 0, z);
      rig.rotation.y = heading;
      _scene.add(rig);

      const nameEl = document.createElement('div');
      nameEl.className = 'pg3d-nametag pg3d-npc-nametag';
      nameEl.textContent = spec.name || '';
      if (_hudLayer) _hudLayer.appendChild(nameEl);

      const bScale = (rig.scale && rig.scale.y) || 1;   // taller builds → higher tag
      _npcs.push({
        id: spec.id, name: spec.name, rig, nameEl,
        homeX, homeZ, x, z, yaw: heading, heading, dir,
        stepClock: 0, walking: false, pauseUntil: 0,
        headY: 2.05 * bScale + 0.3
      });
    }
  }

  // Deterministic angle [0, 2π) from a string — keeps a hero's start angle and
  // patrol direction stable across rebuilds (no spawn-time Math.random jump).
  function _hashAngle(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return ((Math.abs(h) % 360) / 360) * Math.PI * 2;
  }

  // Can an NPC stand at (x,z)? It must be on legal ground (_isInWalkable),
  // OUTSIDE its home node's poster footprint, and still within that node's
  // apron band — this confines each hero to a ring around its own building
  // (never on the poster, never wandering off down the roads).
  function _npcCanStand(x, z, npc) {
    const cheb = Math.max(Math.abs(x - npc.homeX), Math.abs(z - npc.homeZ));
    const inner = WORLD.PLATFORM_W / 2 + 0.3;                        // just outside the poster
    const outer = (WORLD.PLATFORM_W + WORLD.APRON_MARGIN) / 2 - 0.2; // just inside the apron edge
    if (cheb < inner || cheb > outer) return false;
    return _isInWalkable(x, z);
  }

  function _tickNpcs(dt, now) {
    if (!_npcs.length) return;
    for (const npc of _npcs) {
      const bones = npc.rig.userData.bones;
      const dampIdle = () => {
        if (!bones) return;
        const k = Math.min(1, dt * 8);
        bones.leftLeg.rotation.x  *= 1 - k;
        bones.rightLeg.rotation.x *= 1 - k;
        bones.leftArm.rotation.x  *= 1 - k;
        bones.rightArm.rotation.x *= 1 - k;
        bones.body.position.y *= 1 - k;
      };

      // Paused — stand still, relax limbs to idle.
      if (now < npc.pauseUntil) { npc.walking = false; dampIdle(); continue; }

      // Walk forward; if the next step would leave the apron ring, steer a
      // consistent way and retry so the hero hugs the ring edge. Rig forward is
      // (sin yaw, cos yaw) — matches the engine's atan2(dirX,dirZ) yaw.
      const stepLen = NPC_SPEED * dt;
      let moved = false;
      for (let tries = 0; tries < 7; tries++) {
        const nx = npc.x + Math.sin(npc.heading) * stepLen;
        const nz = npc.z + Math.cos(npc.heading) * stepLen;
        if (_npcCanStand(nx, nz, npc)) {
          npc.x = nx; npc.z = nz;
          npc.heading += (Math.random() - 0.5) * 0.15;   // gentle organic wander
          moved = true;
          break;
        }
        npc.heading += NPC_TURN * npc.dir;               // turn to follow the boundary
      }

      if (!moved) {
        // Boxed in (shouldn't happen on a continuous ring) — reverse + pause.
        npc.dir = -npc.dir;
        npc.walking = false;
        npc.pauseUntil = now + 500 + Math.random() * 800;
        dampIdle();
        continue;
      }

      // Occasional idle pause so they don't pace forever.
      if (Math.random() < 0.0015) { npc.pauseUntil = now + 1500 + Math.random() * 2500; }

      npc.walking = true;
      npc.yaw = npc.heading;
      npc.rig.position.set(npc.x, 0, npc.z);
      npc.rig.rotation.y = npc.yaw;

      // Walk-cycle swing — identical formula to the player / remote players.
      npc.stepClock += dt;
      const phase = (npc.stepClock / PHYSICS.STEP_PERIOD) * Math.PI * 2;
      const swing = Math.sin(phase) * 0.6;
      if (bones) {
        bones.leftLeg.rotation.x = swing;
        bones.rightLeg.rotation.x = -swing;
        bones.leftArm.rotation.x = -swing * 0.7;
        bones.rightArm.rotation.x = swing * 0.7;
        bones.body.position.y = Math.abs(Math.sin(phase)) * 0.04;
      }
    }
  }

  function _clearNpcs() {
    for (const npc of _npcs) {
      if (npc.rig && npc.rig.parent) npc.rig.parent.remove(npc.rig);
      if (npc.rig) _disposeRig(npc.rig);
      if (npc.nameEl && npc.nameEl.parentNode) npc.nameEl.parentNode.removeChild(npc.nameEl);
    }
    _npcs.length = 0;
  }

  // ── remote player API ──

  function addRemotePlayer(id, character, username, x, z, yaw, y) {
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
      target: { x: x || 0, y: y || 0, z: z || 0, yaw: yaw || 0, walking: false },
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

  function updateRemotePlayer(id, x, z, yaw, walking, y) {
    const rp = _remotePlayers.get(id);
    if (!rp) return;
    rp.target.x = x;
    rp.target.z = z;
    rp.target.y = (typeof y === 'number' && Number.isFinite(y)) ? y : 0;
    rp.target.yaw = yaw;
    rp.target.walking = !!walking;
  }

  function removeRemotePlayer(id) {
    const rp = _remotePlayers.get(id);
    if (!rp) return;
    if (rp.rig.parent) rp.rig.parent.remove(rp.rig);
    rp.rig.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      }
    });
    if (rp.nameEl && rp.nameEl.parentNode) rp.nameEl.parentNode.removeChild(rp.nameEl);
    for (const b of rp.bubbleEls) if (b.parentNode) b.parentNode.removeChild(b);
    _remotePlayers.delete(id);
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
      if (!el.parentNode) return;
      el.classList.add('fading');
      setTimeout(() => {
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

  // Push a remote player's current fade level onto its rig materials and HUD.
  // Skips redundant work when the level hasn't changed since last applied.
  function _applyRemoteOpacity(rp) {
    if (rp.opacity === rp.appliedOpacity) return;
    rp.appliedOpacity = rp.opacity;
    const o = rp.opacity;
    const vis = o > 0.02;
    rp.rig.visible = vis;
    if (vis) {
      rp.rig.traverse(m => {
        if (!m.material) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach(mat => { mat.transparent = true; mat.opacity = o; });
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
      const visTarget = (_mode === 'world' && !_isInWalkable(rp.current.x, rp.current.z)) ? 0 : 1;
      const fadeK = Math.min(1, dt * WORLD.FADE_RATE);
      rp.opacity += (visTarget - rp.opacity) * fadeK;
      if (Math.abs(rp.opacity - visTarget) < 0.01) rp.opacity = visTarget;
      _applyRemoteOpacity(rp);

      const bones = rp.rig.userData.bones;
      if (!bones) continue;
      if (rp.target.walking) {
        rp.stepClock += dt;
        const phase = (rp.stepClock / PHYSICS.STEP_PERIOD) * Math.PI * 2;
        const swing = Math.sin(phase) * 0.6;
        bones.leftLeg.rotation.x = swing;
        bones.rightLeg.rotation.x = -swing;
        bones.leftArm.rotation.x = -swing * 0.7;
        bones.rightArm.rotation.x = swing * 0.7;
        bones.body.position.y = Math.abs(Math.sin(phase)) * 0.04;
      } else {
        rp.stepClock = 0;
        const damp = Math.min(1, dt * 8);
        bones.leftLeg.rotation.x  *= 1 - damp;
        bones.rightLeg.rotation.x *= 1 - damp;
        bones.leftArm.rotation.x  *= 1 - damp;
        bones.rightArm.rotation.x *= 1 - damp;
        bones.body.position.y *= 1 - damp;
      }
      // Wave emote — overrides right arm pose while active.
      if (rp.emoteUntil > now && bones.rightArm) {
        const t = (now - (rp.emoteUntil - WORLD.EMOTE_DURATION_MS)) / 200;
        bones.rightArm.rotation.x = -Math.PI * 0.9;
        bones.rightArm.rotation.z = Math.sin(t) * 0.4;
      } else if (bones.rightArm) {
        bones.rightArm.rotation.z = 0;
      }
    }
  }

  // ── public world-only getters / actions ──

  function getLocalState() {
    if (!_player) return null;
    return {
      x: _player.position.x,
      y: _player.position.y,
      z: _player.position.z,
      yaw: _player.rotation.y,
      // Walking = local stepClock advanced recently (set in the main tick).
      walking: !!_localWalking
    };
  }

  function getActiveNode() { return _activeNode; }
  function setProjectClickHandler(fn) { _projectClickHandler = fn; }

  // ── standalone 3D preview ──
  //
  // Self-contained mini-renderer for the character builder modal. Owns its
  // own WebGL renderer, scene, camera, lights, RAF loop and a single rig
  // group — does NOT touch any module-level engine state, so it can run
  // simultaneously with the main /home or /world scene without conflict.
  function createPreview(container, character) {
    let renderer = null, scene = null, camera = null;
    let rig = null, rotGroup = null, rafId = null;
    let dragging = false, lastX = 0, yaw = 0;
    const autoYawVel = 0.4; // rad/s when not being dragged
    let alive = false;
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
        renderer.render(scene, camera);
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    }

    function _attachPointer() {
      const el = renderer.domElement;
      const onDown = (e) => {
        dragging = true;
        lastX = e.clientX;
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        el.style.cursor = 'grabbing';
        e.preventDefault();
      };
      const onMove = (e) => {
        if (!dragging) return;
        yaw += (e.clientX - lastX) * 0.012;
        lastX = e.clientX;
      };
      const onUp = (e) => {
        if (!dragging) return;
        dragging = false;
        el.style.cursor = 'grab';
        try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      };
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      el.addEventListener('pointerleave', onUp);
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
    }

    function destroy() {
      alive = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
      if (rig && rotGroup) { rotGroup.remove(rig); _disposeRig(rig); }
      if (scene) _disposeRig(scene);
      if (renderer) {
        renderer.dispose();
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

    return { setCharacter, destroy };
  }

  return {
    init, initWorld, destroy, setCharacter, defaultCharacter, createPreview,
    // World/multiplayer surface — no-ops in home mode.
    addRemotePlayer, updateRemotePlayer, removeRemotePlayer,
    showRemoteChat, playRemoteEmote, playLocalEmote,
    getLocalState, getActiveNode, setProjectClickHandler,
    // Local NPC surface — Avenger wanderers in /world.
    setWorldNpcs,
    // Voice-chat surface — distance attenuation + speaking indicator.
    getRemotePlayers, setRemotePlayerSpeaking
  };
})();
