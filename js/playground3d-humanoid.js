/************************************************
 * PLAYGROUND3D HUMANOID — realistic rigged characters (glTF)
 *
 * Loads the CC0 Quaternius bodies/hair/animations built by
 * scripts/build-humanoid-assets.mjs and turns a character description into
 * an animated, tinted, body-shaped instance.
 *
 *   PG3DHumanoid.preload() → Promise          (idempotent)
 *   PG3DHumanoid.createInstance(look) → handle
 *     handle: { object, body, mixer, shape, anchors,
 *               setState(base, timeScale), play(clip, opts), update(dt),
 *               applyLook(look), setOpacity(o), dispose() }
 *
 * Body shapes (Slim…Huge, head sizes) are BAKED into a per-(model, build)
 * copy of the geometry and bind pose: every vertex is deformed by its skin
 * weights in its bones' local frames (thickness only, never length), joint
 * sockets are moved outward for wide chests/hips, and the skeleton's inverse
 * bind matrices are rebuilt. At runtime bones only rotate, so limbs never
 * shear when they bend. Variants are cached and shared by every character
 * of that body type; each instance clones only the skeleton and materials.
 * The Hulk-type's hunch is a small rotation layered on after each animation
 * update.
 *
 * Tinting: body parts come from each vertex's dominant bone (flat varying,
 * so part edges are crisp) plus how far along that bone the vertex sits, so
 * sleeves and trouser legs can end part-way down a limb (optionally ragged).
 * Skin keeps the texture's detail; cloth keeps only its shading.
 *
 * Needs window.THREE with GLTFLoader + SkeletonUtils attached, and
 * PG3DHumanoidLogic (js/playground3d-humanoid-logic.js).
 ************************************************/
