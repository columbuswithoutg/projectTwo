/************************************************
 * CONFIGURATION (Mobile proportions for all)
 ************************************************/
const CONFIG = {
  H_SPACING: 160,
  V_SPACING: 220,
  NODE_WIDTH: 120,
  NODE_HEIGHT: 180,
  IMAGE_BASE: "assets/images/",
  START_NODE_ID: "ironman1",
  STORAGE_KEY: "watchProgress_v2"
};

// Scale down for mobile — zoomed out feel
const isMobile = window.matchMedia('(max-width: 640px)').matches;
if (isMobile) {
  CONFIG.H_SPACING = 100;
  CONFIG.V_SPACING = 140;
  CONFIG.NODE_WIDTH = 75;
  CONFIG.NODE_HEIGHT = 110;
}

const PHASE_UNLOCKERS = {
  2: "avengers1",
  3: "ageofultron",
  4: "endgame",
  5: "loki1",
  6: "loki2"
};

/************************************************
 * STATE MANAGEMENT
 ************************************************/
/************************************************
 * AUTH HELPERS
 ************************************************/
const API = window.location.origin + "/api";

const Auth = {
  getToken: () => localStorage.getItem("mcu_token"),
  getUsername: () => localStorage.getItem("mcu_username"),
  setToken: (t) => localStorage.setItem("mcu_token", t),
  clearToken: () => localStorage.removeItem("mcu_token"),
  isLoggedIn: () => !!localStorage.getItem("mcu_token"),

  async register(username, password) {
    const res = await fetch(`${API}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    return res.json();
  },

  async login(username, password) {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.token) Auth.setToken(data.token);
    return data;
  },

  logout() {
    Auth.clearToken();
    localStorage.removeItem("mcu_username");
    window.location.reload();
  }
};

/************************************************
 * STATE MANAGEMENT (MongoDB-backed)
 ************************************************/
class WatchState {
  constructor() {
    this.data = new Map();
    this.byId = new Map();
    this.listeners = new Set();
    // load() is now async, called explicitly in DOMContentLoaded
  }

  // Load from MongoDB if logged in, otherwise fall back to localStorage
  // Load from MongoDB
  async load() {
    if (Auth.isLoggedIn()) {
      try {
        const res = await fetch(`${API}/progress/load`, {
          headers: { Authorization: `Bearer ${Auth.getToken()}` }
        });
        if (res.ok) {
          const { watchedProjects } = await res.json();
          // New shape: [{projectId, count, memories}]
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
        // Handle both old boolean format and new object format
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

  // isWatched still works the same
  isWatched(id) { return this.data.has(id); }

  getCount(id) { return this.data.get(id)?.count || 0; }

  getMemories(id) { return this.data.get(id)?.memories || []; }

  // Watch again increments count
  watchAgain(id) {
    const entry = this.data.get(id);
    if (entry) {
      entry.count += 1;
      this.save();
    }
  }

  toggle(id) {
    if (this.isWatched(id)) {
      this.data.delete(id); // unwatching fully removes
    } else {
      this.data.set(id, { count: 1, memories: [] });
    }
    this.save();
    return this.isWatched(id);
  }

  clear() {
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

  // Everything below is UNCHANGED from your original
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

/************************************************
 * UTILITY FUNCTIONS
 ************************************************/
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

/************************************************
 * VISIBILITY & UNLOCK LOGIC
 ************************************************/
const isPhaseUnlocked = (p) => {
  if (p.phaseNum === 1) return true;
  const unlockerId = PHASE_UNLOCKERS[p.phaseNum];
  return unlockerId && state.isWatched(unlockerId);
};

const isUnlocked = (p) => {
  if (p.phaseNum === 1) return true;
  if (!isPhaseUnlocked(p)) return false;
  return (p.prerequisites || []).every(id => state.isWatched(id));
};

const isVisible = (p) => {
  if (p.id === CONFIG.START_NODE_ID) return true;
  if (state.isWatched(p.id)) return true;
  return (p.prerequisites || []).every(id => state.isWatched(id));
};

const getHighestUnlockedPhase = () => {
  const unlocked = projects.filter(isPhaseUnlocked);
  return unlocked.length ? Math.max(...unlocked.map(p => p.phaseNum)) : 1;
};

/************************************************
 * COORDINATE SYSTEM (Fixed - uniform for both sides)
 ************************************************/
const getBounds = () => {
  const visible = projects.filter(isVisible);
  if (!visible.length) return null;

  const xs = visible.map(p => p.gridX);
  const ys = visible.map(p => p.gridY);

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
};

// Convert grid coordinates to pixel positions
// Both leftmost and rightmost nodes get the same treatment
const toPixel = (gridX, gridY, bounds) => ({
  x: (gridX - bounds.minX) * CONFIG.H_SPACING,
  y: (gridY - bounds.minY) * CONFIG.V_SPACING
});

/************************************************
 * RENDERER
 ************************************************/
class MapRenderer {
  constructor() {
    this.container = $("#map-wrapper");
    this.mapContainer = $("#map-container");
    this.nodesContainer = $("#nodes");
    this.svg = $("#connections");
    this.nodeElements = new Map();
    this.arrowElements = [];
    this.pendingCenterTarget = null;
  }

  init() {
    this.setupEventDelegation();
    state.subscribe(() => this.render());
  }

  setupEventDelegation() {
    this.nodesContainer.addEventListener("click", (e) => {
      const node = e.target.closest(".node");
      if (!node) return;

      const id = node.dataset.id;
      const project = state.byId.get(id);
      if (!project) return;

      const isReadonly = this.nodesContainer.classList.contains('readonly');

      // In readonly mode, only open popup for watched nodes
      if (isReadonly && !state.isWatched(project.id)) return;

      // In normal mode, only open popup for unlocked nodes
      if (!isReadonly && !isUnlocked(project)) return;

      this.showPopup(project);
    });
  }

  render() {
    const bounds = getBounds();
    if (!bounds) return;

    this.updateContainerSize(bounds);
    this.renderNodes(bounds);
    this.updatePhaseIndicator();

    requestAnimationFrame(() => {
      this.renderArrows();
      this.centerOnTarget();
    });
  }

  // FIXED: Uniform sizing logic for both left and right sides
  updateContainerSize(bounds) {
    // Calculate based on actual node positions, not grid range + arbitrary padding
    // Width = (distance between leftmost and rightmost grid positions) * spacing + node width
    // This treats left and right edges identically
    const gridWidth = bounds.maxX - bounds.minX;
    const gridHeight = bounds.maxY - bounds.minY;

    // Width: space between nodes + one node width (same logic as left side positioning)
    const width = gridWidth * CONFIG.H_SPACING + CONFIG.NODE_WIDTH;
    const height = gridHeight * CONFIG.V_SPACING + CONFIG.NODE_HEIGHT;

    this.mapContainer.style.width = `${width}px`;
    this.mapContainer.style.height = `${height}px`;
  }

  renderNodes(bounds) {
    const visible = projects.filter(isVisible);
    const fragment = document.createDocumentFragment();

    const existingIds = new Set(this.nodeElements.keys());
    const newIds = new Set(visible.map(p => p.id));

    existingIds.forEach(id => {
      if (!newIds.has(id)) {
        this.nodeElements.get(id)?.remove();
        this.nodeElements.delete(id);
      }
    });

    visible.forEach(p => {
      let node = this.nodeElements.get(p.id);
      const pos = toPixel(p.gridX, p.gridY, bounds);

      if (!node) {
        node = this.createNodeElement(p, pos);
        fragment.appendChild(node);
        this.nodeElements.set(p.id, node);
      } else {
        node.style.left = `${pos.x}px`;
        node.style.top = `${pos.y}px`;
        this.updateNodeState(node, p);
      }
    });

    if (fragment.childNodes.length) {
      this.nodesContainer.appendChild(fragment);
    }
  }

  createNodeElement(project, pos) {
    const node = document.createElement("div");
    node.className = "node";
    node.dataset.id = project.id;
    node.style.left = `${pos.x}px`;
    node.style.top = `${pos.y}px`;

    if (project.image) {
      const img = document.createElement("img");
      img.src = CONFIG.IMAGE_BASE + project.image;
      img.loading = "lazy";
      img.onerror = () => img.remove();
      node.appendChild(img);
    }

    const check = document.createElement("span");
    check.className = "checkmark";
    check.textContent = "✔";
    node.appendChild(check);

    this.updateNodeState(node, project);
    return node;
  }

  updateNodeState(node, project) {
    const isWatched = state.isWatched(project.id);
    const locked = !isUnlocked(project);

    node.classList.toggle("watched", isWatched);
    node.classList.toggle("locked", locked);
  }

  renderArrows() {
    this.arrowElements.forEach(el => el.remove());
    this.arrowElements = [];

    if (!this.svg.querySelector("#arrowhead")) {
      this.createArrowhead();
    }

    const containerRect = this.mapContainer.getBoundingClientRect();

    projects.forEach(parent => {
      if (!isVisible(parent)) return;

      const fromNode = this.nodeElements.get(parent.id);
      if (!fromNode) return;

      parent.unlocks.forEach(childId => {
        const child = state.byId.get(childId);
        if (!child || !isVisible(child)) return;

        const toNode = this.nodeElements.get(childId);
        if (toNode) {
          const arrow = this.createArrow(fromNode, toNode, containerRect);
          this.svg.appendChild(arrow);
          this.arrowElements.push(arrow);
        }
      });
    });
  }

  createArrowhead() {
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");

    marker.id = "arrowhead";
    marker.setAttribute("markerWidth", "8");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("refX", "7");
    marker.setAttribute("refY", "3");
    marker.setAttribute("orient", "auto");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M0,0 L0,6 L7,3 Z");
    path.setAttribute("fill", "rgba(46, 255, 81, 0.6)");

    marker.appendChild(path);
    defs.appendChild(marker);
    this.svg.appendChild(defs);
  }

  createArrow(fromNode, toNode, containerRect) {
    const a = fromNode.getBoundingClientRect();
    const b = toNode.getBoundingClientRect();

    const fx = a.left + a.width / 2 - containerRect.left;
    const fy = a.top + a.height / 2 - containerRect.top;
    const tx = b.left + b.width / 2 - containerRect.left;
    const ty = b.top + b.height / 2 - containerRect.top;

    const dx = tx - fx;
    const dy = ty - fy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    const offsetX = ux * (a.width / 2 + 6);
    const offsetY = uy * (a.height / 2 + 6);
    const endOffsetX = ux * (b.width / 2 + 8);
    const endOffsetY = uy * (b.height / 2 + 8);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", fx + offsetX);
    line.setAttribute("y1", fy + offsetY);
    line.setAttribute("x2", tx - endOffsetX);
    line.setAttribute("y2", ty - endOffsetY);
    line.setAttribute("stroke", "rgba(46, 255, 81, 0.35)");
    line.setAttribute("stroke-width", "2");

    return line;
  }

  updatePhaseIndicator() {
    this.mapContainer.dataset.phase = getHighestUnlockedPhase();
  }

  setCenterTarget(id) {
    this.pendingCenterTarget = id;
  }

  centerOnTarget() {
    const targetId = this.pendingCenterTarget || state.getLastWatchedId();
    this.pendingCenterTarget = null;

    const node = this.nodeElements.get(targetId);
    if (!node) return;

    const wrapperRect = this.container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();

    const scrollLeft = this.container.scrollLeft + (nodeRect.left - wrapperRect.left) - (wrapperRect.width / 2) + (nodeRect.width / 2);
    const scrollTop = this.container.scrollTop + (nodeRect.top - wrapperRect.top) - (wrapperRect.height / 2) + (nodeRect.height / 2);

    this.container.scrollTo({
      left: Math.max(0, scrollLeft),
      top: Math.max(0, scrollTop),
      behavior: "smooth"
    });
  }

  showPopup(project) {
    $('.node-popup')?.remove();

    const isWatched = state.isWatched(project.id);
    const count = state.getCount(project.id);
    const memories = state.getMemories(project.id);
    const watchedWith = state.getWatchedWith(project.id);
    const isReadonly = renderer.nodesContainer.classList.contains('readonly');

    const popup = document.createElement('div');
    popup.className = 'node-popup';
    popup.innerHTML = `
  <button class="popup-close">✕</button>
  <h3>${project.title}</h3>

  ${isWatched ? `
    <p class="watch-count">Watched ${count} time${count !== 1 ? 's' : ''}</p>
${watchedWith.length ? (() => {
          const currentUsername = Auth.getUsername();
          const formatted = watchedWith.map(name =>
            name === currentUsername ? '<span class="watched-with-you">you</span>' : `<span>${name}</span>`
          );
          return `
    <div class="watched-with-info">
      <p class="watched-with-label">Watched with:</p>
      <div class="watched-with-list">
        ${formatted.map(f => `<div class="watched-with-entry">${f}</div>`).join('')}
      </div>
    </div>
  `;
        })() : ''}
  ` : ''}

${!isReadonly ? `
  <button class="popup-action ${isWatched ? 'watch-again' : ''}">
    ${isWatched ? 'Watch Again' : 'Mark as Watched'}
  </button>
  <button class="popup-action secondary" id="watched-with-friend-btn">Watched with a Friend</button>
  ${isWatched ? `
    <button class="popup-action secondary" id="add-memory-btn">Add Memory</button>
  ` : ''}
` : ''}

  ${memories.length ? `
    <div class="memories-section">
      <h4>Memories</h4>
      <div class="memories-grid">
        ${memories.map((m, i) => `
          <div class="memory-item" data-index="${i}">
            ${m.type === 'video'
            ? `<video src="${m.url}" preload="metadata"></video>`
            : `<img src="${m.url}" alt="${m.caption}" />`
          }
            <div class="memory-overlay">
              <button class="memory-view-btn" data-index="${i}">View</button>
              ${!isReadonly ? `<button class="memory-delete" data-url="${m.url}">✕</button>` : ''}
            </div>
            ${m.caption ? `<p class="memory-caption">${m.caption}</p>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  ` : ''}
`;

    popup.querySelector('.popup-close').onclick = () => popup.remove();

    if (!isReadonly) {
      popup.querySelector('.popup-action').onclick = () => {
        if (isWatched) {
          state.watchAgain(project.id);
        } else {
          state.toggle(project.id);
        }
        this.setCenterTarget(project.id);
        popup.remove();
      };

      popup.querySelector('#watched-with-friend-btn')?.addEventListener('click', () => {
        popup.remove();
        showWatchedWithFriendModal(project);
      });

      popup.querySelector('#add-memory-btn')?.addEventListener('click', () => {
        popup.remove();
        showAddMemoryModal(project);
      });

      popup.querySelectorAll('.memory-delete').forEach(btn => {
        btn.onclick = async () => {
          const url = btn.dataset.url;
          await fetch(`${API}/progress/memory`, {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${Auth.getToken()}`
            },
            body: JSON.stringify({ projectId: project.id, url })
          });
          const entry = state.data.get(project.id);
          if (entry) entry.memories = entry.memories.filter(m => m.url !== url);
          btn.closest('.memory-item').remove();
        };
      });
    }

    // View memory lightbox — works for both own and friend's memories
    popup.querySelectorAll('.memory-view-btn').forEach(btn => {
      btn.onclick = () => {
        const index = parseInt(btn.dataset.index);
        popup.remove();
        showMemoryLightbox(memories, index, project);
      };
    });

    popup.addEventListener('click', (e) => {
      if (e.target === popup) popup.remove();
    });

    document.body.appendChild(popup);
  }

  markAllWatched() {
    projects.forEach(p => state.setWatched(p.id, true));
  }
}

