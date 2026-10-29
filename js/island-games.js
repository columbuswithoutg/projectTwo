/************************************************
 * ISLAND GAMES — one island screen, several minigames (the /world HUD side)
 *
 * Scene Guess (js/scene-guess.js) and Quote Guess (js/quote-guess.js) share
 * each island's cinema wall. This decides, for the player in front of it:
 *   - E / the touch button (Playground3D.setScreenRouter): a game that's on
 *     takes E straight away; with one game there E opens it; with both idle
 *     E opens the PICKER — two tiles, keys 1 / 2, Esc to close
 *   - the prompt: that game's name, or "Play a game" 🎮
 *   - the ONE header chip (#world-sg-slot): each game offers a model
 *     (hud.chip(): text, rank); my game > a lobby / live game here > idle
 *     games (two idle games: "🎮 2 games here", which opens the picker)
 *   - the roof label's game lines (tagFor): only the live game's line while
 *     one runs, otherwise one line per game
 * One game per island at a time is enforced by the server
 * (server/island-games.js); this only routes the player's input.
 ************************************************/
const IslandGames = (() => {
  let _engine = null, _host = null, _chip = null, _ticker = null, _picker = null, _zone = null, _started = false;
  let _games = [];      // [{ kind, name, icon, blurb, hud }]

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const byKind = (kind) => _games.find(g => g.kind === kind) || null;

  function start(opts) {
    stop();
    _engine = opts.engine || null;
    _host = opts.chipHost || null;
    _games = (opts.games || []).filter(g => g && g.hud);
    _started = true;
    if (_engine && _engine.setScreenRouter) _engine.setScreenRouter({ interact, prompt });
    _ticker = setInterval(renderChip, 250);
    renderChip();
  }

  function stop() {
    _started = false;
    closePicker();
    if (_ticker) { clearInterval(_ticker); _ticker = null; }
    if (_chip) { _chip.remove(); _chip = null; }
    if (_engine && _engine.setScreenRouter) _engine.setScreenRouter(null);
    _engine = null;
    _host = null;
    _games = [];
    _zone = null;
  }

  function onZone(pid) {
    _zone = pid || null;
    if (_picker && _picker.pid !== _zone) closePicker();
    renderChip();
  }

  // ── E at a screen ──

  function interact(pid, ctx, call) {
    const kinds = (ctx && ctx.kinds) || [];
    if (ctx && ctx.live) return call(ctx.live);
    if (kinds.length === 1) return call(kinds[0]);
    if (kinds.length > 1) openPicker(pid, kinds, (kind) => call(kind));
  }

  function prompt(pid, ctx) {
    const kinds = (ctx && ctx.kinds) || [];
    const one = ctx && ctx.live ? byKind(ctx.live) : kinds.length === 1 ? byKind(kinds[0]) : null;
    if (one) return { label: one.name, glyph: one.icon };
    if (kinds.length > 1) return { label: 'Play a game', glyph: '🎮' };
    return null;
  }

  // ── the picker ──

  function openPicker(pid, kinds, choose) {
    closePicker();
    const games = kinds.map(byKind).filter(Boolean);
    if (!games.length) return;
    const el = document.createElement('div');
    el.className = 'world-lb ig-picker';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Pick a game');
    const fmt = (n) => Number(n || 0).toLocaleString();
    el.innerHTML = `
      <div class="world-lb-panel">
        <button class="popup-close" type="button" aria-label="Close">✕</button>
        <h3>Pick a game</h3>
        <p class="world-lb-sub">${esc(titleOf(pid))}</p>
        <div class="ig-picker-tiles">
          ${games.map((g, i) => {
            const rec = g.hud.record ? g.hud.record(pid) : null;
            return `<button type="button" class="ig-tile" data-kind="${esc(g.kind)}">
              <span class="ig-tile-icon" aria-hidden="true">${esc(g.icon)}</span>
              <b>${esc(g.name)}</b>
              <span>${esc(g.blurb)}</span>
              <small>${rec ? `🏆 ${fmt(rec.score)} · ${esc(rec.username)}` : 'No record yet'}</small>
              <kbd aria-hidden="true">${i + 1}</kbd>
            </button>`;
          }).join('')}
        </div>
      </div>`;
    document.body.appendChild(el);
    const close = (typeof wireModalDismiss === 'function')
      ? wireModalDismiss(el, () => closePicker(), { initialFocus: el.querySelector('.ig-tile') })
      : () => closePicker();
    _picker = { el, close, pid };
    if (_engine && _engine.setInputSuspended) _engine.setInputSuspended(true, 'picker');
    el.querySelector('.popup-close').addEventListener('click', close);
    const pick = (kind) => { closePicker(); choose(kind); };
    el.querySelectorAll('.ig-tile').forEach(b => b.addEventListener('click', () => pick(b.dataset.kind)));
    el.addEventListener('keydown', (e) => {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= games.length) { e.preventDefault(); pick(games[n - 1].kind); }
    });
  }

  function closePicker() {
    if (!_picker) return;
    const { el, close } = _picker;
    _picker = null;
    try { if (close) close(); } catch (_) {}
    el.remove();
    if (_engine && _engine.setInputSuspended) _engine.setInputSuspended(false, 'picker');
  }

  function titleOf(pid) {
    const list = (typeof projects !== 'undefined' && Array.isArray(projects)) ? projects : [];
    const p = list.find(q => q && q.id === pid);
    return (p && p.title) || '';
  }

  // ── the header chip ──

  function renderChip() {
    if (!_started) return;
    const models = _games.map(g => ({ g, m: g.hud.chip ? g.hud.chip() : null })).filter(x => x.m);
    if (!models.length || !_host) {
      if (_chip) { _chip.remove(); _chip = null; }
      return;
    }
    models.sort((a, b) => b.m.rank - a.m.rank);
    const top = models[0];
    const idle = models.filter(x => x.m.rank === 1);
    let text = top.m.text, cls = top.m.cls || '', title = top.m.title || '', onClick = () => top.g.hud.chipClick();
    if (top.m.rank === 1 && idle.length > 1) {
      text = `🎮 ${idle.length} games here`;
      cls = '';
      title = idle.map(x => x.g.name).join(' or ');
      onClick = () => openPicker(_zone, idle.map(x => x.g.kind), (kind) => byKind(kind).hud.chipClick());
    }
    if (!_chip) {
      _chip = document.createElement('button');
      _chip.type = 'button';
      _chip.addEventListener('click', () => { if (_chip && _chip._go) _chip._go(); });
      _host.appendChild(_chip);
    }
    _chip._go = onClick;
    if (_chip.textContent !== text) _chip.textContent = text;
    _chip.className = 'world-sg-chip ' + cls;
    _chip.title = title;
  }

  // ── the roof label ──

  // → { games: [{ text, live, kind }] } | null. While a game is on, only its line.
  function tagFor(pid) {
    if (!_started) return null;
    const lines = [];
    for (const g of _games) {
      const t = g.hud.tagFor ? g.hud.tagFor(pid) : null;
      if (!t) continue;
      lines.push(Object.assign(t.text != null ? Object.assign({}, t) : { text: t.sg, live: !!t.live, kind: g.kind }, { icon: g.icon }));
    }
    if (!lines.length) return null;
    const live = lines.filter(l => l.live);
    if (live.length) return { games: live };
    // Two records on one roof: each starts with its game's icon, so it's
    // clear which record is whose (Scene Guess alone keeps its 🏆).
    if (lines.length > 1) lines.forEach(l => { l.text = l.text.replace(/^🏆 /, l.icon + ' '); });
    return { games: lines };
  }

  return {
    start, stop, onZone, tagFor,
    _debug: { picker: () => _picker && { pid: _picker.pid }, interact, prompt, openPicker }
  };
})();
