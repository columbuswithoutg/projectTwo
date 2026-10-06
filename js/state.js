/************************************************
 * STATE MANAGEMENT (MongoDB-backed)
 ************************************************/
class WatchState {
  constructor() {
    this.data = new Map();
    this.byId = new Map();
    this.listeners = new Set();
    // When true, mutations don't persist. Set while the user is viewing a
    // friend's progress so accidental watchAgain/toggle/walker edits can't
    // PUT the friend's data to the current user's account.
    this.readonly = false;
    // In-progress watches (board "In progress" column), keyed by projectId:
    // { episode, startedAt: ms|null, rewatch }. Server-owned — only changed
    // via startWatching / completeWatching / cancelWatching.
    this.sessions = new Map();
    // serverNow − Date.now(), so countdowns match the server's clock.
    this.clockOffset = 0;
    // load() is async, called explicitly in DOMContentLoaded
  }

  // Adopt a { watchedProjects, watchSessions, serverNow } payload from the
  // progress API as the source of truth, then re-render.
  _applyServer(payload, { notify = true } = {}) {
    if (!payload || !Array.isArray(payload.watchedProjects)) return;
    this.data.clear();
    payload.watchedProjects.forEach(entry => this.data.set(entry.projectId, {
      count: entry.count,
      watchedWith: entry.watchedWith || [],
      memories: entry.memories || [],
      lastWatchedAt: entry.lastWatchedAt ? new Date(entry.lastWatchedAt).getTime() : null
    }));
    this.sessions.clear();
    (payload.watchSessions || []).forEach(s => this.sessions.set(s.projectId, {
      episode: s.episode || 0,
      startedAt: s.startedAt ? new Date(s.startedAt).getTime() : null,
      rewatch: !!s.rewatch
    }));
    if (Number.isFinite(payload.serverNow)) this.clockOffset = payload.serverNow - Date.now();
    this.byId.forEach(p => { p.watched = this.isWatched(p.id); });
    if (notify) this.listeners.forEach(fn => fn(this.data));
  }