/************************************************
 * INITIALIZATION
 ************************************************/
const renderer = new MapRenderer();

document.addEventListener("DOMContentLoaded", async () => {
  await state.load();
  state.initProjects(projects);
  renderer.init();

  // Drawer open/close
  const drawer = document.getElementById('nav-drawer');

  const openDrawer = () => drawer.classList.add('open');
  const closeDrawer = () => drawer.classList.remove('open');

  document.getElementById('nav-toggle').addEventListener('click', openDrawer);
  document.getElementById('close-drawer').addEventListener('click', closeDrawer);
  document.getElementById('nav-drawer-overlay').addEventListener('click', closeDrawer);
  document.getElementById('characters-btn')?.addEventListener('click', () => {
    window.location.href = '/characters.html';
  });
  // Close drawer after any button is clicked
  document.querySelectorAll('#nav-drawer-content nav button').forEach(btn => {
    btn.addEventListener('click', closeDrawer);
  });

  // Existing button listeners
  $("#markAllWatchedBtn")?.addEventListener("click", () => renderer.markAllWatched());

  $("#clear-progress")?.addEventListener("click", () => {
    state.clear();
    renderer.setCenterTarget(CONFIG.START_NODE_ID);
  });

  $("#logout-btn")?.addEventListener("click", () => {
    localStorage.removeItem("mcu_token");
    localStorage.removeItem("mcu_username");
    window.location.href = "/index.html";
  });

  $("#friends-btn")?.addEventListener("click", () => showFriendsPanel());

  renderer.setCenterTarget(state.getLastWatchedId());
  renderer.render();
});

