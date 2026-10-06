/************************************************
 * SCENE GUESS — the /world HUD for the minigame
 *
 * Mounted by js/views/world.js once multiplayer is up; talks to
 * server/scene-guess.js over the world socket. Draws:
 *   - the island chip in the header (live islands only): "🎬 Scene Guess ·
 *     🏆 record", or "● Lobby · Join" / "● LIVE · @host · 3/10 · Watch"
 *   - the island panel: how it works, the record, top 5, your best, and
 *     Play / Join / Watch (+ "Change screen picture" for the champion)
 *   - the lobby card for everyone on the island while a lobby is open
 *   - the game overlay: get ready → still + timeline → reveal → results.
 *     Players drag / tap the line (arrows ±10 s, Shift ±1 min, PgUp/PgDn
 *     ±1 episode, Enter locks in); onlookers get the same overlay read-only.
 *   - chat lines for a new record and the champion's arrival
 * The 3D side (island screen, crown, confetti, spotlight) is in
 * js/playground3d.js.
 *
 * Everything shown comes from SceneGuessLogic.publicState-shaped payloads:
 * a still's real time is in `history` after its reveal, never before.
 * While the overlay or panel is open the 3D controls are suspended
 * (Playground3D.setInputSuspended), so keys and taps belong to the UI.
 ************************************************/