(function (root) {
  'use strict';

  const L = root.PG3DHumanoidLogic;

  // Unshaped body height in world units; the build's root scale and baked
  // head size go on top. Old procedural characters topped out at ≈2.02.
  const BODY_HEIGHT = { male: 1.9, female: 1.84 };

  const PART = { head: 0, neck: 1, torso: 2, upperArm: 3, forearm: 4, hand: 5, pelvis: 6, thigh: 7, shin: 8, foot: 9 };
  const PART_COUNT = 10;

  // Animation state → clip (see PG3DHumanoidLogic.selectAnimState).
  const STATE_CLIPS = {
    idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', sprint: 'Sprint_Loop',
    jumpUp: 'Jump_Start', fall: 'Jump_Loop', land: 'Jump_Land', down: 'Death01', getup: 'Death01'
  };
  const ONE_SHOT = new Set(['jumpUp', 'land', 'down', 'getup']);

  let _status = 'idle';
  let _ready = null;
  const _protos = {};              // model → { scene, restHeight, hipsName, hipsRest, skinAvg }
  let _hair = null;                // { meshes: Map(style → SkinnedMesh), avg: Color }
  let _clipsSrc = [];
  let _animHipsRest = null;
  const _variants = new Map();     // 'model|build' → baked variant
  const _clipsByModel = new Map();
  let _lastInstance = null;        // most recently built character (debugging)

  function T() { return root.THREE; }

  // ── Loading ──

  function _load(src) {
    return new Promise((resolve, reject) => {
      const loader = new (T().GLTFLoader)();
      if (src instanceof ArrayBuffer) loader.parse(src, '', resolve, reject);
      else loader.load(src, resolve, undefined, reject);
    });
  }

  // GLTFLoader + SkeletonUtils are imported by spa.html AFTER three-ready, so a
  // caller can easily ask for characters before they exist. Wait for them
  // rather than failing — treating that race as a permanent failure left a
  // whole page stuck on the procedural rig.
  function _whenAddons() {
    if (T() && T().GLTFLoader && T().SkeletonUtils) return Promise.resolve();
    if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        window.removeEventListener('three-addons-ready', ok);
        window.removeEventListener('three-addons-failed', fail);
      };
      const ok = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error('THREE.GLTFLoader / SkeletonUtils unavailable')); };
      window.addEventListener('three-addons-ready', ok);
      window.addEventListener('three-addons-failed', fail);
    });
  }

  // opts.base: asset folder URL; opts.buffers: { male, female, hair, anims }
  // ArrayBuffers (tests / offline preview).
  function preload(opts) {
    if (_ready) return _ready;
    opts = opts || {};
    const base = opts.base || L.ASSET_BASE;
    const src = (k, file) => (opts.buffers && opts.buffers[k]) || base + file;
    _status = 'loading';
    _ready = _whenAddons().then(() => Promise.all([
      _load(src('male', L.BODY_FILES.male)),
      _load(src('female', L.BODY_FILES.female)),
      _load(src('hair', 'hair.glb')),
      _load(src('anims', 'anims.glb'))
    ])).then(([male, female, hair, anims]) => {
      _protos.male = _prepBody(male);
      _protos.female = _prepBody(female);
      _hair = _prepHair(hair);
      _prepAnims(anims);
      _status = 'ready';
    }, (err) => {
      _status = 'failed';
      console.warn('[PG3DHumanoid] load failed — characters stay procedural', err);
      throw err;
    });
    return _ready;
  }

  function _skinnedIn(obj) {
    const out = [];
    obj.traverse((o) => { if (o.isSkinnedMesh) out.push(o); });
    return out;
  }

  // Average colour of a texture, ignoring transparent and near-black texels
  // (painted underwear, atlas gutters). Used to normalise tints.
  function _texAvg(tex, fallback) {
    const c = new (T().Color)(fallback);
    const img = tex && tex.image;
    if (!img || typeof document === 'undefined') return c;
    try {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 32;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 32, 32);
      const d = ctx.getImageData(0, 0, 32, 32).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        const R = d[i] / 255, G = d[i + 1] / 255, B = d[i + 2] / 255;
        if (0.299 * R + 0.587 * G + 0.114 * B < 0.2) continue;
        r += R; g += G; b += B; n++;
      }
      if (n) c.setRGB(r / n, g / n, b / n, T().SRGBColorSpace);
    } catch (e) { /* tainted canvas etc. — keep fallback */ }
    return c;
  }

  function _prepBody(gltf) {
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const meshes = _skinnedIn(scene);
    const body = meshes.find((m) => m.name === 'Body') || meshes[0];
    // Bind-pose height from skinned vertex positions (geometry may be quantized).
    const v = new (T().Vector3)();
    let minY = Infinity, maxY = -Infinity;
    const n = body.geometry.attributes.position.count;
    for (let i = 0; i < n; i += 5) {
      body.getVertexPosition(i, v);
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    const bones = body.skeleton.bones;
    const cls = L.classifySkeleton(bones.map((b) => ({ name: b.name })));
    const hips = bones.find((b) => b.name === cls.hips);
    return {
      scene,
      restHeight: maxY - minY,
      hipsName: cls.hips,
      hipsRest: hips ? hips.position.clone() : null,
      skinAvg: _texAvg(body.material.map, 0xd8b39a)
    };
  }

  function _prepHair(gltf) {
    gltf.scene.updateMatrixWorld(true);
    const meshes = new Map();
    let avg = null;
    for (const m of _skinnedIn(gltf.scene)) {
      meshes.set(m.name, m);
      if (!avg && m.material && m.material.map) avg = _texAvg(m.material.map, 0x6b4a33);
    }
    return { meshes, avg: avg || new (T().Color)(0x6b4a33) };
  }

  function _prepAnims(gltf) {
    _clipsSrc = gltf.animations || [];
    let hipsName = null;
    gltf.scene.traverse((o) => { if (!hipsName && /^(pelvis|hips)$/i.test(o.name)) hipsName = o.name; });
    const hips = hipsName && gltf.scene.getObjectByName(hipsName);
    _animHipsRest = hips ? hips.position.clone() : null;
  }

  // Clips retargeted to one body model: only the hips keep a position track,
  // re-based from the animation rig's rest height onto this body's.
  function _clipsFor(model) {
    if (_clipsByModel.has(model)) return _clipsByModel.get(model);
    const proto = _protos[model];
    const hipsTrack = proto.hipsName + '.position';
    const out = new Map();
    for (const src of _clipsSrc) {
      const clip = src.clone();
      clip.tracks = clip.tracks.filter((t) =>
        !/\.scale$/.test(t.name) && (!/\.position$/.test(t.name) || t.name === hipsTrack));
      if (proto.hipsRest && _animHipsRest) {
        const d = proto.hipsRest.clone().sub(_animHipsRest);
        for (const t of clip.tracks) {
          if (t.name !== hipsTrack) continue;
          for (let i = 0; i < t.values.length; i += 3) {
            t.values[i] += d.x; t.values[i + 1] += d.y; t.values[i + 2] += d.z;
          }
        }
      }
      out.set(clip.name, clip);
    }
    _clipsByModel.set(model, out);
    return out;
  }

  // ── Body-shape baking ──

  function _lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  // Which local axis a bone points along (towards its first child bone).
  function _lengthAxis(bone) {
    for (let b = bone; b; b = b.parent && b.parent.isBone ? b.parent : null) {
      const child = b.children.find((c) => c.isBone);
      if (child) {
        const p = child.position;
        const a = [Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)];
        return a[0] > a[1] && a[0] > a[2] ? 0 : a[2] > a[1] ? 2 : 1;
      }
    }
    return 1;
  }

  // Canonical [width, length, depth] factors → a scale in the bone's own axes.
  function _shapeMatrix(axis, s) {
    const k = [0, 0, 0];
    k[axis] = s[1];
    const others = [0, 1, 2].filter((i) => i !== axis);
    k[others[0]] = s[0];
    k[others[1]] = s[2];
    return new (T().Matrix4)().makeScale(k[0], k[1], k[2]);
  }

  function _rigInfo(bones, shape) {
    const cls = L.classifySkeleton(bones.map((b) => ({ name: b.name })));
    const idx = new Map(bones.map((b, i) => [b.name, i]));
    const part = new Array(bones.length).fill(-1);
    const scale = bones.map(() => [1, 1, 1]);
    const P = shape.parts;
    const set = (names, p, s) => {
      for (const nm of [].concat(names || [])) {
        const i = idx.get(nm);
        if (i != null) { part[i] = p; scale[i] = s; }
      }
    };
    set(cls.hips, PART.pelvis, P.hips);
    const sp = cls.spine || [];
    sp.forEach((nm, k) => set(nm, PART.torso, _lerp3(P.spineLow, P.spineHigh, sp.length > 1 ? k / (sp.length - 1) : 1)));
    set(cls.neck, PART.neck, P.neck);
    set(cls.head, PART.head, P.head);
    for (const s of ['L', 'R']) {
      set(cls['shoulder.' + s], PART.torso, P.shoulder);
      set(cls['upperArm.' + s], PART.upperArm, P.upperArm);
      set(cls['forearm.' + s], PART.forearm, P.forearm);
      set(cls['hand.' + s], PART.hand, P.hand);
      set(cls['thigh.' + s], PART.thigh, P.thigh);
      set(cls['shin.' + s], PART.shin, P.shin);
      set(cls['foot.' + s], PART.foot, P.foot);
      set(cls['toe.' + s], PART.foot, P.foot);
    }
    // Fingers, leaf helpers, root: inherit from the nearest classified ancestor
    // (fingers thicken with the hand but keep their length).
    for (let i = 0; i < bones.length; i++) {
      if (part[i] >= 0) continue;
      let j = -1;
      for (let b = bones[i].parent; b; b = b.parent) {
        const k = idx.get(b.name);
        if (k != null && part[k] >= 0) { j = k; break; }
      }
      if (j < 0) { part[i] = PART.pelvis; continue; }
      part[i] = part[j];
      scale[i] = part[j] === PART.hand ? [P.hand[0], 1, P.hand[2]] : scale[j];
    }
    const axis = bones.map(_lengthAxis);
    // Signed distance to the child joint along that axis — normalises each
    // vertex's position along its bone (0 at this joint, 1 at the next) so
    // sleeves and trouser legs can end part-way down a limb.
    const reach = bones.map((b, i) => {
      const child = b.children.find((c) => c.isBone);
      return child ? child.position.getComponent(axis[i]) : 0;
    });
    return { cls, idx, part, scale, axis, reach };
  }

  // Move a bone's rest position sideways (world X, the model is symmetric about
  // x=0 in bind space) — widens shoulder/hip sockets for broad builds.
  function _shiftLateral(bone, factor) {
    if (!bone || !bone.parent || factor === 1) return;
    const w = bone.getWorldPosition(new (T().Vector3)());
    w.x *= factor;
    bone.position.copy(bone.parent.worldToLocal(w));
  }

  // New skinned geometry in bind-space world coordinates:
  //   p' = Σ w_j · (W'_j · S_j) · boneInverse_j · bindMatrix · p
  // A = per-variant-bone W'·S; byName maps this mesh's joints → variant bones.
  function _bakeGeometry(mesh, byName, A, rig) {
    const THREE = T();
    const src = mesh.geometry;
    const sk = mesh.skeleton;
    // GLTFLoader de-duplicates repeated node names with a numeric suffix
    // (hair.glb holds one skeleton copy per style: root, root_1, spine_01_2…).
    // Try the exact name first — real bone names like spine_01 end in digits too.
    const jointMap = sk.bones.map((b) => {
      let i = byName.get(b.name);
      if (i == null) i = byName.get(b.name.replace(/_\d+$/, ''));
      if (i == null) throw new Error(`[PG3DHumanoid] joint "${b.name}" not in body skeleton`);
      return i;
    });
    const M = sk.boneInverses.map((inv, j) => A[jointMap[j]].clone().multiply(inv).multiply(mesh.bindMatrix));
    const N = M.map((m) => new THREE.Matrix3().getNormalMatrix(m));
    const Lm = sk.boneInverses.map((inv) => inv.clone().multiply(mesh.bindMatrix));   // → original bone-local
    const pos = src.attributes.position, nor = src.attributes.normal;
    const si = src.attributes.skinIndex, sw = src.attributes.skinWeight;
    const n = pos.count;
    const outP = new Float32Array(n * 3);
    const outN = nor ? new Float32Array(n * 3) : null;
    const outI = new Uint16Array(n * 4);
    const outPart = new Float32Array(n);
    const outAlong = new Float32Array(n);
    const outHeight = new Float32Array(n);
    const v = new THREE.Vector3(), nv = new THREE.Vector3(), t = new THREE.Vector3();
    const acc = new THREE.Vector3(), accN = new THREE.Vector3();
    const W = [0, 0, 0, 0], J = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i);
      if (nor) nv.fromBufferAttribute(nor, i);
      W[0] = sw.getX(i); W[1] = sw.getY(i); W[2] = sw.getZ(i); W[3] = sw.getW(i);
      J[0] = si.getX(i); J[1] = si.getY(i); J[2] = si.getZ(i); J[3] = si.getW(i);
      const wsum = W[0] + W[1] + W[2] + W[3] || 1;
      acc.set(0, 0, 0); accN.set(0, 0, 0);
      let best = J[0], bestW = -1;
      for (let k = 0; k < 4; k++) {
        const w = W[k] / wsum;
        if (w <= 0) continue;
        const j = J[k];
        acc.addScaledVector(t.copy(v).applyMatrix4(M[j]), w);
        if (nor) accN.addScaledVector(t.copy(nv).applyMatrix3(N[j]), w);
        if (w > bestW) { bestW = w; best = j; }
      }
      outP[i * 3] = acc.x; outP[i * 3 + 1] = acc.y; outP[i * 3 + 2] = acc.z;
      outHeight[i] = acc.y;
      if (nor) { accN.normalize(); outN[i * 3] = accN.x; outN[i * 3 + 1] = accN.y; outN[i * 3 + 2] = accN.z; }
      for (let k = 0; k < 4; k++) outI[i * 4 + k] = W[k] > 0 ? jointMap[J[k]] : 0;
      const bi = jointMap[best];
      outPart[i] = rig.part[bi];
      const r = rig.reach[bi];
      outAlong[i] = r ? t.copy(v).applyMatrix4(Lm[best]).getComponent(rig.axis[bi]) / r : 0;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(outP, 3));
    if (outN) g.setAttribute('normal', new THREE.BufferAttribute(outN, 3));
    // Carry everything else over unchanged — uv(s) and, importantly, COLOR_0:
    // the bodies ship vertex colours (material.vertexColors = true), and a
    // missing colour attribute renders the whole mesh black.
    for (const [name, attr] of Object.entries(src.attributes)) {
      if (!/^(position|normal|skinIndex|skinWeight)$/.test(name)) g.setAttribute(name, attr);
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(outI, 4));
    g.setAttribute('skinWeight', sw);
    g.setAttribute('aPart', new THREE.BufferAttribute(outPart, 1));
    g.setAttribute('aAlong', new THREE.BufferAttribute(outAlong, 1));
    g.setAttribute('aHeight', new THREE.BufferAttribute(outHeight, 1));   // bind-pose height (waistline)
    if (src.index) g.setIndex(src.index);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.userData.shared = true;
    return g;
  }

  // Posture offsets (radians, from bodyShapeFor().posture) as constant
  // quaternions: pitch about the body's lateral axis and shrug/splay about its
  // forward axis, expressed in each bone's PARENT rest frame and applied with
  // premultiply(). In the bone's own frame the offset would follow the bone —
  // once a punch swings the upper arm ~90° it becomes a twist along the arm.
  // Sitting: thighs swung forward to horizontal, shins hanging from the knee,
  // arms resting a little forward. Same parent-rest-frame construction as
  // _postureOffsets so the offsets stay knee/hip hinges whatever the clip does.
  function _sitOffsets(bones, rig) {
    const THREE = T();
    const out = [];
    const X = new THREE.Vector3(1, 0, 0);
    const add = (key, angle) => {
      const nm = rig.cls[key] && rig.cls[key][0];
      const i = nm != null ? rig.idx.get(nm) : null;
      if (i == null) return;
      const parent = bones[i].parent;
      const inv = (parent ? parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion()).invert();
      const ax = X.clone().applyQuaternion(inv).normalize();
      out.push({ name: nm, q: new THREE.Quaternion().setFromAxisAngle(ax, angle) });
    };
    add('thigh.L', -Math.PI / 2); add('thigh.R', -Math.PI / 2);
    add('shin.L', Math.PI / 2);   add('shin.R', Math.PI / 2);
    add('upperArm.L', -0.3);      add('upperArm.R', -0.3);
    add('forearm.L', -0.5);       add('forearm.R', -0.5);
    return out;
  }

  function _postureOffsets(bones, rig, posture) {
    const THREE = T();
    const out = [];
    if (!posture) return out;
    const X = new THREE.Vector3(1, 0, 0);
    const Z = new THREE.Vector3(0, 0, 1);
    const add = (name, axisWorld, angle) => {
      const i = name != null ? rig.idx.get(name) : null;
      if (i == null || !angle) return;
      const parent = bones[i].parent;
      const inv = (parent ? parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion()).invert();
      const ax = axisWorld.clone().applyQuaternion(inv).normalize();
      out.push({ name, q: new THREE.Quaternion().setFromAxisAngle(ax, angle) });
    };
    const cls = rig.cls;
    const upper = (cls.spine || []).slice(-2);
    for (const nm of upper) add(nm, X, posture.spine / upper.length);
    const neck = cls.neck || [];
    for (const nm of neck) add(nm, X, posture.neck / neck.length);
    add(cls.head, X, posture.head);
    // Sideways offsets rotate about the forward axis; the sign follows which
    // side of the body the bone is on, so positive always means "outward/up".
    const sided = (key, angle) => {
      for (const s of ['L', 'R']) {
        const nm = cls[key + '.' + s] && cls[key + '.' + s][0];
        const i = nm != null ? rig.idx.get(nm) : null;
        if (i == null) continue;
        const side = Math.sign(bones[i].getWorldPosition(new THREE.Vector3()).x) || 1;
        add(nm, Z, angle * side);
      }
    };
    sided('shoulder', posture.shrug);
    sided('upperArm', posture.armSplay);
    sided('thigh', posture.legSplay);
    return out;
  }

  // Bounding box of every body part in the baked geometry — lets gear centre
  // itself on the head/chest/pelvis and scale to fit, instead of hard-coded
  // offsets that only suit one body.
  function _partBoxes(geom) {
    const pos = geom.attributes.position;
    const part = geom.attributes.aPart;
    const out = {};
    for (let i = 0; i < pos.count; i++) {
      const p = Math.round(part.getX(i));
      const b = out[p] || (out[p] = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
      const v = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      for (let c = 0; c < 3; c++) {
        if (v[c] < b.min[c]) b.min[c] = v[c];
        if (v[c] > b.max[c]) b.max[c] = v[c];
      }
    }
    for (const k of Object.keys(out)) {
      const b = out[k];
      b.center = b.min.map((v, c) => (v + b.max[c]) / 2);
      b.size = b.max.map((v, c) => v - b.min[c]);
    }
    return out;
  }

  // Backpedal lean (radians, same convention as bodyShapeFor().posture:
  // positive pitches forward). The chest tips back ~9°, and the neck and head
  // tip forward by about as much, so the gaze stays level. STRIDE_K pulls the
  // thighs and shins that far back towards their straight rest pose, so the
  // steps come out shorter.
  const BACKPEDAL_POSE = { spine: -0.16, neck: 0.07, head: 0.07 };
  const BACKPEDAL_STRIDE_K = 0.3;

  function _variant(model, build) {
    const key = model + '|' + build;
    if (_variants.has(key)) return _variants.get(key);
    const THREE = T();
    const proto = _protos[model];
    const shape = L.bodyShapeFor({ gender: model === 'female' ? 2 : 1, build });
    const tpl = THREE.SkeletonUtils.clone(proto.scene);
    tpl.position.set(0, 0, 0); tpl.quaternion.identity(); tpl.scale.set(1, 1, 1);
    tpl.updateMatrixWorld(true);
    const meshes = _skinnedIn(tpl);
    const body = meshes.find((m) => m.name === 'Body') || meshes[0];
    const bones = body.skeleton.bones.slice();
    const rig = _rigInfo(bones, shape);
    const bone = (k) => { const nm = rig.cls[k] && rig.cls[k][0]; return nm ? bones[rig.idx.get(nm)] : null; };
    _shiftLateral(bone('upperArm.L'), shape.jointShift.shoulder);
    _shiftLateral(bone('upperArm.R'), shape.jointShift.shoulder);
    _shiftLateral(bone('thigh.L'), shape.jointShift.hip);
    _shiftLateral(bone('thigh.R'), shape.jointShift.hip);
    tpl.updateMatrixWorld(true);
    const Wp = bones.map((b) => b.matrixWorld.clone());
    const A = bones.map((b, i) => Wp[i].clone().multiply(_shapeMatrix(rig.axis[i], rig.scale[i])));
    const skeleton = new THREE.Skeleton(bones, Wp.map((m) => m.clone().invert()));
    for (const m of meshes) {
      m.geometry = _bakeGeometry(m, rig.idx, A, rig);
      m.bind(skeleton, new THREE.Matrix4());
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
    }
    const posture = _postureOffsets(bones, rig, shape.posture);
    const lean = _postureOffsets(bones, rig, BACKPEDAL_POSE);
    const sit = _sitOffsets(bones, rig);
    const strideRest = ['thigh.L', 'thigh.R', 'shin.L', 'shin.R']
      .map((k) => rig.cls[k] && rig.cls[k][0])
      .filter((nm) => nm != null && rig.idx.has(nm))
      .map((nm) => ({ name: nm, q: bones[rig.idx.get(nm)].quaternion.clone() }));
    const jointY = (name) => {
      const i = name != null ? rig.idx.get(name) : null;
      return i == null ? 0 : new THREE.Vector3().setFromMatrixPosition(Wp[i]).y;
    };
    const hipsY = jointY(rig.cls.hips);
    const waistY = hipsY + (jointY(rig.cls.spine[0]) - hipsY) * WAIST_K;
    const variant = {
      key, model, build, shape, template: tpl, A, rig, posture, lean, sit, strideRest, waistY, hipsY,
      partBox: _partBoxes(body.geometry), hairGeo: new Map()
    };
    _variants.set(key, variant);
    return variant;
  }

  function _hairGeometry(variant, style) {
    if (variant.hairGeo.has(style)) return variant.hairGeo.get(style);
    const src = _hair && _hair.meshes.get(style);
    const g = src ? _bakeGeometry(src, variant.rig.idx, variant.A, variant.rig) : null;
    variant.hairGeo.set(style, g);
    return g;
  }

  // ── Tinting ──

  const TINT_VERT_DECL = [
    'attribute float aPart;',
    'attribute float aAlong;',
    'attribute float aHeight;',
    'flat varying int vPart;',
    'varying float vAlong;',
    'varying float vHeight;'
  ].join('\n') + '\n';
  const TINT_FRAG_DECL = [
    'flat varying int vPart;',
    'varying float vAlong;',
    'varying float vHeight;',
    `uniform vec3 uPartColor[${PART_COUNT}];`,
    `uniform float uPartSkin[${PART_COUNT}];`,
    `uniform float uPartCut[${PART_COUNT}];`,
    `uniform float uPartRag[${PART_COUNT}];`,
    `uniform vec3 uPartColor2[${PART_COUNT}];`,
    `uniform float uPartSkin2[${PART_COUNT}];`,
    `uniform float uPartWaist[${PART_COUNT}];`,
    'uniform float uWaistY;',
    'uniform vec3 uWaistTop;',
    'uniform float uWaistTopSkin;',
    'uniform vec3 uWaistBottom;',
    'uniform float uWaistBottomSkin;',
    'uniform vec3 uSkinColor;',
    'uniform vec3 uTexAvg;'
  ].join('\n') + '\n';
  // Cloth covers a part from its joint down to `cut` (fraction of the bone),
  // with an optional jagged hem (`rag`) for torn clothes. Beyond the cut is
  // skin, or a second cloth (colour2) — the pelvis uses it so the waistband
  // is a smooth line with the shirt above it, instead of following the
  // stair-stepped pelvis/spine triangle boundary.
  const TINT_MAP = [
    '#ifdef USE_MAP',
    '  vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
    '  vec3 texC = sampledDiffuseColor.rgb;',
    '  vec3 avg = max( uTexAvg, vec3( 0.05 ) );',
    '  vec3 skinC = texC / avg * uSkinColor;',
    '  float lum = dot( texC, vec3( 0.299, 0.587, 0.114 ) ) / max( dot( avg, vec3( 0.299, 0.587, 0.114 ) ), 0.05 );',
    // Cloth takes only a narrow slice of the texture's shading: the base skin
    // has black underwear painted on, which blotched through at a wider range.
    // Muscle definition comes from the normal map anyway.
    '  float shade = clamp( lum, 0.8, 1.1 );',
    '  vec3 clothC = uPartColor[ vPart ] * shade;',
    '  float jag = ( sin( vMapUv.x * 140.0 ) + sin( vMapUv.x * 53.0 + 1.7 ) ) * 0.5;',
    '  float cut = uPartCut[ vPart ] + jag * uPartRag[ vPart ];',
    '  float covered = ( 1.0 - uPartSkin[ vPart ] ) * step( vAlong, cut );',
    '  vec3 beyond = mix( uPartColor2[ vPart ] * shade, skinC, uPartSkin2[ vPart ] );',
    '  vec3 partC = mix( beyond, clothC, covered );',
    // Torso and pelvis split shirt/trousers at a horizontal waistline (bind-
    // pose height) instead of the stair-stepped pelvis/spine triangle border.
    '  vec3 waistC = vHeight < uWaistY',
    '    ? mix( uWaistBottom * shade, skinC, uWaistBottomSkin )',
    '    : mix( uWaistTop * shade, skinC, uWaistTopSkin );',
    '  diffuseColor.rgb *= mix( partC, waistC, uPartWaist[ vPart ] );',
    '  diffuseColor.a *= sampledDiffuseColor.a;',
    '#endif'
  ].join('\n');

  // Eyes: tint only the dark texels (iris + pupil) so the whites stay white.
  const EYE_MAP = [
    '#ifdef USE_MAP',
    '  vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
    '  vec3 texC = sampledDiffuseColor.rgb;',
    '  float lum = dot( texC, vec3( 0.299, 0.587, 0.114 ) );',
    '  float iris = 1.0 - smoothstep( 0.25, 0.6, lum );',
    '  diffuseColor.rgb *= mix( texC, texC * uEyeColor * 2.2, iris );',
    '  diffuseColor.a *= sampledDiffuseColor.a;',
    '#endif'
  ].join('\n');

  function _installEyeTint(mat) {
    const THREE = T();
    const u = { uEyeColor: { value: new THREE.Color(0x5a3a22) } };
    mat.userData.eyeTint = u;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uEyeColor;')
        .replace('#include <map_fragment>', EYE_MAP);
    };
    mat.customProgramCacheKey = () => 'pg3d-humanoid-eyes';
    mat.needsUpdate = true;
    return u;
  }

  function _installTint(mat, avg) {
    const THREE = T();
    const u = {
      uPartColor: { value: Array.from({ length: PART_COUNT }, () => new THREE.Color(1, 1, 1)) },
      uPartSkin: { value: new Array(PART_COUNT).fill(1) },
      uPartCut: { value: new Array(PART_COUNT).fill(0) },
      uPartRag: { value: new Array(PART_COUNT).fill(0) },
      uPartColor2: { value: Array.from({ length: PART_COUNT }, () => new THREE.Color(1, 1, 1)) },
      uPartSkin2: { value: new Array(PART_COUNT).fill(1) },
      uPartWaist: { value: new Array(PART_COUNT).fill(0) },
      uWaistY: { value: 0 },
      uWaistTop: { value: new THREE.Color(1, 1, 1) },
      uWaistTopSkin: { value: 1 },
      uWaistBottom: { value: new THREE.Color(1, 1, 1) },
      uWaistBottomSkin: { value: 1 },
      uSkinColor: { value: new THREE.Color(0xc68642) },
      uTexAvg: { value: avg.clone() }
    };
    mat.userData.tint = u;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + TINT_VERT_DECL)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = int( aPart + 0.5 );\nvAlong = aAlong;\nvHeight = aHeight;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + TINT_FRAG_DECL)
        .replace('#include <map_fragment>', TINT_MAP);
    };
    mat.customProgramCacheKey = () => 'pg3d-humanoid-tint';
    mat.needsUpdate = true;
    return u;
  }

  // Waistline height as a fraction from the hip joints (0) to the first spine
  // joint (1). Just above 1 so trousers cover the underwear waistband painted
  // into the base skin texture (it peeked out as a tinted band otherwise).
  const WAIST_K = 1.15;

  // Hair/brows/beard: one colour everywhere, texture shading kept.
  function _setAll(u, hex) {
    for (let i = 0; i < PART_COUNT; i++) {
      u.uPartColor.value[i].set(hex);
      u.uPartSkin.value[i] = 0;
      u.uPartCut.value[i] = 2;
      u.uPartRag.value[i] = 0;
    }
  }

  // look: { skin, top, bottom, shoes, gloves, bracers, hair (hex; null top/
  //         bottom/shoes/gloves/bracers = bare), sleeves: 'none'|'short'|'long',
  //         legs: 'bare'|'short'|'torn'|'long', hairStyle: style name|null, beard }
  // `bracers` paints the forearms (gauntlets / vambraces) over any sleeve.
  function _paintBody(u, look) {
    u.uSkinColor.value.set(look.skin != null ? look.skin : 0xc68642);
    const put = (p, hex, cut, rag) => {
      const bare = hex == null || !cut;
      u.uPartColor.value[p].set(bare ? 0xffffff : hex);
      u.uPartSkin.value[p] = bare ? 1 : 0;
      u.uPartCut.value[p] = bare ? 0 : cut;
      u.uPartRag.value[p] = rag || 0;
      u.uPartColor2.value[p].set(0xffffff);
      u.uPartSkin2.value[p] = 1;
    };
    const top = look.top, bottom = look.bottom;
    const sleeves = look.sleeves || 'short';
    const legs = look.legs || 'long';
    put(PART.head, null);
    put(PART.neck, null);
    put(PART.torso, top, 2);
    put(PART.upperArm, top, sleeves === 'long' ? 2 : sleeves === 'short' ? 0.5 : 0);
    if (look.bracers != null) put(PART.forearm, look.bracers, 2);
    else put(PART.forearm, top, sleeves === 'long' ? 2 : 0);
    put(PART.hand, look.gloves, look.glovesCut != null ? look.glovesCut : 2);
    put(PART.pelvis, bottom, 2);
    // Torso + pelvis use the horizontal waistline: trousers below, shirt above.
    for (let p = 0; p < PART_COUNT; p++) u.uPartWaist.value[p] = p === PART.torso || p === PART.pelvis ? 1 : 0;
    u.uWaistTop.value.set(top != null ? top : 0xffffff);
    u.uWaistTopSkin.value = top != null ? 0 : 1;
    u.uWaistBottom.value.set(bottom != null ? bottom : 0xffffff);
    u.uWaistBottomSkin.value = bottom != null ? 0 : 1;
    put(PART.thigh, bottom, legs === 'bare' ? 0 : legs === 'short' ? 0.75 : 2);
    put(PART.shin, bottom, legs === 'long' ? 2 : legs === 'torn' ? 0.55 : 0, legs === 'torn' ? 0.09 : 0);
    put(PART.foot, look.shoes, 2);
  }

  // ── garments ──
  // Shell: a second skin over the body — the same baked geometry and skeleton,
  // pushed out along its normals, with fragments discarded wherever the
  // garment doesn't cover. It deforms with every animation for free and costs
  // one draw call (jacket, vest, Iron Man armour).
  // Region shells (boot shafts, soles, cuffs, pockets, collars, stripes…) are
  // the same layer clipped further: up to MAX_PLANES half-spaces in bind-pose
  // body space keep only one patch. Planes test
  // (|x|, y, z) — every region is mirrored left/right, like the clothes.
  const MAX_PLANES = 6;
  const SHELL_FRAG_DECL = [
    'flat varying int vPart;',
    'varying float vAlong;',
    'varying float vHeight;',
    'varying vec3 vBind;',
    `uniform float uCover[${PART_COUNT}];`,
    `uniform float uCoverCut[${PART_COUNT}];`,
    `uniform float uAccent[${PART_COUNT}];`,
    'uniform vec3 uAccentColor;',
    'uniform float uHemY;',
    `uniform vec4 uPlanes[${MAX_PLANES}];`,
    `uniform float uRegionPart[${PART_COUNT}];`,
    'uniform int uPlaneCount;',
    'uniform float uRag;'
  ].join('\n') + '\n';
  // Discard outside the region planes. `uRag` makes the first plane's edge
  // jagged (torn cloth).
  const SHELL_REGION = [
    'if ( uRegionPart[ vPart ] > 0.5 ) {',
    'vec3 rp = vec3( abs( vBind.x ), vBind.y, vBind.z );',
    `for ( int i = 0; i < ${MAX_PLANES}; i++ ) {`,
    '  if ( i >= uPlaneCount ) break;',
    '  float jagP = i == 0 ? ( sin( vBind.x * 90.0 ) + sin( vBind.x * 37.0 + 1.3 ) ) * 0.5 * uRag : 0.0;',
    '  if ( dot( uPlanes[ i ].xyz, rp ) < uPlanes[ i ].w + jagP ) discard;',
    '}',
    '}'
  ].join('\n');

  function _shellMaterial(hex, spec) {
    const THREE = T();
    const mat = new THREE.MeshStandardMaterial({
      color: hex,
      metalness: spec.metal || 0,
      roughness: spec.rough != null ? spec.rough : 0.8,
      side: THREE.DoubleSide            // thin layer: the inside shows at hems
    });
    const u = {
      uCover: { value: new Array(PART_COUNT).fill(0) },
      uCoverCut: { value: new Array(PART_COUNT).fill(2) },
      // Two-tone: parts flagged in uAccent render in uAccentColor instead of
      // the material colour (Iron Man's gold biceps/thighs).
      uAccent: { value: new Array(PART_COUNT).fill(0) },
      uAccentColor: { value: new THREE.Color(spec.accentHex != null ? spec.accentHex : hex) },
      uHemY: { value: -1e3 },
      uInflate: { value: spec.inflate != null ? spec.inflate : 0.014 },
      uPlanes: { value: Array.from({ length: MAX_PLANES }, () => new THREE.Vector4()) },
      uPlaneCount: { value: 0 },
      // Which parts the region clips (a jacket's straight hem must not cut the sleeves).
      uRegionPart: { value: new Array(PART_COUNT).fill(1) },
      uRag: { value: spec.rag || 0 }
    };
    mat.userData.shell = u;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uInflate;\nvarying vec3 vBind;\n' + TINT_VERT_DECL)
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\nvPart = int( aPart + 0.5 );\nvAlong = aAlong;\nvHeight = aHeight;\nvBind = position;\ntransformed += objectNormal * uInflate;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + SHELL_FRAG_DECL)
        .replace('#include <clipping_planes_fragment>',
          '#include <clipping_planes_fragment>\n' +
          'if ( uCover[ vPart ] < 0.5 ) discard;\n' +
          'if ( vAlong > uCoverCut[ vPart ] ) discard;\n' +
          'if ( vHeight < uHemY ) discard;\n' + SHELL_REGION)
        .replace('#include <color_fragment>',
          '#include <color_fragment>\nif ( uAccent[ vPart ] > 0.5 ) diffuseColor.rgb = uAccentColor;');
    };
    mat.customProgramCacheKey = () => 'pg3d-humanoid-shell';
    return mat;
  }

  // Open cone hanging from the waist: skirt, dress, robe, coat tails.
  function _skirtGeometry(waistR, hemR, length) {
    const THREE = T();
    const pts = [];
    const N = 7;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      pts.push(new THREE.Vector2(waistR + (hemR - waistR) * Math.pow(t, 1.4), -length * t));
    }
    const g = new THREE.LatheGeometry(pts, 28);
    g.computeVertexNormals();
    return g;
  }

  // Cape: a tapered sheet hanging from the shoulders, swept back and wrapped
  // slightly around the body. Hangs from y = 0 down to −length.
  function _capeGeometry(width, length, sweep) {
    const THREE = T();
    const g = new THREE.PlaneGeometry(width, length, 8, 14);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const t = (length / 2 - v.y) / length;            // 0 at the collar, 1 at the hem
      // Narrow at the collar, gently wider at the hem, and wrapped around the
      // shoulders at the top so it sits on the back rather than floating.
      pos.setXYZ(i, v.x * (0.78 + t * 0.42), v.y - length / 2, -sweep * t * t - Math.abs(v.x) * 0.22 * (1 - t));
    }
    g.computeVertexNormals();
    return g;
  }

  // ── Instances ──

  function createInstance(look) {
    if (_status !== 'ready') throw new Error('[PG3DHumanoid] not ready');
    const THREE = T();
    look = Object.assign({ model: 'male', build: 1 }, look);
    const variant = _variant(look.model, look.build);
    const pivot = new THREE.Group();
    pivot.name = 'humanoid';
    const body = THREE.SkeletonUtils.clone(variant.template);
    pivot.add(body);
    // The glTF bodies face +Z, which is also the engine's forward (yaw comes
    // from atan2(moveX, moveZ) and the camera trails on the opposite side), so
    // no turn is needed here — a half-turn made characters walk backwards.
    pivot.scale.setScalar(BODY_HEIGHT[look.model] / _protos[look.model].restHeight);

    const meshes = _skinnedIn(body);
    const bodyMesh = meshes.find((m) => m.name === 'Body') || meshes[0];
    const skeleton = bodyMesh.skeleton;
    const mats = [];
    const tints = { body: null, hair: [], eyes: null };
    for (const m of meshes) {
      m.material = m.material.clone();
      mats.push(m.material);
      if (m === bodyMesh) tints.body = _installTint(m.material, _protos[look.model].skinAvg);
      else if (/brow/i.test(m.name)) tints.hair.push(_installTint(m.material, _hair.avg));
      else if (/eye/i.test(m.name)) tints.eyes = _installEyeTint(m.material);
      else tints.hair.push(_installTint(m.material, _hair.avg));
    }
    tints.body.uWaistY.value = variant.waistY;

    const hairMeshes = [];
    function setHair(styles) {
      for (const h of hairMeshes.splice(0)) {
        h.removeFromParent();
        const i = mats.indexOf(h.material);
        if (i >= 0) mats.splice(i, 1);
        h.material.dispose();
      }
      const hex = look.hair != null ? look.hair : 0x3b2a20;
      for (const style of styles) {
        const g = style && _hairGeometry(variant, style);
        if (!g) continue;
        const mat = _hair.meshes.get(style).material.clone();
        _setAll(_installTint(mat, _hair.avg), hex);
        const hm = new THREE.SkinnedMesh(g, mat);
        hm.name = style;
        hm.frustumCulled = false;
        hm.castShadow = true;
        body.add(hm);
        hm.bind(skeleton, new THREE.Matrix4());
        hairMeshes.push(hm);
        mats.push(mat);
      }
    }

    // ── garments: shells (jacket / armour), skirts, capes ──
    const garments = [];
    let capeMesh = null;
    function _clearGarments() {
      for (const g of garments.splice(0)) {
        g.removeFromParent();
        if (g.userData.ownGeometry && g.geometry) g.geometry.dispose();
        if (!g.userData.sharedMaterial) {
          const i = mats.indexOf(g.material);
          if (i >= 0) mats.splice(i, 1);
          g.material.dispose();
        }
      }
      capeMesh = null;
    }

    // Region (see PG3DHumanoidLogic.garmentsFor) → clip planes in bind-pose
    // body space. Fractions are of the `ref` part's bounding box: y 0 = its
    // bottom, z 0 = its back, x is |x| over the box's half-width (0 = the
    // body's centre line). Kept where dot(n, (|x|, y, z)) >= d.
    function _regionPlanes(region) {
      const out = [];
      if (!region) return out;
      const b = variant.partBox[PART[region.ref || 'torso']];
      if (!b) return out;
      const at = (axis, f) => b.min[axis] + (b.max[axis] - b.min[axis]) * f;
      const halfW = Math.max(Math.abs(b.min[0]), Math.abs(b.max[0]));
      const push = (x, y, z, d) => out.push([x, y, z, d]);
      // The vee goes first so a torn hem (rag) can't jag the neckline.
      if (region.vee) {
        const v = region.vee;
        push(-v.slope, 1, 0, at(1, v.top) - v.depth * (b.max[1] - b.min[1]));
      }
      if (region.y) {
        if (region.y[0] != null) push(0, 1, 0, at(1, region.y[0]));
        if (region.y[1] != null) push(0, -1, 0, -at(1, region.y[1]));
      }
      if (region.xAbs) {
        if (region.xAbs[0] != null) push(1, 0, 0, halfW * region.xAbs[0]);
        if (region.xAbs[1] != null) push(-1, 0, 0, -halfW * region.xAbs[1]);
      }
      if (region.z) {
        if (region.z[0] != null) push(0, 0, 1, at(2, region.z[0]));
        if (region.z[1] != null) push(0, 0, -1, -at(2, region.z[1]));
      }
      return out.slice(0, MAX_PLANES);
    }

    // One shell layer (see _shellMaterial): a jacket, armour, or a clipped
    // region such as a boot shaft, a sole, a cuff or a collar.
    function _addShell(sh) {
      const mat = _shellMaterial(sh.hex, sh);
      const u = mat.userData.shell;
      for (const p of sh.parts || []) {
        if (PART[p] == null) continue;
        u.uCover.value[PART[p]] = 1;
        u.uCoverCut.value[PART[p]] = (sh.cut && sh.cut[p] != null) ? sh.cut[p] : 2;
      }
      if (sh.accentHex != null) {
        for (const p of sh.accentParts || []) if (PART[p] != null) u.uAccent.value[PART[p]] = 1;
      }
      const planes = _regionPlanes(sh.region);
      planes.forEach((p, i) => u.uPlanes.value[i].set(p[0], p[1], p[2], p[3]));
      u.uPlaneCount.value = planes.length;
      if (sh.region && sh.region.parts) {
        for (let i = 0; i < PART_COUNT; i++) u.uRegionPart.value[i] = 0;
        for (const p of sh.region.parts) if (PART[p] != null) u.uRegionPart.value[PART[p]] = 1;
      }
      const mesh = new THREE.SkinnedMesh(bodyMesh.geometry, mat);
      mesh.name = 'garment:' + sh.kind;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      body.add(mesh);
      mesh.bind(skeleton, new THREE.Matrix4());
      garments.push(mesh);
      mats.push(mat);
      return { mesh, mat };
    }

    function setGarments(spec) {
      _clearGarments();
      if (!spec) return;
      const box = variant.partBox;
      // Detail layers (shoes, cuffs, pockets, collars, trims): clipped shells.
      for (const sh of spec.details || []) if (sh && sh.hex != null) _addShell(sh);
      // A second skin: jacket, bomber, hoodie, vest, Iron Man armour.
      if (spec.shell && spec.shell.hex != null) {
        const sh = spec.shell;
        const { mat } = _addShell(sh);
        if (sh.pauldrons) {
          const arm = box[PART.upperArm];
          const r = (arm ? arm.size[2] : 0.12) * 0.85;
          for (const side of ['L', 'R']) {
            const bone = anchors['upperArm.' + side];
            if (!bone) continue;
            const pad = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat);
            pad.name = 'garment:pauldron';
            pad.castShadow = true;
            pad.userData.ownGeometry = true;
            pad.userData.sharedMaterial = true;      // shares the shell material
            bone.add(pad);
            garments.push(pad);
          }
        }
      }
      // Hangs from the waist: skirt, dress, robe, coat tails.
      if (spec.skirt && spec.skirt.hex != null) {
        const sk = spec.skirt;
        const slot = attachSlot('pelvis', { center: true, y: 0.055, scale: 1 });
        if (slot) {
          const waistR = (box[PART.pelvis] ? box[PART.pelvis].size[0] * 0.5 : 0.16) * 1.02;
          const mesh = new THREE.Mesh(
            _skirtGeometry(waistR, waistR * (sk.flare || 1.6), sk.length || 0.35),
            new THREE.MeshStandardMaterial({ color: sk.hex, roughness: 0.85, side: THREE.DoubleSide })
          );
          mesh.name = 'garment:' + sk.kind;
          mesh.castShadow = true;
          mesh.frustumCulled = false;
          mesh.userData.ownGeometry = true;
          slot.add(mesh);
          garments.push(mesh);
          mats.push(mesh.material);
        }
      }
      // Hangs from the upper back (Thor's cape).
      if (spec.cape && spec.cape.hex != null) {
        const cp = spec.cape;
        const slot = attachSlot('chest', { center: true, y: 0.17, scale: 1 });
        if (slot) {
          const chest = box[PART.torso];
          const w = Math.max(cp.width || 0, (chest ? chest.size[0] : 0.42) * 1.02);
          const mesh = new THREE.Mesh(
            _capeGeometry(w, cp.length || 1, cp.sweep || 0.12),
            new THREE.MeshStandardMaterial({ color: cp.hex, roughness: 0.9, side: THREE.DoubleSide })
          );
          mesh.name = 'garment:cape';
          mesh.castShadow = true;
          mesh.frustumCulled = false;
          mesh.userData.ownGeometry = true;
          mesh.position.z = -((chest ? chest.size[2] : 0.24) * 0.5) - 0.02;
          slot.add(mesh);
          garments.push(mesh);
          mats.push(mesh.material);
          capeMesh = mesh;
        }
      }
    }

    const mixer = new THREE.AnimationMixer(body);
    const clips = _clipsFor(look.model);
    let current = null;
    let currentState = null;
    let softUntil = 0;

    function play(name, opts) {
      opts = opts || {};
      const clip = clips.get(name);
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      const ts = opts.timeScale != null ? opts.timeScale : 1;
      if (current === a && !opts.restart) { a.setEffectiveTimeScale(opts.reverse ? -ts : ts); return a; }
      a.reset();
      a.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = !!opts.once;
      a.setEffectiveWeight(1);
      a.setEffectiveTimeScale(opts.reverse ? -ts : ts);
      if (opts.reverse) a.time = clip.duration;
      else if (opts.randomStart) a.time = Math.random() * clip.duration;
      a.play();
      if (current && current !== a) current.crossFadeTo(a, opts.fade != null ? opts.fade : 0.2, false);
      current = a;
      // Big one-shot moves (punch, hit, roll) read badly with a full hunch
      // layered on top, so posture eases off while they run.
      if (opts.once) softUntil = mixer.time + clip.duration;
      return a;
    }

    // force: restart even if it's already the current state — used to resume
    // walking/idle after a one-shot overlay (punch) finishes.
    function setState(base, timeScale, force) {
      const name = STATE_CLIPS[base];
      if (!name) return;
      if (base === currentState && !force) { if (current) current.setEffectiveTimeScale(base === 'getup' ? -1.6 : (timeScale || 1)); return; }
      const first = currentState == null;
      currentState = base;
      play(name, {
        once: ONE_SHOT.has(base),
        reverse: base === 'getup',
        timeScale: base === 'getup' ? 1.6 : (timeScale || 1),
        randomStart: first && base === 'idle',
        restart: true,
        fade: first ? 0 : 0.2
      });
    }

    function applyLook(next) {
      look = Object.assign(look, next || {});
      _paintBody(tints.body, look);
      for (const u of tints.hair) _setAll(u, look.hair != null ? look.hair : 0x3b2a20);
      if (tints.eyes && look.eyes != null) tints.eyes.uEyeColor.value.set(look.eyes);
      setHair([look.hairStyle, look.beard ? 'Hair_Beard' : null]);
      setGarments(look.garments);
    }

    // Curl a hand into a grip so held props read as held rather than floating
    // beside an open hand. Fingers bend about their own +X on this rig
    // (measured); the thumb closes less. Re-applied after every mixer update,
    // since the clips animate finger bones too.
    const fists = { L: 0, R: 0 };
    const fistBones = { L: null, R: null };
    // Wrist turn that points the grip channel along the arm (set by attachSlot
    // when a prop is mounted), re-applied after every mixer update.
    const grips = { L: null, R: null };
    function setFist(side, amount) {
      if (!anchors['hand.' + side]) return;
      fists[side] = Math.max(0, Math.min(1, amount == null ? 1 : amount));
      if (!fistBones[side]) {
        const list = [];
        anchors['hand.' + side].traverse((b) => {
          if (b.isBone && b !== anchors['hand.' + side] && !/leaf/i.test(b.name)) {
            list.push({ bone: b, bend: /thumb/i.test(b.name) ? 0.45 : 0.95 });
          }
        });
        fistBones[side] = list;
      }
    }
    function _applyFists() {
      for (const side of ['L', 'R']) {
        if (grips[side]) anchors['hand.' + side].quaternion.multiply(grips[side]);
        const a = fists[side];
        if (!a || !fistBones[side]) continue;
        for (const f of fistBones[side]) f.bone.rotation.x = f.bend * a;
      }
    }

    // Shadow casting is the expensive half of a crowd; the engine turns it off
    // for distant characters (PG3DHumanoidLogic.lodTier).
    let shadows = true;
    function setShadows(on) {
      on = !!on;
      if (on === shadows) return;
      shadows = on;
      for (const m of meshes) m.castShadow = on;
      for (const h of hairMeshes) h.castShadow = on;
    }

    function setOpacity(o) {
      for (const m of mats) {
        m.transparent = o < 1;
        m.opacity = o;
        m.depthWrite = o >= 1;
      }
    }

    // Brief red glow when hit — every material's emissive is driven up and
    // decays over ~250ms in update(). Tinted materials keep `emissive`
    // (onBeforeCompile only rewrites the diffuse sample), so it's one loop.
    let flash = 0;
    const FLASH_HEX = 0xff2a2a;
    function setHitFlash(strength) {
      flash = Math.max(flash, strength == null ? 1 : strength);
      for (const m of mats) if (m.emissive) { m.emissive.setHex(FLASH_HEX); m.emissiveIntensity = flash * 0.8; }
    }
    function _decayFlash(dt) {
      if (flash <= 0) return;
      flash = Math.max(0, flash - dt / 0.25);
      for (const m of mats) if (m.emissive) m.emissiveIntensity = flash * 0.8;
      if (flash === 0) for (const m of mats) if (m.emissive) m.emissive.setHex(0x000000);
    }

    function dispose() {
      _clearGarments();
      mixer.stopAllAction();
      mixer.uncacheRoot(body);
      for (const m of mats) m.dispose();
      pivot.removeFromParent();
    }

    const boneBy = (nm) => (nm ? body.getObjectByName(nm) : null);
    const cls = variant.rig.cls;
    const anchors = {
      head: boneBy(cls.head),
      chest: boneBy(cls.spine[cls.spine.length - 1]),
      pelvis: boneBy(cls.hips),
      'hand.L': boneBy(cls['hand.L'] && cls['hand.L'][0]),
      'hand.R': boneBy(cls['hand.R'] && cls['hand.R'][0]),
      'forearm.L': boneBy(cls['forearm.L'] && cls['forearm.L'][0]),
      'forearm.R': boneBy(cls['forearm.R'] && cls['forearm.R'][0]),
      'upperArm.L': boneBy(cls['upperArm.L'] && cls['upperArm.L'][0]),
      'upperArm.R': boneBy(cls['upperArm.R'] && cls['upperArm.R'][0]),
      'foot.L': boneBy(cls['foot.L'] && cls['foot.L'][0]),
      'foot.R': boneBy(cls['foot.R'] && cls['foot.R'][0])
    };
    // The mixer rewrites every bone each update, so the constant posture
    // offsets are re-applied right after it (never accumulated). They fade out
    // while knocked down / getting up — a hunch on someone lying on their back
    // curls them up off the floor.
    const posture = variant.posture.map((p) => ({ bone: boneBy(p.name), q: p.q, clean: new THREE.Quaternion() })).filter((p) => p.bone);
    const postureQ = new THREE.Quaternion();
    let postureW = 1;
    let postureOn = false;
    // Backpedal layer — same restore-then-reapply scheme as the posture, on top
    // of it. Eases in and out over ~0.2s so turning around doesn't snap.
    const lean = variant.lean.map((p) => ({ bone: boneBy(p.name), q: p.q, clean: new THREE.Quaternion() })).filter((p) => p.bone);
    const stride = variant.strideRest.map((p) => ({ bone: boneBy(p.name), rest: p.q, clean: new THREE.Quaternion() })).filter((p) => p.bone);
    const leanQ = new THREE.Quaternion();
    let leanTarget = 0;
    let leanW = 0;
    let leanOn = false;
    function setBackpedal(on) { leanTarget = on ? 1 : 0; }

    // Sit pose — a third offset layer (applied after lean, restored first).
    const sit = (variant.sit || []).map((p) => ({ bone: boneBy(p.name), q: p.q, clean: new THREE.Quaternion() })).filter((p) => p.bone);
    const poseQ = new THREE.Quaternion();
    let poseTarget = 0;
    let poseW = 0;
    let poseOn = false;
    function setPose(name) { poseTarget = name === 'sit' ? 1 : 0; }
    function _applyPoseLayer(dt) {
      if (!sit.length) return;
      poseW += (poseTarget - poseW) * (1 - Math.exp(-dt * 10));
      if (poseW < 0.001) { poseW = poseTarget ? poseW : 0; return; }
      for (const p of sit) {
        p.clean.copy(p.bone.quaternion);
        p.bone.quaternion.premultiply(poseQ.identity().slerp(p.q, poseW));
      }
      poseOn = true;
    }

    function _applyPosture(dt) {
      if (!posture.length) return;
      const down = currentState === 'down' || currentState === 'getup';
      const target = down ? 0 : (mixer.time < softUntil ? 0.35 : 1);
      postureW += (target - postureW) * (1 - Math.exp(-dt * 8));
      if (postureW < 0.001) return;
      // A cape drifts as the character breathes and walks.
      if (capeMesh) capeMesh.rotation.x = 0.05 + Math.sin(mixer.time * 1.7) * 0.045;
      for (const p of posture) {
        p.clean.copy(p.bone.quaternion);
        p.bone.quaternion.premultiply(postureQ.identity().slerp(p.q, postureW));
      }
      postureOn = true;
    }

    function _applyLean(dt) {
      const down = currentState === 'down' || currentState === 'getup';
      const target = down ? 0 : leanTarget;
      leanW += (target - leanW) * (1 - Math.exp(-dt * 12));
      if (leanW < 0.001) { leanW = target ? leanW : 0; return; }
      for (const p of lean) {
        p.clean.copy(p.bone.quaternion);
        p.bone.quaternion.premultiply(leanQ.identity().slerp(p.q, leanW));
      }
      for (const s of stride) {
        s.clean.copy(s.bone.quaternion);
        s.bone.quaternion.slerp(s.rest, BACKPEDAL_STRIDE_K * leanW);
      }
      leanOn = true;
    }

    // A mount point on an anchor bone for procedural gear (hats, helmets,
    // emblems, held props). Re-aligned to the character's own axes — bone rest
    // frames in this rig are not axis-aligned — and scaled, since the pieces
    // were authored for the old 0.55u cube head. `y` offsets along the
    // character's up axis, in character units.
    function attachSlot(name, opts) {
      opts = opts || {};
      pivot.updateMatrixWorld(true);
      // `armSpan`: held props are authored in whole-arm space, gripped
      // `armSpan` below the shoulder. Mount on the HAND, with the origin a
      // little inside the palm, aligned along the arm; the caller shifts the
      // authored grip onto that origin. Scale comes from the real arm length so
      // props keep sensible proportions.
      if (opts.armSpan) {
        const side = name.split('.')[1];
        const upper = anchors['upperArm.' + side];
        const hand = anchors['hand.' + side];
        if (!upper || !hand) return null;
        const g = new THREE.Group();
        g.name = 'slot:arm.' + side;
        hand.add(g);
        // Middle of the fist: halfway to the average knuckle (thumb excluded —
        // it sits off to one side and would pull the grip out of the palm).
        const knuckles = hand.children.filter((c) => c.isBone && !/thumb/i.test(c.name));
        if (knuckles.length) {
          const p = new THREE.Vector3();
          for (const k of knuckles) p.add(k.position);
          g.position.copy(p.divideScalar(knuckles.length).multiplyScalar(0.5));
        }
        const upL = body.worldToLocal(upper.getWorldPosition(new THREE.Vector3()));
        const handL = body.worldToLocal(hand.getWorldPosition(new THREE.Vector3()));
        g.scale.setScalar(upL.distanceTo(handL) / opts.armSpan);
        // Align +Y with the fist's GRIP CHANNEL — the axis the fingers curl
        // around (a held bar runs parallel to the knuckle hinge), which is the
        // finger bones' own bend axis and is unaffected by curling them. Using
        // the arm direction instead ran the handle past the fist, ~54° off.
        const upW = upper.getWorldPosition(new THREE.Vector3());
        const handW = hand.getWorldPosition(new THREE.Vector3());
        const idxBone = knuckles.find((c) => /index/i.test(c.name)) || knuckles[0];
        const yA = idxBone
          ? new THREE.Vector3(1, 0, 0).applyQuaternion(idxBone.getWorldQuaternion(new THREE.Quaternion())).normalize()
          : upW.clone().sub(handW).normalize();
        if (yA.y < 0) yA.negate();          // props hang along −Y, so keep +Y up
        // Turn the wrist so that channel runs along the arm; a relaxed hand
        // points it up-and-forward, which carries a hammer sideways at hip
        // height instead of letting it hang.
        const along = upW.clone().sub(handW).normalize();
        const twist = new THREE.Quaternion().setFromUnitVectors(yA, along);
        const parentQ = hand.parent
          ? hand.parent.getWorldQuaternion(new THREE.Quaternion())
          : new THREE.Quaternion();
        const targetLocal = parentQ.invert().multiply(twist).multiply(hand.getWorldQuaternion(new THREE.Quaternion()));
        grips[side] = hand.quaternion.clone().invert().multiply(targetLocal);
        hand.quaternion.copy(targetLocal);
        hand.updateMatrixWorld(true);
        yA.copy(along);
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(pivot.getWorldQuaternion(new THREE.Quaternion()));
        const zA = fwd.addScaledVector(yA, -fwd.dot(yA));
        if (zA.lengthSq() < 1e-6) zA.set(0, 0, 1);
        zA.normalize();
        const xA = new THREE.Vector3().crossVectors(yA, zA).normalize();
        const aim = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, zA));
        g.quaternion.copy(hand.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(aim));
        return g;
      }
      const bone = anchors[name];
      if (!bone) return null;
      const g = new THREE.Group();
      g.name = 'slot:' + name;
      bone.add(g);
      const boneQ = bone.getWorldQuaternion(new THREE.Quaternion());
      const rootQ = pivot.getWorldQuaternion(new THREE.Quaternion());
      g.quaternion.copy(boneQ.invert().multiply(rootQ));
      // `fit`/`center`: scale to the body part's real width and sit on its
      // centre — head gear then fits both bodies without hand-tuned offsets.
      const SLOT_PART = { head: PART.head, chest: PART.torso, pelvis: PART.pelvis };
      const box = SLOT_PART[name] != null ? variant.partBox[SLOT_PART[name]] : null;
      // Fit each axis separately: a real head is deeper than it is wide, and
      // scaling by width alone left face pieces (masks, visors) buried under
      // the skin. A cube helmet becomes head-shaped, which also reads better.
      if (opts.fit && box) g.scale.set(box.size[0] / opts.fit, box.size[1] / opts.fit, box.size[2] / opts.fit);
      else g.scale.setScalar(opts.scale != null ? opts.scale : 1);
      if (opts.center && box) {
        const c = new THREE.Vector3(box.center[0], box.center[1] + (opts.y || 0), box.center[2]);
        body.localToWorld(c);
        g.position.copy(bone.worldToLocal(c));
      } else if (opts.y) {
        const world = bone.getWorldPosition(new THREE.Vector3());
        world.y += opts.y * (pivot.getWorldScale(new THREE.Vector3()).y || 1);
        g.position.copy(bone.worldToLocal(world));
      }
      return g;
    }

    applyLook(look);
    const handle = {
      object: pivot, body, mixer, shape: variant.shape, anchors,
      setState, play, applyLook, setOpacity, setShadows, attachSlot, setFist, setHitFlash, setBackpedal, setPose, dispose,
      update(dt) {
        _decayFlash(dt);
        // Put the clean (animation-only) rotations back before the mixer runs.
        // The mixer snapshots a bone's current value as its "original" state
        // when an action activates and lerps towards it at partial weight, so
        // leaving the offset on the bone made every clip change compound it —
        // the Hulk-type ended up tilted 75° mid-punch.
        // Undo in reverse order of application: pose went on last, then lean.
        if (poseOn) {
          for (let i = sit.length - 1; i >= 0; i--) sit[i].bone.quaternion.copy(sit[i].clean);
          poseOn = false;
        }
        if (leanOn) {
          for (let i = stride.length - 1; i >= 0; i--) stride[i].bone.quaternion.copy(stride[i].clean);
          for (let i = lean.length - 1; i >= 0; i--) lean[i].bone.quaternion.copy(lean[i].clean);
          leanOn = false;
        }
        if (postureOn) {
          for (const p of posture) p.bone.quaternion.copy(p.clean);
          postureOn = false;
        }
        mixer.update(dt);
        _applyFists();
        _applyPosture(dt);
        _applyLean(dt);
        _applyPoseLayer(dt);
      },
      get backpedal() { return leanW; },
      get pose() { return poseW; },
      get hipsY() { return variant.hipsY; },   // hip joint height in character units (seat placement)
      // Bind-pose bounding box of a body part ('foot', 'torso', …) in body
      // units — lets add-on pieces (heels, bow ties) size and place themselves.
      partBox(name) { return variant.partBox[PART[name]] || null; },
      get state() { return currentState; }
    };
    _lastInstance = handle;          // debugging aid (PG3DHumanoid._debug.last)
    return handle;
  }

  root.PG3DHumanoid = {
    preload,
    whenReady() { return _ready || preload(); },
    status() { return _status; },
    createInstance,
    clipNames() { return _clipsSrc.map((c) => c.name); },
    hairStyles() { return _hair ? [..._hair.meshes.keys()] : []; },
    STATE_CLIPS, PART, BODY_HEIGHT,
    _debug: { variants: _variants, protos: _protos, get last() { return _lastInstance; } }
  };
})(typeof self !== 'undefined' ? self : this);