function updateAuthUI() {
  const loggedIn = Auth.isLoggedIn();
  $("#logout-btn") && ($("#logout-btn").style.display = loggedIn ? "block" : "none");
  $("#login-btn") && ($("#login-btn").style.display = loggedIn ? "none" : "block");
  $("#register-btn") && ($("#register-btn").style.display = loggedIn ? "none" : "block");
}

function showAuthModal(mode) {
  $(".auth-modal")?.remove();

  const modal = document.createElement("div");
  modal.className = "auth-modal";
  modal.innerHTML = `
    <div class="auth-box">
      <button class="popup-close">✕</button>
      <h3>${mode === "login" ? "Login" : "Register"}</h3>
      <input id="auth-username" type="text" placeholder="Username" />
      <input id="auth-password" type="password" placeholder="Password" />
      <p class="auth-error" style="color:red;display:none;"></p>
      <button id="auth-submit">${mode === "login" ? "Login" : "Create Account"}</button>
    </div>
  `;

  modal.querySelector(".popup-close").onclick = () => modal.remove();

  modal.querySelector("#auth-submit").onclick = async () => {
    const username = modal.querySelector("#auth-username").value.trim();
    const password = modal.querySelector("#auth-password").value;
    const errorEl = modal.querySelector(".auth-error");

    if (!username || !password) {
      errorEl.textContent = "Please fill in all fields.";
      errorEl.style.display = "block";
      return;
    }

    const data = mode === "login"
      ? await Auth.login(username, password)
      : await Auth.register(username, password);

    if (data.error) {
      errorEl.textContent = data.error;
      errorEl.style.display = "block";
      return;
    }

    modal.remove();

    if (mode === "login") {
      // Reload progress from MongoDB after login
      state.data.clear();
      await state.load();
      renderer.render();
    }

    updateAuthUI();
  };

  document.body.appendChild(modal);
}

