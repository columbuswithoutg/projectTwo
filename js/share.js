/************************************************
 * SHARE TO STORY — the Doomsday progress card
 *
 * Instagram and Facebook give websites no way to post into a story, so the
 * share works the way story apps expect from the web:
 *   1. we draw a 1080×1920 story card (progress ring, poster grid, avatar,
 *      countdown) on a canvas,
 *   2. "Share to story" hands the image to the phone's share sheet (Web
 *      Share API with files), where the user picks Instagram / Facebook,
 *   3. the same tap copies their share link, which they paste into a Link
 *      sticker. Friends who tap it land on /s/<token> (js/views/shared.js).
 * Without file sharing (desktop) the card downloads and the link is copied.
 *
 *   ShareProgress.open(opts)    the share dialog (turns the link on first);
 *                               opts.onChange(info) after it turns the link on / off
 *   ShareProgress.link()        GET /api/share/me → { enabled, token, joins }
 *   ShareProgress.turnOff()     DELETE /api/share/me (asks first)
 *   ShareProgress.drawCard(d)   → canvas (exposed for test/share-client.test.js)
 *
 * Rules shared with the server (the list, tokens, countdown) are in
 * js/share-logic.js.
 ************************************************/
const ShareProgress = (() => {
  const W = 1080, H = 1920;
  const COLORS = {
    bg0: '#0b0d13', bg1: '#1b0b12', text1: '#eceef3', text3: '#8e95a6',
    red: '#c8102e', redLight: '#ff5a6a', gold: '#d6b25e', good: '#2fbf71'
  };
  // Same hues as --phase-1..6 (styles/tokens/primitives.css), for posters
  // that have no image file.
  const PHASE = ['#b5563f', '#6478a6', '#6f8f5a', '#8a5a86', '#3f8f8f', '#b98a3f'];

  function urlFor(token) { return `${location.origin}/s/${token}`; }

  async function call(method) {
    const res = await Auth.fetch(`${API}/share/me`, { method });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data;
  }
  const link = () => call('GET');

  async function turnOff() {
    const ok = await confirmDialog({
      title: 'Turn off your share link?',
      message: 'Anyone opening your old story link will see “no longer shared”. Sharing again makes a new link.',
      confirmLabel: 'Turn off',
      cancelLabel: 'Keep it on',
      danger: true
    });
    if (!ok) return null;
    const data = await call('DELETE');
    toast('Share link turned off.', 'success');
    return data;
  }

  // ── the card ──

  function loadImage(src, cors) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      if (cors) img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => resolve(null), 8000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = src;
    });
  }

  async function loadFonts() {
    if (!document.fonts || !document.fonts.load) return;
    try {
      await Promise.race([
        Promise.all([
          document.fonts.load('400 120px "Bebas Neue"'),
          document.fonts.load('700 40px "Inter"'),
          document.fonts.load('500 30px "Inter"')
        ]),
        new Promise(r => setTimeout(r, 3000))
      ]);
    } catch (_) { /* system fonts it is */ }
  }

  function spaced(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; }

  // Largest font size ≤ max at which `text` fits `width`.
  function fit(ctx, text, font, max, width) {
    let size = max;
    ctx.font = font(size);
    while (size > 20 && ctx.measureText(text).width > width) { size -= 4; ctx.font = font(size); }
    return size;
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

  function wrapLines(ctx, text, width, maxLines) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width <= width || !line) line = t;
      else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    return lines.slice(0, maxLines);
  }

  // Poster grid box: from under the countdown pill to above the footer
  // text (baseline 1580), so the bottom of the frame stays free for the
  // Link sticker. The rows / columns split that gives the biggest posters
  // wins (14 titles → 7 × 2 at 128 px, 16 → 8 × 2, 20 → 7 × 3); posters
  // never grow past 128 × 192.
  const GRID = { top: 1110, bottom: 1530, width: 980, gap: 12, maxW: 128 };
  function posterGrid(n) {
    const { top, bottom, width, gap, maxW } = GRID;
    let best = { cols: 1, rows: 1, pw: 0 };
    for (let rows = 1; rows <= Math.max(1, n); rows++) {
      const cols = Math.max(1, Math.ceil(n / rows));
      const byW = (width - (cols - 1) * gap) / cols;
      const byH = ((bottom - top) - (rows - 1) * gap) / rows / 1.5;
      const pw = Math.floor(Math.min(maxW, byW, byH));
      if (pw > best.pw) best = { cols, rows, pw };
    }
    const { cols, rows, pw } = best;
    const ph = Math.round(pw * 1.5);
    const rowW = (k) => k * pw + (k - 1) * gap;
    // Item i's top-left; a short last row is centred.
    const at = (i) => {
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, n - row * cols);
      return { x: (W - rowW(inRow)) / 2 + (i % cols) * (pw + gap), y: top + row * (ph + gap) };
    };
    return { cols, rows, pw, ph, gap, at };
  }

  // d: { username, avatar (img|null), items: [{ project, watched, img }], met, total,
  //      title, countdown, host }
  function drawCard(d) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');

    // Background: near-black with a red spotlight up top and a gold one below.
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, COLORS.bg1); bg.addColorStop(0.45, COLORS.bg0); bg.addColorStop(1, '#07080c');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const glow = (x, y, r, rgba) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    };
    glow(540, 120, 760, 'rgba(200,16,46,0.38)');
    glow(540, 1900, 700, 'rgba(214,178,94,0.16)');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // Avatar — gold ring, initial when there's no picture.
    const ax = 540, ay = 236, ar = 70;
    ctx.save();
    ctx.beginPath(); ctx.arc(ax, ay, ar + 7, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.gold; ctx.fill();
    ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = '#1a1e2a'; ctx.fill();
    ctx.clip();
    if (d.avatar) {
      const s = Math.max((ar * 2) / d.avatar.width, (ar * 2) / d.avatar.height);
      const w = d.avatar.width * s, h = d.avatar.height * s;
      ctx.drawImage(d.avatar, ax - w / 2, ay - h / 2.6, w, h);   // faces sit high in the portraits
    } else {
      ctx.fillStyle = COLORS.text1;
      ctx.font = '400 96px "Bebas Neue", "Arial Narrow", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText((d.username || '?')[0].toUpperCase(), ax, ay + 6);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();

    ctx.fillStyle = COLORS.text1;
    fit(ctx, '@' + d.username, (s) => `700 ${s}px Inter, system-ui, sans-serif`, 42, 900);
    ctx.fillText('@' + d.username, 540, 368);

    // Title.
    spaced(ctx, 10);
    ctx.fillStyle = COLORS.gold;
    ctx.font = '400 54px "Bebas Neue", "Arial Narrow", sans-serif';
    ctx.fillText('THE ROAD TO', 540, 452);
    spaced(ctx, 4);
    ctx.fillStyle = '#ffffff';
    const title = String(d.title || 'Avengers: Doomsday').toUpperCase();
    fit(ctx, title, (s) => `400 ${s}px "Bebas Neue", "Arial Narrow", sans-serif`, 132, 960);
    ctx.fillText(title, 540, 572);
    spaced(ctx, 0);

    // Progress ring.
    const rx = 540, ry = 790, rr = 150, lw = 28;
    const frac = d.total ? d.met / d.total : 0;
    ctx.lineCap = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath(); ctx.arc(rx, ry, rr, 0, Math.PI * 2); ctx.stroke();
    if (frac > 0) {
      const ring = ctx.createLinearGradient(rx - rr, ry - rr, rx + rr, ry + rr);
      ring.addColorStop(0, COLORS.redLight); ring.addColorStop(1, COLORS.gold);
      ctx.strokeStyle = ring;
      ctx.beginPath();
      ctx.arc(rx, ry, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, frac));
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#ffffff';
    ctx.font = '400 128px "Bebas Neue", "Arial Narrow", sans-serif';
    ctx.fillText(`${d.met}/${d.total}`, rx, ry + 30);
    spaced(ctx, 6);
    ctx.fillStyle = COLORS.text3;
    ctx.font = '700 24px Inter, system-ui, sans-serif';
    ctx.fillText('WATCHED', rx, ry + 76);
    spaced(ctx, 0);

    // Countdown pill.
    if (d.countdown) {
      const text = d.countdown.toUpperCase();
      spaced(ctx, 3);
      ctx.font = '700 30px Inter, system-ui, sans-serif';
      const tw = ctx.measureText(text).width;
      const pw = Math.min(980, tw + 64), ph = 64, px = 540 - pw / 2, py = 1000;
      roundRect(ctx, px, py, pw, ph, ph / 2);
      ctx.fillStyle = 'rgba(200,16,46,0.18)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,90,106,0.7)'; ctx.stroke();
      ctx.fillStyle = COLORS.text1;
      ctx.fillText(text, 540, py + 43);
      spaced(ctx, 0);
    }

    // Poster grid (posterGrid sizes it to the count), watched ones in full
    // colour with a check, the rest dimmed.
    const grid = posterGrid(d.items.length);
    const { pw, ph } = grid, k = pw / 128;
    d.items.forEach((it, i) => {
      const { x, y } = grid.at(i);
      ctx.save();
      roundRect(ctx, x, y, pw, ph, 10);
      ctx.clip();
      ctx.globalAlpha = it.watched ? 1 : 0.32;
      if (it.img) {
        const s = Math.max(pw / it.img.width, ph / it.img.height);
        ctx.drawImage(it.img, x + (pw - it.img.width * s) / 2, y + (ph - it.img.height * s) / 2, it.img.width * s, it.img.height * s);
      } else {
        ctx.fillStyle = PHASE[PosterArt.phaseOf(it.project) - 1] || PHASE[0];
        ctx.fillRect(x, y, pw, ph);
        ctx.fillStyle = '#ffffff';
        ctx.font = `400 ${Math.round(26 * k)}px "Bebas Neue", "Arial Narrow", sans-serif`;
        wrapLines(ctx, (it.project && it.project.title) || '', pw - 16, 4)
          .forEach((l, n) => ctx.fillText(l, x + pw / 2, y + Math.round(60 * k) + n * Math.round(28 * k)));
      }
      ctx.restore();
      ctx.lineWidth = 2;
      ctx.strokeStyle = it.watched ? 'rgba(214,178,94,0.8)' : 'rgba(255,255,255,0.12)';
      roundRect(ctx, x + 1, y + 1, pw - 2, ph - 2, 10); ctx.stroke();
      if (it.watched) {
        const cx = x + pw - 22, cy = y + 22;
        ctx.beginPath(); ctx.arc(cx, cy, 17, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.good; ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(cx - 8, cy + 1); ctx.lineTo(cx - 2, cy + 7); ctx.lineTo(cx + 9, cy - 6); ctx.stroke();
        ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      }
    });

    // Footer — leaves the bottom of the frame free for the Link sticker.
    spaced(ctx, 4);
    ctx.fillStyle = COLORS.gold;
    ctx.font = '700 28px Inter, system-ui, sans-serif';
    ctx.fillText('TAP THE LINK TO SEE MY WATCH ORDER', 540, 1580);
    spaced(ctx, 0);
    ctx.fillStyle = COLORS.text3;
    ctx.font = '500 28px Inter, system-ui, sans-serif';
    ctx.fillText(d.host || '', 540, 1630);
    return c;
  }

  // Everything the card shows, from the signed-in user's own state.
  async function cardData(username, profilePicture) {
    const goal = computeDoomsdayGoal();
    const days = ShareLogic.daysUntil(goal.target && goal.target.release);
    const pic = profilePicUrl(profilePicture);
    const [avatar, imgs] = await Promise.all([
      // Cloudinary sends CORS headers; bundled portraits are same-origin.
      loadImage(pic, /^https?:/.test(pic) && !pic.startsWith(location.origin)),
      Promise.all(goal.items.map(i => loadImage(PosterArt.url(state.byId.get(i.id)), false))),
      loadFonts()
    ]);
    return {
      username,
      avatar,
      items: goal.items.map((i, n) => ({ project: state.byId.get(i.id), watched: i.watched, img: imgs[n] })),
      met: goal.met,
      total: goal.total,
      title: goal.target ? goal.target.title : 'Avengers: Doomsday',
      countdown: ShareLogic.countdownText(days, 'Doomsday'),
      host: location.host
    };
  }

  function toBlob(canvas) {
    return new Promise((resolve, reject) => {
      try { canvas.toBlob(b => (b ? resolve(b) : reject(new Error('empty'))), 'image/jpeg', 0.92); } catch (e) { reject(e); }
    });
  }

  // A tainted canvas (an avatar served without CORS) can't be exported —
  // draw it again without the avatar rather than fail the share.
  async function renderBlob(d) {
    try { return await toBlob(drawCard(d)); } catch (_) { return toBlob(drawCard({ ...d, avatar: null })); }
  }

  // ── the dialog ──

  function canShareFiles(file) {
    try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] })); } catch (_) { return false; }
  }

  function copy(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(url).then(() => true, () => false);
    }
    return Promise.resolve(false);
  }

  // Readonly means someone else's data is swapped in — except on your own
  // /s/<token> page, where the swapped-in list is your own watched ids.
  function ownSharePage() {
    const a = typeof FriendView !== 'undefined' && FriendView.getActive ? FriendView.getActive() : null;
    if (!a || !a.shareToken || !Auth.isLoggedIn()) return false;
    return (Auth.getUsername() || '').toLowerCase() === String(a.username || '').toLowerCase();
  }

  async function open(opts = {}) {
    $('.share-panel')?.remove();
    if (state.readonly && !ownSharePage()) return;   // never share a friend's board as your own
    const changed = (info) => { if (info && typeof opts.onChange === 'function') { try { opts.onChange(info); } catch (_) {} } };
    try { await state.ensureLoaded(); } catch (_) {}

    const panel = document.createElement('div');
    panel.className = 'share-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'share-panel-heading');
    panel.innerHTML = `
      <div class="share-box">
        <button class="popup-close" type="button" aria-label="Close">✕</button>
        <h3 id="share-panel-heading">Share to your story</h3>
        <div class="share-preview" aria-busy="true">
          <span class="share-preview-wait">Making your card…</span>
        </div>
        <ol class="share-steps">
          <li>Tap <strong>Share to story</strong> and pick Instagram or Facebook.</li>
          <li>Add a <strong>Link</strong> sticker and paste your link — we copy it for you.</li>
        </ol>
        <div class="share-link-row">
          <label class="visually-hidden" for="share-link-input">Your share link</label>
          <input id="share-link-input" type="text" readonly value="Getting your link…" />
          <button type="button" class="btn btn--secondary" data-act="copy" disabled>Copy</button>
        </div>
        <div class="share-actions">
          <button type="button" class="btn btn--primary" data-act="share" disabled>Share to story</button>
          <button type="button" class="btn btn--secondary" data-act="download" disabled>Download image</button>
        </div>
        <p class="share-note">
          Anyone with the link sees your Doomsday checklist and watch order — nothing else.
          <span class="share-joins" hidden></span>
          <button type="button" class="share-off" data-act="off" hidden>Turn off link</button>
        </p>
      </div>`;
    document.body.appendChild(panel);

    let blobUrl = null;
    const close = wireModalDismiss(panel, () => {
      panel.remove();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    }, { initialFocus: panel.querySelector('.popup-close') });
    panel.querySelector('.popup-close').addEventListener('click', close);

    const $in = (sel) => panel.querySelector(sel);
    const input = $in('#share-link-input');
    const btn = (act) => $in(`[data-act="${act}"]`);

    // 1. The link (sharing turns it on).
    let linkInfo;
    try {
      linkInfo = await call('POST');
    } catch (_) {
      if (!panel.isConnected) return;
      toast('Couldn’t make your share link — try again.', 'error');
      close();
      return;
    }
    changed(linkInfo);
    if (!panel.isConnected) return;
    const url = urlFor(linkInfo.token);
    input.value = url;
    btn('copy').disabled = false;
    btn('off').hidden = false;
    if (linkInfo.joins > 0) {
      const j = $in('.share-joins');
      j.textContent = `${linkInfo.joins} ${linkInfo.joins === 1 ? 'person has' : 'people have'} joined from your link.`;
      j.hidden = false;
    }

    // 2. The card.
    const username = Auth.getUsername() || 'me';
    let profilePicture = '';
    try {
      const res = await Auth.fetch(`${API}/profile`);
      const p = await res.json();
      if (p && !p.error) profilePicture = p.profilePicture || '';
    } catch (_) { /* initial instead */ }
    let blob;
    try {
      blob = await renderBlob(await cardData(username, profilePicture));
    } catch (_) {
      if (!panel.isConnected) return;
      $in('.share-preview-wait').textContent = 'Couldn’t draw the card. You can still copy your link.';
      $in('.share-preview').removeAttribute('aria-busy');
      return;
    }
    if (!panel.isConnected) return;
    blobUrl = URL.createObjectURL(blob);
    const preview = $in('.share-preview');
    preview.removeAttribute('aria-busy');
    preview.innerHTML = `<img src="${blobUrl}" alt="Your story card: ${esc(String(computeDoomsdayGoal().met))} of ${esc(String(computeDoomsdayGoal().total))} watched before Avengers: Doomsday" />`;

    const file = new File([blob], 'road-to-doomsday.jpg', { type: 'image/jpeg' });
    const shareable = canShareFiles(file);
    btn('download').disabled = false;
    if (shareable) btn('share').disabled = false;
    else {
      // Desktop and older browsers: the main action becomes the download.
      btn('share').hidden = true;
      btn('download').classList.replace('btn--secondary', 'btn--primary');
      $in('.share-steps').innerHTML = `
        <li>Download the image and post it to your Instagram or Facebook story from your phone.</li>
        <li>Add a <strong>Link</strong> sticker with your link below.</li>`;
    }

    btn('copy').addEventListener('click', async () => {
      if (await copy(url)) toast('Link copied — paste it into a Link sticker.', 'success');
      else { input.focus(); input.select(); toast('Select the link and copy it.', 'info'); }
    });

    btn('share').addEventListener('click', () => {
      // Both calls start inside the tap: Safari refuses navigator.share once
      // an await has passed.
      copy(url);
      navigator.share({ files: [file], text: url }).then(() => {
        toast('Now add a Link sticker and paste your link.', 'success');
      }).catch((e) => {
        if (e && e.name === 'AbortError') return;   // closed the share sheet
        toast('Sharing didn’t work — download the image instead.', 'error');
      });
    });

    btn('download').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'road-to-doomsday.jpg';
      document.body.appendChild(a);
      a.click();
      a.remove();
      copy(url).then(ok => { if (ok) toast('Image saved and link copied.', 'success'); });
    });

    btn('off').addEventListener('click', async () => {
      try {
        const res = await turnOff();
        changed(res);
        if (res) close();
      } catch (_) {
        toast('Couldn’t turn the link off — try again.', 'error');
      }
    });
  }

  return { open, link, turnOff, drawCard, _debug: { posterGrid, GRID, ownSharePage } };
})();
