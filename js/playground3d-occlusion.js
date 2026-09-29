/************************************************
 * PLAYGROUND 3D — see-through occluders
 *
 * Extracted from js/playground3d.js (2026-09-22). Fades any static mesh
 * that sits between the chase camera and the local player so the
 * character is never hidden behind a roof or wall.
 *
 * PG3DOcclusion.create() returns { tick(dt, now, scene, camera, player),
 * reset(), release(mesh) }; the engine calls tick once per frame, reset on
 * destroy, and release before it swaps or disposes a mesh's material (a roof
 * repaint). Per-instance state (occluder boxes, faded materials) lives
 * inside the closure. Must load BEFORE js/playground3d.js.
 ************************************************/
(function (root) {
  function create() {
    // ── See-through occluders ──
    // Anything standing between the camera and the local player (a neighbour's
    // roof, a wall, a lamp post) fades to see-through so the character is never
    // hidden. Static scenery is gathered into a list of world-space boxes (the
    // list is refreshed about once a second, since rooms stream in), and each
    // frame a few sight lines — feet, chest, head — are tested against those
    // boxes. A blocking mesh swaps to its own transparent clone of its material
    // (materials are shared town-wide, so fading the original would fade every
    // house) and swaps back once it has faded fully in again.
    //
    // Box cost: measuring every mesh every second hitched a fully unlocked
    // town, so each mesh's box is cached and only re-measured when the mesh
    // has moved (or on a slow full refresh). Meshes flagged
    // userData.noOcclude (instanced scenery, floating stones) never count.
    const OCCLUDE = { ALPHA: 0.22, RATE: 10, REBUILD_MS: 1000, FULL_REFRESH_MS: 5000, PAD: 0.05 };
    let _occluders = [];            // [{ mesh, box }]
    let _occluderBuiltAt = -Infinity;
    let _fullRefreshAt = -Infinity;
    const _faded = new Map();       // mesh → { orig, clones, alpha, box }
    let _boxes = new WeakMap();     // mesh → { box, x, y, z }  (world position when measured)

    // Per-frame scratch (the tick used to allocate 3 vectors, a ray and a hit
    // point every frame).
    let _targets = null, _ray = null, _hitPt = null;

    function _isActor(o) {
      for (let p = o; p; p = p.parent) {
        if (p.userData && ('bones' in p.userData || p.userData.humanoid)) return true;
      }
      return false;
    }

    function _boxFor(o, force) {
      const THREE = window.THREE;
      const e = o.matrixWorld.elements;
      const hit = _boxes.get(o);
      if (hit && !force && hit.x === e[12] && hit.y === e[13] && hit.z === e[14]) return hit.box;
      const box = (hit && hit.box) || new THREE.Box3();
      box.setFromObject(o);
      _boxes.set(o, { box, x: e[12], y: e[13], z: e[14] });
      return box;
    }

    function _rebuildOccluders(_scene, force) {
      _occluders = [];
      _scene.updateMatrixWorld();
      _scene.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
        if (o.userData && o.userData.noOcclude) return;
        if (_faded.has(o)) { _occluders.push({ mesh: o, box: _faded.get(o).box }); return; }
        if (_isActor(o)) return;
        const box = _boxFor(o, force);
        if (box.isEmpty()) return;
        _occluders.push({ mesh: o, box });
      });
    }

    function _setFadeOpacity(state, a) {
      for (const m of state.clones) m.opacity = a;
    }

    // Put the mesh's own material back — but only if the fade clone is still
    // what it wears. If something else swapped the material meanwhile (a
    // keeper repainting a roof), that new material stays; writing the stale
    // original back used to revert the roof colour.
    function _restoreFaded(mesh, state) {
      const cur = mesh.material;
      const wearingClone = Array.isArray(cur)
        ? cur.length === state.clones.length && cur.every((m, i) => m === state.clones[i])
        : cur === state.clones[0];
      if (wearingClone) mesh.material = state.orig;
      for (const m of state.clones) m.dispose();
      _faded.delete(mesh);
    }

    // The engine is about to replace / dispose this mesh's material: drop any
    // fade first so it reads (and disposes) the real material, not our clone.
    function release(mesh) {
      const state = _faded.get(mesh);
      if (state) _restoreFaded(mesh, state);
      _boxes.delete(mesh);
    }

    function _resetOcclusion() {
      for (const [mesh, state] of _faded) _restoreFaded(mesh, state);
      _occluders = [];
      _occluderBuiltAt = -Infinity;
      _fullRefreshAt = -Infinity;
      _boxes = new WeakMap();
    }

    function _tickOcclusion(dt, now, _scene, _camera, _player) {
      const THREE = window.THREE;
      if (!THREE || !_player || !_camera || !_scene) return;
      if (now - _occluderBuiltAt > OCCLUDE.REBUILD_MS) {
        const full = now - _fullRefreshAt > OCCLUDE.FULL_REFRESH_MS;
        _rebuildOccluders(_scene, full);
        _occluderBuiltAt = now;
        if (full) _fullRefreshAt = now;
      }
      if (!_targets) {
        _targets = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
        _ray = new THREE.Ray();
        _hitPt = new THREE.Vector3();
      }
      const s = _player.scale.y || 1;
      const px = _player.position.x, py = _player.position.y, pz = _player.position.z;
      const cam = _camera.position;
      _targets[0].set(px, py + 0.25 * s, pz);
      _targets[1].set(px, py + 1.15 * s, pz);
      _targets[2].set(px, py + 1.9 * s, pz);
      const blocking = new Set();
      for (const t of _targets) {
        const len = cam.distanceTo(t);
        _ray.origin.copy(cam);
        _ray.direction.copy(t).sub(cam).normalize();
        for (const oc of _occluders) {
          const mesh = oc.mesh;
          if (!mesh.visible || !mesh.parent || blocking.has(mesh)) continue;
          // Boxes that hold the player (sky dome, the floor under them) never
          // count — only things between the camera and the character.
          if (oc.box.containsPoint(t)) continue;
          if (!_ray.intersectBox(oc.box, _hitPt)) continue;
          if (cam.distanceTo(_hitPt) < len - OCCLUDE.PAD) blocking.add(mesh);
        }
      }
      const k = 1 - Math.exp(-dt * OCCLUDE.RATE);
      for (const mesh of blocking) {
        if (_faded.has(mesh)) continue;
        const orig = mesh.material;
        const list = Array.isArray(orig) ? orig : [orig];
        const clones = list.map((m) => {
          const c = m.clone();
          c.transparent = true;
          c.depthWrite = false;
          c.opacity = m.opacity == null ? 1 : m.opacity;
          return c;
        });
        const box = (_occluders.find((o) => o.mesh === mesh) || {}).box;
        _faded.set(mesh, { orig, clones, alpha: 1, box });
        mesh.material = Array.isArray(orig) ? clones : clones[0];
      }
      for (const [mesh, state] of _faded) {
        if (!mesh.parent) { _restoreFaded(mesh, state); continue; }
        const target = blocking.has(mesh) ? OCCLUDE.ALPHA : 1;
        state.alpha += (target - state.alpha) * k;
        if (target === 1 && state.alpha > 0.98) { _restoreFaded(mesh, state); continue; }
        _setFadeOpacity(state, state.alpha);
      }
    }

    return { tick: _tickOcclusion, reset: _resetOcclusion, release };
  }

  root.PG3DOcclusion = { create };
})(typeof self !== 'undefined' ? self : this);
