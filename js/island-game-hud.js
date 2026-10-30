/************************************************
 * ISLAND GAME HUD — the shared /world HUD shell for island minigames
 *
 * IslandGameHud.create(spec) builds one game's HUD from the parts every
 * island game has (the server side is server/island-game.js):
 *   - config from GET /api/world/<api> and the live socket updates
 *   - a chip model for the header (js/island-games.js draws ONE chip for
 *     every game and asks each for its model)
 *   - the lobby card for everyone on the island while a lobby is open
 *   - the island panel: how it works, the record, top 5, your best, Play /
 *     Join / Watch, plus the game's own buttons
 *   - the game overlay frame: top bar, round timer, player chips, results
 *     (ranking with per-round bars, new-record banner, confetti), watch mode
 *   - the record / arrival chat lines, the screen + champions + E handler
 *     on the engine (Playground3D.setScreen* for `spec.kind`), the roof tag
 * The game supplies its stage (what a round looks like and how a player
 * answers), its texts, and its socket calls — spelled out as literals in its
 * own file (test/socket-contract.test.js reads them there):
 *   listen(on, h)   on('world:xx-state', h.state); … live, islands, records, fanfare, arrived
 *   send            { start(emit, pid), join(emit, pid), leave(emit), go(emit), pick(emit, pid, index) }
 * Quote Guess (js/quote-guess.js) is the first game on it; Scene Guess still
 * has its own copy (js/scene-guess.js).
 *
 * Everything shown comes from the game Logic's publicState-shaped payloads:
 * an answer is in `history` after its reveal, never before. While the
 * overlay or panel is open the 3D controls are suspended under this game's
 * own owner (Playground3D.setInputSuspended(on, kind)).
 ************************************************/