/************************************************
 * FRIENDS SYSTEM
 ************************************************/
const Friends = {
  async search(username) {
    const res = await fetch(`${API}/friends/search?username=${encodeURIComponent(username)}`, {
      headers: { Authorization: `Bearer ${Auth.getToken()}` }
    });
    return res.json();
  },

  async sendRequest(recipientId) {
    const res = await fetch(`${API}/friends/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Auth.getToken()}`
      },
      body: JSON.stringify({ recipientId })
    });
    return res.json();
  },

  async getPending() {
    const res = await fetch(`${API}/friends/pending`, {
      headers: { Authorization: `Bearer ${Auth.getToken()}` }
    });
    return res.json();
  },

  async respond(requestId, action) {
    const res = await fetch(`${API}/friends/respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Auth.getToken()}`
      },
      body: JSON.stringify({ requestId, action })
    });
    return res.json();
  },

  async getList() {
    const res = await fetch(`${API}/friends/list`, {
      headers: { Authorization: `Bearer ${Auth.getToken()}` }
    });
    return res.json();
  },

  async getProgress(friendId) {
    const res = await fetch(`${API}/friends/progress/${friendId}`, {
      headers: { Authorization: `Bearer ${Auth.getToken()}` }
    });
    return res.json();
  },

  async remove(friendId) {
    const res = await fetch(`${API}/friends/remove/${friendId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${Auth.getToken()}` }
    });
    return res.json();
  }
};