const SceneGuess = (() => {
  const L = () => window.SceneGuessLogic;
  const COLORS = 6;            // .sg-c0 … .sg-c5 player colours (styles/hud/scene-guess.css)
  const ERRORS = {
    'not-here': 'Step onto the island to play.',
    'not-live': "Scene Guess isn't available on this island.",
    'busy': "You're already in a game.",
    'full': 'That lobby is full.',
    'started': 'That game already started — watch it instead.',
    'off': 'Scene Guess is switched off.',
    'slow-down': 'Slow down a moment, then try again.',
    'no-game': 'That game has ended.',
    'too-late': "Time's up — that guess didn't count.",
    'not-champion': 'Only the island champion can do that.'
  };

  const DEFAULT_CFG = { enabled: false, islands: [], records: {}, live: {}, mine: {}, roundSec: 30 };

  let _socket = null, _engine = null, _postSystem = () => {}, _me = '', _slot = null, _onTags = null;
  let _engineKey = '';
  let _cfg = { ...DEFAULT_CFG };
  let _zone = null;
  const _states = new Map();   // projectId → latest public state (current island + my game)
  let _clockOffset = 0;        // server time − local time
  let _overlay = null;         // { el, projectId, mode: 'play'|'watch', final, refs }
  let _panel = null;           // { el, projectId, close, board, picks }
  let _lobbyEl = null;
  let _chip = null;
  let _ticker = null;
  let _marker = null;          // { projectId, round, at, locked, sending }
  const _imgs = new Map();     // still url → Image (preloaded)
  const _off = [];             // socket listener removers
  let _started = false;
  let _lastRenderKey = '';

  // ── helpers ──

  const now = () => Date.now() + _clockOffset;
  const fmt = (n) => Number(n || 0).toLocaleString();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function title(pid) {
    const list = (typeof projects !== 'undefined' && Array.isArray(projects)) ? projects : [];
    const p = list.find(q => q && q.id === pid);
    return (p && p.title) || pid || '';
  }
  function secsLeft(deadline) { return Math.max(0, Math.ceil((deadline - now()) / 1000)); }
  function amIn(st) { return !!st && Array.isArray(st.players) && st.players.some(p => p.username === _me); }
  function myGame() {
    for (const st of _states.values()) if (amIn(st)) return st;
    return null;
  }
  function liveIsland(pid) { return _cfg.enabled && !!pid && _cfg.islands.includes(pid); }
  function colorOf(st, username) {
    const i = st && st.players ? st.players.findIndex(p => p.username === username) : -1;
    return 'sg-c' + ((i < 0 ? 0 : i) % COLORS);
  }
  function initials(name) { return String(name || '?').replace(/^claude_qa_/, '').slice(0, 2).toUpperCase(); }
  function say(msg, type) { if (typeof toast === 'function') toast(msg, type || 'info'); }
  function errText(e) { return ERRORS[e] || "Couldn't do that — try again."; }
  function emit(event, payload) {
    return new Promise((resolve) => {
      if (!_socket || !_socket.connected) return resolve({ ok: false, error: 'offline' });
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: 'timeout' }); } }, 8000);
      _socket.emit(event, payload, (r) => { if (done) return; done = true; clearTimeout(t); resolve(r || { ok: false }); });
    });
  }
  function syncInput() {
    if (_engine && _engine.setInputSuspended) _engine.setInputSuspended(!!(_overlay || _panel));
  }
  function preload(urls) {
    for (const url of urls || []) {
      if (!url || _imgs.has(url)) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.src = url;
      _imgs.set(url, img);
    }
    if (_imgs.size > 40) {
      const keep = new Set([].concat(...[..._states.values()].map(s => s.stills || [])));
      for (const u of [..._imgs.keys()]) if (!keep.has(u)) _imgs.delete(u);
    }
  }

  // ── lifecycle ──

  function start(opts) {
    stop();
    _socket = opts.socket || null;
    _engine = opts.engine || null;
    _postSystem = typeof opts.postSystem === 'function' ? opts.postSystem : () => {};
    _me = opts.username || '';
    _slot = opts.chipHost || null;
    _onTags = typeof opts.onTags === 'function' ? opts.onTags : null;
    _engineKey = '';
    _started = true;
    // E (or the 🎬 button) in front of an island's screen.
    if (_engine && _engine.setSceneInteractHandler) _engine.setSceneInteractHandler((pid) => onScreen(pid));
    on('world:sg-state', onState);
    on('world:sg-live', onLive);
    on('world:sg-islands', onIslands);
    on('world:sg-records', onRecords);
    on('world:sg-fanfare', onFanfare);
    on('world:sg-arrived', onArrived);
    on('connect', () => { if (_started) loadConfig(); });
    _ticker = setInterval(tick, 250);
    loadConfig();
  }

  function on(event, fn) {
    if (!_socket) return;
    _socket.on(event, fn);
    _off.push(() => { if (_socket) _socket.off(event, fn); });
  }

  async function loadConfig() {
    try {
      const res = await fetch(`${API}/world/scene`, { headers: { Authorization: `Bearer ${Auth.getToken()}` } });
      if (!res.ok || !_started) return;
      const d = await res.json();
      if (!_started) return;
      _cfg = {
        enabled: !!d.enabled,
        islands: Array.isArray(d.islands) ? d.islands : [],
        records: d.records || {},
        live: d.live || {},
        mine: d.mine || {},
        roundSec: d.roundSec || 30
      };
      render();
    } catch (_) { /* offline — the HUD stays dark */ }
  }

  // Leaving /world while in a game quits it (the seat would otherwise sit
  // in its reconnect grace for nothing).
  function stop() {
    if (_started && myGame() && _socket && _socket.connected) _socket.emit('world:sg-leave', {}, () => {});
    _off.splice(0).forEach(f => f());
    if (_ticker) { clearInterval(_ticker); _ticker = null; }
    closeOverlay(true);
    closePanel();
    removeLobby();
    if (_chip) { _chip.remove(); _chip = null; }
    _states.clear();
    _imgs.clear();
    _marker = null;
    _zone = null;
    _cfg = { ...DEFAULT_CFG };
    _started = false;
    _socket = null;
    if (_engine) {
      if (_engine.setInputSuspended) _engine.setInputSuspended(false);
      if (_engine.setSceneScreens) _engine.setSceneScreens([]);
      if (_engine.setChampions) _engine.setChampions({}, '');
      if (_engine.setSceneInteractHandler) _engine.setSceneInteractHandler(null);
    }
    _engine = null;
    _onTags = null;
    _engineKey = '';
  }

  function onZone(projectId) {
    _zone = projectId || null;
    // Islands we're not on (and not playing on) go stale.
    for (const [id, st] of [..._states]) if (id !== _zone && !amIn(st)) _states.delete(id);
    if (_overlay && _overlay.mode === 'watch' && _overlay.projectId !== _zone && !_overlay.final) closeOverlay();
    if (_panel && _panel.projectId !== _zone) closePanel();
    render();
  }

  // ── server events ──

  function onState(st) {
    if (!st || typeof st.projectId !== 'string') return;
    if (typeof st.serverTime === 'number') _clockOffset = st.serverTime - Date.now();
    const prev = _states.get(st.projectId) || null;
    if (st.phase === 'idle') {
      _states.delete(st.projectId);
      onIdle(st, prev);
      return render();
    }
    _states.set(st.projectId, st);
    if (st.stills && st.stills.length) preload(st.stills);
    if (amIn(st)) {
      // My game left the lobby → the play overlay opens by itself.
      if (st.phase !== 'lobby' && !(_overlay && _overlay.projectId === st.projectId && _overlay.mode === 'play')) {
        openOverlay(st.projectId, 'play');
      }
      if (st.phase === 'round' && (!_marker || _marker.projectId !== st.projectId || _marker.round !== st.round)) {
        _marker = { projectId: st.projectId, round: st.round, at: null, locked: false, sending: false };
      }
    } else if (prev && amIn(prev) && _overlay && _overlay.projectId === st.projectId && _overlay.mode === 'play') {
      // Dropped from the game (left on another device, grace ran out): keep watching.
      _overlay.mode = 'watch';
      _marker = null;
      if (_overlay.el) _overlay.el.classList.add('is-watch');
    }
    render();
  }

  function onIdle(st, prev) {
    const wasMine = !!(prev && amIn(prev));
    if (_overlay && _overlay.projectId === st.projectId) {
      if (st.reason === 'done' && prev) {
        _overlay.final = prev;      // keep the results up until closed
      } else {
        closeOverlay();
        if (wasMine && st.reason === 'moved') say('Your game continued in another tab.', 'info');
        else if (st.reason === 'disabled') say('Scene Guess was switched off here.', 'warn');
        else if (wasMine && st.reason === 'no-stills') say("This island doesn't have enough screenshots yet.", 'warn');
        else if (wasMine && st.reason === 'error') say('The game hit a problem and stopped.', 'error');
      }
    } else if (wasMine && st.reason === 'moved') {
      say('Your game continued in another tab.', 'info');
    }
    if (_marker && _marker.projectId === st.projectId) _marker = null;
  }

  function onLive(p) {
    if (!p || typeof p.projectId !== 'string') return;
    if (p.live) _cfg.live[p.projectId] = p.host || '';
    else delete _cfg.live[p.projectId];
    render();
  }

  function onIslands(p) {
    if (!p) return;
    const wasOn = _cfg.enabled;
    _cfg.enabled = !!p.enabled;
    _cfg.islands = Array.isArray(p.islands) ? p.islands : [];
    if (_cfg.enabled && !wasOn) loadConfig();          // switched on mid-visit: fetch records too
    if (!liveIsland(_zone)) closePanel();
    if (_overlay && !liveIsland(_overlay.projectId) && !_overlay.final) closeOverlay();
    render();
  }

  function onRecords(p) {
    if (!p || !p.records) return;
    _cfg.records = p.records;
    render();
    if (_panel) renderPanel();
  }

  function onFanfare(p) {
    if (!p || p.kind !== 'record') return;
    _postSystem(`🏆 ${p.username} set a new ${title(p.projectId)} record: ${fmt(p.score)}!`);
    if (p.username === _me) _cfg.mine[p.projectId] = p.score;
    if (_engine && _engine.playConfetti) _engine.playConfetti(p.projectId);
  }

  function onArrived(p) {
    if (!p) return;
    _postSystem(`👑 The champion of ${title(p.projectId)} has arrived — ${p.username}`);
    if (_engine && _engine.spotlight) _engine.spotlight(_socket && p.id === _socket.id ? 'local' : p.id, 6000);
  }

  // E at an island's screen: join its lobby, watch its game, or open its panel.
  function onScreen(pid) {
    if (!liveIsland(pid) || _overlay || _panel) return;
    const mine = myGame();
    if (mine && mine.projectId === pid && mine.phase !== 'lobby') return openOverlay(pid, 'play');
    const st = _states.get(pid);
    if (!mine && st && st.phase === 'lobby') return join(pid);
    if (!mine && (st || _cfg.live[pid] != null)) return openOverlay(pid, 'watch');
    openPanel(pid);
  }

  // ── the 3D side (Playground3D: screens, crowns, roof labels) ──

  // What an island's screen shows (PG3DScene.drawScreen).
  function screenView(pid) {
    const st = _states.get(pid) || null;
    const rec = _cfg.records[pid] || null;
    return {
      mode: st ? st.phase : 'idle',
      title: title(pid),
      record: rec ? { username: rec.username, score: rec.score } : null,
      pickUrl: rec && rec.pickUrl ? rec.pickUrl : null,
      liveHost: _cfg.live[pid] != null ? (_cfg.live[pid] || '') : null,
      state: st,
      deadline: st && st.deadline ? st.deadline - _clockOffset : 0
    };
  }

  function syncEngine() {
    if (!_engine) return;
    const islands = _cfg.enabled ? _cfg.islands : [];
    const champs = {};
    for (const pid of islands) { const r = _cfg.records[pid]; if (r) champs[pid] = r.username; }
    const key = JSON.stringify([islands, champs, _me, Object.keys(_cfg.live), islands.map(pid => _cfg.records[pid] && _cfg.records[pid].score)]);
    if (key !== _engineKey) {
      _engineKey = key;
      if (_engine.setSceneScreens) _engine.setSceneScreens(islands);
      if (_engine.setChampions) _engine.setChampions(champs, _me);
      if (_onTags) { try { _onTags(); } catch (_) {} }
    }
    if (_engine.setSceneScreenState) for (const pid of islands) _engine.setSceneScreenState(pid, screenView(pid));
  }

  // The extra line on an island's roof label (js/views/world.js _pushKeeperTags).
  function tagFor(pid) {
    if (!_started || !liveIsland(pid)) return null;
    if (_cfg.live[pid] != null) return { sg: '● LIVE · Scene Guess', live: true };
    const r = _cfg.records[pid];
    return { sg: r ? `🏆 ${fmt(r.score)} · ${r.username}` : '🎬 Scene Guess', live: false };
  }

  // ── the clock (4 Hz): countdowns + the auto lock-in ──

  function tick() {
    if (!_started) return;
    const st = _overlay ? (_overlay.final || _states.get(_overlay.projectId)) : null;
    if (_overlay && st) updateTimer(st);
    if (_lobbyEl) updateLobbyTime();
    if (_chip) renderChip();
    // A placed but unlocked marker locks itself just before the buzzer.
    const g = _marker && _states.get(_marker.projectId);
    if (g && g.phase === 'round' && g.round === _marker.round && _marker.at != null && !_marker.locked && !_marker.sending &&
        g.deadline - now() <= L().C.AUTO_LOCK_LEAD_MS) {
      lockIn();
    }
  }

  // ── rendering ──

  function render() {
    if (!_started) return;
    renderChip();
    renderLobby();
    renderOverlay();
    syncEngine();
  }

  // The header chip — only on a live island (or while I'm in a game).
  function renderChip() {
    const mine = myGame();
    const here = _zone ? _states.get(_zone) : null;
    const show = !!mine || liveIsland(_zone);
    if (!show || !_slot) {
      if (_chip) { _chip.remove(); _chip = null; }
      return;
    }
    if (!_chip) {
      _chip = document.createElement('button');
      _chip.type = 'button';
      _chip.className = 'world-sg-chip';
      _chip.addEventListener('click', onChip);
      _slot.appendChild(_chip);
    }
    let text, cls = '';
    if (mine && mine.phase === 'lobby') { text = `🎬 Lobby · ${secsLeft(mine.deadline)}s`; cls = 'is-lobby'; }
    else if (mine) { text = '🎬 Back to your game'; cls = 'is-live'; }
    else if (here && here.phase === 'lobby') { text = `● Lobby open · Join · ${secsLeft(here.deadline)}s`; cls = 'is-lobby'; }
    else if (here) { text = `● LIVE · ${here.host || '…'} · ${Math.min(here.of, here.round + 1)}/${here.of} · Watch`; cls = 'is-live'; }
    else if (_cfg.live[_zone] != null) { text = `● LIVE · ${_cfg.live[_zone] || '…'} · Watch`; cls = 'is-live'; }
    else {
      const rec = _cfg.records[_zone];
      text = rec ? `🎬 Scene Guess · 🏆 ${fmt(rec.score)}` : '🎬 Scene Guess';
    }
    if (_chip.textContent !== text) _chip.textContent = text;
    _chip.className = 'world-sg-chip ' + cls;
    _chip.title = 'Scene Guess — when in the film is this screenshot?';
  }

  async function onChip() {
    const mine = myGame();
    if (mine && mine.phase !== 'lobby') return openOverlay(mine.projectId, 'play');
    const here = _zone ? _states.get(_zone) : null;
    if (!mine && here && here.phase === 'lobby') return join(_zone);
    if (!mine && (here || _cfg.live[_zone] != null)) return openOverlay(_zone, 'watch');
    openPanel(mine ? mine.projectId : _zone);
  }

  // ── lobby card ──

  function lobbyState() {
    const mine = myGame();
    if (mine && mine.phase === 'lobby') return mine;
    const here = _zone ? _states.get(_zone) : null;
    return here && here.phase === 'lobby' ? here : null;
  }

  function renderLobby() {
    const st = lobbyState();
    if (!st) return removeLobby();
    if (!_lobbyEl) {
      _lobbyEl = document.createElement('div');
      _lobbyEl.className = 'sg-lobby';
      _lobbyEl.setAttribute('role', 'status');
      _lobbyEl.addEventListener('click', onLobbyClick);
      document.body.appendChild(_lobbyEl);
    }
    const inIt = amIn(st);
    const host = st.host === _me;
    const full = st.players.length >= st.max;
    const key = JSON.stringify([st.projectId, st.players.map(p => p.username), inIt, host, full]);
    if (_lobbyEl.dataset.key !== key) {
      _lobbyEl.dataset.key = key;
      _lobbyEl.innerHTML = `
        <div class="sg-lobby-head">
          <span class="sg-lobby-title">Scene Guess</span>
          <span class="sg-lobby-film">${esc(title(st.projectId))}</span>
        </div>
        <div class="sg-lobby-time">Starts in <b class="sg-lobby-secs">${secsLeft(st.deadline)}</b>s · ${st.players.length}/${st.max} players</div>
        <div class="sg-lobby-players">${st.players.map(p => `<span class="sg-chip ${colorOf(st, p.username)}">${esc(p.username)}${p.username === st.host ? ' ★' : ''}</span>`).join('')}</div>
        <div class="sg-lobby-actions">
          ${inIt ? '<button type="button" class="sg-btn" data-act="leave">Leave</button>' : `<button type="button" class="sg-btn sg-btn-primary" data-act="join" ${full ? 'disabled' : ''}>${full ? 'Full' : 'Join'}</button>`}
          ${host ? '<button type="button" class="sg-btn sg-btn-primary" data-act="go">Start now</button>' : ''}
        </div>`;
    }
  }

  function updateLobbyTime() {
    const st = lobbyState();
    const el = _lobbyEl && _lobbyEl.querySelector('.sg-lobby-secs');
    if (st && el) el.textContent = String(secsLeft(st.deadline));
  }

  function removeLobby() {
    if (_lobbyEl) { _lobbyEl.remove(); _lobbyEl = null; }
  }

  async function onLobbyClick(e) {
    const btn = e.target.closest('button[data-act]');
    const st = lobbyState();
    if (!btn || !st) return;
    btn.disabled = true;
    const act = btn.dataset.act;
    let r;
    if (act === 'join') r = await emit('world:sg-join', { projectId: st.projectId });
    else if (act === 'leave') r = await emit('world:sg-leave', {});
    else if (act === 'go') r = await emit('world:sg-go', {});
    if (r && !r.ok) say(errText(r.error), 'warn');
    if (_lobbyEl) { delete _lobbyEl.dataset.key; renderLobby(); }
  }

  async function join(pid) {
    const r = await emit('world:sg-join', { projectId: pid });
    if (!r.ok) say(errText(r.error), 'warn');
  }

  async function play(pid) {
    const r = await emit('world:sg-start', { projectId: pid });
    if (!r.ok) say(errText(r.error), 'warn');
    return r.ok;
  }

  // ── island panel ──

  async function openPanel(pid) {
    if (!pid) return;
    closePanel();
    const el = document.createElement('div');
    el.className = 'world-lb sg-panel';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Scene Guess');
    el.innerHTML = `
      <div class="world-lb-panel sg-panel-box">
        <button class="popup-close" type="button" aria-label="Close">✕</button>
        <h3>Scene Guess</h3>
        <p class="world-lb-sub">${esc(title(pid))}</p>
        <p class="sg-how">10 screenshots from ${esc(title(pid))}. Mark on its timeline when each one happens — the closer you land, the more points (up to 1,000 each). Everyone on the island can join in the first ${Math.round(L().C.LOBBY_MS / 1000)} seconds.</p>
        <div class="sg-panel-record"></div>
        <div class="sg-panel-board"><div class="sg-muted">Loading the board…</div></div>
        <div class="sg-panel-me"></div>
        <div class="sg-panel-actions"></div>
        <div class="sg-panel-picks" hidden></div>
      </div>`;
    document.body.appendChild(el);
    const close = (typeof wireModalDismiss === 'function')
      ? wireModalDismiss(el, () => closePanel(), { initialFocus: el.querySelector('.popup-close') })
      : () => closePanel();
    el.querySelector('.popup-close').addEventListener('click', close);
    el.querySelector('.sg-panel-actions').addEventListener('click', onPanelAction);
    _panel = { el, projectId: pid, close, board: null, picks: null };
    syncInput();
    renderPanel();
    try {
      const res = await fetch(`${API}/world/scene/${encodeURIComponent(pid)}/board`, { headers: { Authorization: `Bearer ${Auth.getToken()}` } });
      const data = res.ok ? await res.json() : null;
      if (_panel && _panel.projectId === pid) { _panel.board = data || { top: [], me: null }; renderPanel(); }
    } catch (_) {
      if (_panel && _panel.projectId === pid) { _panel.board = { top: [], me: null }; renderPanel(); }
    }
  }

  function closePanel() {
    if (!_panel) return;
    const el = _panel.el;
    _panel = null;
    el.remove();
    syncInput();
  }

  function renderPanel() {
    if (!_panel) return;
    const pid = _panel.projectId;
    const el = _panel.el;
    const rec = _cfg.records[pid];
    el.querySelector('.sg-panel-record').innerHTML = rec
      ? `<div class="sg-record">🏆 Island record <b>${fmt(rec.score)}</b> · ${esc(rec.username)}${rec.username === _me ? ' (you — you wear the crown here)' : ''}</div>`
      : '<div class="sg-record">🏆 No record yet — the first finished game sets it.</div>';
    const b = _panel.board;
    if (b) {
      el.querySelector('.sg-panel-board').innerHTML = b.top && b.top.length
        ? `<ol class="sg-top5">${b.top.map(r => `<li class="${r.username === _me ? 'you' : ''}"><span>${esc(r.username)}</span><b>${fmt(r.best)}</b></li>`).join('')}</ol>`
        : '<div class="sg-muted">Nobody has finished a game here yet.</div>';
      el.querySelector('.sg-panel-me').innerHTML = b.me && b.me.best > 0
        ? `<div class="sg-muted">Your best: <b>${fmt(b.me.best)}</b> · #${b.me.rank} · ${b.me.plays} game${b.me.plays === 1 ? '' : 's'}</div>`
        : (b.me ? `<div class="sg-muted">${b.me.plays} game${b.me.plays === 1 ? '' : 's'} played, no points yet.</div>` : '');
    }
    const st = _states.get(pid);
    const mine = myGame();
    const champ = !!(rec && rec.username === _me);
    let actions;
    if (mine && mine.projectId === pid) actions = mine.phase === 'lobby'
      ? '<span class="sg-muted">You\'re in the lobby.</span><button type="button" class="sg-btn" data-act="leave">Leave</button>'
      : '<button type="button" class="sg-btn sg-btn-primary" data-act="back">Back to your game</button>';
    else if (st && st.phase === 'lobby') actions = '<button type="button" class="sg-btn sg-btn-primary" data-act="join">Join the lobby</button>';
    else if (st || _cfg.live[pid] != null) actions = '<button type="button" class="sg-btn sg-btn-primary" data-act="watch">Watch the game</button>';
    else actions = `<button type="button" class="sg-btn sg-btn-primary" data-act="play" ${mine ? 'disabled' : ''}>Play</button>`;
    if (champ && !st && _cfg.live[pid] == null) actions += '<button type="button" class="sg-btn" data-act="picks">Change screen picture</button>';
    el.querySelector('.sg-panel-actions').innerHTML = actions;
  }

  async function onPanelAction(e) {
    const btn = e.target.closest('button[data-act]');
    if (!btn || !_panel) return;
    const pid = _panel.projectId;
    const act = btn.dataset.act;
    if (act === 'play') { btn.disabled = true; if (await play(pid)) closePanel(); else if (_panel) btn.disabled = false; return; }
    if (act === 'join') { closePanel(); return join(pid); }
    if (act === 'leave') { await emit('world:sg-leave', {}); return renderPanel(); }
    if (act === 'watch') { closePanel(); return openOverlay(pid, 'watch'); }
    if (act === 'back') { closePanel(); return openOverlay(pid, 'play'); }
    if (act === 'picks') return showPicks(pid);
  }

  async function showPicks(pid) {
    const box = _panel && _panel.el.querySelector('.sg-panel-picks');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = '<div class="sg-muted">Loading your record game…</div>';
    try {
      const res = await fetch(`${API}/world/scene/${encodeURIComponent(pid)}/picks`, { headers: { Authorization: `Bearer ${Auth.getToken()}` } });
      const data = await res.json();
      if (!res.ok) { box.innerHTML = `<div class="sg-muted">${esc(data.error || 'Not available.')}</div>`; return; }
      renderPickGrid(box, pid, data.stills || [], data.pick, null);
    } catch (_) { box.innerHTML = '<div class="sg-muted">Could not load the pictures.</div>'; }
  }

  // The champion's pick: one of the 10 stills of their record game is what
  // the island screen shows between games.
  function renderPickGrid(box, pid, stills, current, labels) {
    box.innerHTML = `
      <div class="sg-pick-head">Pick the picture your island screen shows between games</div>
      <div class="sg-pick-grid">${stills.map((u, i) => u ? `
        <button type="button" class="sg-pick ${i === current ? 'is-on' : ''}" data-i="${i}" aria-pressed="${i === current}">
          <img src="${esc(u)}" alt="" crossorigin="anonymous" loading="lazy">
          ${labels && labels[i] ? `<span>${esc(labels[i])}</span>` : ''}
        </button>` : '').join('')}
      </div>`;
    box.querySelectorAll('.sg-pick').forEach(b => b.addEventListener('click', async () => {
      const r = await emit('world:sg-pick', { projectId: pid, index: +b.dataset.i });
      if (!r.ok) return say(errText(r.error), 'warn');
      box.querySelectorAll('.sg-pick').forEach(x => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      say('Your island screen will show this picture between games.', 'success');
    }));
  }

  // ── the game overlay ──

  function openOverlay(pid, mode) {
    if (_overlay && _overlay.projectId === pid && _overlay.mode === mode && !_overlay.final) { renderOverlay(); return; }
    closeOverlay(true);
    closePanel();
    const el = document.createElement('div');
    el.className = 'sg-overlay' + (mode === 'watch' ? ' is-watch' : '');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Scene Guess');
    el.innerHTML = `
      <div class="sg-frame">
        <header class="sg-top">
          <div class="sg-title"><span class="sg-brand">Scene Guess</span><span class="sg-film"></span></div>
          <div class="sg-round"></div>
          <div class="sg-timer" aria-hidden="true"><svg viewBox="0 0 36 36"><circle class="sg-timer-bg" cx="18" cy="18" r="15.5"/><circle class="sg-timer-fg" cx="18" cy="18" r="15.5"/></svg><span class="sg-timer-num"></span></div>
          <button type="button" class="sg-close" aria-label="Leave">✕</button>
        </header>
        <div class="sg-stage">
          <div class="sg-still">
            <img class="sg-img" alt="A screenshot from the film" crossorigin="anonymous">
            <div class="sg-wait"><div class="sg-spinner"></div></div>
            <div class="sg-ready"></div>
            <div class="sg-reveal-msg" aria-live="polite"></div>
          </div>
          <div class="sg-results" hidden></div>
        </div>
        <div class="sg-players"></div>
        <div class="sg-line">
          <div class="sg-track" role="slider" tabindex="0" aria-label="When in the film is this screenshot?" aria-valuemin="0">
            <div class="sg-segs"></div>
            <div class="sg-ticks"></div>
            <div class="sg-pins"></div>
            <div class="sg-marker" hidden><span class="sg-bubble"></span></div>
          </div>
        </div>
        <div class="sg-controls">
          <button type="button" class="sg-btn sg-nudge" data-d="-60">−1m</button>
          <button type="button" class="sg-btn sg-nudge" data-d="-10">−10s</button>
          <span class="sg-readout">Tap the line where you think it is</span>
          <button type="button" class="sg-btn sg-nudge" data-d="10">+10s</button>
          <button type="button" class="sg-btn sg-nudge" data-d="60">+1m</button>
          <button type="button" class="sg-btn sg-btn-primary sg-lock">Lock in</button>
        </div>
        <div class="sg-confetti" aria-hidden="true"></div>
      </div>`;
    document.body.appendChild(el);
    const refs = {
      film: el.querySelector('.sg-film'), round: el.querySelector('.sg-round'),
      timer: el.querySelector('.sg-timer'), timerFg: el.querySelector('.sg-timer-fg'), timerNum: el.querySelector('.sg-timer-num'),
      close: el.querySelector('.sg-close'),
      still: el.querySelector('.sg-still'), img: el.querySelector('.sg-img'), wait: el.querySelector('.sg-wait'),
      ready: el.querySelector('.sg-ready'), revealMsg: el.querySelector('.sg-reveal-msg'),
      results: el.querySelector('.sg-results'), players: el.querySelector('.sg-players'),
      line: el.querySelector('.sg-line'), track: el.querySelector('.sg-track'),
      segs: el.querySelector('.sg-segs'), ticks: el.querySelector('.sg-ticks'), pins: el.querySelector('.sg-pins'),
      marker: el.querySelector('.sg-marker'), bubble: el.querySelector('.sg-bubble'),
      controls: el.querySelector('.sg-controls'), readout: el.querySelector('.sg-readout'), lock: el.querySelector('.sg-lock'),
      confetti: el.querySelector('.sg-confetti')
    };
    _overlay = { el, projectId: pid, mode, final: null, refs, lineKey: '', imgUrl: '', confettiFor: '' };
    refs.img.addEventListener('load', () => refs.wait.hidden = true);
    refs.img.addEventListener('error', () => refs.wait.hidden = true);
    refs.close.addEventListener('click', onCloseClick);
    el.addEventListener('keydown', onOverlayKey);
    wireTrack(refs.track);
    refs.controls.addEventListener('click', onControls);
    syncInput();
    renderOverlay();
    (mode === 'play' ? refs.track : refs.close).focus({ preventScroll: true });
  }

  function closeOverlay(silent) {
    if (!_overlay) return;
    const el = _overlay.el;
    _overlay = null;
    el.remove();
    if (!silent) syncInput();
    else if (_engine && _engine.setInputSuspended) _engine.setInputSuspended(!!_panel);
  }

  async function onCloseClick() {
    if (!_overlay) return;
    const st = _states.get(_overlay.projectId);
    if (_overlay.mode === 'play' && !_overlay.final && st && amIn(st) && st.phase !== 'results') {
      const ok = (typeof confirmDialog === 'function')
        ? await confirmDialog({ title: 'Leave the game?', message: "You'll drop out and this game won't count for you.", confirmLabel: 'Leave', cancelLabel: 'Keep playing', danger: true })
        : true;
      if (!ok || !_overlay) return;
      await emit('world:sg-leave', {});
    }
    closeOverlay();
  }

  function onOverlayKey(e) {
    if (e.key === 'Escape' && !document.querySelector('.confirm-overlay, .confirm-dialog')) {
      e.preventDefault();
      onCloseClick();
    }
  }

  // The state the overlay shows: the live game, or the frozen results.
  function overlayState() {
    if (!_overlay) return null;
    return _overlay.final || _states.get(_overlay.projectId) || null;
  }

  function canGuess(st) {
    return !!(_overlay && _overlay.mode === 'play' && !_overlay.final && st && st.phase === 'round' && amIn(st) &&
      _marker && _marker.round === st.round && !_marker.locked);
  }

  function renderOverlay() {
    if (!_overlay) return;
    const st = overlayState();
    if (!st) return;
    const r = _overlay.refs;
    const tl = st.timeline;
    r.film.textContent = title(st.projectId) + (_overlay.mode === 'watch' ? ` · watching ${st.host || ''}'s game` : '');
    const showRound = Math.min(st.of, Math.max(1, st.round + 1));
    r.round.textContent = st.phase === 'lobby' ? 'Lobby' : st.phase === 'ready' ? 'Get ready' : st.phase === 'results' ? 'Final scores' : `Round ${showRound}/${st.of}`;
    r.close.setAttribute('aria-label', _overlay.mode === 'play' && !_overlay.final && st.phase !== 'results' ? 'Leave the game' : 'Close');
    updateTimer(st);

    const results = st.phase === 'results';
    r.results.hidden = !results;
    r.still.hidden = results;
    r.line.hidden = results || !tl;
    r.controls.hidden = results || _overlay.mode !== 'play';
    r.players.hidden = results;
    if (results) { renderResults(st); return; }

    // The still for this round (none yet while getting ready).
    const url = st.phase === 'round' || st.phase === 'reveal' ? (st.stills || [])[st.round] : null;
    if (url !== _overlay.imgUrl) {
      _overlay.imgUrl = url || '';
      if (url) {
        r.wait.hidden = false;
        r.img.src = url;
        if (r.img.complete && r.img.naturalWidth) r.wait.hidden = true;
      } else {
        r.img.removeAttribute('src');
        r.wait.hidden = true;
      }
    }
    r.img.hidden = !url;
    r.ready.hidden = st.phase !== 'ready';
    if (st.phase === 'ready') r.ready.innerHTML = `<b>Get ready</b><span>${st.players.length} player${st.players.length === 1 ? '' : 's'} · 10 screenshots</span>`;

    // Who's in, who has locked in, running totals.
    r.players.innerHTML = st.players.map(p => `
      <span class="sg-chip ${colorOf(st, p.username)} ${p.locked ? 'is-locked' : ''} ${(st.away || []).includes(p.username) ? 'is-away' : ''}" title="${esc(p.username)}">
        <i>${esc(initials(p.username))}</i>${esc(p.username)}${p.username === _me ? ' (you)' : ''} <b>${fmt(p.total)}</b>${st.phase === 'round' ? (p.locked ? ' ✓' : ' …') : ''}
      </span>`).join('');

    if (tl) renderLine(st, tl);
    renderControls(st, tl);
    renderReveal(st, tl);
  }

  function updateTimer(st) {
    const r = _overlay && _overlay.refs;
    if (!r) return;
    const timed = !_overlay.final && ['ready', 'round', 'reveal', 'results'].includes(st.phase);
    r.timer.hidden = !timed;
    if (!timed) return;
    const total = st.phase === 'round' ? st.roundMs : st.phase === 'ready' ? L().C.READY_MS : st.phase === 'reveal' ? L().C.REVEAL_MS : L().C.RESULTS_MS;
    const left = Math.max(0, st.deadline - now());
    const frac = total > 0 ? Math.min(1, left / total) : 0;
    const circ = 2 * Math.PI * 15.5;
    r.timerFg.style.strokeDasharray = `${circ}`;
    r.timerFg.style.strokeDashoffset = `${circ * (1 - frac)}`;
    r.timer.classList.toggle('is-low', st.phase === 'round' && left <= 5000);
    r.timerNum.textContent = String(Math.ceil(left / 1000));
    if (st.phase === 'ready' && r.ready && !r.ready.hidden) {
      const span = r.ready.querySelector('b');
      if (span) span.textContent = `Get ready · ${Math.ceil(left / 1000)}`;
    }
  }

  // The line: episode segments or 15-minute ticks, my marker, and at a
  // reveal every player's pin plus the real moment.
  function renderLine(st, tl) {
    const r = _overlay.refs;
    const key = st.projectId + '|' + tl.total + '|' + tl.segments.length;
    if (_overlay.lineKey !== key) {
      _overlay.lineKey = key;
      r.track.setAttribute('aria-valuemax', String(tl.total));
      const pct = (x) => (100 * x / tl.total).toFixed(3) + '%';
      r.segs.innerHTML = tl.kind === 'series'
        ? tl.segments.map((s, i) => `<span class="sg-seg ${i % 2 ? 'odd' : ''}" style="left:${pct(s.start)};width:${pct(s.len)}"><em>${esc(s.label)}</em></span>`).join('')
        : '';
      r.ticks.innerHTML = tl.kind === 'series' ? '' : L().ticks(tl).map(t => `<span class="sg-tick" style="left:${pct(t.at)}"><em>${esc(t.label)}</em></span>`).join('');
    }
    // Pins only at a reveal (and only for the revealed round).
    const h = st.phase === 'reveal' ? (st.history || [])[st.round] : null;
    if (h) {
      const pct = (x) => (100 * x / tl.total).toFixed(3) + '%';
      r.pins.innerHTML =
        h.guesses.filter(g => g.at != null).map(g => `<span class="sg-pin ${colorOf(st, g.username)} ${g.username === _me ? 'is-me' : ''}" style="left:${pct(g.at)}" title="${esc(g.username)} · ${esc(L().formatGuess(tl, g.at))}"><i>${esc(initials(g.username))}</i></span>`).join('') +
        `<span class="sg-pin sg-answer" style="left:${pct(h.answer)}" title="The real moment"><i>★</i><em>${esc(h.label)}</em></span>`;
    } else if (r.pins.innerHTML) {
      r.pins.innerHTML = '';
    }
    // My marker (during my round; at a reveal my locked guess is a pin instead).
    const m = _marker && _overlay.mode === 'play' && st.phase === 'round' && _marker.round === st.round ? _marker : null;
    r.marker.hidden = !(m && m.at != null);
    if (m && m.at != null) {
      r.marker.style.left = (100 * m.at / tl.total).toFixed(3) + '%';
      r.marker.classList.toggle('is-locked', !!m.locked);
      r.bubble.textContent = L().formatGuess(tl, m.at);
      r.track.setAttribute('aria-valuenow', String(m.at));
      r.track.setAttribute('aria-valuetext', L().formatGuess(tl, m.at));
    }
    r.track.classList.toggle('is-active', canGuess(st));
    r.track.setAttribute('aria-disabled', canGuess(st) ? 'false' : 'true');
  }

  function renderControls(st, tl) {
    const r = _overlay.refs;
    if (_overlay.mode !== 'play') return;
    const can = canGuess(st);
    const placed = !!(_marker && _marker.at != null && _marker.round === st.round);
    r.controls.querySelectorAll('.sg-nudge').forEach(b => { b.disabled = !can || !placed; });
    r.lock.disabled = !can || !placed || (_marker && _marker.sending);
    let text;
    if (st.phase === 'ready') text = 'The first screenshot is coming up…';
    else if (st.phase === 'reveal') text = 'Next screenshot in a moment…';
    else if (_marker && _marker.locked && _marker.round === st.round) {
      const waiting = st.players.filter(p => !p.locked && !(st.away || []).includes(p.username)).length;
      text = `Locked in at ${L().formatGuess(tl, _marker.at)} ✓` + (waiting ? ` · waiting for ${waiting} more` : '');
    } else if (placed) text = L().formatGuess(tl, _marker.at);
    else text = tl && tl.kind === 'series' ? 'Tap the line: the episode and the moment' : 'Tap the line where you think it is';
    if (r.readout.textContent !== text) r.readout.textContent = text;
    r.lock.textContent = _marker && _marker.locked && _marker.round === st.round ? 'Locked ✓' : 'Lock in';
  }

  function renderReveal(st, tl) {
    const r = _overlay.refs;
    const h = st.phase === 'reveal' ? (st.history || [])[st.round] : null;
    r.revealMsg.hidden = !h;
    if (!h) { r.revealMsg.innerHTML = ''; return; }
    const mine = h.guesses.find(g => g.username === _me);
    const best = [...h.guesses].sort((a, b) => b.points - a.points)[0];
    r.revealMsg.innerHTML = `
      <div class="sg-reveal-when">It was at <b>${esc(h.label)}</b></div>
      ${mine ? `<div class="sg-reveal-me ${mine.points >= 900 ? 'is-great' : ''}">${mine.at == null ? 'No guess · +0' : `You said ${esc(L().formatGuess(tl, mine.at))} · <b>+${fmt(mine.points)}</b>`}</div>` : ''}
      ${!mine && best ? `<div class="sg-reveal-me">${esc(best.username)} was closest · +${fmt(best.points)}</div>` : ''}`;
  }

  function renderResults(st) {
    const r = _overlay.refs;
    const key = JSON.stringify([st.projectId, st.ranking, st.record, !!_overlay.final]);
    if (r.results.dataset.key === key) return;
    r.results.dataset.key = key;
    const rec = st.record;
    const mineRecord = !!(rec && rec.username === _me);
    const rows = (st.ranking || []).map((p, i) => {
      const bars = (st.history || []).map(h => {
        const g = h.guesses.find(x => x.username === p.username);
        const pts = g ? g.points : 0;
        return `<i style="--h:${Math.max(4, Math.round(pts / 10))}%" title="${fmt(pts)}"></i>`;
      }).join('');
      return `<li class="${p.username === _me ? 'you' : ''}">
        <span class="sg-rank-n">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1)}</span>
        <span class="sg-chip ${colorOf(st, p.username)}"><i>${esc(initials(p.username))}</i>${esc(p.username)}</span>
        <span class="sg-bars" aria-hidden="true">${bars}</span>
        <b>${fmt(p.total)}</b>
      </li>`;
    }).join('');
    let beat = '';
    if (rec && rec.previous != null) {
      if (rec.previousHolder && rec.previousHolder === rec.username) beat = ` · beat ${mineRecord ? 'your' : 'their'} own ${fmt(rec.previous)}`;
      else if (rec.previousHolder) beat = ` · beat ${rec.previousHolder === _me ? 'your' : esc(rec.previousHolder) + '’s'} ${fmt(rec.previous)}`;
      else beat = ` · beat ${fmt(rec.previous)}`;
    }
    const banner = rec
      ? `<div class="sg-banner is-record">${mineRecord ? '👑 New island record — you wear the crown!' : `👑 New island record by ${esc(rec.username)}`}<span>${fmt(rec.score)}${beat}</span></div>`
      : `<div class="sg-banner">Final scores${_cfg.records[st.projectId] ? `<span>Island record ${fmt(_cfg.records[st.projectId].score)} · ${esc(_cfg.records[st.projectId].username)}</span>` : ''}</div>`;
    const island = _states.get(st.projectId);
    const canAgain = _overlay.mode === 'play' && liveIsland(st.projectId) && st.projectId === _zone;
    r.results.innerHTML = `
      ${banner}
      <ol class="sg-ranking">${rows}</ol>
      ${mineRecord ? '<div class="sg-results-picks"></div>' : ''}
      <div class="sg-results-actions">
        ${canAgain ? `<button type="button" class="sg-btn sg-btn-primary" data-act="again">${island && island.phase === 'lobby' ? 'Join the next game' : 'Play again'}</button>` : ''}
        <button type="button" class="sg-btn" data-act="close">Close</button>
      </div>`;
    if (mineRecord) {
      const labels = (st.history || []).map(h => h.label);
      renderPickGrid(r.results.querySelector('.sg-results-picks'), st.projectId, st.stills || [], -1, labels);
    }
    r.results.querySelector('[data-act="close"]').addEventListener('click', () => closeOverlay());
    const again = r.results.querySelector('[data-act="again"]');
    if (again) again.addEventListener('click', async () => {
      const pid = st.projectId;
      closeOverlay();
      const live = _states.get(pid);
      if (live && live.phase === 'lobby') join(pid); else play(pid);
    });
    if (rec && _overlay.confettiFor !== key) { _overlay.confettiFor = key; confetti(r.confetti); }
  }

  function confetti(host) {
    if (!host || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    const colors = ['#ffd23f', '#e3243f', '#3ecf73', '#4ea1ff', '#a58bff', '#ffffff'];
    host.innerHTML = Array.from({ length: 70 }, () => {
      const c = colors[Math.floor(Math.random() * colors.length)];
      return `<i style="left:${(Math.random() * 100).toFixed(1)}%;background:${c};animation-delay:${(Math.random() * 0.6).toFixed(2)}s;animation-duration:${(2.2 + Math.random() * 1.6).toFixed(2)}s;--r:${Math.floor(Math.random() * 720 - 360)}deg"></i>`;
    }).join('');
    setTimeout(() => { if (host.isConnected) host.innerHTML = ''; }, 4500);
  }

  // ── guessing ──

  function wireTrack(track) {
    let dragging = null;
    const atFromX = (clientX) => {
      const st = overlayState();
      if (!st || !st.timeline) return null;
      const rect = track.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      return Math.round(f * st.timeline.total);
    };
    track.addEventListener('pointerdown', (e) => {
      const st = overlayState();
      if (!canGuess(st)) return;
      e.preventDefault();
      dragging = e.pointerId;
      try { track.setPointerCapture(e.pointerId); } catch (_) {}
      track.focus({ preventScroll: true });
      place(atFromX(e.clientX));
    });
    track.addEventListener('pointermove', (e) => {
      if (dragging !== e.pointerId) return;
      place(atFromX(e.clientX));
    });
    const end = (e) => { if (dragging === e.pointerId) { dragging = null; try { track.releasePointerCapture(e.pointerId); } catch (_) {} } };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    track.addEventListener('keydown', (e) => {
      const st = overlayState();
      if (!canGuess(st)) return;
      const tl = st.timeline;
      const at = _marker.at == null ? Math.round(tl.total / 2) : _marker.at;
      const step = e.shiftKey ? 60 : 10;
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = L().nudge(tl, at, step);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = L().nudge(tl, at, -step);
      else if (e.key === 'PageUp') next = tl.kind === 'series' ? L().stepEpisode(tl, at, 1) : L().nudge(tl, at, 300);
      else if (e.key === 'PageDown') next = tl.kind === 'series' ? L().stepEpisode(tl, at, -1) : L().nudge(tl, at, -300);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tl.total;
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (_marker.at != null) lockIn(); return; }
      if (next == null) return;
      e.preventDefault();
      place(next);
    });
  }

  function place(at) {
    const st = overlayState();
    if (at == null || !canGuess(st)) return;
    _marker.at = Math.max(0, Math.min(st.timeline.total, Math.round(at)));
    renderLine(st, st.timeline);
    renderControls(st, st.timeline);
  }

  function onControls(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const st = overlayState();
    if (!canGuess(st)) return;
    if (btn.classList.contains('sg-lock')) return lockIn();
    const d = Number(btn.dataset.d);
    if (Number.isFinite(d) && _marker.at != null) place(L().nudge(st.timeline, _marker.at, d));
  }

  async function lockIn() {
    const st = overlayState();
    if (!canGuess(st) || _marker.at == null || _marker.sending) return;
    const m = _marker;
    m.sending = true;
    renderControls(st, st.timeline);
    const r = await emit('world:sg-guess', { round: m.round, at: m.at });
    m.sending = false;
    if (r.ok) m.locked = true;
    else {
      if (r.error === 'too-late' || r.error === 'already' || r.error === 'not-round' || r.error === 'wrong-round') m.locked = true;
      say(errText(r.error), 'warn');
    }
    const cur = overlayState();
    if (cur && cur.timeline) { renderLine(cur, cur.timeline); renderControls(cur, cur.timeline); }
  }

  return {
    start, stop, onZone, tagFor,
    // For the browser preview / QA (tests drive the HUD without a mouse).
    _debug: {
      cfg: () => _cfg,
      state: (pid) => _states.get(pid || _zone) || null,
      marker: () => _marker,
      overlay: () => _overlay && { projectId: _overlay.projectId, mode: _overlay.mode, final: !!_overlay.final },
      place, lockIn, openPanel, openOverlay
    }
  };
})();