  async load() {
    if (Auth.isLoggedIn()) {
      try {
        const res = await fetch(`${API}/progress/load`, {
          headers: { Authorization: `Bearer ${Auth.getToken()}` }
        });
        if (res.ok) {
          this._applyServer(await res.json(), { notify: false });
          this.loadFailed = false;
          return;
        }
      } catch (e) {
        console.warn("Progress load failed:", e);
      }
      // Never fall back to localStorage for a logged-in user: it's usually
      // empty, and the next save would overwrite the real server copy with it.
      // Block saves until a successful load.
      this.loadFailed = true;
      toast("Couldn't load your progress. Changes won't be saved until you reload.", { type: 'error', duration: 6000 });
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY) || "{}");
      Object.entries(saved).forEach(([id, val]) => {
        if (typeof val === 'boolean') {
          if (val) this.data.set(id, { count: 1, memories: [] });
        } else {
          this.data.set(id, val);
        }
      });
    } catch (e) {
      console.warn("Failed to load:", e);
    }
  }

  save() {
    // In readonly mode (friend-view), fire listeners so the UI updates but
    // never push the friend's data back to the server or localStorage.
    if (this.readonly) {
      this.listeners.forEach(fn => fn(this.data));
      return;
    }
    // Render synchronously — users should see the UI flip instantly — but
    // coalesce network writes. A rapid "watched → undo → watched" flurry
    // previously fired three full-document POSTs; now it sends one.
    this.listeners.forEach(fn => fn(this.data));
    this._schedulePersist();
  }

  _schedulePersist() {
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persistNow();
    }, 400);
  }

  _persistNow() {
    if (this.readonly) return;
    if (Auth.isLoggedIn()) {
      if (this.loadFailed) {
        toast("Not saved — your progress didn't load. Please reload the page.", 'error');
        return;
      }
      const watchedProjects = [...this.data.entries()].map(([projectId, val]) => ({
        projectId,
        count: val.count,
        watchedWith: val.watchedWith || [],
        memories: val.memories || []
      }));
      // keepalive lets the browser finish the request even if the page is
      // unloading — otherwise a "click Watched, close tab" sequence would
      // abort the save mid-flight and the server would never see it.
      fetch(`${API}/progress/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Auth.getToken()}`
        },
        body: JSON.stringify({ watchedProjects }),
        keepalive: true
      }).then(res => {
        if (!res.ok) toast("Couldn't save your progress. Please try again.", 'error');
      }).catch(e => {
        console.warn("Save failed:", e);
        toast("Couldn't save your progress. Check your connection.", 'error');
      });
    } else {
      const obj = Object.fromEntries(this.data);
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(obj));
    }
  }

  // Force any pending debounced write to run immediately. Called on logout so
  // a user's last click isn't lost to the debounce window.
  flushPersist() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
      this._persistNow();
    }
  }

  isWatched(id) { return this.data.has(id); }

  getCount(id) { return this.data.get(id)?.count || 0; }

  // ms timestamp of the latest finished watch, or null. Entries from before
  // the server stamped it fall back to their newest memory upload.
  lastWatchedAt(id) {
    const e = this.data.get(id);
    if (!e) return null;
    if (e.lastWatchedAt) return e.lastWatchedAt;
    let best = null;
    for (const m of e.memories || []) {
      const t = m.uploadedAt ? new Date(m.uploadedAt).getTime() : NaN;
      if (Number.isFinite(t) && (best === null || t > best)) best = t;
    }
    return best;
  }

  getMemories(id) { return this.data.get(id)?.memories || []; }

  /* ---------- Watch sessions: Start watching → In progress → Mark as watched ----------
   * Watching is a timed flow enforced by the server (routes/progress.js):
   * "Start watching" stamps a start time, and "Mark as watched" unlocks only
   * after the movie's runtime — or, for a series, the current episode's
   * runtime — has passed. Series go episode by episode, in order.
   */

  getSession(id) { return this.sessions.get(id) || null; }

  isInProgress(id) { return this.sessions.has(id); }

  // Timers ticking right now (series waiting between episodes don't count).
  // The server allows MAX_RUNNING_TIMERS at once — routes/progress.js MAX_RUNNING.
  runningCount() { let n = 0; this.sessions.forEach(s => { if (s.startedAt) n++; }); return n; }

  atTimerCap() { return this.runningCount() >= WatchState.MAX_RUNNING_TIMERS; }

  // Non-empty episode list ⇒ series.
  episodesOf(p) { return Array.isArray(p?.episodes) && p.episodes.length ? p.episodes : null; }

  stepCount(p) { const eps = this.episodesOf(p); return eps ? eps.length : 1; }

  // Minutes for step `idx`: the movie runtime, or that episode's runtime.
  stepMinutes(p, idx = 0) {
    const eps = this.episodesOf(p);
    const v = eps ? eps[idx] : p?.runtime;
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  // Skippable end credits: "Mark as watched" unlocks this long before the
  // runtime ends — 10 min for a movie, 10% of an episode (2–10 min), never
  // more than half the runtime. Mirrors server/watchRules.js creditsMinutes().
  creditsMinutes(p, idx = 0) {
    const run = this.stepMinutes(p, idx);
    const credits = this.episodesOf(p) ? Math.min(10, Math.max(2, run * 0.10)) : 10;
    return Math.min(credits, run / 2);
  }

  // Minutes after Start before the step can be marked watched.
  requiredMinutes(p, idx = 0) {
    return Math.max(0, this.stepMinutes(p, idx) - this.creditsMinutes(p, idx));
  }

  totalMinutes(p) {
    const eps = this.episodesOf(p);
    return eps ? eps.reduce((a, b) => a + (b > 0 ? b : 0), 0) : this.stepMinutes(p);
  }

  serverNow() { return Date.now() + this.clockOffset; }

  // ms until "Mark as watched" unlocks for the running step; 0 = ready,
  // Infinity = no timer running (not started, or between episodes).
  remainingMs(id) {
    const s = this.sessions.get(id);
    if (!s || !s.startedAt) return Infinity;
    const p = this.byId.get(id);
    return Math.max(0, this.requiredMinutes(p, s.episode) * 60000 - (this.serverNow() - s.startedAt));
  }

  async _sessionCall(path, body) {
    if (this.readonly) return null;
    if (this.loadFailed) {
      toast("Your progress didn't load. Please reload the page.", 'error');
      return null;
    }
    // Flush pending tag/memory edits first so the server copy we get back
    // (and adopt) already includes them.
    this.flushPersist();
    try {
      const res = await fetch(`${API}/progress/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Auth.getToken()}` },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (data.watchedProjects) this._applyServer(data);
      if (!res.ok) {
        toast(data.error || "Couldn't update your board. Please try again.", 'error');
        return null;
      }
      return data;
    } catch (e) {
      console.warn(`${path} failed:`, e);
      toast("Couldn't reach the server. Check your connection.", 'error');
      return null;
    }
  }

  // Not started / Done → In progress, or start the next episode of a series.
  startWatching(id) { return this._sessionCall('start', { projectId: id }); }

  // post: the composer's { caption, memories, tagFriendIds } (all optional —
  // an empty composer posts it as-is). Resolves to { finished, post: { id } };
  // finished is true when the project moved to Done.
  completeWatching(id, post = {}) { return this._sessionCall('complete', { projectId: id, ...post }); }

  // In progress → back to where it was (resets timer + episode progress).
  cancelWatching(id) { return this._sessionCall('cancel', { projectId: id }); }

  // Rewatching goes through the same timed flow.
  watchAgain(id) { return this.startWatching(id); }

  // Un-watch only. Watches are added exclusively by completeWatching().
  toggle(id) {
    if (this.isWatched(id)) {
      this.data.delete(id);
      this.save();
    }
    return this.isWatched(id);
  }

  clear() {
    // Respect readonly — "Clear Progress" while viewing a friend's map must
    // not wipe our own account's server-side progress.
    if (this.readonly) return;
    if (Auth.isLoggedIn() && this.loadFailed) return;
    this.data.clear();
    this.sessions.clear();
    if (Auth.isLoggedIn()) {
      // Dedicated endpoint: /save can no longer delete watches (a stale tab
      // would silently erase finished ones), so wiping goes through /clear.
      fetch(`${API}/progress/clear`, {
        method: "POST",
        headers: { Authorization: `Bearer ${Auth.getToken()}` }
      }).then(res => {
        if (!res.ok) toast("Couldn't clear your progress. Please reload and try again.", 'error');
      }).catch(e => {
        console.warn("Failed to clear progress:", e);
        toast("Couldn't clear your progress. Check your connection.", 'error');
      });
    } else {
      localStorage.removeItem(CONFIG.STORAGE_KEY);
    }
    this.listeners.forEach(fn => fn(this.data));
  }

  // Local-only reset: used on logout and before loading a different user.
  // Unlike clear(), this never posts to the server (which would wipe the
  // previous user's saved progress). Fires listeners so subscribed caches
  // — layout cache, renderer, walkers — rebuild for the new user.
  resetLocal() {
    this.data.clear();
    this.sessions.clear();
    // The next account loads its own progress (ensureLoaded is per user).
    this._loadedFor = undefined;
    this.loadFailed = false;
    if (this._persistTimer) { clearTimeout(this._persistTimer); this._persistTimer = null; }
    this.listeners.forEach(fn => fn(this.data));
  }

  // Load progress once per signed-in user. Concurrent callers — a view
  // remounted while the first load is still in flight (boot's background
  // content refresh does that) — share ONE request; a failed load is retried
  // on the next call instead of being remembered.
  ensureLoaded() {
    const who = (typeof Auth !== 'undefined' && Auth.isLoggedIn()) ? (Auth.getUsername() || '?') : '';
    if (this._loadedFor === who && !this.loadFailed) return Promise.resolve();
    if (this._loading && this._loadingFor === who) return this._loading;
    this._loadingFor = who;
    const p = this.load().then(() => {
      if (!this.loadFailed) this._loadedFor = who;
    }).finally(() => {
      if (this._loading === p) this._loading = null;
    });
    this._loading = p;
    return p;
  }

  getLastWatchedId() {
    const watched = [];
    for (const [id, isWatched] of this.data) {
      if (isWatched) watched.push(id);
    }
    return watched.length ? watched[watched.length - 1] : CONFIG.START_NODE_ID;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  initProjects(projects) {
    this.byId = new Map(projects.map(p => [p.id, p]));
    projects.forEach(p => {
      p.watched = this.isWatched(p.id);
      p.phaseNum = this.parsePhase(p.phase);
      p.unlocks = projects
        .filter(c => c.prerequisites?.includes(p.id))
        .map(c => c.id);
    });
  }

  parsePhase(phase) {
    if (typeof phase === "number") return phase;
    const match = String(phase).match(/\d+/);
    return match ? +match[0] : 1;
  }

  getWatchedWith(id) { return this.data.get(id)?.watchedWith || []; }
}

WatchState.MAX_RUNNING_TIMERS = 2;

const state = new WatchState();