function showFriendsPanel() {
  $('.friends-panel')?.remove();

  const panel = document.createElement('div');
  panel.className = 'friends-panel';
  panel.innerHTML = `
    <div class="friends-box">
      <button class="popup-close" id="close-friends">✕</button>
      <h3>Friends</h3>

      <!-- Search -->
      <div class="friends-section">
        <h4>Add Friend</h4>
        <div class="friends-search-row">
          <input id="friend-search" type="text" placeholder="Search by username" />
          <button id="friend-search-btn">Add</button>
        </div>
        <div id="friend-search-results"></div>
      </div>

      <!-- Pending Requests -->
      <div class="friends-section">
        <h4>Pending Requests</h4>
        <div id="friend-pending-list">Loading...</div>
      </div>

      <!-- Friends List -->
      <div class="friends-section">
        <h4>Your Friends</h4>
        <div id="friend-list">Loading...</div>
      </div>
    </div>
  `;

  // Close
  panel.querySelector('#close-friends').onclick = () => panel.remove();

  const addBtn = panel.querySelector('#friend-search-btn');

  const doAdd = async () => {
    const query = panel.querySelector('#friend-search').value.trim();
    if (!query) return;

    addBtn.disabled = true;
    addBtn.textContent = '...';

    // Search for the user first
    const results = await Friends.search(query);

    if (!results.length) {
      addBtn.textContent = 'Not Found';
      addBtn.style.background = 'rgba(255, 80, 80, 0.7)';
      addBtn.style.color = '#fff';
      // Reset after 2 seconds
      setTimeout(() => {
        addBtn.textContent = 'Add';
        addBtn.style.background = '';
        addBtn.style.color = '';
        addBtn.disabled = false;
      }, 2000);
      return;
    }

    // Send request to the first exact or closest match
    const user = results.find(u => u.username.toLowerCase() === query.toLowerCase()) || results[0];
    const data = await Friends.sendRequest(user._id);

    if (data.error) {
      addBtn.textContent = data.error === 'Request already exists' ? 'Already Added' : data.error;
      addBtn.style.background = 'rgba(255, 80, 80, 0.7)';
      addBtn.style.color = '#fff';
    } else {
      addBtn.textContent = 'Added!';
      addBtn.style.background = 'rgba(46, 255, 81, 0.8)';
      addBtn.style.color = '#000';
    }

    // Reset after 2 seconds
    setTimeout(() => {
      addBtn.textContent = 'Add';
      addBtn.style.background = '';
      addBtn.style.color = '';
      addBtn.disabled = false;
      panel.querySelector('#friend-search').value = '';
    }, 2000);
  };

  addBtn.onclick = doAdd;

  // Allow Enter key in search
  panel.querySelector('#friend-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doAdd();
  });

  // Load pending requests
  Friends.getPending().then(requests => {
    const container = panel.querySelector('#friend-pending-list');
    if (!requests.length) {
      container.innerHTML = '<p class="friends-empty">No pending requests</p>';
      return;
    }
    container.innerHTML = requests.map(r => `
  <div class="friend-row">
    <span>
      ${r.type === 'watch'
        ? `<strong>${r.requester.username}</strong> wants to watch <em style="color:rgba(46,255,81,0.8)">${r.projectTitle || r.projectId}</em> together`
        : `<strong>${r.requester.username}</strong> sent you a friend request`
      }
    </span>
    <div style="display:flex; gap:6px; flex-shrink:0">
      <button class="friend-accept-btn" data-id="${r._id}" data-type="${r.type || 'friend'}" data-project="${r.projectId || ''}">Accept</button>
      <button class="friend-reject-btn" data-id="${r._id}">Reject</button>
    </div>
  </div>
`).join('');
    container.querySelectorAll('.friend-accept-btn').forEach(btn => {
      btn.onclick = async () => {
        const data = await Friends.respond(btn.dataset.id, 'accepted');
        const type = btn.dataset.type;
        const projectId = btn.dataset.project;

        if (type === 'watch' && projectId) {
          const entry = state.data.get(projectId);
          if (entry) {
            entry.count += 1;
            if (data.requester?.username && !entry.watchedWith.includes(data.requester.username)) {
              entry.watchedWith.push(data.requester.username);
            }
          } else {
            state.data.set(projectId, { count: 1, watchedWith: [], memories: [] });
          }
          state.save();
          renderer.render();
        }

        btn.closest('.friend-row').remove();
        if (type === 'friend') loadFriendList(panel);

        const list = panel.querySelector('#friend-pending-list');
        if (!list.querySelector('.friend-row')) {
          list.innerHTML = '<p class="friends-empty">No pending requests</p>';
        }
      };
    });
    container.querySelectorAll('.friend-reject-btn').forEach(btn => {
      btn.onclick = async () => {
        await Friends.respond(btn.dataset.id, 'rejected');
        btn.closest('.friend-row').remove();
      };
    });
  });

  // Load friends list
  loadFriendList(panel);

  document.body.appendChild(panel);
}

