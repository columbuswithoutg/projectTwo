/************************************************
 * PLAYGROUND3D GEAR — clothes and accessories built FOR the realistic body
 *
 * The realistic (rigged) bodies used to borrow the Box body's pieces, built
 * round a 0.55 cube head and a blocky torso: glasses floated in front of the
 * face, hats perched on the crown, the hoodie's hood was a torso-sized white
 * sphere, belts and emblems were buried in the chest and bow ties floated.
 * Everything here is fitted to the MEASURED body instead
 * (inst.measure() → js/playground3d-gear-logic.js) and authored directly in
 * bind-pose body space, then hung on a bone (inst.mountRigid) or added as a
 * clipped garment shell (inst.addShell).
 *
 *   PG3DGear.attach(inst, c, ctx)   everything for one character
 *     ctx: { gearMat(hex, opts), palette(name, idx), hidden, buildEmblem,
 *            buildHelmet }
 *
 * Box bodies never come here (js/playground3d-avatar.js keeps their pieces).
 ************************************************/
(function (root) {
  'use strict';

  const G = () => root.PG3DGearLogic;
  const T = () => root.THREE;

  // ── geometry helpers ──

  // An ellipsoid cap: from the crown down to `plane` (kept where
  // dot(n, p) >= d), optionally starting below `opts.top` (a band). The rim
  // follows the plane exactly, so hems are clean. Positions in body space.
  function ellipsoidCap(c, r, plane, opts) {
    const THREE = T();
    opts = opts || {};
    const nU = opts.u || 44, nV = opts.v || 16;
    const pt = (th, ph) => [
      c[0] + r[0] * Math.sin(th) * Math.sin(ph),
      c[1] + r[1] * Math.cos(th),
      c[2] + r[2] * Math.sin(th) * Math.cos(ph)
    ];
    const side = (pl, p) => pl[0] * p[0] + pl[1] * p[1] + pl[2] * p[2] - pl[3];
    // Largest polar angle still on the kept side of `pl` (bisection).
    const limit = (pl, ph) => {
      if (side(pl, pt(Math.PI, ph)) >= 0) return Math.PI;
      if (side(pl, pt(0, ph)) < 0) return 0;
      let lo = 0, hi = Math.PI;
      for (let i = 0; i < 28; i++) {
        const mid = (lo + hi) / 2;
        if (side(pl, pt(mid, ph)) >= 0) lo = mid; else hi = mid;
      }
      return lo;
    };
    const pos = [], rim = [];
    for (let j = 0; j <= nU; j++) {
      const ph = (j / nU) * Math.PI * 2;
      const t1 = limit(plane, ph);
      // `top` (a band's upper edge): kept BELOW it — start where we cross it.
      const t0 = opts.top ? Math.min(t1, _cross(opts.top, ph, pt, side)) : 0;
      for (let i = 0; i <= nV; i++) {
        const th = t0 + (t1 - t0) * (i / nV);
        pos.push(...pt(th, ph));
      }
      rim.push(pt(t1, ph));
    }
    const idx = [];
    for (let j = 0; j < nU; j++) {
      for (let i = 0; i < nV; i++) {
        const a = j * (nV + 1) + i, b = (j + 1) * (nV + 1) + i;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // rim: one point per meridian; the last repeats the first (closed loop).
    return { geometry: g, rim };
  }

  // A closed rim loop for tube(): drop the repeated end point (a zero-length
  // segment breaks the tube's frames) and thin it out.
  function loop(rim, step) {
    const out = [];
    for (let i = 0; i < rim.length - 1; i += step || 1) out.push(rim[i]);
    return out;
  }
  // Polar angle where a meridian first crosses below `top` (for bands).
  function _cross(top, ph, pt, side) {
    if (side(top, pt(0, ph)) <= 0) return 0;
    let lo = 0, hi = Math.PI;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (side(top, pt(mid, ph)) > 0) lo = mid; else hi = mid;
    }
    return hi;
  }

  function tube(points, radius, closed, mat) {
    const THREE = T();
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), !!closed);
    return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, points.length * 2), radius, 8, !!closed), mat);
  }

  function shade(hex, k) {
    const r = Math.round(((hex >> 16) & 255) * k), g = Math.round(((hex >> 8) & 255) * k), b = Math.round((hex & 255) * k);
    return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
  }

  // Merge a group's meshes that share a material into one mesh per material,
  // transforms baked in (relative to the group), indices kept: a pair of
  // glasses was 9 draw calls, a utility belt 11. → a new Group.
  function compact(group) {
    const THREE = T();
    if (!group) return group;
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const byMat = new Map();
    group.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!byMat.has(o.material)) byMat.set(o.material, { list: [], cast: o.castShadow, ud: o.userData });
      byMat.get(o.material).list.push(g);
    });
    const out = new THREE.Group();
    out.name = group.name;
    out.position.copy(group.position);
    out.quaternion.copy(group.quaternion);
    out.scale.copy(group.scale);
    for (const [mat, { list, cast, ud }] of byMat) {
      const color = list.every((g) => g.attributes.color);
      let nv = 0, ni = 0;
      for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = color ? new Float32Array(nv * 3) : null;
      const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let vo = 0, io = 0;
      for (const g of list) {
        const p = g.attributes.position, n = g.attributes.normal, cl = g.attributes.color;
        for (let i = 0; i < p.count; i++) {
          const k = (vo + i) * 3;
          pos[k] = p.getX(i); pos[k + 1] = p.getY(i); pos[k + 2] = p.getZ(i);
          nor[k] = n.getX(i); nor[k + 1] = n.getY(i); nor[k + 2] = n.getZ(i);
          if (col) { col[k] = cl.getX(i); col[k + 1] = cl.getY(i); col[k + 2] = cl.getZ(i); }
        }
        if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
        else for (let i = 0; i < p.count; i++) idx[io + i] = vo + i;
        vo += p.count;
        io += g.index ? g.index.count : p.count;
        g.dispose();
      }
      const merged = new THREE.BufferGeometry();
      merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      if (col) merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
      merged.setIndex(new THREE.BufferAttribute(idx, 1));
      const m = new THREE.Mesh(merged, mat);
      m.name = group.name;
      m.castShadow = cast;
      m.receiveShadow = true;
      m.userData.castsShadow = !!ud.castsShadow;
      m.userData.ownGeometry = true;
      out.add(m);
    }
    group.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    return out;
  }

  function flagShadows(obj, silhouette) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = !!silhouette;
      o.receiveShadow = true;
      if (silhouette) o.userData.castsShadow = true;
      o.userData.ownGeometry = true;
    });
    return obj;
  }

  // ── glasses ──

  function glasses(H, style, ctx) {
    const THREE = T();
    const F = G().glassesFit(H, style);
    const grp = new THREE.Group();
    grp.name = 'gear:glasses';
    const frame = ctx.gearMat(style === 3 ? 0xb8962e : 0x1c1c1c, style === 3 ? { metal: 0.85, rough: 0.3 } : { metal: 0.2, rough: 0.45 });
    const glass = new THREE.MeshStandardMaterial({
      color: style === 3 ? 0x2a3a4a : 0xdfe8f0, transparent: true, opacity: style === 3 ? 0.62 : 0.16,
      roughness: 0.08, metalness: 0.1, depthWrite: false
    });
    glass.userData.baseOpacity = glass.opacity;
    const tubeR = F.tube;
    for (const s of [-1, 1]) {
      const lens = new THREE.Group();
      const cx = s * Math.abs(F.lens[0][0]);
      lens.position.set(cx, F.lensY, F.lensZ);
      lens.rotation.y = s * F.wrap;                  // outer edge back: wraps round the face
      const hw = F.w / 2, hh = F.h / 2;
      let ring;
      if (style === 2) {
        // Rounded rectangle.
        const shape = new THREE.Shape();
        const rr = Math.min(0.004, hh * 0.4);
        shape.moveTo(-hw + rr, -hh); shape.lineTo(hw - rr, -hh); shape.quadraticCurveTo(hw, -hh, hw, -hh + rr);
        shape.lineTo(hw, hh - rr); shape.quadraticCurveTo(hw, hh, hw - rr, hh); shape.lineTo(-hw + rr, hh);
        shape.quadraticCurveTo(-hw, hh, -hw, hh - rr); shape.lineTo(-hw, -hh + rr); shape.quadraticCurveTo(-hw, -hh, -hw + rr, -hh);
        const pts = shape.getSpacedPoints(48).map((p) => [p.x, p.y, 0]);
        ring = tube(pts, tubeR, true, frame);
        const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), glass);
        lens.add(fill);
      } else if (style === 4) {
        // Half-rim: a bar on top, the lens below rimless.
        const pts = [];
        for (let k = 0; k <= 16; k++) { const a = Math.PI * (k / 16); pts.push([Math.cos(a) * hw, Math.sin(a) * hh * 0.35 + hh * 0.2, 0]); }
        ring = tube(pts, tubeR, false, frame);
        const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 28), glass);
        fill.scale.set(hw, hh, 1);
        lens.add(fill);
      } else {
        // Round; aviators are a teardrop (wider at the bottom outside).
        const pts = [];
        for (let k = 0; k < 40; k++) {
          const a = (k / 40) * Math.PI * 2;
          let x = Math.cos(a) * hw, y = Math.sin(a) * hh;
          if (style === 3 && y < 0) { x *= 1 + 0.12 * (-y / hh) * Math.sign(x * s); y *= 1.08; }
          pts.push([x, y, 0]);
        }
        ring = tube(pts, tubeR, true, frame);
        const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 32), glass);
        fill.scale.set(hw * 0.98, hh * 0.98, 1);
        lens.add(fill);
      }
      lens.add(ring);
      grp.add(lens);
      // Temple arm: hinge → over the ear.
      const hinge = [s * F.hinge[0], F.hinge[1], F.hinge[2]];
      const end = [s * F.templeEnd[0], F.templeEnd[1], F.templeEnd[2]];
      const mid = [s * (F.templeEnd[0] + 0.002), (hinge[1] + end[1]) / 2 + 0.002, (hinge[2] + end[2]) / 2];
      const drop = [end[0], end[1] - 0.014, end[2] - 0.012];
      grp.add(tube([hinge, mid, end, drop], tubeR * 0.8, false, frame));
    }
    // Bridge over the nose.
    const bx = F.bridge.halfGap;
    grp.add(tube([[-bx - 0.002, F.bridge.y - 0.002, F.lensZ], [0, F.bridge.y + 0.003, F.bridge.z], [bx + 0.002, F.bridge.y - 0.002, F.lensZ]], tubeR * 0.9, false, frame));
    if (style === 3) {                                // aviator double bridge
      grp.add(tube([[-bx - 0.004, F.lensY + F.h * 0.38, F.lensZ], [0, F.lensY + F.h * 0.42, F.bridge.z], [bx + 0.004, F.lensY + F.h * 0.38, F.lensZ]], tubeR * 0.8, false, frame));
    }
    grp.traverse((o) => { if (o.isMesh) { o.userData.ownGeometry = true; o.castShadow = false; } });
    grp.userData.noFrame = true;
    return grp;
  }

  // ── hats ──

  function hat(H, style, c, ctx) {
    const THREE = T();
    const bald = c.hairStyle === 4;
    const F = G().hatFit(H, style, { bald });
    const grp = new THREE.Group();
    grp.name = 'gear:hat';
    if (F.kind === 'tophat') {
      // Built round the band centre, then tipped back about it.
      grp.position.set(F.c[0], F.c[1], F.c[2]);
      grp.rotation.x = F.tilt;
      const black = ctx.gearMat(0x141414, { rough: 0.55 });
      black.side = THREE.DoubleSide;
      const band = ctx.gearMat(0xa02828, { rough: 0.6 });
      // Crown: slightly wider at the top, closed lid.
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(1.04, 1, 1, 40, 1, false), black);
      crown.scale.set(F.rx, F.crown, F.rz);
      crown.position.y = F.crown / 2;
      grp.add(crown);
      const bandM = new THREE.Mesh(new THREE.CylinderGeometry(1.004, 1, 1, 40, 1, true), band);
      bandM.scale.set(F.rx + 0.0015, F.band, F.rz + 0.0015);
      bandM.position.y = F.band / 2 + 0.003;
      grp.add(bandM);
      // Brim: an elliptic ring, its sides curling up a little.
      const prof = [];
      for (let k = 0; k <= 6; k++) { const t = k / 6; prof.push(new THREE.Vector2(1 + (F.brim / F.rx) * t, (0.006 / F.rx) * t * t)); }
      const brim = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), black);
      brim.scale.set(F.rx, F.rx, F.rz);
      grp.add(brim);
      return flagShadows(grp, true);
    }
    const hex = style === 1 ? 0x3a4a8a : ctx.palette('SHIRT_COLORS', c.shirtColor);
    const main = ctx.gearMat(hex, { rough: style === 1 ? 0.95 : 0.75 });
    main.side = THREE.DoubleSide;
    const dome = ellipsoidCap(F.c, F.r, F.plane, { u: 48, v: 18 });
    grp.add(new THREE.Mesh(dome.geometry, main));
    if (F.kind === 'beanie') {
      // Folded cuff: a band just outside the rim, in a darker tone.
      const cuffMat = ctx.gearMat(0x243466, { rough: 0.95 });
      cuffMat.side = THREE.DoubleSide;
      const top = [F.plane[0], F.plane[1], F.plane[2], F.plane[3] + F.cuff.height];
      const r2 = [F.r[0] + F.cuff.out, F.r[1] + F.cuff.out, F.r[2] + F.cuff.out];
      const band = ellipsoidCap(F.c, r2, F.plane, { u: 48, v: 4, top });
      grp.add(new THREE.Mesh(band.geometry, cuffMat));
      // A soft rolled edge along the rim.
      grp.add(tube(loop(band.rim, 2), 0.004, true, cuffMat));
    } else {
      // Cap: bill out over the brow + a button on top.
      const B = F.bill;
      const pos = [];
      const N = 16;
      for (let k = 0; k <= N; k++) {
        const a = -B.span / 2 + B.span * (k / N);
        // Rim point at this angle: front of the dome rim.
        const rimP = dome.rim[Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * (dome.rim.length - 1))];
        const out = Math.cos(a * 0.9) * B.len;
        const dir = [Math.sin(a), -Math.sin(B.droop), Math.cos(a)];
        pos.push(rimP[0], rimP[1], rimP[2]);
        pos.push(rimP[0] + dir[0] * out, rimP[1] + dir[1] * out, rimP[2] + dir[2] * out);
      }
      const idx = [];
      for (let k = 0; k < N; k++) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const billMat = ctx.gearMat(shade(hex, 0.8), { rough: 0.7 });
      billMat.side = THREE.DoubleSide;
      grp.add(new THREE.Mesh(g, billMat));
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), billMat);
      btn.position.set(F.c[0], F.c[1] + F.r[1], F.c[2]);
      grp.add(btn);
    }
    return flagShadows(grp, true);
  }

  // ── hoods ──

  // The neck as a ring, for pieces round its base. Measured a little up the
  // neck: the neck part's lowest rows are mostly torso-labelled triangles and
  // come out ~1 cm "wide". → theta → surface point { x, z, r, nx, nz }.
  function neckRing(M) {
    const N = M.neck;
    if (!N) return (th) => ({ x: 0.06 * Math.sin(th), z: 0.06 * Math.cos(th), r: 0.06, nx: Math.sin(th), nz: Math.cos(th) });
    const neckY = M.neckY != null ? M.neckY : N.y0;
    const yRef = Math.min(N.yMax - 0.02, Math.max(neckY + 0.03, N.y0 + 0.3 * (N.yMax - N.y0)));
    return (th) => G().surfaceAt(N, yRef, th);
  }

  // Hood worn UP (hat 4): a loose shell round the skull with an oval face
  // opening and a darker rim, tapering into the collar.
  function hoodUp(H, M, hex, ctx) {
    const THREE = T();
    const F = G().hoodFit(H);
    const main = ctx.gearMat(hex, { rough: 0.9 });
    main.side = THREE.DoubleSide;
    const grp = new THREE.Group();
    grp.name = 'gear:hood';
    const cap = ellipsoidCap(F.c, F.r, [0, 1, 0, F.bottomY], { u: 56, v: 26 });
    // Cut the face opening out of the shell.
    const g = cap.geometry;
    const p = g.attributes.position;
    const O = F.opening;
    const inOpening = (i) => {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      return z > O.zMin && ((x / O.rx) ** 2 + ((y - O.cy) / O.ry) ** 2) < 1;
    };
    const src = g.index.array, keep = [];
    for (let t = 0; t < src.length; t += 3) {
      const a = src[t], b = src[t + 1], c = src[t + 2];
      if (inOpening(a) && inOpening(b) && inOpening(c)) continue;
      if ((inOpening(a) + inOpening(b) + inOpening(c)) >= 2) continue;
      keep.push(a, b, c);
    }
    g.setIndex(keep);
    g.computeVertexNormals();
    grp.add(new THREE.Mesh(g, main));
    // Rim round the opening, on the hood's surface.
    const rimMat = ctx.gearMat(shade(hex, 0.7), { rough: 0.9 });
    const rimPts = [];
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      const x = Math.cos(a) * O.rx, y = O.cy + Math.sin(a) * O.ry;
      // z on the hood ellipsoid at (x, y), front side.
      const u = 1 - (x / F.r[0]) ** 2 - ((y - F.c[1]) / F.r[1]) ** 2;
      if (u <= 0 || y < F.bottomY) continue;
      rimPts.push([x, y, F.c[2] + F.r[2] * Math.sqrt(u)]);
    }
    if (rimPts.length > 8) grp.add(tube(rimPts, F.rim, false, rimMat));
    // A short skirt from the hood's lower edge in to the neck (measured on
    // the neck alone — the torso table there is as wide as the shoulders,
    // which flared this into a disc on the Huge build).
    const neckY = M.neckY != null ? M.neckY : H.chinY - 0.06;
    const t = (F.bottomY - F.c[1]) / F.r[1];
    const k = Math.sqrt(Math.max(0.05, 1 - t * t));
    // It reaches the base of the neck and drapes a little onto the
    // trapezius (stopping at the neck bone left a band of bare neck).
    const yb = Math.min(F.bottomY - 0.03, neckY - 0.022);
    const ring = neckRing(M);
    const N = 40, pos = [], idx = [];
    for (let j = 0; j <= N; j++) {
      const ph = (j / N) * Math.PI * 2;
      pos.push(F.c[0] + F.r[0] * k * Math.sin(ph), F.bottomY, F.c[2] + F.r[2] * k * Math.cos(ph));
      const n = ring(ph);
      const t = M.torso ? G().surfaceAt(M.torso, yb, ph) : n;
      const cz = t.z - t.nz * t.r;
      const r = Math.min(t.r, n.r * 1.8) + 0.012;
      pos.push(Math.sin(ph) * r, yb, cz + Math.cos(ph) * r);
    }
    for (let j = 0; j < N; j++) { const a = j * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g2.setIndex(idx);
    g2.computeVertexNormals();
    grp.add(new THREE.Mesh(g2, main));
    return flagShadows(grp, true);
  }

  // A pillow lying ON the torso: a grid over (theta, y) of the surface table,
  // pushed out along the surface by height(u, v) (u, v in 0..1; u runs with
  // theta, v up), kept where inside(u, v). Vertex colours darken toward the
  // edge (edge(u, v): 0 inside … 1 at the rim) so the fold reads as cloth.
  function surfacePillow(Tt, th0, th1, y0, y1, nu, nv, height, inside, edge) {
    const THREE = T();
    const pos = [], col = [];
    // The table is 1 cm × 7.5° bins: average a small neighbourhood so the
    // pillow doesn't inherit its steps.
    const S = G().surfaceAt;
    const smooth = (y, th) => {
      let r = 0, cz = 0;
      for (const [dy, dt] of [[0, 0], [0.008, 0], [-0.008, 0], [0, 0.07], [0, -0.07]]) {
        const s = S(Tt, y + dy, th + dt);
        r += s.r; cz += s.z - s.nz * s.r;
      }
      r /= 5; cz /= 5;
      return { x: Math.sin(th) * r, z: cz + Math.cos(th) * r, nx: Math.sin(th), nz: Math.cos(th) };
    };
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv;
        const y = y0 + (y1 - y0) * v;
        const s = smooth(y, th0 + (th1 - th0) * u);
        const h = height(u, v);
        pos.push(s.x + s.nx * h, y, s.z + s.nz * h);
        const k = 1 - 0.32 * Math.min(1, Math.max(0, edge(u, v)));
        col.push(k, k, k);
      }
    }
    const idx = [], W = nu + 1;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        if (!inside((i + 0.5) / nu, (j + 0.5) / nv)) continue;
        const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Hood DOWN (Hoodie top / hoodie outerwear): a collar roll round the back
  // and sides of the neck, the hood lying folded on the upper back (a pillow
  // that follows the back), and drawstrings. Sized from the neck — the old one
  // was a torso-sized sphere. `off`: the outermost layer over the chest (a
  // jacket worn over a hoodie top lifts it).
  function hoodDown(M, hex, ctx, off) {
    const THREE = T();
    const Gl = G();
    const grp = new THREE.Group();
    grp.name = 'gear:hood';
    if (!M.torso) return grp;
    off = off || 0;
    const neckY = M.neckY != null ? M.neckY : M.torso.yMax - 0.08;
    const ring = neckRing(M);
    const k = Math.max(0.8, Math.min(1.4, ring(Math.PI / 2).r / 0.07));
    const main = ctx.gearMat(hex, { rough: 0.9 });
    main.side = THREE.DoubleSide;
    const dark = ctx.gearMat(shade(hex, 0.72), { rough: 0.9 });
    // The folded hood: a rounded flap hanging from the neck, ~2 cm thick.
    // Its edge stands 3 mm proud (1 mm flickered against the shirt) and it
    // stays on the back, short of the shoulder tops.
    const W = 0.62, top = neckY - 0.004, bot = neckY - 0.17 * k;
    const d = (u, v) => ((u - 0.5) / 0.5) ** 2 + (1 - v) ** 2;
    const flapMat = ctx.gearMat(hex, { rough: 0.9 });
    flapMat.vertexColors = true;
    flapMat.side = THREE.DoubleSide;
    flapMat.polygonOffset = true;
    flapMat.polygonOffsetFactor = -1;
    flapMat.polygonOffsetUnits = -2;
    grp.add(new THREE.Mesh(surfacePillow(M.torso, Math.PI - W, Math.PI + W, bot, top, 24, 16,
      (u, v) => off + 0.003 + 0.02 * k * Math.pow(Math.max(0, 1 - d(u, v)), 0.55),
      (u, v) => d(u, v) < 1,
      (u, v) => (d(u, v) - 0.55) / 0.45), flapMat));
    // Collar roll: the hood's opening edge round the back and sides of the
    // neck's base, riding a little higher toward the sides (where it rests on
    // the trapezius).
    const roll = [];
    const rollR = 0.012 * k;
    for (let a = Math.PI / 2 + 0.3; a <= Math.PI * 1.5 - 0.3 + 1e-6; a += 0.1) {
      const s = ring(a);
      const out = s.r * 1.06 + off + rollR * 0.9;
      const cz = s.z - s.nz * s.r;
      roll.push([Math.sin(a) * out, neckY + 0.002 + 0.018 * (1 - Math.abs(Math.cos(a))), cz + Math.cos(a) * out]);
    }
    grp.add(tube(roll, rollR, false, main));
    // Drawstrings hanging at the front of the neck.
    for (const s of [-1, 1]) {
      const f = Gl.surfaceAt(M.torso, neckY - 0.012, s * 0.5);
      const f2 = Gl.surfaceAt(M.torso, neckY - 0.13, s * 0.42);
      const p0 = [f.x + f.nx * (off + 0.004), neckY - 0.012, f.z + f.nz * (off + 0.004)];
      const p1 = [f2.x + f2.nx * (off + 0.005), neckY - 0.13, f2.z + f2.nz * (off + 0.005)];
      grp.add(tube([p0, p1], 0.0025, false, dark));
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.0038, 0.016, 8), dark);
      tip.position.set(p1[0], p1[1] - 0.008, p1[2]);
      grp.add(tip);
    }
    return flagShadows(grp, false);
  }

  // ── masks, visor, helmets ──

  // Face masks as conforming shells (inst.addShell): they follow the face
  // exactly, with eye holes, instead of flat cards floating off it.
  function maskShells(H, style, hex) {
    const R = G().maskRegion(H, style);
    const planes = [[0, 1, 0, R.y[0]], [0, -1, 0, -R.y[1]], [0, 0, 1, R.zMin]];
    return [{
      kind: 'mask', parts: style === 4 ? ['head', 'neck'] : ['head'], hex,
      inflate: 0.0035, rough: 0.6, seam: 0.004, seamDark: 0.45,
      region: { planes, holes: R.holes, parts: style === 4 ? ['head', 'neck'] : ['head'] }
    }];
  }

  function visor(H, ctx, opts) {
    const THREE = T();
    const F = G().visorFit(H);
    const mat = ctx.gearMat((opts && opts.hex) || 0x113344, { metal: 0.5, rough: 0.15, emissive: 0x0a2233, emissiveIntensity: 0.5 });
    mat.transparent = true;
    mat.opacity = 0.85;
    mat.userData.baseOpacity = 0.85;
    mat.side = THREE.DoubleSide;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, F.height, 40, 1, true, -F.arc / 2, F.arc), mat);
    band.scale.set(F.rx, 1, F.rz);
    band.position.set(F.c[0], F.c[1], F.c[2]);
    const grp = new THREE.Group();
    grp.name = 'gear:visor';
    grp.add(band);
    return flagShadows(grp, false);
  }

  // The cowl: a hood that hugs the head and neck with eye holes and an open
  // lower face — two shells (the upper face down to just under the eyes, and
  // the back and sides below that).
  function cowlShells(H, hex) {
    const line = H.eyeY - 0.024;
    const holes = [{ cx: H.eyeX, cy: H.eyeY, rx: H.eyeR * 1.25, ry: H.eyeR * 0.8, zMin: H.eyeZ - 0.02 }];
    const base = { hex, inflate: 0.0045, rough: 0.55, seam: 0.004, seamDark: 0.35 };
    return [
      Object.assign({ kind: 'cowl', parts: ['head'], region: { planes: [[0, 1, 0, line]], holes, parts: ['head'] } }, base),
      Object.assign({ kind: 'cowl-back', parts: ['head', 'neck'], region: { planes: [[0, -1, 0, -(line + 0.002)], [0, 0, -1, -(H.eyeZ - 0.03)]], parts: ['head', 'neck'] } }, base)
    ];
  }

  // Dome helmets (Winged, Visor) over the skull, with the rim low at the back.
  function helmetDome(H, mat) {
    const THREE = T();
    const F = G().helmetFit(H);
    mat.side = THREE.DoubleSide;
    const dome = ellipsoidCap(F.c, F.r, F.plane, { u: 48, v: 18 });
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(dome.geometry, mat));
    grp.add(tube(loop(dome.rim, 2), 0.004, true, mat));
    return { grp, F };
  }

  // The Knight's great helm: an oval barrel round the whole head (nose and
  // ears included) with a low dome, an eye slit, a front ridge and breathing
  // holes. The Box piece stretched to the head's bounding box was a cube.
  function knightHelm(H, ctx, mat) {
    const THREE = T();
    const S = H.skull;
    const front = Math.max(H.noseZ, H.maxZ) + 0.014, back = H.minZ - 0.016;
    const cz = (front + back) / 2, rz = (front - back) / 2;
    const rx = Math.max(S.r[0], H.templeX, H.earX) + 0.02;
    const y0 = H.chinY - 0.022, y1 = H.crownY - 0.012;
    const grp = new THREE.Group();
    grp.name = 'gear:helmet';
    mat.side = THREE.DoubleSide;
    // Narrower at the top, like a real great helm (a straight one read as a bucket).
    const TOP = 0.9;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(TOP, 1, y1 - y0, 40, 1, true), mat);
    barrel.scale.set(rx, 1, rz);
    barrel.position.set(0, (y0 + y1) / 2, cz);
    grp.add(barrel);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.scale.set(rx * TOP, 0.06, rz * TOP);
    dome.position.set(0, y1, cz);
    grp.add(dome);
    const dark = ctx.gearMat(0x0b0b0d, { rough: 0.9 });
    // The barrel's half-axes at height y (it narrows toward the top).
    const axes = (y) => {
      const k = 1 - (1 - TOP) * Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
      return [rx * k, rz * k];
    };
    const at = (x, y, w, h) => {                 // a dark cut on the barrel's front
      const [ax, az] = axes(y);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), dark);
      const t = Math.max(-0.95, Math.min(0.95, x / ax));
      const z = cz + az * Math.sqrt(1 - t * t);
      m.position.set(x, y, z - 0.002);
      m.rotation.y = Math.atan2(x / (ax * ax), (z - cz) / (az * az));   // face the barrel's normal
      grp.add(m);
    };
    const eyeAx = axes(H.eyeY)[0];
    for (const s of [-1, 1]) at(s * eyeAx * 0.33, H.eyeY + 0.006, eyeAx * 0.5, 0.011);   // eye slits
    const holeAx = axes(H.noseY)[0];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) at(holeAx * (0.28 + i * 0.13), H.noseY - 0.018 - j * 0.016, 0.006, 0.006);
    // A ridge down the front, leaning back with the taper.
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.012, y1 - y0 - 0.01, 0.01), mat);
    ridge.position.set(0, (y0 + y1) / 2, cz + rz * (1 + TOP) / 2 + 0.002);
    ridge.rotation.x = -Math.atan2(rz * (1 - TOP), y1 - y0);
    grp.add(ridge);
    // A rolled rim at the bottom edge.
    const rim = [];
    for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI * 2; rim.push([Math.sin(a) * rx * 1.01, y0, cz + Math.cos(a) * rz * 1.01]); }
    grp.add(tube(rim, 0.004, true, mat));
    return flagShadows(grp, true);
  }

  function helmet(H, idx, ctx, mat) {
    const THREE = T();
    if (idx === 4) return knightHelm(H, ctx, mat);
    if (idx === 3 || idx === 5) {
      const { grp, F } = helmetDome(H, mat);
      grp.name = 'gear:helmet';
      if (idx === 3) {
        const wingMat = ctx.gearMat(0xd8dce4, { metal: 0.7, rough: 0.3 });
        for (const s of [-1, 1]) {
          const shape = new THREE.Shape();
          shape.moveTo(0, 0); shape.quadraticCurveTo(0.03, 0.05, 0.02, 0.1); shape.quadraticCurveTo(-0.01, 0.06, -0.035, 0.04);
          shape.quadraticCurveTo(-0.015, 0.02, 0, 0);
          const wing = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: false }), wingMat);
          wing.position.set(s * (F.r[0] + 0.004), H.eyeY + 0.035, F.c[2] - 0.01);
          wing.rotation.set(0, s * Math.PI / 2, s * -0.35);
          grp.add(wing);
        }
      } else {
        grp.add(visor(H, ctx, { hex: 0x28435a }));
      }
      return flagShadows(grp, true);
    }
    return null;   // Iron Man, Knight, Soldier: the fitted classic helmets (engine)
  }

  // ── torso pieces ──

  // How far the outermost clothing layer stands off the skin over the chest
  // or the waist (PG3DHumanoidLogic.outerLayer — the LAYER table the garment
  // shells use), so a piece sits ON it rather than inside it.
  function layerAt(c, zone) {
    const L = root.PG3DHumanoidLogic;
    return L && L.outerLayer ? L.outerLayer(c, zone) : 0;
  }

  // Angle round the torso at height y whose surface point lies at this x.
  function thetaForX(Tt, y, x) {
    const s = x < 0 ? -1 : 1, ax = Math.abs(x);
    let lo = 0, hi = Math.PI / 2;
    if (G().surfaceAt(Tt, y, s * hi).x * s <= ax) return s * hi;
    for (let i = 0; i < 14; i++) {                // ~0.1 mrad: far below a pixel
      const mid = (lo + hi) / 2;
      if (G().surfaceAt(Tt, y, s * mid).x * s < ax) lo = mid; else hi = mid;
    }
    return s * (lo + hi) / 2;
  }

  // Split triangles (longest edge first) until no edge is longer than
  // `maxEdge`, so a flat piece can be bent onto the body without its faces
  // cutting into it (a 7 cm chord on the chest sags ~1 cm). → non-indexed.
  function subdivide(geometry, maxEdge) {
    const THREE = T();
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.attributes.position.array;
    const out = [];
    const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const m2 = maxEdge * maxEdge;
    const tri = (a, b, c, depth) => {
      const ab = d2(a, b), bc = d2(b, c), ca = d2(c, a);
      const m = Math.max(ab, bc, ca);
      if (m <= m2 || depth >= 10) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); return; }
      if (m === ab) { const d = mid(a, b); tri(a, d, c, depth + 1); tri(d, b, c, depth + 1); }
      else if (m === bc) { const d = mid(b, c); tri(a, b, d, depth + 1); tri(a, d, c, depth + 1); }
      else { const d = mid(c, a); tri(a, b, d, depth + 1); tri(d, b, c, depth + 1); }
    };
    for (let i = 0; i < p.length; i += 9) {
      tri([p[i], p[i + 1], p[i + 2]], [p[i + 3], p[i + 4], p[i + 5]], [p[i + 6], p[i + 7], p[i + 8]], 0);
    }
    if (g !== geometry) g.dispose();
    const res = new THREE.BufferGeometry();
    res.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    return res;
  }

  // Belts: a band that follows the waist (a shell) + a buckle and pouches
  // standing on it. Style: 1 Belt, 2 Utility, 3 Sash, 4 Widow.
  // → { shells, group, anchor }
  function belt(M, style, hex, c, ctx) {
    const THREE = T();
    const Gl = G();
    if (!M.torso) return { shells: [], group: null };
    const y = M.waistY;
    const base = layerAt(c, 'waist');
    const grp = new THREE.Group();
    grp.name = 'gear:belt';
    if (style === 3) {
      // Sash: over the left shoulder, down to the right hip, front and back.
      const sh = M.shoulders && M.shoulders[0];
      const sY = sh ? sh[1] : y + 0.42, sX = sh ? Math.abs(sh[0]) : 0.17;
      const hipX = Gl.surfaceAt(M.torso, y - 0.08, Math.PI / 2).r;
      const lift = Math.max(base, layerAt(c, 'chest'));
      const shells = [{
        kind: 'sash', parts: ['torso', 'pelvis'], hex, inflate: lift + 0.006, rough: 0.8, seam: 0.005, seamDark: 0.32,
        region: { planes: Gl.bandPlanes([sX * 0.8, sY - 0.01], [-hipX * 0.85, y - 0.08], 0.075).map((p) => p.concat([0])), parts: ['torso', 'pelvis'] }
      }];
      // A knot on the right hip with two short tails.
      const th = -1.05;
      const k = Gl.surfaceAt(M.torso, y - 0.075, th);
      const kOut = lift + 0.018;
      const knotMat = ctx.gearMat(shade(hex, 0.82), { rough: 0.8 });
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), knotMat);
      knot.position.set(k.x + k.nx * kOut, y - 0.075, k.z + k.nz * kOut);
      knot.scale.set(1, 0.85, 0.6);
      knot.rotation.y = th;
      grp.add(knot);
      for (const s of [-1, 1]) {
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.085, 0.006), knotMat);
        tail.position.set(knot.position.x + s * 0.011 * Math.cos(th), knot.position.y - 0.05, knot.position.z - s * 0.011 * Math.sin(th));
        tail.rotation.set(0, th, s * 0.18);
        grp.add(tail);
      }
      return { shells, group: flagShadows(grp, false), anchor: 'pelvis' };
    }
    const h = style === 4 ? 0.022 : 0.034;
    const top = y + h * 0.35, bot = y - h * 0.65, mid = (top + bot) / 2;
    const out = base + 0.005;                       // the belt's own surface
    const shells = [{
      kind: 'belt', parts: ['torso', 'pelvis'], hex, inflate: out,
      rough: style === 4 ? 0.35 : 0.55, metal: style === 4 ? 0.2 : 0.05, seam: 0.004, seamDark: 0.42,
      region: { planes: [[0, 1, 0, bot], [0, -1, 0, -top]], parts: ['torso', 'pelvis'] }
    }];
    const f = Gl.surfaceAt(M.torso, mid, 0);
    const z = f.z + out;
    if (style === 4) {
      // Black Widow: a round black buckle with the red hourglass.
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.008, 24), ctx.gearMat(0x141414, { metal: 0.6, rough: 0.3 }));
      disc.rotation.x = Math.PI / 2;
      disc.position.set(0, mid, z + 0.003);
      grp.add(disc);
      const red = ctx.gearMat(0xd01818, { metal: 0.3, rough: 0.4, emissive: 0x500000, emissiveIntensity: 0.4 });
      for (const s of [-1, 1]) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.015, 3), red);
        cone.rotation.set(s > 0 ? Math.PI : 0, 0, 0);
        cone.position.set(0, mid + s * 0.0075, z + 0.008);
        cone.scale.z = 0.4;
        grp.add(cone);
      }
    } else {
      const metal = style === 2 ? 0xd9a420 : 0xc9ccd4;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.044, h * 1.05, 0.006), ctx.gearMat(metal, { metal: 0.85, rough: 0.3 }));
      frame.position.set(0, mid, z + 0.003);
      grp.add(frame);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.03, h * 0.62, 0.004), ctx.gearMat(shade(metal, 0.7), { metal: 0.8, rough: 0.35 }));
      plate.position.set(0, mid, z + 0.0055);
      grp.add(plate);
      if (style === 2) {
        // Utility pouches round the waist.
        const pouchMat = ctx.gearMat(shade(hex, 0.85), { rough: 0.7 });
        const flapMat = ctx.gearMat(shade(hex, 0.68), { rough: 0.7 });
        for (const th of [0.62, -0.62, 1.2, -1.2]) {
          const s = Gl.surfaceAt(M.torso, mid - 0.006, th);
          const d = out + 0.011;
          const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.044, 0.022), pouchMat);
          pouch.position.set(s.x + s.nx * d, mid - 0.006, s.z + s.nz * d);
          pouch.rotation.y = th;
          grp.add(pouch);
          const flap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.016, 0.024), flapMat);
          flap.position.set(pouch.position.x + s.nx * 0.001, mid + 0.012, pouch.position.z + s.nz * 0.001);
          flap.rotation.y = th;
          grp.add(flap);
        }
      }
    }
    return { shells, group: flagShadows(grp, false), anchor: 'pelvis' };
  }

  // A five-pointed star in the xy plane, `depth` thick, centred on z = 0.
  function starGeometry(R, depth) {
    const THREE = T();
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? R * 0.42 : R;
      if (i) shape.lineTo(Math.cos(a) * r, Math.sin(a) * r); else shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    return g;
  }

  // Chest emblems: the Box body's emblem pieces, scaled to this chest and
  // bent onto the outermost layer at chest height (they used to sit inside
  // the chest, invisible). Reliefs keep their depth below the emblem's face.
  function emblem(M, idx, matHex, c, ctx) {
    const THREE = T();
    const Gl = G();
    if (!M.torso || !ctx.buildEmblem) return null;
    const box = ctx.buildEmblem(idx, ctx.gearMat(matHex, { metal: 0.35, rough: 0.45 }), { TORSO_D: 0 });
    if (!box) return null;
    box.position.set(0, 0, 0);
    // The Box "stars" are 5-sided cylinders (pentagons): real stars here.
    box.traverse((o) => {
      const p = o.isMesh && o.geometry.parameters;
      if (!p || o.geometry.type !== 'CylinderGeometry' || p.radialSegments !== 5) return;
      o.geometry.dispose();
      o.geometry = starGeometry(p.radiusTop, p.height);
      o.rotation.set(0, 0, 0);
    });
    box.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(box);
    const neckY = M.neckY != null ? M.neckY : M.torso.yMax - 0.1;
    const chestY = M.chestY != null ? M.chestY : neckY - 0.15;
    // Sized from the chest's FRONT (60° round from the middle): the side
    // radius takes in the lats and blew the Huge build's emblems up.
    const front = Gl.surfaceAt(M.torso, chestY, Math.PI / 3).x;
    const s = Math.min(0.85, Math.max(0.45, 0.6 * Math.pow(front / 0.13, 0.8)));
    // Centred a little above the chest line, but never up onto the neck.
    const y0 = Math.min(chestY + 0.15 * (neckY - chestY), neckY - 0.035 - bb.max.y * s);
    const off = layerAt(c, 'chest') + 0.004;
    const zFront = bb.max.z;
    const grp = new THREE.Group();
    grp.name = 'gear:emblem';
    const v = new THREE.Vector3();
    box.traverse((o) => {
      if (!o.isMesh) return;
      const src = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const sp = src.attributes.position;
      for (let i = 0; i < sp.count; i++) sp.setXYZ(i, sp.getX(i) * s, sp.getY(i) * s, (sp.getZ(i) - zFront) * s);
      const g = subdivide(src, 0.03);            // a 3 cm chord sags < 1 mm on the chest
      src.dispose();
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const y = y0 + v.y;
        const surf = Gl.surfaceAt(M.torso, y, thetaForX(M.torso, y, v.x));
        const k = off + 0.006 + v.z;            // v.z ≤ 0: below the face
        p.setXYZ(i, surf.x + surf.nx * k, y, surf.z + surf.nz * k);
      }
      g.computeVertexNormals();
      grp.add(new THREE.Mesh(g, o.material));
    });
    box.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    return flagShadows(grp, false);
  }

  // The Box quiver hangs a blocky torso's depth behind its slot (~8 cm off a
  // real back): sit it on the measured back, over whatever is worn, and add
  // the strap across the chest. `q` lives in a chest slot centred on the
  // torso's box (+ slotY), in that slot's body-aligned frame.
  function seatQuiver(inst, q, slotY, c) {
    const M = inst.measure && inst.measure();
    const box = inst.partBox && inst.partBox('torso');
    if (!M || !M.torso || !box || !q) return;
    const Gl = G();
    const cx = box.center[0] + q.position.x, cy = box.center[1] + slotY + q.position.y;
    // The back's surface at (cx, cy): x = sin θ · r falls from +r to −r
    // across the back half (θ π/2 → 3π/2).
    let lo = Math.PI / 2, hi = Math.PI * 1.5;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (Gl.surfaceAt(M.torso, cy, mid).x > cx) lo = mid; else hi = mid;
    }
    const s = Gl.surfaceAt(M.torso, cy, (lo + hi) / 2);
    const off = layerAt(c, 'chest') + 0.004;
    q.position.z = (s.z - off - 0.068) - box.center[2];
    // The strap: over the quiver-side (right) shoulder to the opposite hip.
    const sh = M.shoulders && M.shoulders[1];
    const sX = sh ? Math.abs(sh[0]) : 0.17, sY = sh ? sh[1] : M.waistY + 0.4;
    const hipX = Gl.surfaceAt(M.torso, M.waistY - 0.04, Math.PI / 2).r;
    if (inst.addShell) {
      inst.addShell({
        kind: 'strap', parts: ['torso', 'pelvis'], hex: 0x4a3020, inflate: off + 0.002, rough: 0.8, seam: 0.004, seamDark: 0.4,
        region: { planes: Gl.bandPlanes([-sX * 0.75, sY], [hipX * 0.8, M.waistY - 0.04], 0.032).map((p) => p.concat([0])), parts: ['torso', 'pelvis'] }
      });
    }
  }

  // Polo bow tie: at the throat, on the collar.
  function bowTie(M, hex, c, ctx) {
    const THREE = T();
    if (!M.torso) return null;
    const y = (M.neckY != null ? M.neckY : M.torso.yMax - 0.1) + 0.004;
    const f = G().surfaceAt(M.torso, y, 0);
    const z = f.z + layerAt(c, 'chest') + 0.012;
    const mat = ctx.gearMat(hex, { rough: 0.6 });
    const grp = new THREE.Group();
    grp.name = 'gear:bowtie';
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.03, 12), mat);
      wing.rotation.z = s * Math.PI / 2;           // tips meet at the knot
      wing.scale.z = 0.45;
      wing.position.set(s * 0.015, y, z);
      grp.add(wing);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 10, 8), mat);
    knot.scale.set(1, 1.1, 0.7);
    knot.position.set(0, y, z + 0.002);
    grp.add(knot);
    return flagShadows(grp, false);
  }

  // ── everything for one character ──
  // → { helmetBuilt } (the engine still builds Iron Man, Knight and Soldier).
  function attach(inst, c, ctx) {
    const M = inst.measure();
    const H = M.head;
    const hidden = ctx.hidden || {};
    const out = { helmetBuilt: false };
    const pal = ctx.palette;
    const shirtHex = pal('SHIRT_COLORS', c.shirtColor);
    const accHex = pal('ACCESSORY_COLORS', c.accessoryColor);
    const suitOn = (c.suit ?? 0) > 0;
    const outerHood = (c.outerwear ?? 0) === 4;
    const topHood = !suitOn && (c.shirtStyle ?? 0) === 3;
    // Pieces lying on the body bend with it (skinned to the skin under
    // them); a bone mount is the fallback.
    const onBody = (obj, parts, bone) => (inst.mountSurface ? inst.mountSurface(compact(obj), parts) : inst.mountRigid(bone, compact(obj)));
    const onHead = (obj) => inst.mountRigid('head', compact(obj));

    // Hat, or the hood worn up (in the hoodie's colour when there is one).
    const hatIdx = hidden.hat ? 0 : (c.hat ?? 0);
    if (hatIdx === 4) {
      const hex = outerHood ? pal('SHIRT_COLORS', c.outerwearColor) : topHood ? shirtHex : 0x2a2a2a;
      onHead(hoodUp(H, M, hex, ctx));
    } else if (hatIdx) {
      onHead(hat(H, hatIdx, c, ctx));
    }
    if (!hidden.glasses && (c.glasses ?? 0)) onHead(glasses(H, c.glasses, ctx));
    const maskIdx = hidden.mask ? 0 : (c.mask ?? 0);
    if (maskIdx === 3) onHead(visor(H, ctx));
    else if (maskIdx) for (const sh of maskShells(H, maskIdx, accHex)) inst.addShell(sh);
    // Helmets: the cowl is a pair of shells, Winged/Visor are domes.
    const helm = c.helmet ?? 0;
    if (helm === 2) {
      for (const sh of cowlShells(H, pal('SHIRT_COLORS', c.helmetColor))) inst.addShell(sh);
      out.helmetBuilt = true;
    } else if (helm === 3 || helm === 4 || helm === 5) {
      const mat = ctx.gearMat(pal('SHIRT_COLORS', c.helmetColor), { metal: 0.7, rough: 0.35 });
      onHead(helmet(H, helm, ctx, mat));
      out.helmetBuilt = true;
    }

    // Hood down: the Hoodie top or the hoodie jacket, unless it's up.
    if ((outerHood || topHood) && hatIdx !== 4) {
      const hex = outerHood ? pal('SHIRT_COLORS', c.outerwearColor) : shirtHex;
      onBody(hoodDown(M, hex, ctx, layerAt(c, 'chest')), ['torso', 'neck'], 'chest');
    }

    const beltIdx = c.belt ?? 0;
    if (beltIdx) {
      const b = belt(M, beltIdx, accHex, c, ctx);
      for (const sh of b.shells) inst.addShell(sh);
      if (b.group) onBody(b.group, ['torso', 'pelvis'], b.anchor);
    }

    if ((c.emblem ?? 0) > 0) {
      const e = emblem(M, c.emblem, pal('SHIRT_COLORS', c.emblemColor), c, ctx);
      if (e) onBody(e, ['torso'], 'chest');
    }

    // Polo with an accent colour: a bow tie at the collar.
    if (!suitOn && (c.shirtStyle ?? 0) === 4 && (c.shirtColor2 ?? 0) > 0) {
      const bt = bowTie(M, pal('SHIRT_COLORS', c.shirtColor2 - 1), c, ctx);
      if (bt) onBody(bt, ['torso', 'neck'], 'chest');
    }
    return out;
  }

  root.PG3DGear = {
    attach, ellipsoidCap, subdivide, compact, layerAt, seatQuiver,
    glasses, hat, hoodUp, hoodDown, maskShells, cowlShells, visor, helmet, belt, emblem, bowTie
  };
})(typeof self !== 'undefined' ? self : this);
