/************************************************
 * PLAYGROUND 3D — Scene Guess props (driven by js/scene-guess.js)
 *
 * The minigame's 3D side, kept out of js/playground3d.js:
 *   screenSpot(project, projects, WORLD, wallHeight)
 *       where an island's cinema-wall screen hangs (pure maths): the longest
 *       door-free stretch of inner wall, judged from EVERY road the island
 *       will ever have (all prerequisite links, both ways) — so the screen
 *       sits in the same spot for everyone and an unlocked road can never
 *       open a doorway under it. Bottom 1.9 (over 1.8-tall bookshelves),
 *       0.3 below the wall top and from each end; 16:10 = picture + marquee.
 *   makeScreen(THREE, spot)        the screen: a canvas texture + slim bezel
 *   drawScreen(ctx, view, imgOf)   paints one frame of it
 *   makeCrown(THREE)               the champion's crown (shared geometry)
 *   makeConfetti(THREE, x, y, z)   a one-shot burst — update(dt) → alive
 *   makeSpotlight(THREE)           the champion's arrival beam
 * Attaches window.PG3DScene. Load BEFORE js/playground3d.js.
 ************************************************/
(function (root) {
  const SCREEN = { BOTTOM: 1.9, TOP_GAP: 0.3, SIDE_GAP: 0.3, ASPECT: 1.6, OFF_WALL: 0.06, MIN_W: 1.2 };
  const CW = 1280, CH = 800, PIC = 720;          // canvas: 1280×720 picture + an 80px marquee
  const COLORS = ['#e3243f', '#3b82f6', '#22a861', '#a855f7', '#f97316', '#0ea5b7'];
  const DISPLAY = '"Bebas Neue", "Oswald", Impact, "Arial Narrow", sans-serif';
  const UI = '"Inter", "Segoe UI", system-ui, sans-serif';

  // ── placement ──

  // Doorway spans per side over every road the island will ever have. Same
  // maths as playground3d.js _doorwayOnSide / _sideOpenings.
  function allOpenings(project, projects, W) {
    const HALF = W.PLATFORM_W / 2, D = W.DOORWAY_WIDTH;
    const cx = project.gridX * W.SCALE, cz = project.gridY * W.SCALE;
    const byId = new Map((projects || []).map(p => [p.id, p]));
    const others = [];
    for (const id of (project.prerequisites || [])) { const q = byId.get(id); if (q) others.push(q); }
    for (const q of projects || []) {
      if (q && q.id !== project.id && Array.isArray(q.prerequisites) && q.prerequisites.includes(project.id)) others.push(q);
    }
    const sides = { N: [], S: [], E: [], W: [] };
    for (const q of others) {
      if (typeof q.gridX !== 'number' || typeof q.gridY !== 'number') continue;
      const dx = q.gridX * W.SCALE - cx, dz = q.gridY * W.SCALE - cz;
      if (!dx && !dz) continue;
      if (Math.abs(dx) >= Math.abs(dz)) {
        const exitZ = cz + dz * (HALF / Math.abs(dx));
        sides[dx > 0 ? 'E' : 'W'].push(Math.max(cz - HALF + 0.5, Math.min(cz + HALF - 0.5, exitZ)));
      } else {
        const exitX = cx + dx * (HALF / Math.abs(dz));
        sides[dz > 0 ? 'S' : 'N'].push(Math.max(cx - HALF + 0.5, Math.min(cx + HALF - 0.5, exitX)));
      }
    }
    const out = {};
    for (const s of ['N', 'S', 'E', 'W']) {
      const start = ((s === 'N' || s === 'S') ? cx : cz) - HALF, end = start + 2 * HALF;
      const opens = [];
      for (const c of sides[s].sort((a, b) => a - b)) {
        const a = Math.max(start, c - D / 2), b = Math.min(end, c + D / 2);
        if (b - a < 0.1) continue;
        const last = opens[opens.length - 1];
        if (last && a - last[1] < W.DOORWAY_MERGE_GAP) last[1] = Math.max(last[1], b);
        else opens.push([a, b]);
      }
      out[s] = opens;
    }
    return out;
  }

  // { side, from, to (world coords along that wall), x, y, z (centre), w, h, rotY } or null.
  function screenSpot(project, projects, W, wallHeight) {
    if (!project || typeof project.gridX !== 'number' || typeof project.gridY !== 'number') return null;
    const HALF = W.PLATFORM_W / 2, T = W.WALL_THICKNESS;
    const cx = project.gridX * W.SCALE, cz = project.gridY * W.SCALE;
    const opens = allOpenings(project, projects, W);
    const opposite = { N: 'S', S: 'N', E: 'W', W: 'E' };
    let best = null;
    for (const s of ['N', 'S', 'W', 'E']) {
      const start = ((s === 'N' || s === 'S') ? cx : cz) - HALF + T, end = start + 2 * (HALF - T);
      let cursor = start;
      const stretches = [];
      for (const [a, b] of opens[s]) { if (a > cursor) stretches.push([cursor, a]); cursor = Math.max(cursor, b); }
      if (cursor < end) stretches.push([cursor, end]);
      for (const [a, b] of stretches) {
        // A tie goes to the wall across from a doorway: you face it walking in.
        const score = (b - a) + (opens[opposite[s]].length ? 0.001 : 0);
        if (!best || score > best.score + 1e-9) best = { side: s, a, b, score };
      }
    }
    if (!best) return null;
    const H = wallHeight || W.WALL_HEIGHT;
    const w = Math.max(SCREEN.MIN_W, Math.min((best.b - best.a) - 2 * SCREEN.SIDE_GAP, (H - SCREEN.BOTTOM - SCREEN.TOP_GAP) * SCREEN.ASPECT));
    const h = w / SCREEN.ASPECT;
    const mid = (best.a + best.b) / 2;
    const inner = HALF - T - SCREEN.OFF_WALL;
    let x, z, rotY;
    switch (best.side) {
      case 'N': x = mid; z = cz - inner; rotY = 0; break;
      case 'S': x = mid; z = cz + inner; rotY = Math.PI; break;
      case 'W': x = cx - inner; z = mid; rotY = Math.PI / 2; break;
      default:  x = cx + inner; z = mid; rotY = -Math.PI / 2; break;
    }
    return { side: best.side, from: mid - w / 2, to: mid + w / 2, x, y: SCREEN.BOTTOM + h / 2, z, w, h, rotY };
  }

  // ── the screen ──

  function makeScreen(THREE, spot) {
    const canvas = document.createElement('canvas');
    canvas.width = CW;
    canvas.height = CH;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    // Unlit and not tone-mapped: it glows like a real display at golden hour.
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const group = new THREE.Group();
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(spot.w, spot.h), mat);
    group.add(plane);
    // A slim bezel — four bars, no back panel: seen from behind the wall the
    // single-sided picture is invisible and only the outline remains.
    const bezelMat = new THREE.MeshLambertMaterial({ color: 0x0b0c10 });
    const t = 0.07, d = 0.08;
    const bars = [
      [spot.w + 2 * t, t, 0, spot.h / 2 + t / 2], [spot.w + 2 * t, t, 0, -spot.h / 2 - t / 2],
      [t, spot.h, -spot.w / 2 - t / 2, 0], [t, spot.h, spot.w / 2 + t / 2, 0]
    ];
    for (const [bw, bh, bx, by] of bars) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d), bezelMat);
      m.position.set(bx, by, -d / 2 + 0.01);
      group.add(m);
    }
    group.position.set(spot.x, spot.y, spot.z);
    group.rotation.y = spot.rotY;
    group.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    return { group, canvas, ctx, tex, mat, plane, spot };
  }

  function dispose(obj) {
    if (!obj) return;
    obj.traverse(o => {
      if (o.geometry && !(o.geometry.userData && o.geometry.userData.shared)) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) {
        if (m.userData && m.userData.shared) continue;
        if (m.map && m.map.isCanvasTexture) m.map.dispose();
        m.dispose();
      }
    });
    if (obj.parent) obj.parent.remove(obj);
  }

  // ── painting ──

  const fmt = (n) => Number(n || 0).toLocaleString();
  function fmtTime(sec) {
    const t = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }
  function initials(name) { return String(name || '?').replace(/^claude_qa_/, '').slice(0, 2).toUpperCase(); }
  function fit(ctx, text, max) {
    let s = String(text || '');
    while (s.length > 3 && ctx.measureText(s).width > max) s = s.slice(0, -2) + '…';
    return s;
  }
  // Letterbox an image into (x, y, w, h).
  function contain(ctx, img, x, y, w, h) {
    const r = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * r, dh = img.naturalHeight * r;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  function pill(ctx, x, y, text, bg, fg, font, alignRight) {
    ctx.font = font;
    const w = ctx.measureText(text).width + 36;
    const left = alignRight ? x - w : x;
    ctx.fillStyle = bg;
    roundRect(ctx, left, y, w, 56, 28);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + 18, y + 30);
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function backdrop(ctx) {
    const g = ctx.createLinearGradient(0, 0, CW, PIC);
    g.addColorStop(0, '#120a14');
    g.addColorStop(0.55, '#0b0d18');
    g.addColorStop(1, '#1a0b0b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CW, PIC);
  }
  function marquee(ctx, text) {
    const g = ctx.createLinearGradient(0, PIC, 0, CH);
    g.addColorStop(0, '#1b1406');
    g.addColorStop(1, '#0c0903');
    ctx.fillStyle = g;
    ctx.fillRect(0, PIC, CW, CH - PIC);
    ctx.fillStyle = '#d6b25e';
    ctx.fillRect(0, PIC, CW, 3);
    ctx.font = `600 34px ${UI}`;
    ctx.fillStyle = '#f5d98a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fit(ctx, text, CW - 60), CW / 2, PIC + 42);
  }
  function headline(ctx, big, small, y) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#d6b25e';
    ctx.font = `400 150px ${DISPLAY}`;
    ctx.fillText(big, CW / 2, y);
    if (small) {
      ctx.fillStyle = '#eceef3';
      ctx.font = `600 44px ${UI}`;
      ctx.fillText(fit(ctx, small, CW - 120), CW / 2, y + 70);
    }
  }

  // view: { mode, title, record:{username,score}|null, pickUrl, liveHost,
  //         state (public game state) | null, deadline (local ms) }
  // imgOf(url) → a loaded HTMLImageElement or null (still loading).
  function drawScreen(ctx, view, imgOf) {
    const v = view || { mode: 'idle' };
    const st = v.state || null;
    const secs = v.deadline ? Math.max(0, Math.ceil((v.deadline - Date.now()) / 1000)) : 0;
    const recText = v.record ? `🏆 Record ${fmt(v.record.score)} · ${v.record.username}` : 'No record yet — be the first champion';
    ctx.save();
    ctx.clearRect(0, 0, CW, CH);
    backdrop(ctx);
    const mode = v.mode || 'idle';

    if (mode === 'round' || mode === 'reveal') {
      const url = st && st.stills ? st.stills[st.round] : null;
      const img = url ? imgOf(url) : null;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, CW, PIC);
      if (img) contain(ctx, img, 0, 0, CW, PIC);
      else headline(ctx, '…', 'Loading the screenshot', 400);
      pill(ctx, 24, 22, `ROUND ${Math.min(st.of, st.round + 1)}/${st.of}`, 'rgba(0,0,0,0.72)', '#ffffff', `800 30px ${UI}`);
      if (mode === 'round') {
        pill(ctx, CW - 24, 22, `⏱ ${secs}s`, secs <= 5 ? 'rgba(200,16,46,0.9)' : 'rgba(0,0,0,0.72)', '#ffffff', `800 30px ${UI}`, true);
        // Who has locked in.
        let x = 24;
        (st.players || []).forEach((p, i) => {
          ctx.fillStyle = p.locked ? COLORS[i % COLORS.length] : 'rgba(0,0,0,0.6)';
          ctx.beginPath(); ctx.arc(x + 26, PIC - 44, 24, 0, Math.PI * 2); ctx.fill();
          ctx.lineWidth = 4; ctx.strokeStyle = COLORS[i % COLORS.length]; ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.font = `800 20px ${UI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(p.locked ? '✓' : initials(p.username), x + 26, PIC - 43);
          x += 60;
        });
        marquee(ctx, `When in ${v.title} is this?  ·  ${(st.players || []).filter(p => p.locked).length}/${(st.players || []).length} locked in`);
      } else {
        const h = (st.history || [])[st.round];
        if (h && st.timeline) drawRevealLine(ctx, st, h);
        const best = h ? [...h.guesses].sort((a, b) => b.points - a.points)[0] : null;
        marquee(ctx, h ? `It was at ${h.label}${best && best.at != null ? `  ·  closest: ${best.username} +${fmt(best.points)}` : ''}` : recText);
      }
    } else if (mode === 'lobby' && st) {
      headline(ctx, 'SCENE GUESS', `Lobby open · starts in ${secs}s`, 250);
      ctx.font = `700 40px ${UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      (st.players || []).slice(0, 6).forEach((p, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        const x = CW / 2 + (col - 1) * 380, y = 430 + row * 90;
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        roundRect(ctx, x - 170, y - 34, 340, 68, 34); ctx.fill();
        ctx.fillStyle = COLORS[i % COLORS.length];
        ctx.fillText(fit(ctx, p.username + (p.username === st.host ? ' ★' : ''), 310), x, y + 2);
      });
      marquee(ctx, `${(st.players || []).length}/${st.max} players  ·  walk up and press E to join`);
    } else if (mode === 'ready' && st) {
      headline(ctx, 'GET READY', `${(st.players || []).length} player${(st.players || []).length === 1 ? '' : 's'} · 10 screenshots`, 330);
      ctx.fillStyle = '#ffffff';
      ctx.font = `400 170px ${DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.fillText(String(secs), CW / 2, 610);
      marquee(ctx, `${v.title}  ·  ${recText}`);
    } else if (mode === 'results' && st) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = st.record ? '#ffd23f' : '#d6b25e';
      ctx.font = `400 104px ${DISPLAY}`;
      ctx.fillText(st.record ? '👑 NEW ISLAND RECORD' : 'FINAL SCORES', CW / 2, 130);
      (st.ranking || []).slice(0, 5).forEach((r, i) => {
        const y = 210 + i * 98;
        ctx.fillStyle = i === 0 ? 'rgba(255,210,63,0.16)' : 'rgba(255,255,255,0.06)';
        roundRect(ctx, 150, y, CW - 300, 80, 18); ctx.fill();
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.font = `800 40px ${UI}`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${i + 1}.`, 182, y + 42);
        ctx.fillStyle = COLORS[(st.players || []).findIndex(p => p.username === r.username) % COLORS.length] || '#ffffff';
        ctx.fillText(fit(ctx, r.username, 640), 250, y + 42);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(fmt(r.total), CW - 182, y + 42);
      });
      marquee(ctx, st.record ? `${st.record.username} is the champion of ${v.title} — ${fmt(st.record.score)}` : recText);
    } else {
      // Idle: the champion's pick, or a title card.
      const pick = v.pickUrl ? imgOf(v.pickUrl) : null;
      if (pick) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, CW, PIC);
        contain(ctx, pick, 0, 0, CW, PIC);
        if (v.record) pill(ctx, 24, 22, `👑 Champion's pick · ${v.record.username}`, 'rgba(0,0,0,0.72)', '#ffd23f', `800 30px ${UI}`);
      } else {
        headline(ctx, 'SCENE GUESS', v.title || '', 330);
        ctx.fillStyle = 'rgba(236,238,243,0.7)';
        ctx.font = `500 34px ${UI}`;
        ctx.textAlign = 'center';
        ctx.fillText('10 screenshots · when in the film is each one?', CW / 2, 480);
      }
      if (v.liveHost != null) {
        pill(ctx, CW - 24, 22, `● LIVE · ${v.liveHost || 'a game'} is playing`, 'rgba(200,16,46,0.9)', '#ffffff', `800 30px ${UI}`, true);
      }
      marquee(ctx, `${recText}   ·   Walk up and press E to play`);
    }
    ctx.restore();
  }

  // The reveal strip over the bottom of the picture: the line, the real
  // moment (gold) and every player's guess.
  function drawRevealLine(ctx, st, h) {
    const tl = st.timeline;
    const x0 = 70, x1 = CW - 70, y = PIC - 70;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    roundRect(ctx, 30, y - 64, CW - 60, 118, 22); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    roundRect(ctx, x0, y - 6, x1 - x0, 12, 6); ctx.fill();
    const X = (at) => x0 + (x1 - x0) * Math.max(0, Math.min(1, at / tl.total));
    h.guesses.forEach((g) => {
      if (g.at == null) return;
      const i = (st.players || []).findIndex(p => p.username === g.username);
      ctx.fillStyle = COLORS[(i < 0 ? 0 : i) % COLORS.length];
      ctx.beginPath(); ctx.arc(X(g.at), y, 15, 0, Math.PI * 2); ctx.fill();
    });
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(X(h.answer), y, 20, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = `800 22px ${UI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', X(h.answer), y + 1);
    ctx.fillStyle = '#ffd23f';
    ctx.font = `800 34px ${UI}`;
    ctx.fillText(`It was at ${h.label}`, CW / 2, y - 38);
  }

  // ── champion's crown ──

  let _crownParts = null;
  function makeCrown(THREE) {
    if (!_crownParts) {
      const gold = new THREE.MeshStandardMaterial({ color: 0xffc93c, metalness: 0.85, roughness: 0.28, emissive: 0x5a3c00, emissiveIntensity: 0.6 });
      const gem = new THREE.MeshStandardMaterial({ color: 0xe3243f, metalness: 0.2, roughness: 0.15, emissive: 0x5a0010, emissiveIntensity: 0.8 });
      gold.userData.shared = true;
      gem.userData.shared = true;
      const band = new THREE.CylinderGeometry(0.17, 0.16, 0.09, 20, 1, true);
      const spike = new THREE.ConeGeometry(0.045, 0.13, 8);
      const ball = new THREE.SphereGeometry(0.026, 10, 8);
      const stone = new THREE.SphereGeometry(0.03, 10, 8);
      for (const g of [band, spike, ball, stone]) g.userData.shared = true;
      _crownParts = { gold, gem, band, spike, ball, stone };
    }
    const P = _crownParts;
    const crown = new THREE.Group();
    const bandMesh = new THREE.Mesh(P.band, P.gold);
    bandMesh.material.side = THREE.DoubleSide;
    crown.add(bandMesh);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const s = new THREE.Mesh(P.spike, P.gold);
      s.position.set(Math.sin(a) * 0.155, 0.11, Math.cos(a) * 0.155);
      crown.add(s);
      const b = new THREE.Mesh(P.ball, P.gold);
      b.position.set(Math.sin(a) * 0.155, 0.18, Math.cos(a) * 0.155);
      crown.add(b);
      const g = new THREE.Mesh(P.stone, P.gem);
      g.position.set(Math.sin(a + Math.PI / 5) * 0.168, 0, Math.cos(a + Math.PI / 5) * 0.168);
      crown.add(g);
    }
    crown.traverse(o => { if (o.isMesh) { o.castShadow = false; o.userData.noOcclude = true; } });
    crown.userData.noOcclude = true;
    return crown;
  }

  // ── confetti burst ──

  function makeConfetti(THREE, x, y, z) {
    const N = 140;
    const geo = new THREE.PlaneGeometry(0.13, 0.2);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false, transparent: true });
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    mesh.userData.noOcclude = true;
    mesh.frustumCulled = false;
    const color = new THREE.Color();
    const parts = [];
    for (let i = 0; i < N; i++) {
      color.set(COLORS[i % COLORS.length]).offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
      if (i % 7 === 0) color.set('#ffd23f');
      mesh.setColorAt(i, color);
      const a = Math.random() * Math.PI * 2, sp = 1.2 + Math.random() * 2.6;
      parts.push({
        p: new THREE.Vector3(x, y, z),
        v: new THREE.Vector3(Math.cos(a) * sp, 2.2 + Math.random() * 2.6, Math.sin(a) * sp),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        w: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12)
      });
    }
    const dummy = new THREE.Object3D();
    let age = 0;
    const LIFE = 4.2;
    function update(dt) {
      age += dt;
      for (let i = 0; i < N; i++) {
        const q = parts[i];
        q.v.y -= 4.2 * dt;
        q.v.multiplyScalar(1 - 0.9 * dt);
        q.p.addScaledVector(q.v, dt);
        if (q.p.y < 0.05) { q.p.y = 0.05; q.v.set(0, 0, 0); }
        q.r.x += q.w.x * dt; q.r.y += q.w.y * dt; q.r.z += q.w.z * dt;
        dummy.position.copy(q.p);
        dummy.rotation.copy(q.r);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mat.opacity = age > LIFE - 0.8 ? Math.max(0, (LIFE - age) / 0.8) : 1;
      return age < LIFE;
    }
    update(0);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return { mesh, update };
  }

  // ── the champion's arrival beam ──

  function makeSpotlight(THREE) {
    const group = new THREE.Group();
    const coneMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 1.15, 4.2, 28, 1, true), coneMat);
    cone.position.y = 2.1;
    group.add(cone);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.CircleGeometry(1.15, 32), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(ring);
    group.traverse(o => { o.userData.noOcclude = true; if (o.isMesh) o.castShadow = false; });
    let age = 0;
    // fade in 0.4 s, hold, fade out the last 0.8 s of `life`
    function update(dt, life) {
      age += dt;
      const a = age < 0.4 ? age / 0.4 : age > life - 0.8 ? Math.max(0, (life - age) / 0.8) : 1;
      coneMat.opacity = 0.22 * a;
      ringMat.opacity = 0.35 * a;
      return age < life;
    }
    return { group, update };
  }

  root.PG3DScene = { SCREEN, CW, CH, allOpenings, screenSpot, makeScreen, drawScreen, makeCrown, makeConfetti, makeSpotlight, dispose };
})(typeof self !== 'undefined' ? self : this);
