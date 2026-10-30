/************************************************
 * STATE MANAGEMENT (MongoDB-backed)
 ************************************************/
class WatchState {
  constructor() {
    this.data = new Map();
    this.byId = new Map();
    this.listeners = new Set();
    // When true, mutations don't persist. Set while the user is viewing a
    // friend's progress so an accidental start/complete/cancel can't act on
    // the current user's account with the friend's board on screen.
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
    // While a friend's progress is on screen (FriendView swapped it into
    // this.data and set readonly), OUR server copy must not overwrite it —
    // and must not be lost either: FriendView.exit() restores its saved
    // snapshot, so hand the payload to FriendView to fold into that
    // snapshot instead. (A load still in flight when the friend page opened
    // used to land here, wipe the friend's map, and then be discarded by
    // exit() — blanking our own progress until reload.)
    if (this.readonly && typeof FriendView !== 'undefined' && FriendView.isActive()) {
      const data = new Map(), sessions = new Map();
      this._fillFromServer(payload, data, sessions);
      FriendView.replaceSaved(data, sessions);
      if (Number.isFinite(payload.serverNow)) this.clockOffset = payload.serverNow - Date.now();
      return;
    }
    this._fillFromServer(payload, this.data, this.sessions);
    if (Number.isFinite(payload.serverNow)) this.clockOffset = payload.serverNow - Date.now();
    this.byId.forEach(p => { p.watched = this.isWatched(p.id); });
    if (notify) this.listeners.forEach(fn => fn(this.data));
  }

  // Server payload → the given data / sessions maps (cleared first).
  _fillFromServer(payload, data, sessions) {
    data.clear();
    payload.watchedProjects.forEach(entry => data.set(entry.projectId, {
      count: entry.count,
      watchedWith: entry.watchedWith || [],
      memories: entry.memories || [],
      lastWatchedAt: entry.lastWatchedAt ? new Date(entry.lastWatchedAt).getTime() : null
    }));
    sessions.clear();
    (payload.watchSessions || []).forEach(s => sessions.set(s.projectId, {
      episode: s.episode || 0,
      startedAt: s.startedAt ? new Date(s.startedAt).getTime() : null,
      rewatch: !!s.rewatch
    }));
  }

  async load() {
    // Every view is behind the auth gate, so there is no guest copy to load.
    // sessionExpired(): the token ran out in this tab — still a signed-in
    // user, so take the server path and let Auth.fetch send them to /login.
    if (!Auth.isLoggedIn() && !Auth.sessionExpired()) return;
    try {
      // Auth.fetch: a dead session redirects to /login and never settles,
      // so a 401 can no longer surface as "Couldn't load your progress".
      const res = await Auth.fetch(`${API}/progress/load`);
      if (res.ok) {
        this._applyServer(await res.json(), { notify: false });
        this.loadFailed = false;
        return;
      }
    } catch (e) {
      console.warn("Progress load failed:", e);
    }
    // Signed out while it ran: on a public page (/s/<token>) Auth.fetch drops
    // a revoked token quietly and hands back the 401 (or rejects with no
    // token). Nothing of ours to protect there, so no banner, no retry prompt.
    if (!Auth.isLoggedIn()) return;
    // Block board changes (start / complete / cancel) until a successful load.
    this.loadFailed = true;
    toast("Couldn't load your progress. Changes won't be saved until you reload.", { type: 'error', duration: 6000 });
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
    try {
      const res = await Auth.fetch(`${API}/progress/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  // Local-only reset: used on logout and before loading a different user.
  // It never posts to the server, so the previous user's saved progress is
  // untouched. Fires listeners so subscribed caches
  // — layout cache, renderer, walkers — rebuild for the new user.
  resetLocal() {
    this.data.clear();
    this.sessions.clear();
    // The next account loads its own progress (ensureLoaded is per user).
    this._loadedFor = undefined;
    this.loadFailed = false;
    // Forget an in-flight load: after a dead session it never settles
    // (Auth.endSession), and the same user signing back in must not wait on it.
    this._loading = null;
    this._loadingFor = undefined;
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

  // Where /map (and a friend's map) centres on open: the most RECENTLY
  // watched title by lastWatchedAt(), so a rewatch or a fresh completion
  // moves it. Entries with no timestamp at all fall back to the old rule —
  // the last one in the server's order.
  getLastWatchedId() {
    let bestId = null, bestAt = -Infinity, lastId = null;
    for (const id of this.data.keys()) {
      lastId = id;
      const at = this.lastWatchedAt(id);
      if (Number.isFinite(at) && at > bestAt) { bestAt = at; bestId = id; }
    }
    return bestId || lastId || CONFIG.START_NODE_ID;
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