function loadFriendList(panel) {
  Friends.getList().then(friends => {
    const container = panel.querySelector('#friend-list');
    if (!friends || friends.error || !Array.isArray(friends)) {
      container.innerHTML = '<p class="friends-empty">Failed to load</p>';
      return;
    }
    if (!friends.length) {
      container.innerHTML = '<p class="friends-empty">No friends yet</p>';
      return;
    }
    container.innerHTML = friends.map(f => `
      <div class="friend-row" data-id="${f.id}">
        <span>${f.username}</span>
        <div style="display:flex; gap:6px">
          <button class="friend-view-btn" data-id="${f.id}" data-name="${f.username}">View Progress</button>
          <button class="friend-remove-btn" data-id="${f.id}" data-name="${f.username}">Remove</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.friend-view-btn').forEach(btn => {
      btn.onclick = () => {
        panel.remove();
        viewFriendProgress(btn.dataset.id, btn.dataset.name);
      };
    });

    container.querySelectorAll('.friend-remove-btn').forEach(btn => {
      btn.onclick = () => showRemoveConfirm(btn.dataset.id, btn.dataset.name, panel);
    });

  }).catch(() => {
    panel.querySelector('#friend-list').innerHTML =
      '<p class="friends-empty">Failed to load friends</p>';
  });
}

async function viewFriendProgress(friendId, friendName) {
  const data = await Friends.getProgress(friendId);
  if (data.error) return alert(data.error);

  const originalData = new Map(state.data);

  state.data.clear();
  // Load full entry including memories so popup shows them
  data.watchedProjects.forEach(entry => {
    state.data.set(entry.projectId, {
      count: entry.count,
      watchedWith: entry.watchedWith || [],
      memories: entry.memories || []
    });
  });

  const originalHeader = document.getElementById('header');
  originalHeader.style.display = 'none';

  const banner = document.createElement('header');
  banner.id = 'header';
  banner.innerHTML = `
    <h1>Viewing <strong>${friendName}</strong>'s Progress</h1>
    <button id="exit-friend-view">← Back to My Progress</button>
  `;

  banner.querySelector('#exit-friend-view').onclick = () => {
    state.data.clear();
    originalData.forEach((v, k) => state.data.set(k, v));
    banner.remove();
    originalHeader.style.display = '';
    renderer.nodesContainer.classList.remove('readonly');
    renderer.render();
  };

  document.body.insertBefore(banner, document.getElementById('map-wrapper'));
  renderer.nodesContainer.classList.add('readonly');
  renderer.render();
}

async function showWatchedWithFriendModal(project) {
  const friends = await Friends.getList();

  const modal = document.createElement('div');
  modal.className = 'auth-modal';
  modal.innerHTML = `
    <div class="auth-box">
      <button class="popup-close">✕</button>
      <h3>Watched with a Friend</h3>
      <p style="color:#aaa; font-size:0.9rem">Select a friend to mark <strong style="color:#fff">${project.title}</strong> as watched for them too.</p>
      <div id="watch-friends-list">
        ${!friends.length
      ? '<p style="color:#666">No friends yet</p>'
      : friends.map(f => `
            <div class="friend-row">
              <span>${f.username}</span>
              <button class="watch-with-btn" data-id="${f.id}">Send Request</button>
            </div>
          `).join('')
    }
      </div>
    </div>
  `;

  modal.querySelector('.popup-close').onclick = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelectorAll('.watch-with-btn').forEach(btn => {
    btn.onclick = async () => {
      const recipientId = btn.dataset.id;

      // Mark as watched for current user if not already
      if (!state.isWatched(project.id)) {
        state.data.set(project.id, { count: 1, watchedWith: [], memories: [] });
        state.save();
        renderer.render();
      }

      // Send watch request to friend
      const res = await fetch(`${API}/friends/watch-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Auth.getToken()}`
        },
        body: JSON.stringify({ recipientId, projectId: project.id, projectTitle: project.title })
      });
      const data = await res.json();

      if (data.error) {
        btn.textContent = data.error;
        btn.style.background = 'rgba(255, 80, 80, 0.7)';
        btn.style.color = '#fff';
      } else {
        btn.textContent = 'Sent!';
        // Add friend's username to current user's watchedWith locally
        const entry = state.data.get(project.id);
        const friendName = btn.closest('.friend-row').querySelector('span').textContent;
        if (entry && !entry.watchedWith.includes(friendName)) {
          entry.watchedWith.push(friendName);
          state.save();
        }
      }
      btn.disabled = true;
    };
  });

  document.body.appendChild(modal);
}

async function showAddMemoryModal(project) {
  const modal = document.createElement('div');
  modal.className = 'auth-modal';
  modal.innerHTML = `
    <div class="auth-box">
      <button class="popup-close">✕</button>
      <h3>Add Memory</h3>
      <p style="color:#aaa; font-size:0.9rem">Upload a photo or video from watching ${project.title}</p>
      <input type="file" id="memory-file" accept="image/*,video/*" />
      <input type="text" id="memory-caption" placeholder="Caption (optional)" />
      <div id="memory-preview"></div>
      <p class="auth-error" style="display:none; color:red"></p>
      <button id="memory-upload-btn">Upload</button>
    </div>
  `;

  modal.querySelector('.popup-close').onclick = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  // Preview before upload
  modal.querySelector('#memory-file').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const preview = modal.querySelector('#memory-preview');
    const url = URL.createObjectURL(file);
    preview.innerHTML = file.type.startsWith('video')
      ? `<video src="${url}" controls style="max-width:100%; border-radius:8px; margin-top:8px"></video>`
      : `<img src="${url}" style="max-width:100%; border-radius:8px; margin-top:8px" />`;
  };

  modal.querySelector('#memory-upload-btn').onclick = async () => {
    const file = modal.querySelector('#memory-file').files[0];
    const caption = modal.querySelector('#memory-caption').value.trim();
    const errorEl = modal.querySelector('.auth-error');
    const uploadBtn = modal.querySelector('#memory-upload-btn');

    if (!file) {
      errorEl.textContent = 'Please select a file.';
      errorEl.style.display = 'block';
      return;
    }

    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';

    try {
      // Upload to Cloudinary via your server
      const formData = new FormData();
      formData.append('file', file);

      const uploadRes = await fetch(`${API}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${Auth.getToken()}` },
        body: formData
      });
      const { url, type, error } = await uploadRes.json();
      if (error) throw new Error(error);

      // Save memory to MongoDB
      const saveRes = await fetch(`${API}/progress/memory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Auth.getToken()}`
        },
        body: JSON.stringify({ projectId: project.id, url, type, caption })
      });
      const saved = await saveRes.json();

      // Update local state
      const entry = state.data.get(project.id);
      if (entry) entry.memories = saved.memories;

      modal.remove();
      renderer.showPopup(project); // reopen popup to show new memory

    } catch (e) {
      errorEl.textContent = 'Upload failed. Try again.';
      errorEl.style.display = 'block';
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload';
    }
  };

  document.body.appendChild(modal);
}

function showMemoryLightbox(memories, startIndex, project) {
  let current = startIndex;

  const lightbox = document.createElement('div');
  lightbox.className = 'memory-lightbox';

  const render = () => {
    const m = memories[current];
    lightbox.innerHTML = `
      <div class="lightbox-inner">
        <button class="lightbox-close">✕</button>
        <button class="lightbox-nav prev" ${current === 0 ? 'disabled' : ''}>‹</button>
        <div class="lightbox-media">
          ${m.type === 'video'
        ? `<video src="${m.url}" controls autoplay></video>`
        : `<img src="${m.url}" alt="${m.caption}" />`
      }
          ${m.caption ? `<p class="lightbox-caption">${m.caption}</p>` : ''}
          <p class="lightbox-counter">${current + 1} / ${memories.length}</p>
        </div>
        <button class="lightbox-nav next" ${current === memories.length - 1 ? 'disabled' : ''}>›</button>
      </div>
    `;

    lightbox.querySelector('.lightbox-close').onclick = () => lightbox.remove();
    lightbox.querySelector('.prev').onclick = () => { if (current > 0) { current--; render(); } };
    lightbox.querySelector('.next').onclick = () => { if (current < memories.length - 1) { current++; render(); } };
    lightbox.onclick = (e) => { if (e.target === lightbox) lightbox.remove(); };
  };

  render();
  document.body.appendChild(lightbox);
}

function showRemoveConfirm(friendId, friendName, panel) {
  const confirm = document.createElement('div');
  confirm.className = 'auth-modal';
  confirm.innerHTML = `
    <div class="auth-box" style="text-align:center; gap:16px">
      <h3>Remove Friend</h3>
      <p style="color:#aaa">Are you sure you want to remove <strong style="color:#fff">${friendName}</strong> as a friend?</p>
      <p class="auth-error" style="display:none; color:red"></p>
      <div style="display:flex; gap:8px">
        <button id="confirm-remove" style="flex:1; padding:10px; border-radius:8px; border:none; background:rgba(255,80,80,0.8); color:#fff; font-weight:bold; cursor:pointer">
          Remove
        </button>
        <button id="cancel-remove" style="flex:1; padding:10px; border-radius:8px; border:none; background:rgba(255,255,255,0.1); color:#fff; font-weight:bold; cursor:pointer">
          Cancel
        </button>
      </div>
    </div>
  `;

  confirm.querySelector('#cancel-remove').onclick = () => confirm.remove();
  confirm.addEventListener('click', (e) => { if (e.target === confirm) confirm.remove(); });

  confirm.querySelector('#confirm-remove').onclick = async () => {
    const btn = confirm.querySelector('#confirm-remove');
    const errorEl = confirm.querySelector('.auth-error');
    btn.disabled = true;
    btn.textContent = 'Removing...';

    try {
      const res = await fetch(`${API}/friends/remove/${friendId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${Auth.getToken()}` }
      });
      const data = await res.json();

      if (data.error) {
        errorEl.textContent = data.error;
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Remove';
        return;
      }

      confirm.remove();
      // Find and remove the row by button data-id instead of row data-id
      const removeBtn = panel.querySelector(`.friend-remove-btn[data-id="${friendId}"]`);
      removeBtn?.closest('.friend-row')?.remove();

      const list = panel.querySelector('#friend-list');
      if (!list.querySelector('.friend-row')) {
        list.innerHTML = '<p class="friends-empty">No friends yet</p>';
      }
    } catch (e) {
      errorEl.textContent = 'Failed to remove. Try again.';
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Remove';
    }
  };

  document.body.appendChild(confirm);
}