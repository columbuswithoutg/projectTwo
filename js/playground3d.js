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
    DEFAULT_ELEV: 0.45,           // radians above horizon
    MIN_ELEV: 0.05,
    MAX_ELEV: 1.30,
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
    EMOTE_DURATION_MS: 1500,
    GROUND_COLOR: 0x2a3a2e,
    ROAD_COLOR: 0xc9a04f,
    // Wall fence around each platform — character-height (1.8u) so the
    // top-down camera still sees over them but you can't walk off the
    // platform anywhere except through a doorway that lines up with a
    // connecting road.
    WALL_HEIGHT: 1.8,
    WALL_THICKNESS: 0.3,
    WALL_COLOR: 0xa68a4d,
    DOORWAY_WIDTH: 4.0            // wide enough for the player with margin
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
  let _worldNodes = new Map();    // projectId → { mesh, project, anchor: Vector3, labelEl }
  let _worldRoads = new Map();    // "a→b" key (sorted) → mesh
  let _remotePlayers = new Map(); // socketId → { rig, target:{x,z,yaw,walking}, current, nameEl, bubbleEls[], emoteUntil }
  let _worldStateUnsub = null;
  let _activeNode = null;          // project currently within PROXIMITY
  let _activePromptEl = null;
  let _localEmoteUntil = 0;        // ms timestamp; while > now, override right-arm pose
  let _projectClickHandler = null; // set by view to handle prompt clicks
  let _localWalking = false;       // set each tick; read by getLocalState() for MP broadcast
  let _walkableRoads = [];         // [{ cx, cz, cos, sin, halfW, halfL }] for point-in-rotated-rect tests
  let _velY = 0;                   // vertical velocity for jump physics

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
    if (_scene) _scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
    // World-mode cleanup.
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
    return { skin: 0, hairStyle: 0, hairColor: 0, shirtColor: 1, pantsColor: 0 };
  }

  // ── init ──

  function _initInternal() {
    const THREE = window.THREE;
    _running = true;

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
    _scene.background = new THREE.Color(SKY_COLOR);

    // Lighting — hemisphere fill + directional sun.
    const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x4a4030, 0.55);
    _scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
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
      elevation: CAMERA.DEFAULT_ELEV,
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
    const loader = new THREE.TextureLoader();

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
        loader.load(imgUrl, (tex) => {
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

  function _buildPlayer(c) {
    const THREE = window.THREE;
    const skinHex = _palette('SKIN_TONES', c.skin);
    const shirtHex = _palette('SHIRT_COLORS', c.shirtColor);
    const pantsHex = _palette('PANTS_COLORS', c.pantsColor);
    const hairHex = _palette('HAIR_COLORS', c.hairColor);
    const styleIdx = c.hairStyle ?? 0;

    const skinMat  = new THREE.MeshLambertMaterial({ color: skinHex });
    const shirtMat = new THREE.MeshLambertMaterial({ color: shirtHex });
    const pantsMat = new THREE.MeshLambertMaterial({ color: pantsHex });
    const hairMat  = new THREE.MeshLambertMaterial({ color: hairHex });
    const shoeMat  = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const eyeMat   = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });

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
    const LEG_W = 0.32;
    const LEG_D = 0.32;
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
    const leftLeg = mkLeg(-0.18);
    const rightLeg = mkLeg(0.18);
    body.add(leftLeg);
    body.add(rightLeg);

    // Torso.
    const TORSO_W = 0.85, TORSO_H = 0.75, TORSO_D = 0.45;
    const torso = mkBox(TORSO_W, TORSO_H, TORSO_D, shirtMat);
    torso.position.y = HIP_Y + TORSO_H / 2;
    body.add(torso);

    // Arms (pivot at the shoulder, hangs down).
    const SHOULDER_Y = HIP_Y + TORSO_H - 0.05;
    const ARM_LEN = 0.7;
    const ARM_W = 0.22, ARM_D = 0.22;

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
    // Eyes — flat black squares on the front face (positive Z is "front").
    const eyeGeom = new THREE.BoxGeometry(0.06, 0.06, 0.02);
    const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
    leftEye.position.set(-0.12, 0.04, HEAD_SZ / 2 + 0.001);
    head.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
    rightEye.position.set(0.12, 0.04, HEAD_SZ / 2 + 0.001);
    head.add(rightEye);
    // Mouth — small dark bar.
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), eyeMat);
    mouth.position.set(0, -0.12, HEAD_SZ / 2 + 0.001);
    head.add(mouth);

    // Hair — per-style box arrangement on top of head.
    const hair = _buildHair(styleIdx, hairMat, HEAD_SZ);
    if (hair) head.add(hair);

    body.add(head);

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
    }
    return grp;
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
      _orbit.elevation = Math.max(CAMERA.MIN_ELEV,
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
        _orbit.elevation = Math.max(CAMERA.MIN_ELEV,
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
          _orbit.elevation = Math.max(CAMERA.MIN_ELEV,
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
    const loader = new THREE.TextureLoader();

    for (const p of projects) {
      if (!_isProjectUnlocked(p)) continue;
      if (_worldNodes.has(p.id)) continue;
      if (typeof p.gridX !== 'number' || typeof p.gridY !== 'number') continue;

      // Platform.
      const x = p.gridX * WORLD.SCALE;
      const z = p.gridY * WORLD.SCALE;
      const geom = new THREE.BoxGeometry(WORLD.PLATFORM_W, WORLD.PLATFORM_H, WORLD.PLATFORM_D);
      // Per-face materials so only the top face shows the poster.
      const side = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
      const top  = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const url = (typeof CONFIG !== 'undefined' && CONFIG.IMAGE_BASE && p.image)
        ? `${CONFIG.IMAGE_BASE}${p.image}` : '';
      if (url) {
        loader.load(url, (tex) => { top.map = tex; top.needsUpdate = true; });
      }
      // BoxGeometry material slots: +x, -x, +y(top), -y(bottom), +z, -z
      const mats = [side, side, top, side, side, side];
      const mesh = new THREE.Mesh(geom, mats);
      mesh.position.set(x, WORLD.PLATFORM_RAISE, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.projectId = p.id;
      _scene.add(mesh);

      // HUD label for the platform — title above it. The label itself is
      // managed through the HUD-projection tick; we just create the element.
      const labelEl = document.createElement('div');
      labelEl.className = 'pg3d-nodelabel';
      labelEl.textContent = p.title || p.id;
      _hudLayer.appendChild(labelEl);

      const anchor = new THREE.Vector3(x, WORLD.PLATFORM_RAISE + WORLD.PLATFORM_H / 2 + 1.6, z);
      const node = { mesh, project: p, anchor, labelEl, walls: [] };
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

    const connections = _getConnectedNodes(node.project.id);
    // A node with no current connections (e.g. the spawn node before its
    // first prereq is watched) gets no walls so the player isn't trapped
    // inside the platform with no doorway out.
    if (connections.length === 0) return;

    const sides = { N: [], S: [], E: [], W: [] };
    for (const other of connections) {
      const { side, coord } = _doorwayOnSide(node, other);
      sides[side].push(coord);
    }

    const cx = node.mesh.position.x, cz = node.mesh.position.z;
    const HALF = WORLD.PLATFORM_W / 2;
    const T = WORLD.WALL_THICKNESS;
    const H = WORLD.WALL_HEIGHT;
    const D = WORLD.DOORWAY_WIDTH;
    const wallY = WORLD.PLATFORM_RAISE + WORLD.PLATFORM_H / 2 + H / 2;

    // For each side, compute wall segments around its doorway gaps and
    // build a thin box per segment. Walls are inset by T/2 so they sit
    // visibly ON the platform rather than at its edge.
    function buildSide(sideName, axisStart, axisEnd, fixed, horizontal) {
      const sorted = [...sides[sideName]].sort((a, b) => a - b);
      // Compute segments between gaps.
      let segs = [], cursor = axisStart;
      for (const dCenter of sorted) {
        const dStart = Math.max(axisStart, dCenter - D / 2);
        const dEnd   = Math.min(axisEnd,   dCenter + D / 2);
        if (dStart > cursor + 0.05) segs.push([cursor, dStart]);
        cursor = Math.max(cursor, dEnd);
      }
      if (cursor < axisEnd - 0.05) segs.push([cursor, axisEnd]);

      for (const [s, e] of segs) {
        const len = e - s;
        if (len <= 0.1) continue;
        let mx, mz, sx, sz;
        if (horizontal) {
          mx = (s + e) / 2;
          mz = (sideName === 'N') ? (fixed + T / 2) : (fixed - T / 2);
          sx = len; sz = T;
        } else {
          mz = (s + e) / 2;
          mx = (sideName === 'W') ? (fixed + T / 2) : (fixed - T / 2);
          sx = T; sz = len;
        }
        const geom = new THREE.BoxGeometry(sx, H, sz);
        const mat = new THREE.MeshLambertMaterial({ color: WORLD.WALL_COLOR });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(mx, wallY, mz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        _scene.add(mesh);
        const aabb = {
          minX: mx - sx / 2, maxX: mx + sx / 2,
          minZ: mz - sz / 2, maxZ: mz + sz / 2
        };
        _walls.push(aabb);
        node.walls.push({ mesh, aabb });
      }
    }

    buildSide('N', cx - HALF, cx + HALF, cz - HALF, true);
    buildSide('S', cx - HALF, cx + HALF, cz + HALF, true);
    buildSide('W', cz - HALF, cz + HALF, cx - HALF, false);
    buildSide('E', cz - HALF, cz + HALF, cx + HALF, false);
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
    // Node platforms (axis-aligned).
    const halfP = WORLD.PLATFORM_W / 2;
    for (const node of _worldNodes.values()) {
      const dx = x - node.mesh.position.x;
      const dz = z - node.mesh.position.z;
      if (Math.abs(dx) <= halfP && Math.abs(dz) <= halfP) return true;
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

    // Node title labels.
    for (const node of _worldNodes.values()) {
      _placeHudEl(node.labelEl, node.anchor, 0);
    }

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

    // Remote-player tags + bubbles.
    for (const rp of _remotePlayers.values()) {
      const headY = 1.6;     // approx top-of-head Y in local rig space
      const anchor = new THREE.Vector3(rp.rig.position.x, headY + 0.4, rp.rig.position.z);
      if (rp.nameEl) _placeHudEl(rp.nameEl, anchor, 0);
      let stack = 0.4;
      for (const b of rp.bubbleEls) {
        stack += 0.5;
        _placeHudEl(b, anchor, stack);
      }
    }
  }

  function _openActiveNode() {
    if (!_activeNode) return;
    if (_projectClickHandler) _projectClickHandler(_activeNode);
    else if (typeof showPopup === 'function') showPopup(_activeNode);
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
      bubbleEls: [],
      emoteUntil: 0
    });
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

  return {
    init, initWorld, destroy, setCharacter, defaultCharacter,
    // World/multiplayer surface — no-ops in home mode.
    addRemotePlayer, updateRemotePlayer, removeRemotePlayer,
    showRemoteChat, playRemoteEmote, playLocalEmote,
    getLocalState, getActiveNode, setProjectClickHandler
  };
})();
