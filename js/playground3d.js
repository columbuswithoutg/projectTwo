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

  // ── public API ──

  function init(container, character, layout) {
    _container = container;
    _currentChar = character || defaultCharacter();
    _layout = (layout && Array.isArray(layout.rooms)) ? layout : { rooms: [] };
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
    cam.left = -32; cam.right = 32; cam.top = 32; cam.bottom = -32;
    cam.near = 0.5; cam.far = 80;
    _scene.add(sun);

    _walls = [];
    _buildLayoutScene();

    // Player.
    _player = _buildPlayer(_currentChar);
    const spawn = _layoutSpawn();
    _player.position.set(spawn.x, 0, spawn.z);
    _scene.add(_player);

    // Camera.
    _camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
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
      foot.position.set(0, -LEG_LEN - FOOT_H / 2 + 0.02, 0.05);
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
    root.userData.bones = {
      body, head, torso, leftArm, rightArm, leftLeg, rightLeg
    };
    _rig = root.userData.bones;
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
    const onKeyUp   = e => onKey(e, false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Mouse-drag to orbit camera; wheel to zoom.
    let mouseDragging = false;
    let lastMouse = { x: 0, y: 0 };
    function onMouseDown(e) {
      if (e.button !== 0) return;
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

    if ('ontouchstart' in window) {
      joyEl = document.createElement('div');
      joyEl.className = 'pg-joy';
      stickEl = document.createElement('div');
      stickEl.className = 'pg-joy-stick';
      joyEl.appendChild(stickEl);
      viewport.appendChild(joyEl);
    }

    function joyStart(t) {
      activeJoyTouchId = t.identifier;
      joyActive = true;
      const rect = joyEl.getBoundingClientRect();
      joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      joyRadius = rect.width / 2;
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
    }

    function onTouchStart(e) {
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
    if (joyEl) {
      viewport.addEventListener('touchstart', onTouchStart, { passive: false });
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd);
      window.addEventListener('touchcancel', onTouchEnd);
    }

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

    function detach() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      viewport.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      viewport.removeEventListener('wheel', onWheel);
      if (joyEl) {
        viewport.removeEventListener('touchstart', onTouchStart);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
        window.removeEventListener('touchcancel', onTouchEnd);
      }
    }

    return { getAxis, isOrbiting, detach };
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

    _updateCamera();
    _renderer.render(_scene, _camera);
    _rafId = requestAnimationFrame(_tick);
  }

  function _moveWithCollision(dx, dz) {
    const r = PHYSICS.PLAYER_RADIUS;
    let x = _player.position.x + dx;
    let z = _player.position.z + dz;
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

  return { init, destroy, setCharacter, defaultCharacter };
})();
