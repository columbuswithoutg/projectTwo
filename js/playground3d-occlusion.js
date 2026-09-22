/************************************************
 * PLAYGROUND 3D — see-through occluders
 *
 * Extracted from js/playground3d.js (2026-09-22). Fades any static mesh
 * that sits between the chase camera and the local player so the
 * character is never hidden behind a roof or wall.
 *
 * PG3DOcclusion.create() returns { tick(dt, now, scene, camera, player),
 * reset() }; the engine calls tick once per frame and reset on destroy.
 * Per-instance state (occluder boxes, faded materials) lives inside the
 * closure. Must load BEFORE js/playground3d.js.
 ************************************************/
(function (root) {
  function create() {
    // ── See-through occluders ──
    // Anything standing between the camera and the local player (a neighbour's
    // roof, a wall, a lamp post) fades to see-through so the character is never
    // hidden. Static scenery is gathered into a list of world-space boxes (rebuilt
    // about once a second, since rooms stream in), and each frame a few sight
    // lines — feet, chest, head — are tested against those boxes. A blocking mesh
    // swaps to its own transparent clone of its material (materials are shared
    // town-wide, so fading the original would fade every house) and swaps back
    // once it has faded fully in again.
    const OCCLUDE = { ALPHA: 0.22, RATE: 10, REBUILD_MS: 1000, PAD: 0.05 };
    let _occluders = [];            // [{ mesh, box }]
    let _occluderBuiltAt = -Infinity;
    const _faded = new Map();       // mesh → { orig, clones, alpha }

    function _isActor(o) {
      for (let p = o; p; p = p.parent) {
        if (p.userData && ('bones' in p.userData || p.userData.humanoid)) return true;
      }
      return false;
    }

    function _rebuildOccluders(_scene) {
      const THREE = window.THREE;
      _occluders = [];
      _scene.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
        if (_faded.has(o)) { _occluders.push({ mesh: o, box: _faded.get(o).box }); return; }
        if (_isActor(o)) return;
        const box = new THREE.Box3().setFromObject(o);
        if (box.isEmpty()) return;
        _occluders.push({ mesh: o, box });
      });
    }

    function _setFadeOpacity(state, a) {
      for (const m of state.clones) m.opacity = a;
    }

    function _restoreFaded(mesh, state) {
      mesh.material = state.orig;
      for (const m of state.clones) m.dispose();
      _faded.delete(mesh);
    }

    function _resetOcclusion() {
      for (const [mesh, state] of _faded) _restoreFaded(mesh, state);
      _occluders = [];
      _occluderBuiltAt = -Infinity;
    }

    function _tickOcclusion(dt, now, _scene, _camera, _player) {
      const THREE = window.THREE;
      if (!THREE || !_player || !_camera || !_scene) return;
      if (now - _occluderBuiltAt > OCCLUDE.REBUILD_MS) {
        _rebuildOccluders(_scene);
        _occluderBuiltAt = now;
      }
      const s = _player.scale.y || 1;
      const px = _player.position.x, py = _player.position.y, pz = _player.position.z;
      const cam = _camera.position;
      const targets = [0.25, 1.15, 1.9].map((h) => new THREE.Vector3(px, py + h * s, pz));
      const ray = new THREE.Ray();
      const hitPt = new THREE.Vector3();
      const blocking = new Set();
      for (const t of targets) {
        const len = cam.distanceTo(t);
        ray.origin.copy(cam);
        ray.direction.copy(t).sub(cam).normalize();
        for (const oc of _occluders) {
          const mesh = oc.mesh;
          if (!mesh.visible || !mesh.parent || blocking.has(mesh)) continue;
          // Boxes that hold the player (sky dome, the floor under them) never
          // count — only things between the camera and the character.
          if (oc.box.containsPoint(t)) continue;
          if (!ray.intersectBox(oc.box, hitPt)) continue;
          if (cam.distanceTo(hitPt) < len - OCCLUDE.PAD) blocking.add(mesh);
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

    return { tick: _tickOcclusion, reset: _resetOcclusion };
  }

  root.PG3DOcclusion = { create };
})(typeof self !== 'undefined' ? self : this);
