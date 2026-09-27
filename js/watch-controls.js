/************************************************
 * WATCH CONTROLS — Start watching → timer → Mark as watched
 *
 * One widget for every place a project can be watched from (the project
 * popup on Watch Order / Universe Map / World, and the Board's cards), so
 * the timed flow looks and behaves the same everywhere. The server enforces
 * the timer (routes/progress.js); this only mirrors it.
 ************************************************/
const WatchControls = (() => {
  // 1:05:09 / 4:07 countdown.
  function fmtClock(ms) {
    const t = Math.ceil(ms / 1000);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const mm = h ? String(m).padStart(2, '0') : String(m);
    return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
  }

  // 2h 6m / 48m runtime label.
  function fmtRuntime(min) {
    if (!min) return '';
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
  }

  // Board column for a project: 'progress' | 'done' | 'todo' | 'locked'.
  function statusOf(p) {
    if (state.isInProgress(p.id)) return 'progress';
    if (state.isWatched(p.id)) return 'done';
    return isUnlocked(p) ? 'todo' : 'locked';
  }

  // Short runtime line: "2h 6m" or "13 episodes · 11h 55m".
  function runtimeLine(p) {
    const eps = state.episodesOf(p);
    const total = fmtRuntime(state.totalMinutes(p));
    if (eps) return `${eps.length} episode${eps.length !== 1 ? 's' : ''}${total ? ` · ${total}` : ''}`;
    return total;
  }

  // opts.showCount: false where the host already shows the watch count (popup).
  function markup(p, opts = {}) {
    const status = statusOf(p);
    const eps = state.episodesOf(p);
    // Two timers already ticking → Start buttons wait (server enforces it too).
    const capped = state.atTimerCap();
    const capMsg = `${WatchState.MAX_RUNNING_TIMERS} timers are already running — finish or cancel one first`;
    const startAttr = capped ? `disabled title="${capMsg}"` : '';
    // opts.capHint: false where the host explains the cap once (the Board banner).
    const capHint = capped && opts.capHint !== false ? `<div class="wc-hint">⏱ ${capMsg}.</div>` : '';
    if (status === 'progress') {
      const s = state.getSession(p.id);
      const epLabel = eps ? `Episode ${s.episode + 1} of ${eps.length}` : '';
      const stepMin = state.stepMinutes(p, s.episode);
      if (!s.startedAt) {
        // Series, between episodes.
        return `
          <div class="wc-meta"><span class="wc-ep">${epLabel}</span><span>${fmtRuntime(stepMin)}</span></div>
          <div class="wc-bar wc-bar-series" aria-hidden="true"><i style="width:${(s.episode / eps.length) * 100}%"></i></div>
          <div class="wc-actions">
            <button type="button" class="wc-btn wc-primary" data-wc="start" ${startAttr}>Start episode ${s.episode + 1}</button>
            <button type="button" class="wc-btn wc-ghost" data-wc="cancel">Cancel</button>
          </div>${capHint}`;
      }
      const left = state.remainingMs(p.id);
      return `
        <div class="wc-meta">${epLabel ? `<span class="wc-ep">${epLabel}</span>` : ''}<span class="wc-left" aria-live="off"></span></div>
        <div class="wc-bar" aria-hidden="true"><i></i></div>
        <div class="wc-actions">
          <button type="button" class="wc-btn wc-primary" data-wc="complete" ${left > 0 ? 'disabled' : ''}>Mark as watched</button>
          <button type="button" class="wc-btn wc-ghost" data-wc="cancel">Cancel</button>
        </div>`;
    }
    if (status === 'done') {
      const count = state.getCount(p.id);
      return `
        <div class="wc-meta">${opts.showCount === false ? '' : `<span>Watched ${count} time${count !== 1 ? 's' : ''}</span>`}<span>${esc(runtimeLine(p))}</span></div>
        <div class="wc-actions">
          <button type="button" class="wc-btn" data-wc="start" ${startAttr}>Watch again</button>
        </div>`;
    }
    if (status === 'todo') {
      return `
        <div class="wc-meta"><span>${esc(runtimeLine(p))}</span></div>
        <div class="wc-actions">
          <button type="button" class="wc-btn wc-primary" data-wc="start" ${startAttr}>Start watching</button>
        </div>${capHint}`;
    }
    return `<div class="wc-meta"><span>🔒 Watch its prerequisites first</span></div>`;
  }

  // Update the live countdown bits in place (no re-render every second).
  function tick(host, p) {
    const s = state.getSession(p.id);
    if (!s || !s.startedAt) return false;
    const left = state.remainingMs(p.id);
    const total = state.requiredMinutes(p, s.episode) * 60000;
    const leftEl = host.querySelector('.wc-left');
    const bar = host.querySelector('.wc-bar > i');
    const btn = host.querySelector('[data-wc="complete"]');
    if (leftEl) leftEl.textContent = left > 0 ? `Unlocks in ${fmtClock(left)}` : 'Ready to mark';
    if (bar) bar.style.width = `${total ? Math.min(100, (1 - left / total) * 100) : 100}%`;
    if (btn) btn.disabled = left > 0;
    host.classList.toggle('wc-ready', left <= 0);
    return true;
  }

  // After the composer posts: "✓ Iron Man watched — posted" / "Episode 3 …".
  function toastPosted(p, result) {
    const posted = result.post ? ' · posted to your feed' : '';
    if (result.finished) toast(`✓ ${p.title} watched${posted}`, 'success');
    else if (state.episodesOf(p)) toast(`Episode ${state.getSession(p.id)?.episode || ''} of ${p.title} done${posted}`, 'success');
  }

  // Render into `host` and keep it live. opts.onChange(action, result) runs
  // after each successful server call. Returns a destroy function.
  function mount(host, p, opts = {}) {
    let timer = null;
    let busy = false;

    const render = () => {
      host.classList.add('watch-controls');
      host.dataset.status = statusOf(p);
      host.innerHTML = markup(p, opts);
      clearInterval(timer);
      timer = null;
      if (tick(host, p)) {
        timer = setInterval(() => {
          // Self-clean once the host leaves the DOM (popup closed, board re-rendered).
          if (!host.isConnected) { clearInterval(timer); return; }
          tick(host, p);
        }, 1000);
      }
    };

    const run = async (action) => {
      if (busy) return;
      if (action === 'cancel') {
        const s = state.getSession(p.id);
        const eps = state.episodesOf(p);
        if (eps && s && s.episode > 0) {
          const ok = await confirmDialog({
            title: `Cancel ${p.title}?`,
            message: `You'll lose your progress (${s.episode} of ${eps.length} episodes) and it goes back to ${s.rewatch ? 'Done' : 'Not started'}.`,
            confirmLabel: 'Cancel watching',
            cancelLabel: 'Keep going',
            danger: true
          });
          if (!ok) return;
        }
      }
      busy = true;
      host.querySelectorAll('.wc-btn').forEach(b => { b.disabled = true; });
      // "Mark as watched" opens the post composer (js/post-composer.js); it
      // does the completing itself when they press Post, and resolves null if
      // they close it (nothing changes — still in progress).
      const call = action === 'start' ? state.startWatching(p.id)
        : action === 'complete' ? PostComposer.open({ mode: 'complete', project: p })
        : state.cancelWatching(p.id);
      const result = await call;
      busy = false;
      if (result && action === 'complete') toastPosted(p, result);
      if (host.isConnected) render();
      if (result) opts.onChange?.(action, result);
    };

    host.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-wc]');
      if (!btn || btn.disabled) return;
      e.stopPropagation();
      run(btn.dataset.wc);
    });

    render();
    return () => clearInterval(timer);
  }

  return { mount, statusOf, runtimeLine, fmtRuntime, fmtClock, toastPosted };
})();
