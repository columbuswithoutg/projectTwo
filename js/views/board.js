/************************************************
 * BOARD VIEW — /board
 *
 * Kanban of the watch flow: Not started (available to watch — its
 * prerequisites are done) → In progress (Start watching pressed, runtime
 * timer running) → Done. Cards move with their buttons or by dragging;
 * every move goes through the same server-enforced calls as the popup
 * (state.startWatching / completeWatching / cancelWatching), so a drag
 * can't skip the timer either.
 ************************************************/
const BoardView = (() => {
  let _root = null;
  let _unsub = null;
  let _seq = 0;
  let _drag = null;

  const COLUMNS = [
    { key: 'todo', title: 'Not started', hint: 'Ready to watch', empty: 'Nothing new unlocked — finish something in progress.' },
    { key: 'progress', title: 'In progress', hint: 'Timer running', empty: 'Press Start watching on a card, or drag one here.' },
    { key: 'done', title: 'Done', hint: 'Watched', empty: 'Finished projects land here.' }
  ];

  const byRelease = (a, b) => String(a.release || '').localeCompare(String(b.release || ''));

  /* ---------- Column filters: what Not started and Done show ----------
   * Not started picks from the unlocked projects (all / movies / series /
   * one phase — only choices that have something in them are offered).
   * Done shows the last N watched, newest first, or everything in release
   * order. Choices are a per-browser preference. */
  const PREFS_KEY = 'mcu.board.filters';
  const DONE_LIMITS = [1, 5, 10, 20];
  let _prefs = { todo: 'all', done: 'all' };
  try { Object.assign(_prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) { /* defaults */ }

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(_prefs)); } catch (e) { /* not persisted */ }
  }

  function todoOptions(list) {
    const movies = list.filter(p => !state.episodesOf(p)).length;
    const series = list.length - movies;
    const opts = [{ value: 'all', label: `All unlocked (${list.length})` }];
    if (movies && series) {
      opts.push({ value: 'movies', label: `Movies (${movies})` });
      opts.push({ value: 'series', label: `Series (${series})` });
    }
    const phases = new Map();
    list.forEach(p => { if (p.phase) phases.set(p.phase, (phases.get(p.phase) || 0) + 1); });
    if (phases.size > 1) {
      [...phases].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
        .forEach(([ph, n]) => opts.push({ value: `phase:${ph}`, label: `${ph} (${n})` }));
    }
    return opts;
  }

  function filterTodo(list, key) {
    if (key === 'movies') return list.filter(p => !state.episodesOf(p));
    if (key === 'series') return list.filter(p => state.episodesOf(p));
    if (key.startsWith('phase:')) return list.filter(p => p.phase === key.slice(6));
    return list;
  }

  function doneOptions(list) {
    const opts = [];
    DONE_LIMITS.forEach(n => {
      if (n === 1 || n < list.length) opts.push({ value: `last${n}`, label: n === 1 ? 'Last watched' : `Last ${n} watched` });
    });
    opts.push({ value: 'all', label: `All done (${list.length})` });
    return opts;
  }

  // Newest watch first; entries with no known time go last, newest release first.
  function byLastWatched(a, b) {
    const ta = state.lastWatchedAt(a.id), tb = state.lastWatchedAt(b.id);
    if (ta && tb) return tb - ta;
    if (ta || tb) return ta ? -1 : 1;
    return byRelease(b, a);
  }

  function filterDone(list, key) {
    const m = /^last(\d+)$/.exec(key);
    if (!m) return list.slice().sort(byRelease);
    return list.slice().sort(byLastWatched).slice(0, Number(m[1]));
  }

  function agoLabel(t) {
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function filterSelect(col, opts, current) {
    return `
      <select class="kb-filter" data-filter="${col.key}" aria-label="Show in ${col.title}" title="Choose what ${col.title} shows">
        ${opts.map(o => `<option value="${esc(o.value)}"${o.value === current ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
      </select>`;
  }

  function tabBar() {
    return `
      <div class="view-tabs" role="tablist" aria-label="View mode">
        <button class="view-tab" data-route="/" role="tab" aria-selected="false"><span class="vt-long">Watch </span>Order</button>
        <button class="view-tab active" data-route="/board" role="tab" aria-selected="true">Board</button>
        <button class="view-tab" data-route="/feed" role="tab" aria-selected="false">Feed</button>
        <button class="view-tab" data-route="/world" role="tab" aria-selected="false">World</button>
      </div>`;
  }

  function cardHtml(p, opts = {}) {
    const phase = p.phase ? `<span class="kb-phase">${esc(p.phase)}</span>` : '';
    const series = state.episodesOf(p) ? '<span class="kb-tag">Series</span>' : '';
    const rewatch = state.getSession(p.id)?.rewatch ? '<span class="kb-tag kb-tag-accent">Rewatch</span>' : '';
    const t = opts.showWatchedAt ? state.lastWatchedAt(p.id) : null;
    const ago = t ? `<span class="kb-tag kb-tag-time" title="${esc(new Date(t).toLocaleString())}">Watched ${agoLabel(t)}</span>` : '';
    return `
      <article class="kb-card" data-id="${esc(p.id)}" tabindex="-1">
        <button type="button" class="kb-grip" aria-label="Drag ${esc(p.title)}" title="Drag to move">⋮⋮</button>
        <div class="kb-poster">${p.image ? `<img src="${esc(CONFIG.IMAGE_BASE + p.image)}" alt="" loading="lazy" />` : ''}</div>
        <div class="kb-body">
          <h3 class="kb-title">${esc(p.title)}</h3>
          <div class="kb-tags">${phase}${series}${rewatch}${ago}</div>
          <div class="kb-controls"></div>
        </div>
      </article>`;
  }

  function render() {
    if (!_root) return;
    const board = _root.querySelector('.kb-board');
    if (!board) return;
    // Don't yank the DOM out from under an active drag; it re-renders on drop.
    if (_drag) { _drag.stale = true; return; }

    const groups = { todo: [], progress: [], done: [] };
    for (const p of projects) {
      const st = WatchControls.statusOf(p);
      if (groups[st]) groups[st].push(p);
    }
    groups.todo.sort(byRelease);
    groups.progress.sort(byRelease);

    // Resolve each filter against what's there now; a stale choice (the
    // phase you picked is all watched) falls back to showing everything.
    const options = { todo: todoOptions(groups.todo), done: doneOptions(groups.done) };
    for (const k of ['todo', 'done']) {
      if (!options[k].some(o => o.value === _prefs[k])) _prefs[k] = 'all';
    }
    const shown = {
      todo: filterTodo(groups.todo, _prefs.todo),
      progress: groups.progress,
      done: filterDone(groups.done, _prefs.done)
    };
    const showWatchedAt = _prefs.done !== 'all';

    const focused = document.activeElement?.dataset?.filter;
    const banner = state.atTimerCap()
      ? `<p class="kb-banner" role="status">⏱ ${WatchState.MAX_RUNNING_TIMERS} timers are running — finish or cancel one to start something else.</p>`
      : '';
    board.innerHTML = banner + COLUMNS.map(c => {
      const total = groups[c.key].length;
      const list = shown[c.key];
      const count = list.length < total ? `${list.length}/${total}` : total;
      const control = options[c.key] && total ? filterSelect(c, options[c.key], _prefs[c.key]) : `<span class="kb-hint">${c.hint}</span>`;
      return `
      <section class="kb-col" data-col="${c.key}" aria-label="${c.title}">
        <header class="kb-col-head">
          <h2>${c.title}</h2>
          <span class="kb-count" title="${list.length} shown of ${total}">${count}</span>
          ${control}
        </header>
        <div class="kb-list">
          ${list.length ? list.map(p => cardHtml(p, { showWatchedAt: c.key === 'done' && showWatchedAt })).join('') : `<p class="kb-empty">${c.empty}</p>`}
        </div>
      </section>`;
    }).join('');

    board.querySelectorAll('select[data-filter]').forEach(sel => {
      sel.addEventListener('change', () => {
        _prefs[sel.dataset.filter] = sel.value;
        savePrefs();
        render();
      });
    });
    if (focused) board.querySelector(`select[data-filter="${focused}"]`)?.focus();

    board.querySelectorAll('.kb-card').forEach(card => {
      const p = state.byId.get(card.dataset.id);
      if (!p) return;
      WatchControls.mount(card.querySelector('.kb-controls'), p, { capHint: false });
      card.querySelector('.kb-poster').addEventListener('click', () => showPopup(p));
      card.querySelector('.kb-title').addEventListener('click', () => showPopup(p));
    });
  }

  /* ---------- Drag and drop (pointer events: mouse anywhere, touch via grip) ---------- */

  // What dropping a card from `from` onto `to` does, or an error string.
  function transition(p, from, to) {
    if (from === to) return null;
    const s = state.getSession(p.id);
    if (to === 'progress') {
      if (state.atTimerCap()) return { error: `${WatchState.MAX_RUNNING_TIMERS} timers are already running — finish or cancel one first.` };
      return { action: 'start' };
    }
    if (from === 'progress' && to === 'done') {
      const left = state.remainingMs(p.id);
      if (s && !s.startedAt) return { error: `Start episode ${s.episode + 1} first.` };
      if (left > 0) return { error: `Mark as watched unlocks in ${WatchControls.fmtClock(left)}.` };
      if (state.episodesOf(p) && s.episode + 1 < state.stepCount(p)) {
        return { error: `Finish all ${state.stepCount(p)} episodes first — mark this one from the card.` };
      }
      return { action: 'complete' };
    }
    if (from === 'progress' && to === 'todo') {
      if (s?.rewatch) return { error: 'This is a rewatch — use Cancel to put it back in Done.' };
      return { action: 'cancel' };
    }
    if (from === 'todo' && to === 'done') return { error: 'Start watching it first.' };
    if (from === 'done' && to === 'todo') return { error: "Watched projects stay in Done — drag to In progress to rewatch." };
    return { error: "Can't move it there." };
  }

  function colAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('.kb-col') : null;
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const card = e.target.closest('.kb-card');
    if (!card) return;
    const onGrip = !!e.target.closest('.kb-grip');
    // Touch/pen scroll the page unless the grip is used; buttons stay buttons.
    if (e.pointerType !== 'mouse' && !onGrip) return;
    if (!onGrip && e.target.closest('button, a, input')) return;
    const p = state.byId.get(card.dataset.id);
    if (!p) return;
    _drag = {
      card, p, from: WatchControls.statusOf(p),
      startX: e.clientX, startY: e.clientY, active: false, ghost: null, stale: false,
      pointerId: e.pointerId
    };
    if (onGrip) e.preventDefault();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  function beginDrag() {
    const d = _drag;
    d.active = true;
    const r = d.card.getBoundingClientRect();
    d.offX = d.startX - r.left;
    d.offY = d.startY - r.top;
    const ghost = d.card.cloneNode(true);
    ghost.classList.add('kb-ghost');
    ghost.style.width = `${r.width}px`;
    document.body.appendChild(ghost);
    d.ghost = ghost;
    d.card.classList.add('kb-dragging');
    document.body.classList.add('kb-drag-active');
    _root.querySelectorAll('.kb-col').forEach(col => {
      const t = transition(d.p, d.from, col.dataset.col);
      col.classList.toggle('kb-drop-ok', !!t && !!t.action);
      col.classList.toggle('kb-drop-no', !!t && !!t.error);
    });
  }

  function onPointerMove(e) {
    const d = _drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
      beginDrag();
    }
    e.preventDefault();
    d.ghost.style.transform = `translate(${e.clientX - d.offX}px, ${e.clientY - d.offY}px) rotate(2deg)`;
    const col = colAt(e.clientX, e.clientY);
    _root.querySelectorAll('.kb-col').forEach(c => c.classList.toggle('kb-drop-hover', c === col));
    // Auto-scroll the board near the viewport edges (stacked columns on phones).
    const wrap = _root.querySelector('#board-wrapper');
    const edge = 60;
    if (wrap) {
      if (e.clientY < wrap.getBoundingClientRect().top + edge) wrap.scrollTop -= 12;
      else if (e.clientY > window.innerHeight - edge) wrap.scrollTop += 12;
    }
  }

  function endDrag() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    const d = _drag;
    _drag = null;
    if (!d) return null;
    d.ghost?.remove();
    d.card.classList.remove('kb-dragging');
    document.body.classList.remove('kb-drag-active');
    _root?.querySelectorAll('.kb-col').forEach(c => c.classList.remove('kb-drop-ok', 'kb-drop-no', 'kb-drop-hover'));
    return d;
  }

  async function onPointerUp(e) {
    if (!_drag || e.pointerId !== _drag.pointerId) return;
    const wasActive = _drag.active;
    const col = wasActive ? colAt(e.clientX, e.clientY) : null;
    const d = endDrag();
    if (!wasActive) return;
    if (d.stale) render();
    if (!col) return;
    const t = transition(d.p, d.from, col.dataset.col);
    if (!t) return;
    if (t.error) { toast(t.error, 'info'); return; }
    // Same confirm as the card's Cancel button for a series part-way through.
    const s = state.getSession(d.p.id);
    if (t.action === 'cancel' && state.episodesOf(d.p) && s && s.episode > 0) {
      const ok = await confirmDialog({
        title: `Cancel ${d.p.title}?`,
        message: `You'll lose your progress (${s.episode} of ${state.stepCount(d.p)} episodes) and it goes back to Not started.`,
        confirmLabel: 'Cancel watching',
        cancelLabel: 'Keep going',
        danger: true
      });
      if (!ok) return;
    }
    const call = t.action === 'start' ? state.startWatching(d.p.id)
      : t.action === 'complete' ? PostComposer.open({ mode: 'complete', project: d.p })
      : state.cancelWatching(d.p.id);
    const result = await call;
    if (result && t.action === 'complete') WatchControls.toastPosted(d.p, result);
  }

  function onPointerCancel() {
    const d = endDrag();
    if (d?.stale) render();
  }

  async function mount(container) {
    if (!Auth.isLoggedIn()) { Router.go('/login'); return; }
    const seq = ++_seq;
    _root = container;

    container.innerHTML = `
      <header id="header">
        <button id="board-friends-btn" class="feed-header-btn" title="Friends" aria-label="Friends">👥</button>
        ${tabBar()}
        <button id="header-profile-btn" title="Profile">
          <img id="header-avatar" src="" alt="" style="display:none" />
          <span id="header-avatar-initials">👤</span>
        </button>
      </header>
      <main id="board-wrapper">
        <div class="kb-board"><div class="kb-loading">Loading your board…</div></div>
      </main>
    `;

    container.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', () => Router.go(tab.dataset.route));
    });
    container.querySelector('#header-profile-btn').addEventListener('click', () => Router.go('/profile'));
    container.querySelector('#board-friends-btn').addEventListener('click', () => showFriendsPanel());
    container.querySelector('.kb-board').addEventListener('pointerdown', onPointerDown);
    initHeaderAvatar();

    if (!(WatchOrderView._initialized || AppView._initialized)) {
      await state.load();
      WatchOrderView._initialized = true;
      AppView._initialized = true;
    }
    if (seq !== _seq) return;
    // Re-derive phaseNum/unlocks — boot.js may have swapped in the DB copy.
    state.initProjects(projects);
    _unsub = state.subscribe(() => render());
    render();
  }

  function unmount() {
    _seq++;
    endDrag();
    if (_unsub) { _unsub(); _unsub = null; }
    _root = null;
  }

  return { title: 'Board — MCU Tracker', mount, unmount, _transition: transition };
})();
