/************************************************
 * PLAYGROUND 3D — Quote Guess props (driven by js/quote-guess.js)
 *
 * Quote Guess shares the island's cinema-wall screen with Scene Guess
 * (Playground3D.registerScreenKind('quote', …), registered by the HUD):
 *   drawScreen(ctx, view, imgOf)   paints one Quote Guess frame of it — the
 *       idle card (the champion's featured line, or a title card), the
 *       lobby, "get ready", a round (the line + four choices; who has
 *       locked in), the reveal (the right choice in gold) and the results
 *   keyOf(view, imgOf)             what the frame depends on (the engine
 *       repaints only when it changes)
 *   makeLaurel(THREE)              the Quote Guess champion's laurel wreath;
 *       worn with Scene Guess's crown it rings the crown's band
 * Same canvas and helpers as Scene Guess (PG3DScene.paint: 1280×800, the
 * picture's bottom at PIC, then the marquee). Attaches window.PG3DQuote.
 * Load after js/playground3d-scene.js, before js/playground3d.js.
 ************************************************/
(function (root) {
  const SERIF = 'Georgia, "Times New Roman", serif';
  const TYPE = { who: { text: 'WHO SAID IT?', bg: '#d6b25e', fg: '#111111' }, reply: { text: "WHAT'S THE REPLY?", bg: '#60a5fa', fg: '#0b1220' } };

  function P() { return root.PG3DScene.paint; }
  function CW() { return root.PG3DScene.CW; }

  // Word-wrap `text` into at most maxLines lines of maxW, trying each font
  // size in turn (largest first); the last size cuts with an ellipsis.
  function wrap(ctx, text, maxW, sizes, fontOf, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    for (let si = 0; si < sizes.length; si++) {
      const size = sizes[si];
      ctx.font = fontOf(size);
      const lines = [];
      let cur = '';
      for (const w of words) {
        const next = cur ? cur + ' ' + w : w;
        if (ctx.measureText(next).width <= maxW || !cur) cur = next;
        else { lines.push(cur); cur = w; }
      }
      if (cur) lines.push(cur);
      if (lines.length <= maxLines || si === sizes.length - 1) {
        if (lines.length > maxLines) {
          lines.length = maxLines;
          lines[maxLines - 1] = P().fit(ctx, lines[maxLines - 1] + '…', maxW);
        }
        return { size, lines };
      }
    }
    return { size: sizes[sizes.length - 1], lines: [] };
  }

  function drawLines(ctx, w, x, y, lineH) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const top = y - ((w.lines.length - 1) * lineH) / 2;
    w.lines.forEach((ln, i) => ctx.fillText(ln, x, top + i * lineH));
  }

  function portraitUrl(characterId) {
    if (!characterId || typeof characters === 'undefined' || !Array.isArray(characters) || typeof assetUrl !== 'function') return null;
    const c = characters.find(x => x && x.id === characterId);
    return c && c.image ? assetUrl('assets/characters/' + c.image) : null;
  }

  function face(ctx, img, name, x, y, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
    if (img) {
      ctx.clip();
      const s = Math.max((2 * r) / img.naturalWidth, (2 * r) / img.naturalHeight);
      ctx.drawImage(img, x - (img.naturalWidth * s) / 2, y - r, img.naturalWidth * s, img.naturalHeight * s);
    } else {
      ctx.fillStyle = '#eceef3';
      ctx.font = `800 ${Math.round(r * 0.8)}px ${P().UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(name || '?').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase(), x, y + 1);
    }
    ctx.restore();
  }

  // The line, big, in the upper part of the picture.
  function drawQuote(ctx, text, speaker, top, bottom) {
    const { UI } = P();
    const W = CW();
    let y0 = top;
    if (speaker) {
      ctx.font = `800 34px ${UI}`;
      ctx.fillStyle = '#9cc8ff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(P().fit(ctx, speaker.toUpperCase() + ':', W - 200), W / 2, top + 20);
      y0 = top + 46;
    }
    const w = wrap(ctx, `“${text}”`, W - 180, [66, 58, 50, 44, 38, 32], (s) => `italic 500 ${s}px ${SERIF}`, 4);
    ctx.fillStyle = '#f6f1e3';
    drawLines(ctx, w, W / 2, (y0 + bottom) / 2, Math.round(w.size * 1.22));
  }

  // The four choices, 2 × 2, under the line. At a reveal the right one is gold.
  function drawOptions(ctx, cur, hist, imgOf, top, bottom) {
    const { UI, roundRect, fit } = P();
    const W = CW();
    const gap = 18, padX = 36;
    const bw = (W - padX * 2 - gap) / 2, bh = (bottom - top - gap) / 2;
    cur.options.forEach((o, i) => {
      const x = padX + (i % 2) * (bw + gap), y = top + Math.floor(i / 2) * (bh + gap);
      const right = hist && hist.answer === o.id;
      ctx.fillStyle = right ? 'rgba(255,210,63,0.92)' : hist ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.09)';
      roundRect(ctx, x, y, bw, bh, 22);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = right ? '#ffd23f' : 'rgba(255,255,255,0.18)';
      ctx.stroke();
      // Letter badge.
      ctx.fillStyle = right ? '#111111' : 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.arc(x + 40, y + bh / 2, 22, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = right ? '#ffd23f' : '#ffffff';
      ctx.font = `800 24px ${UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ABCD'[i], x + 40, y + bh / 2 + 1);
      let tx = x + 76;
      if (cur.type === 'who') {
        const url = portraitUrl(o.characterId);
        face(ctx, url ? imgOf(url) : null, o.label, tx + 30, y + bh / 2, 30);
        tx += 74;
      }
      const maxW = x + bw - tx - 24;
      const label = cur.type === 'reply' && o.label.length > 90 ? o.label.slice(0, 88) + '…' : o.label;
      const w = wrap(ctx, label, maxW, cur.type === 'reply' ? [34, 30, 26, 23] : [38, 34, 30], (s) => cur.type === 'reply' ? `italic 500 ${s}px ${SERIF}` : `700 ${s}px ${UI}`, 2);
      ctx.fillStyle = right ? '#111111' : hist ? 'rgba(236,238,243,0.55)' : '#eceef3';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const lh = Math.round(w.size * 1.18);
      const y0 = y + bh / 2 - ((w.lines.length - 1) * lh) / 2;
      w.lines.forEach((ln, li) => ctx.fillText(fit(ctx, ln, maxW), tx, y0 + li * lh));
    });
  }

  // view: { mode, title, record:{username,score}|null, pick:{text,speaker}|null,
  //         liveHost, state (public game state) | null, deadline (local ms) }
  function drawScreen(ctx, view, imgOf) {
    const { backdrop, marquee, headline, pill, roundRect, fit, initials, COLORS, fmt, PIC, DISPLAY, UI } = P();
    const W = CW(), H = root.PG3DScene.CH;
    const v = view || { mode: 'idle' };
    const st = v.state || null;
    const secs = v.deadline ? Math.max(0, Math.ceil((v.deadline - Date.now()) / 1000)) : 0;
    const recText = v.record ? `🏆 Record ${fmt(v.record.score)} · ${v.record.username}` : 'No record yet — be the first champion';
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    backdrop(ctx);
    const mode = v.mode || 'idle';
    const cur = st && st.current;

    if ((mode === 'round' || mode === 'reveal') && cur) {
      const t = TYPE[cur.type] || TYPE.who;
      pill(ctx, 24, 22, `ROUND ${Math.min(st.of, st.round + 1)}/${st.of}`, 'rgba(0,0,0,0.72)', '#ffffff', `800 28px ${UI}`);
      ctx.font = `800 28px ${UI}`;
      const roundW = ctx.measureText(`ROUND ${Math.min(st.of, st.round + 1)}/${st.of}`).width + 36;
      pill(ctx, 24 + roundW + 12, 22, t.text, t.bg, t.fg, `800 28px ${UI}`);
      if (mode === 'round') {
        pill(ctx, W - 24, 22, `⏱ ${secs}s`, secs <= 5 ? 'rgba(200,16,46,0.9)' : 'rgba(0,0,0,0.72)', '#ffffff', `800 28px ${UI}`, true);
      }
      const hist = mode === 'reveal' ? (st.history || [])[st.round] : null;
      drawQuote(ctx, cur.prompt.text, cur.type === 'reply' && cur.prompt.speaker ? cur.prompt.speaker.name : null, 96, 380);
      drawOptions(ctx, cur, hist, imgOf, 404, PIC - 18);
      if (mode === 'round') {
        const locked = (st.players || []).filter(p => p.locked).length;
        marquee(ctx, `${cur.type === 'reply' ? "What's the reply?" : 'Who said it?'}  ·  ${v.title}  ·  ${locked}/${(st.players || []).length} locked in`);
      } else {
        const rv = hist && hist.reveal ? hist.reveal : {};
        const fast = hist ? [...(hist.picks || [])].filter(p => p.points > 0).sort((a, b) => b.points - a.points)[0] : null;
        marquee(ctx, `${cur.type === 'reply' ? 'Replied by' : 'Said by'} ${rv.speaker || '?'}${rv.note ? ' · ' + rv.note : ''}${fast ? `  ·  fastest: ${fast.username} +${fmt(fast.points)}` : ''}`);
      }
    } else if (mode === 'lobby' && st) {
      headline(ctx, 'QUOTE GUESS', `Lobby open · starts in ${secs}s`, 250);
      ctx.font = `700 40px ${UI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      (st.players || []).slice(0, 6).forEach((p, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        const x = W / 2 + (col - 1) * 380, y = 430 + row * 90;
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        roundRect(ctx, x - 170, y - 34, 340, 68, 34); ctx.fill();
        ctx.fillStyle = COLORS[i % COLORS.length];
        ctx.fillText(fit(ctx, p.username + (p.username === st.host ? ' ★' : ''), 310), x, y + 2);
      });
      marquee(ctx, `${(st.players || []).length}/${st.max} players  ·  walk up and press E to join`);
    } else if (mode === 'ready' && st) {
      headline(ctx, 'GET READY', `${(st.players || []).length} player${(st.players || []).length === 1 ? '' : 's'} · 10 lines`, 330);
      ctx.fillStyle = '#ffffff';
      ctx.font = `400 170px ${DISPLAY}`;
      ctx.textAlign = 'center';
      ctx.fillText(String(secs), W / 2, 610);
      marquee(ctx, `${v.title}  ·  ${recText}`);
    } else if (mode === 'results' && st) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = st.record ? '#ffd23f' : '#d6b25e';
      ctx.font = `400 104px ${DISPLAY}`;
      ctx.fillText(st.record ? '🌿 NEW ISLAND RECORD' : 'FINAL SCORES', W / 2, 130);
      (st.ranking || []).slice(0, 5).forEach((r, i) => {
        const y = 210 + i * 98;
        ctx.fillStyle = i === 0 ? 'rgba(255,210,63,0.16)' : 'rgba(255,255,255,0.06)';
        roundRect(ctx, 150, y, W - 300, 80, 18); ctx.fill();
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.font = `800 40px ${UI}`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${i + 1}.`, 182, y + 42);
        ctx.fillStyle = COLORS[(st.players || []).findIndex(p => p.username === r.username) % COLORS.length] || '#ffffff';
        ctx.fillText(fit(ctx, r.username, 640), 250, y + 42);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(fmt(r.total), W - 182, y + 42);
      });
      marquee(ctx, st.record ? `${st.record.username} is the Quote Guess champion of ${v.title} — ${fmt(st.record.score)}` : recText);
    } else {
      // Idle: the champion's featured line, or a title card.
      if (v.pick && v.pick.text) {
        drawQuote(ctx, v.pick.text, null, 110, 520);
        ctx.fillStyle = '#d6b25e';
        ctx.font = `700 40px ${UI}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fit(ctx, `— ${v.pick.speaker || ''}`, W - 200), W / 2, 590);
        if (v.record) pill(ctx, 24, 22, `🌿 Champion's line · ${v.record.username}`, 'rgba(0,0,0,0.72)', '#9fe0a6', `800 30px ${UI}`);
      } else {
        headline(ctx, 'QUOTE GUESS', v.title || '', 330);
        ctx.fillStyle = 'rgba(236,238,243,0.7)';
        ctx.font = `500 34px ${UI}`;
        ctx.textAlign = 'center';
        ctx.fillText("Who said it? · What's the reply? · 10 lines", W / 2, 480);
      }
      if (v.liveHost != null) {
        pill(ctx, W - 24, 22, `● LIVE · ${v.liveHost || 'a game'} is playing`, 'rgba(200,16,46,0.9)', '#ffffff', `800 30px ${UI}`, true);
      }
      marquee(ctx, `${recText}   ·   Walk up and press E to play`);
    }
    ctx.restore();
  }

  // Repaint key: what the frame shows, down to the countdown second and
  // which portraits have loaded.
  function keyOf(view, imgOf) {
    const v = view || {};
    const st = v.state || null;
    const cur = st && st.current;
    const secs = v.deadline ? Math.max(0, Math.ceil((v.deadline - Date.now()) / 1000)) : 0;
    const urls = cur && cur.type === 'who' ? cur.options.map(o => portraitUrl(o.characterId)).filter(Boolean) : [];
    return JSON.stringify([
      v.mode, v.title, v.liveHost, v.record, v.pick,
      st && [st.phase, st.round, st.players, st.ranking, st.record, (st.history || []).length, cur && cur.prompt.text],
      secs, urls.map(u => !!imgOf(u))
    ]);
  }

  // ── the champion's laurel ──

  let _parts = null;
  function makeLaurel(THREE) {
    if (!_parts) {
      const leaf = new THREE.MeshStandardMaterial({ color: 0x8fcf5a, metalness: 0.55, roughness: 0.35, emissive: 0x1f4210, emissiveIntensity: 0.55 });
      const gold = new THREE.MeshStandardMaterial({ color: 0xffc93c, metalness: 0.85, roughness: 0.28, emissive: 0x5a3c00, emissiveIntensity: 0.6 });
      leaf.userData.shared = true;
      gold.userData.shared = true;
      leaf.side = THREE.DoubleSide;
      const blade = new THREE.SphereGeometry(1, 10, 6);
      blade.scale(0.026, 0.008, 0.06);
      const band = new THREE.TorusGeometry(0.2, 0.011, 6, 40);
      const berry = new THREE.SphereGeometry(0.016, 8, 6);
      for (const g of [blade, band, berry]) g.userData.shared = true;
      _parts = { leaf, gold, blade, band, berry };
    }
    const Pt = _parts;
    const R = 0.2;
    const wreath = new THREE.Group();
    const ring = new THREE.Mesh(Pt.band, Pt.gold);
    ring.rotation.x = Math.PI / 2;
    wreath.add(ring);
    // Two branches from the back round to the front, leaves in pairs that
    // tilt up and out; the tips stop short of each other at the brow.
    const N = 8;
    for (const side of [-1, 1]) {
      for (let i = 0; i < N; i++) {
        const a = side * (Math.PI * (0.1 + 0.78 * (i / (N - 1))));     // 0 = the brow (+z)
        for (const out of [-1, 1]) {
          const m = new THREE.Mesh(Pt.blade, Pt.leaf);
          const r = R + out * 0.018;
          m.position.set(Math.sin(a) * r, 0.012 + out * 0.008, Math.cos(a) * r);
          // Long axis along the branch (towards the brow), tipped up and out.
          m.rotation.order = 'YXZ';
          m.rotation.y = a + side * Math.PI / 2 + (side > 0 ? Math.PI : 0);
          m.rotation.x = -0.55;
          m.rotation.z = out * 0.5;
          wreath.add(m);
        }
        if (i % 3 === 1) {
          const b = new THREE.Mesh(Pt.berry, Pt.gold);
          b.position.set(Math.sin(a) * (R + 0.03), 0.02, Math.cos(a) * (R + 0.03));
          wreath.add(b);
        }
      }
    }
    wreath.traverse(o => { if (o.isMesh) { o.castShadow = false; o.userData.noOcclude = true; } });
    wreath.userData.noOcclude = true;
    return wreath;
  }

  const api = { drawScreen, keyOf, makeLaurel, wrap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PG3DQuote = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);