const IslandGameHud = (() => {
  const COLORS = 6;            // .sg-c0 … .sg-c5 player colours (styles/hud/scene-guess.css)
  const BASE_ERRORS = {
    'not-here': 'Step onto the island to play.',
    'busy': "You're already in a game.",
    'island-busy': 'Another game is running on this island — watch it, or play after.',
    'full': 'That lobby is full.',
    'started': 'That game already started — watch it instead.',
    'slow-down': 'Slow down a moment, then try again.',
    'no-game': 'That game has ended.',
    'not-playing': "You're not in this game.",
    'not-host': 'Only the host can do that.',
    'not-joined': 'Still connecting to the world — try again in a moment.',
    'not-champion': 'Only the island champion can do that.',
    'error': 'Something went wrong on the server — try again.',
    'offline': 'Not connected — try again in a moment.',
    'timeout': "The server didn't answer — try again."
  };
  const RESTART_MSG = 'Server restarting — the game will be back in a moment.';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString();
  function title(pid) {
    const list = (typeof projects !== 'undefined' && Array.isArray(projects)) ? projects : [];
    const p = list.find(q => q && q.id === pid);
    return (p && p.title) || pid || '';
  }
  function initials(name) { return String(name || '?').replace(/^claude_qa_/, '').slice(0, 2).toUpperCase(); }
  function say(msg, type) { if (typeof toast === 'function') toast(msg, type || 'info'); }
  function authHeaders() { return { Authorization: `Bearer ${Auth.getToken()}` }; }

  function create(spec) {
    const L = () => spec.Logic();
    const ERRORS = Object.assign({}, BASE_ERRORS, spec.errors || {});
    const DEFAULT_CFG = { enabled: false, islands: [], records: {}, live: {}, mine: {}, roundSec: 20 };

    let _socket = null, _engine = null, _postSystem = () => {}, _me = '', _onTags = null, _onChange = null;
    let _engineKey = '';
    let _cfg = { ...DEFAULT_CFG };
    let _zone = null;
    const _states = new Map();   // projectId → latest public state (current island + my game)
    let _clockOffset = 0;        // server time − local time
    let _overlay = null;         // { el, projectId, mode: 'play'|'watch', final, refs, local }
    let _panel = null;           // { el, projectId, close, board }
    let _lobbyEl = null;
    let _ticker = null;
    const _pending = new Set();
    const _dismissed = new Set();
    const _off = [];
    let _started = false;

    const now = () => Date.now() + _clockOffset;
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
    function errText(e) { return ERRORS[e] || "Couldn't do that — try again."; }
    function warnErr(e) { if (e !== 'stopped' && _started) say(errText(e), 'warn'); }
    function emit(event, payload) {
      return new Promise((resolve) => {
        if (!_started) return resolve({ ok: false, error: 'stopped' });
        if (!_socket || !_socket.connected) return resolve({ ok: false, error: 'offline' });
        let t = null;
        const finish = (r) => {
          if (!_pending.delete(finish)) return;
          clearTimeout(t);
          resolve(_started ? (r || { ok: false }) : { ok: false, error: 'stopped' });
        };
        _pending.add(finish);
        t = setTimeout(() => finish({ ok: false, error: 'timeout' }), 8000);
        _socket.emit(event, payload, finish);
      });
    }
    function syncInput() {
      if (_engine && _engine.setInputSuspended) _engine.setInputSuspended(!!(_overlay || _panel), spec.kind);
    }
    function changed() { if (_onChange) { try { _onChange(); } catch (_) {} } }

    // What a game's hooks get to work with.
    const h = {
      esc, fmt, title, initials, say, warnErr, errText,
      me: () => _me,
      now, secsLeft, amIn, myGame, colorOf, liveIsland,
      cfg: () => _cfg,
      zone: () => _zone,
      state: (pid) => _states.get(pid) || null,
      emit,
      send: spec.send,
      openPanel: (pid) => openPanel(pid),
      closePanel: () => closePanel(),
      openOverlay: (pid, mode) => openOverlay(pid, mode),
      closeOverlay: () => closeOverlay(),
      overlay: () => _overlay,
      render: () => render(),
      renderOverlay: () => renderOverlay(),
      confetti: (host) => confetti(host),
      authHeaders,
      api: (path) => `${API}/world/${spec.api}${path || ''}`
    };

    // ── lifecycle ──

    function start(opts) {
      stop();
      _socket = opts.socket || null;
      _engine = opts.engine || null;
      _postSystem = typeof opts.postSystem === 'function' ? opts.postSystem : () => {};
      _me = opts.username || '';
      _onTags = typeof opts.onTags === 'function' ? opts.onTags : null;
      _onChange = typeof opts.onChange === 'function' ? opts.onChange : null;
      _engineKey = '';
      _started = true;
      if (_engine) {
        if (spec.register) spec.register(_engine);
        if (_engine.setScreenInteract) _engine.setScreenInteract(spec.kind, (pid) => onScreen(pid));
      }
      spec.listen(on, { state: onState, live: onLive, islands: onIslands, records: onRecords, fanfare: onFanfare, arrived: onArrived });
      on('connect', () => { if (_started) { onReconnect(); loadConfig(); } });
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
        const res = await fetch(h.api(''), { headers: authHeaders() });
        if (!res.ok || !_started) return;
        const d = await res.json();
        if (!_started) return;
        _cfg = Object.assign({
          enabled: !!d.enabled,
          islands: Array.isArray(d.islands) ? d.islands : [],
          records: d.records || {},
          live: d.live || {},
          mine: d.mine || {},
          roundSec: d.roundSec || DEFAULT_CFG.roundSec
        }, spec.parseConfig ? spec.parseConfig(d) : {});
        render();
      } catch (_) { /* offline — the HUD stays dark */ }
    }

    // Leaving /world while in a game quits it.
    function stop() {
      if (_started && myGame() && _socket && _socket.connected) spec.send.leave((ev, p) => { _socket.emit(ev, p, () => {}); return Promise.resolve(); });
      _off.splice(0).forEach(f => f());
      if (_ticker) { clearInterval(_ticker); _ticker = null; }
      closeOverlay(true);
      closePanel();
      removeLobby();
      if (spec.onStop) spec.onStop(h);
      _states.clear();
      _dismissed.clear();
      _zone = null;
      _cfg = { ...DEFAULT_CFG };
      _started = false;
      for (const finish of [..._pending]) finish(null);
      _socket = null;
      if (_engine) {
        if (_engine.setInputSuspended) _engine.setInputSuspended(false, spec.kind);
        if (_engine.setScreenIslands) _engine.setScreenIslands(spec.kind, []);
        if (_engine.setScreenChampions) _engine.setScreenChampions(spec.kind, {}, '');
        if (_engine.setScreenInteract) _engine.setScreenInteract(spec.kind, null);
      }
      _engine = null;
      _onTags = null;
      _onChange = null;
      _engineKey = '';
    }

    // Back after a drop (NET2-01): nobody could tell the old socket that a
    // game ended or that our seat's grace ran out, so what we hold may be a
    // ghost ("Back to your game" for good, Play disabled). Forget it all:
    // world:join → resume(), and onZone once we're on an island again,
    // re-send every game that is still live. Final results stay up.
    function onReconnect() {
      _states.clear();
      if (_overlay && !_overlay.final) closeOverlay();
      if (_panel) renderPanel();
      render();
    }

    function onZone(projectId) {
      _zone = projectId || null;
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
        _dismissed.delete(st.projectId);
        onIdle(st, prev);
        return render();
      }
      _states.set(st.projectId, st);
      if (spec.onState) spec.onState(st, prev, h);
      if (st.phase !== 'results') _dismissed.delete(st.projectId);
      if (amIn(st)) {
        const closedResults = st.phase === 'results' && _dismissed.has(st.projectId);
        if (st.phase !== 'lobby' && !closedResults && !(_overlay && _overlay.projectId === st.projectId && _overlay.mode === 'play')) {
          openOverlay(st.projectId, 'play');
        }
      } else if (prev && amIn(prev) && _overlay && _overlay.projectId === st.projectId && _overlay.mode === 'play') {
        // Dropped from the game (left on another device, grace ran out): keep watching.
        _overlay.mode = 'watch';
        if (_overlay.el) _overlay.el.classList.add('is-watch');
      }
      render();
    }

    function onIdle(st, prev) {
      const wasMine = !!(prev && amIn(prev));
      const notes = spec.idleNotes || {};
      if (_overlay && _overlay.projectId === st.projectId) {
        if (st.reason === 'done' && prev) {
          _overlay.final = prev;      // keep the results up until closed
        } else {
          closeOverlay();
          if (wasMine && st.reason === 'moved') say('Your game continued in another tab.', 'info');
          else if (st.reason === 'disabled') say(`${spec.name} was switched off here.`, 'warn');
          else if (wasMine && notes[st.reason]) say(notes[st.reason], 'warn');
          else if (wasMine && st.reason === 'error') say('The game hit a problem and stopped.', 'error');
          else if (st.reason === 'restart') say(RESTART_MSG, 'warn');
        }
      } else if (wasMine && st.reason === 'moved') {
        say('Your game continued in another tab.', 'info');
      } else if (wasMine && st.reason === 'restart') {
        say(RESTART_MSG, 'warn');
      }
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
      if (spec.onIslands) spec.onIslands(p, h);
      if (_cfg.enabled && !wasOn) loadConfig();
      if (_panel && !panelAllowed(_zone)) closePanel();
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
      _postSystem(`${spec.recordEmoji || '🏆'} ${p.username} set a new ${spec.name} record on ${title(p.projectId)}: ${fmt(p.score)}!`);
      if (p.username === _me) _cfg.mine[p.projectId] = p.score;
      if (_engine && _engine.playConfetti) _engine.playConfetti(p.projectId);
    }

    function onArrived(p) {
      if (!p) return;
      _postSystem(`${spec.crownEmoji || '👑'} The ${spec.name} champion of ${title(p.projectId)} has arrived — ${p.username}`);
      if (_engine && _engine.spotlight) _engine.spotlight(_socket && p.id === _socket.id ? 'local' : p.id, 6000);
    }

    // E at an island's screen: back to my game, join its lobby, watch, or the panel.
    function onScreen(pid) {
      if (!liveIsland(pid) || _overlay || _panel) return;
      const mine = myGame();
      if (mine && mine.projectId === pid && mine.phase !== 'lobby') return openOverlay(pid, 'play');
      const st = _states.get(pid);
      if (!mine && st && st.phase === 'lobby') return join(pid);
      if (!mine && (st || _cfg.live[pid] != null)) return openOverlay(pid, 'watch');
      openPanel(pid);
    }

    // ── the 3D side ──

    function screenView(pid) {
      const st = _states.get(pid) || null;
      const rec = _cfg.records[pid] || null;
      const base = {
        mode: st ? st.phase : 'idle',
        title: title(pid),
        record: rec ? { username: rec.username, score: rec.score } : null,
        liveHost: _cfg.live[pid] != null ? (_cfg.live[pid] || '') : null,
        state: st,
        deadline: st && st.deadline ? st.deadline - _clockOffset : 0
      };
      return spec.screenView ? spec.screenView(base, pid, h) : base;
    }

    function syncEngine() {
      if (!_engine || !_engine.setScreenIslands) return;
      const islands = _cfg.enabled ? _cfg.islands : [];
      const champs = {};
      for (const pid of islands) { const r = _cfg.records[pid]; if (r) champs[pid] = r.username; }
      const key = JSON.stringify([islands, champs, _me, Object.keys(_cfg.live), islands.map(pid => _cfg.records[pid] && _cfg.records[pid].score)]);
      if (key !== _engineKey) {
        _engineKey = key;
        _engine.setScreenIslands(spec.kind, islands);
        _engine.setScreenChampions(spec.kind, champs, _me);
        if (_onTags) { try { _onTags(); } catch (_) {} }
      }
      for (const pid of islands) _engine.setScreenState(spec.kind, pid, screenView(pid));
    }

    // This game's line on an island's roof label: { text, live, kind } | null.
    function tagFor(pid) {
      if (!_started || !liveIsland(pid)) return null;
      if (_cfg.live[pid] != null) return { text: `● LIVE · ${spec.name}`, live: true, kind: spec.kind };
      const r = _cfg.records[pid];
      return { text: r ? `${spec.icon} ${fmt(r.score)} · ${r.username}` : `${spec.icon} ${spec.name}`, live: false, kind: spec.kind };
    }

    // ── the clock (4 Hz) ──

    function tick() {
      if (!_started) return;
      const st = _overlay ? (_overlay.final || _states.get(_overlay.projectId)) : null;
      if (_overlay && st) {
        updateTimer(st);
        if (spec.tickStage) spec.tickStage(_overlay, st, h);
      }
      if (_lobbyEl) updateLobbyTime();
    }

    // ── rendering ──

    function render() {
      if (!_started) return;
      renderLobby();
      renderOverlay();
      syncEngine();
      changed();
    }

    // The header chip's model (js/island-games.js draws it): { text, cls,
    // title, rank } — rank 3 my game, 2 a lobby / live game here, 1 this
    // game is playable here, 0.5 the game's own extra (e.g. suggestions).
    function chip() {
      if (!_started) return null;
      const mine = myGame();
      const here = _zone ? _states.get(_zone) : null;
      const tip = spec.chipTitle || spec.name;
      if (mine && mine.phase === 'lobby') return { text: `${spec.icon} Lobby · ${secsLeft(mine.deadline)}s`, cls: 'is-lobby', title: tip, rank: 3 };
      if (mine) return { text: `${spec.icon} Back to your game`, cls: 'is-live', title: tip, rank: 3 };
      if (here && here.phase === 'lobby') return { text: `● ${spec.name} lobby · Join · ${secsLeft(here.deadline)}s`, cls: 'is-lobby', title: tip, rank: 2 };
      if (here) return { text: `● LIVE · ${here.host || '…'} · ${Math.min(here.of, here.round + 1)}/${here.of} · Watch`, cls: 'is-live', title: tip, rank: 2 };
      if (liveIsland(_zone) && _cfg.live[_zone] != null) return { text: `● LIVE · ${_cfg.live[_zone] || '…'} · Watch`, cls: 'is-live', title: tip, rank: 2 };
      if (liveIsland(_zone)) {
        const rec = _cfg.records[_zone];
        return { text: rec ? `${spec.icon} ${spec.name} · ${spec.recordEmoji || '🏆'} ${fmt(rec.score)}` : `${spec.icon} ${spec.name}`, cls: '', title: tip, rank: 1 };
      }
      const extra = spec.extraChip ? spec.extraChip(_zone, h) : null;
      return extra ? Object.assign({ cls: '', title: tip, rank: 0.5 }, extra) : null;
    }

    function chipClick() {
      const mine = myGame();
      if (mine && mine.phase !== 'lobby') return openOverlay(mine.projectId, 'play');
      const here = _zone ? _states.get(_zone) : null;
      if (!mine && here && here.phase === 'lobby') return join(_zone);
      if (!mine && (here || (liveIsland(_zone) && _cfg.live[_zone] != null))) return openOverlay(_zone, 'watch');
      openPanel(mine ? mine.projectId : _zone);
    }

    // Is this game playable on the island (for the picker): live, or a game is on.
    function available(pid) { return liveIsland(pid); }
    function isLiveHere(pid) { return !!(_states.get(pid) || (liveIsland(pid) && _cfg.live[pid] != null)); }
    function record(pid) { return _cfg.records[pid] || null; }

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
        _lobbyEl.className = 'sg-lobby' + (spec.cssClass ? ' ' + spec.cssClass : '');
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
            <span class="sg-lobby-title">${esc(spec.name)}</span>
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
      if (act === 'join') r = await spec.send.join(emit, st.projectId);
      else if (act === 'leave') r = await spec.send.leave(emit);
      else if (act === 'go') r = await spec.send.go(emit);
      if (r && !r.ok) warnErr(r.error);
      if (_lobbyEl) { delete _lobbyEl.dataset.key; renderLobby(); }
    }

    async function join(pid) {
      const r = await spec.send.join(emit, pid);
      if (!r.ok) warnErr(r.error);
    }

    async function play(pid) {
      const r = await spec.send.start(emit, pid);
      if (!r.ok) warnErr(r.error);
      return r.ok;
    }

    // ── island panel ──

    // The panel opens on a live island, or wherever the game says it has
    // something to offer (Quote Guess: suggesting lines).
    function panelAllowed(pid) { return liveIsland(pid) || !!(spec.panelAllowed && spec.panelAllowed(pid, h)); }

    async function openPanel(pid) {
      if (!pid || !panelAllowed(pid)) return;
      closePanel();
      const el = document.createElement('div');
      el.className = 'world-lb sg-panel' + (spec.cssClass ? ' ' + spec.cssClass : '');
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', spec.name);
      el.innerHTML = `
        <div class="world-lb-panel sg-panel-box">
          <button class="popup-close" type="button" aria-label="Close">✕</button>
          <h3>${esc(spec.icon)} ${esc(spec.name)}</h3>
          <p class="world-lb-sub">${esc(title(pid))}</p>
          <div class="sg-how">${spec.howHtml(pid, h)}</div>
          <div class="sg-panel-record"></div>
          <div class="sg-panel-board"></div>
          <div class="sg-panel-me"></div>
          <div class="sg-panel-actions"></div>
          <div class="sg-panel-extra" hidden></div>
        </div>`;
      document.body.appendChild(el);
      const close = (typeof wireModalDismiss === 'function')
        ? wireModalDismiss(el, () => closePanel(), { initialFocus: el.querySelector('.popup-close') })
        : () => closePanel();
      el.querySelector('.popup-close').addEventListener('click', close);
      el.querySelector('.sg-panel-actions').addEventListener('click', onPanelAction);
      _panel = { el, projectId: pid, close, board: null };
      syncInput();
      renderPanel();
      if (!liveIsland(pid)) return;
      el.querySelector('.sg-panel-board').innerHTML = '<div class="sg-muted">Loading the board…</div>';
      try {
        const res = await fetch(h.api(`/${encodeURIComponent(pid)}/board`), { headers: authHeaders() });
        const data = res.ok ? await res.json() : null;
        if (_panel && _panel.projectId === pid) { _panel.board = data || { top: [], me: null }; renderPanel(); }
      } catch (_) {
        if (_panel && _panel.projectId === pid) { _panel.board = { top: [], me: null }; renderPanel(); }
      }
    }

    function closePanel() {
      if (!_panel) return;
      const { el, close } = _panel;
      _panel = null;
      try { if (close) close(); } catch (_) {}
      el.remove();
      syncInput();
    }

    function renderPanel() {
      if (!_panel) return;
      const pid = _panel.projectId;
      const el = _panel.el;
      const live = liveIsland(pid);
      const rec = _cfg.records[pid];
      el.querySelector('.sg-panel-record').innerHTML = !live ? ''
        : rec
          ? `<div class="sg-record">${spec.recordEmoji || '🏆'} Island record <b>${fmt(rec.score)}</b> · ${esc(rec.username)}${rec.username === _me ? ` (you — you wear the ${esc(spec.crownWord || 'crown')} here)` : ''}</div>`
          : '<div class="sg-record">🏆 No record yet — the first finished game sets it.</div>';
      const b = _panel.board;
      if (b && live) {
        el.querySelector('.sg-panel-board').innerHTML = b.top && b.top.length
          ? `<ol class="sg-top5">${b.top.map(r => `<li class="${r.username === _me ? 'you' : ''}"><span>${esc(r.username)}</span><b>${fmt(r.best)}</b></li>`).join('')}</ol>`
          : '<div class="sg-muted">Nobody has finished a game here yet.</div>';
        el.querySelector('.sg-panel-me').innerHTML = b.me && b.me.best > 0
          ? `<div class="sg-muted">Your best: <b>${fmt(b.me.best)}</b> · #${b.me.rank} · ${b.me.plays} game${b.me.plays === 1 ? '' : 's'}</div>`
          : (b.me ? `<div class="sg-muted">${b.me.plays} game${b.me.plays === 1 ? '' : 's'} played, no points yet.</div>` : '');
      }
      const st = _states.get(pid);
      const mine = myGame();
      let actions = '';
      if (live) {
        if (mine && mine.projectId === pid) actions = mine.phase === 'lobby'
          ? '<span class="sg-muted">You\'re in the lobby.</span><button type="button" class="sg-btn" data-act="leave">Leave</button>'
          : '<button type="button" class="sg-btn sg-btn-primary" data-act="back">Back to your game</button>';
        else if (st && st.phase === 'lobby') actions = '<button type="button" class="sg-btn sg-btn-primary" data-act="join">Join the lobby</button>';
        else if (st || _cfg.live[pid] != null) actions = '<button type="button" class="sg-btn sg-btn-primary" data-act="watch">Watch the game</button>';
        else actions = `<button type="button" class="sg-btn sg-btn-primary" data-act="play" ${mine ? 'disabled' : ''}>Play</button>`;
      }
      if (spec.panelExtras) actions += spec.panelExtras(pid, { idle: live && !st && _cfg.live[pid] == null, champion: !!(rec && rec.username === _me) }, h);
      el.querySelector('.sg-panel-actions').innerHTML = actions;
    }

    async function onPanelAction(e) {
      const btn = e.target.closest('button[data-act]');
      if (!btn || !_panel) return;
      const pid = _panel.projectId;
      const act = btn.dataset.act;
      if (act === 'play') { btn.disabled = true; if (await play(pid)) closePanel(); else if (_panel) btn.disabled = false; return; }
      if (act === 'join') { closePanel(); return join(pid); }
      if (act === 'leave') { await spec.send.leave(emit); return renderPanel(); }
      if (act === 'watch') { closePanel(); return openOverlay(pid, 'watch'); }
      if (act === 'back') { closePanel(); return openOverlay(pid, 'play'); }
      if (spec.onPanelAction) spec.onPanelAction(act, pid, _panel.el.querySelector('.sg-panel-extra'), h, btn);
    }

    // ── the game overlay ──

    function openOverlay(pid, mode) {
      if (_overlay && _overlay.projectId === pid && _overlay.mode === mode && !_overlay.final) { renderOverlay(); return; }
      closeOverlay(true);
      closePanel();
      const el = document.createElement('div');
      el.className = 'sg-overlay' + (spec.cssClass ? ' ' + spec.cssClass : '') + (mode === 'watch' ? ' is-watch' : '');
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', spec.name);
      el.innerHTML = `
        <div class="sg-frame">
          <header class="sg-top">
            <div class="sg-title"><span class="sg-brand">${esc(spec.name)}</span><span class="sg-film"></span></div>
            <div class="sg-round"></div>
            <div class="sg-timer" aria-hidden="true"><svg viewBox="0 0 36 36"><circle class="sg-timer-bg" cx="18" cy="18" r="15.5"/><circle class="sg-timer-fg" cx="18" cy="18" r="15.5"/></svg><span class="sg-timer-num"></span></div>
            <button type="button" class="sg-close" aria-label="Leave">✕</button>
          </header>
          <div class="sg-stage">
            <div class="ig-stage">${spec.stageHtml}</div>
            <div class="sg-results" hidden></div>
          </div>
          <div class="sg-players"></div>
          <div class="sg-confetti" aria-hidden="true"></div>
        </div>`;
      document.body.appendChild(el);
      const refs = {
        film: el.querySelector('.sg-film'), round: el.querySelector('.sg-round'),
        timer: el.querySelector('.sg-timer'), timerFg: el.querySelector('.sg-timer-fg'), timerNum: el.querySelector('.sg-timer-num'),
        close: el.querySelector('.sg-close'), stage: el.querySelector('.ig-stage'),
        results: el.querySelector('.sg-results'), players: el.querySelector('.sg-players'),
        confetti: el.querySelector('.sg-confetti')
      };
      _overlay = { el, projectId: pid, mode, final: null, refs, local: {}, confettiFor: '' };
      refs.close.addEventListener('click', onCloseClick);
      // On document, not the overlay (NET2-02): a click that disables the
      // focused choice, or a new round's buttons, drops focus to <body> and
      // the keys must keep working. onDocKey skips keys aimed elsewhere.
      document.addEventListener('keydown', onDocKey);
      if (spec.initStage) spec.initStage(_overlay, h);
      syncInput();
      renderOverlay();
      (refs.stage.querySelector('[data-focus]') || refs.close).focus({ preventScroll: true });
    }

    function closeOverlay(silent) {
      if (!_overlay) return;
      const live = _states.get(_overlay.projectId);
      if (!_overlay.final && live && live.phase === 'results') _dismissed.add(live.projectId);
      const el = _overlay.el;
      _overlay = null;
      document.removeEventListener('keydown', onDocKey);
      el.remove();
      if (!silent) syncInput();
      else if (_engine && _engine.setInputSuspended) _engine.setInputSuspended(!!_panel, spec.kind);
    }

    async function onCloseClick() {
      if (!_overlay) return;
      const st = _states.get(_overlay.projectId);
      if (_overlay.mode === 'play' && !_overlay.final && st && amIn(st) && st.phase !== 'results') {
        const ok = (typeof confirmDialog === 'function')
          ? await confirmDialog({ title: 'Leave the game?', message: "You'll drop out and this game won't count for you.", confirmLabel: 'Leave', cancelLabel: 'Keep playing', danger: true })
          : true;
        if (!ok || !_overlay) return;
        await spec.send.leave(emit);
      }
      closeOverlay();
    }

    // Keys inside the overlay, or with focus lost to <body>; never a key
    // typed into something else (the world chat box).
    function onDocKey(e) {
      if (!_overlay) return;
      const t = e.target;
      if (t && t !== document.body && t !== document.documentElement && !_overlay.el.contains(t)) return;
      onOverlayKey(e);
    }

    function onOverlayKey(e) {
      if (document.querySelector('.confirm-overlay, .confirm-dialog')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseClick();
        return;
      }
      const st = overlayState();
      if (st && spec.onKey) spec.onKey(e, _overlay, st, h);
    }

    function overlayState() {
      if (!_overlay) return null;
      return _overlay.final || _states.get(_overlay.projectId) || null;
    }

    function renderOverlay() {
      if (!_overlay) return;
      const st = overlayState();
      if (!st) return;
      const r = _overlay.refs;
      r.film.textContent = title(st.projectId) + (_overlay.mode === 'watch' ? ` · watching ${st.host || ''}'s game` : '');
      const showRound = Math.min(st.of, Math.max(1, st.round + 1));
      r.round.textContent = st.phase === 'lobby' ? 'Lobby' : st.phase === 'ready' ? 'Get ready' : st.phase === 'results' ? 'Final scores' : `Round ${showRound}/${st.of}`;
      r.close.setAttribute('aria-label', _overlay.mode === 'play' && !_overlay.final && st.phase !== 'results' ? 'Leave the game' : 'Close');
      updateTimer(st);
      const results = st.phase === 'results';
      r.results.hidden = !results;
      r.stage.hidden = results;
      r.players.hidden = results;
      if (results) { renderResults(st); return; }
      r.players.innerHTML = st.players.map(p => `
        <span class="sg-chip ${colorOf(st, p.username)} ${p.locked ? 'is-locked' : ''} ${(st.away || []).includes(p.username) ? 'is-away' : ''}" title="${esc(p.username)}">
          <i>${esc(initials(p.username))}</i>${esc(p.username)}${p.username === _me ? ' (you)' : ''} <b>${fmt(p.total)}</b>${st.phase === 'round' ? (p.locked ? ' ✓' : ' …') : ''}
        </span>`).join('');
      spec.renderStage(_overlay, st, h);
    }

    function updateTimer(st) {
      const r = _overlay && _overlay.refs;
      if (!r) return;
      const timed = !_overlay.final && ['ready', 'round', 'reveal', 'results'].includes(st.phase);
      r.timer.hidden = !timed;
      if (!timed) return;
      const C = L().C;
      const total = st.phase === 'round' ? st.roundMs : st.phase === 'ready' ? C.READY_MS : st.phase === 'reveal' ? C.REVEAL_MS : C.RESULTS_MS;
      const left = Math.max(0, st.deadline - now());
      const frac = total > 0 ? Math.min(1, left / total) : 0;
      const circ = 2 * Math.PI * 15.5;
      r.timerFg.style.strokeDasharray = `${circ}`;
      r.timerFg.style.strokeDashoffset = `${circ * (1 - frac)}`;
      r.timer.classList.toggle('is-low', st.phase === 'round' && left <= 5000);
      r.timerNum.textContent = String(Math.ceil(left / 1000));
    }

    function renderResults(st) {
      const r = _overlay.refs;
      const key = JSON.stringify([st.projectId, st.ranking, st.record, !!_overlay.final]);
      if (r.results.dataset.key === key) return;
      r.results.dataset.key = key;
      const rec = st.record;
      const mineRecord = !!(rec && rec.username === _me);
      const rows = (st.ranking || []).map((p, i) => {
        const bars = (st.history || []).map(hh => {
          const pts = spec.pointsOf(hh, p.username);
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
      const cw = spec.crownWord || 'crown';
      const banner = rec
        ? `<div class="sg-banner is-record">${mineRecord ? `${spec.crownEmoji || '👑'} New island record — you wear the ${esc(cw)}!` : `${spec.crownEmoji || '👑'} New island record by ${esc(rec.username)}`}<span>${fmt(rec.score)}${beat}</span></div>`
        : `<div class="sg-banner">Final scores${_cfg.records[st.projectId] ? `<span>Island record ${fmt(_cfg.records[st.projectId].score)} · ${esc(_cfg.records[st.projectId].username)}</span>` : ''}</div>`;
      const island = _states.get(st.projectId);
      const canAgain = _overlay.mode === 'play' && liveIsland(st.projectId) && st.projectId === _zone;
      const over = !!_overlay.final;
      r.results.innerHTML = `
        ${banner}
        <ol class="sg-ranking">${rows}</ol>
        <div class="sg-results-picks" hidden></div>
        <div class="sg-results-actions">
          ${canAgain && over ? `<button type="button" class="sg-btn sg-btn-primary" data-act="again">${island && island.phase === 'lobby' ? 'Join the next game' : 'Play again'}</button>` : ''}
          ${canAgain && !over ? '<button type="button" class="sg-btn sg-btn-primary" disabled>Starting soon…</button>' : ''}
          ${spec.resultsActions ? spec.resultsActions(st, h) : ''}
          <button type="button" class="sg-btn" data-act="close">Close</button>
        </div>`;
      if (mineRecord && spec.renderPicks) {
        const box = r.results.querySelector('.sg-results-picks');
        box.hidden = false;
        spec.renderPicks(box, st.projectId, st, h);
      }
      r.results.querySelector('.sg-results-actions').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'close') return closeOverlay();
        if (act === 'again') {
          const pid = st.projectId;
          closeOverlay();
          const live = _states.get(pid);
          if (live && live.phase === 'lobby') join(pid); else play(pid);
          return;
        }
        if (spec.onResultsAction) spec.onResultsAction(act, st, h);
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

    return {
      kind: spec.kind, name: spec.name, icon: spec.icon, blurb: spec.blurb || '',
      start, stop, onZone, tagFor, chip, chipClick, available, isLiveHere, record, onScreen,
      openPanel, play, join,
      _debug: {
        cfg: () => _cfg,
        state: (pid) => _states.get(pid || _zone) || null,
        overlay: () => _overlay && { projectId: _overlay.projectId, mode: _overlay.mode, final: !!_overlay.final, local: _overlay.local },
        inject: (st) => onState(st),
        setCfg: (patch) => { Object.assign(_cfg, patch); render(); },
        openPanel, openOverlay, emit
      }
    };
  }

  return { create, esc, fmt, title, initials };
})();
