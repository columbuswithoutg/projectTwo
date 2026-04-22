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
    // load() is async, called explicitly in DOMContentLoaded
  }

  async load() {
    if (Auth.isLoggedIn()) {
      try {
        const res = await fetch(`${API}/progress/load`, {
          headers: { Authorization: `Bearer ${Auth.getToken()}` }
        });
        if (res.ok) {
          const { watchedProjects } = await res.json();
          watchedProjects.forEach(entry => this.data.set(entry.projectId, {
            count: entry.count,
            watchedWith: entry.watchedWith || [],
            memories: entry.memories || []
          }));
          return;
        }
      } catch (e) {
        console.warn("Falling back to localStorage:", e);
      }
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
    if (Auth.isLoggedIn()) {
      const watchedProjects = [...this.data.entries()].map(([projectId, val]) => ({
        projectId,
        count: val.count,
        watchedWith: val.watchedWith || [],
        memories: val.memories || []
      }));
      fetch(`${API}/progress/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Auth.getToken()}`
        },
        body: JSON.stringify({ watchedProjects })
      }).catch(e => console.warn("Save failed:", e));
    } else {
      const obj = Object.fromEntries(this.data);
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(obj));
    }
    this.listeners.forEach(fn => fn(this.data));
  }

  isWatched(id) { return this.data.has(id); }

  getCount(id) { return this.data.get(id)?.count || 0; }

  getMemories(id) { return this.data.get(id)?.memories || []; }

  watchAgain(id) {
    const entry = this.data.get(id);
    if (entry) {
      entry.count += 1;
      this.save();
    }
  }

  toggle(id) {
    if (this.isWatched(id)) {
      this.data.delete(id);
    } else {
      this.data.set(id, { count: 1, memories: [] });
    }
    this.save();
    return this.isWatched(id);
  }

  clear() {
    // Respect readonly — "Clear Progress" while viewing a friend's map must
    // not wipe our own account's server-side progress.
    if (this.readonly) return;
    this.data.clear();
    if (Auth.isLoggedIn()) {
      fetch(`${API}/progress/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Auth.getToken()}`
        },
        body: JSON.stringify({ watchedProjects: [] })
      }).catch(e => console.warn("Failed to clear progress:", e));
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
    this.listeners.forEach(fn => fn(this.data));
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

const state = new WatchState();
