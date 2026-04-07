/************************************************
 * WALKERS — Chibi characters walking across the map
 *
 * - One walker per watched node (slots = watched count)
 * - User picks which unlocked characters to deploy
 * - Walkers roam node-to-node via random paths
 * - Selections saved in localStorage
 ************************************************/

const Walkers = (() => {
  const STORAGE_KEY = 'mcu_walkers';
  const WALKER_SIZE = 24;             // px diameter
  const SPEED = 40;                   // px per second
  const PAUSE_MIN = 800;              // ms pause at node
  const PAUSE_MAX = 2500;

  let activeWalkers = [];              // { id, charId, charImg, charName, el, currentNode, targetNode, progress, paused, pauseEnd, pathX1, pathY1, pathX2, pathY2 }
  let animFrameId = null;
  let lastTime = 0;

  /* ---- persistence ---- */

  function loadSelections() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch { return []; }
  }

  function saveSelections(ids) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }

  /* ---- helpers ---- */

  function getMaxSlots() {
    return state.data.size;  // one per watched node
  }

  function getUnlockedCharacters() {
    // Characters whose debut node has been watched
    if (typeof characters === 'undefined') return [];
    return characters.filter(c => state.isWatched(c.debut));
  }

  function getVisibleNodes() {
    return projects.filter(isVisible);
  }

  // Build adjacency from visible arrows (prerequisites + unlocks)
  function buildGraph() {
    const graph = new Map();
    const visible = new Set(getVisibleNodes().map(p => p.id));

    projects.forEach(p => {
      if (!visible.has(p.id)) return;
      if (!graph.has(p.id)) graph.set(p.id, []);

      // unlocks = children via prerequisites
      (p.unlocks || []).forEach(childId => {
        if (!visible.has(childId)) return;
        if (!graph.has(childId)) graph.set(childId, []);
        graph.get(p.id).push(childId);
        graph.get(childId).push(p.id);   // bidirectional
      });
    });

    return graph;
  }

  function getNodeCenter(nodeId) {
    const el = renderer.nodeElements.get(nodeId);
    if (!el) return null;
    const containerRect = renderer.mapContainer.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - containerRect.left,
      y: r.top + r.height / 2 - containerRect.top
    };
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function randBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  /* ---- walker DOM element ---- */

  function createWalkerElement(charImg) {
    const wrap = document.createElement('div');
    wrap.className = 'map-walker';
    wrap.style.width = WALKER_SIZE + 'px';
    wrap.style.height = WALKER_SIZE + 'px';
    wrap.style.position = 'absolute';
    wrap.style.zIndex = '50';
    wrap.style.pointerEvents = 'none';
    wrap.style.transition = 'none';

    const img = document.createElement('img');
    img.src = charImg;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.borderRadius = '50%';
    img.style.objectFit = 'cover';
    img.style.border = '1.5px solid rgba(201,162,39,0.9)';
    img.style.boxShadow = '0 0 6px rgba(201,162,39,0.4)';
    img.style.background = 'rgba(7,8,15,0.85)';
    wrap.appendChild(img);

    return wrap;
  }

  /* ---- animation loop ---- */

  function positionWalker(w) {
    if (!w.el) return;
    const x = w.pathX1 + (w.pathX2 - w.pathX1) * w.progress;
    const y = w.pathY1 + (w.pathY2 - w.pathY1) * w.progress;
    w.el.style.left = (x - WALKER_SIZE / 2) + 'px';
    w.el.style.top = (y - WALKER_SIZE / 2) + 'px';
  }

  function pickNextTarget(w, graph) {
    const neighbors = graph.get(w.currentNode) || [];
    if (neighbors.length === 0) return w.currentNode;
    // Prefer not going back to previous node (unless it's the only option)
    const filtered = neighbors.filter(n => n !== w.previousNode);
    return pickRandom(filtered.length ? filtered : neighbors);
  }

  function startWalkerPath(w, graph) {
    const target = pickNextTarget(w, graph);
    const from = getNodeCenter(w.currentNode);
    const to = getNodeCenter(target);

    if (!from || !to) {
      w.paused = true;
      w.pauseEnd = performance.now() + 1000;
      return;
    }

    w.previousNode = w.currentNode;
    w.targetNode = target;
    w.pathX1 = from.x;
    w.pathY1 = from.y;
    w.pathX2 = to.x;
    w.pathY2 = to.y;
    w.progress = 0;
    w.paused = false;

    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    w.duration = (dist / SPEED) * 1000;  // ms
  }

  function tick(now) {
    if (!lastTime) lastTime = now;
    const dt = now - lastTime;
    lastTime = now;

    const graph = buildGraph();

    activeWalkers.forEach(w => {
      if (w.paused) {
        if (now >= w.pauseEnd) {
          startWalkerPath(w, graph);
        }
        return;
      }

      if (w.duration <= 0) {
        w.paused = true;
        w.pauseEnd = now + randBetween(PAUSE_MIN, PAUSE_MAX);
        return;
      }

      w.progress += dt / w.duration;

      if (w.progress >= 1) {
        w.progress = 1;
        positionWalker(w);
        w.currentNode = w.targetNode;
        w.paused = true;
        w.pauseEnd = now + randBetween(PAUSE_MIN, PAUSE_MAX);
        return;
      }

      positionWalker(w);
    });

    animFrameId = requestAnimationFrame(tick);
  }

  /* ---- public API ---- */

  function getSelectedIds() {
    const saved = loadSelections();
    const maxSlots = getMaxSlots();
    const unlocked = new Set(getUnlockedCharacters().map(c => c.id));
    // Filter out any that are no longer unlocked, and cap at max slots
    return saved.filter(id => unlocked.has(id)).slice(0, maxSlots);
  }

  function deploy() {
    // Remove old walkers
    destroy();

    const selectedIds = getSelectedIds();
    if (selectedIds.length === 0) return;

    const charMap = new Map(characters.map(c => [c.id, c]));
    const visibleIds = getVisibleNodes().map(p => p.id);
    if (visibleIds.length === 0) return;

    const graph = buildGraph();
    const container = renderer.mapContainer;

    selectedIds.forEach((charId, i) => {
      const char = charMap.get(charId);
      if (!char) return;

      const img = `assets/characters/${char.image}`;
      const el = createWalkerElement(img);
      container.appendChild(el);

      // Start at the character's debut node if visible, else random visible node
      let startNode = visibleIds.includes(char.debut) ? char.debut : pickRandom(visibleIds);

      const w = {
        id: charId,
        charId,
        charImg: img,
        charName: char.name,
        el,
        currentNode: startNode,
        targetNode: startNode,
        previousNode: null,
        progress: 1,
        paused: true,
        pauseEnd: performance.now() + randBetween(200, 1500),
        pathX1: 0, pathY1: 0, pathX2: 0, pathY2: 0,
        duration: 0
      };

      // Position at start node
      const pos = getNodeCenter(startNode);
      if (pos) {
        w.pathX1 = pos.x; w.pathY1 = pos.y;
        w.pathX2 = pos.x; w.pathY2 = pos.y;
        positionWalker(w);
      }

      activeWalkers.push(w);
    });

    lastTime = 0;
    animFrameId = requestAnimationFrame(tick);
  }

  function destroy() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = null;
    activeWalkers.forEach(w => w.el?.remove());
    activeWalkers = [];
  }

  function toggleCharacter(charId) {
    const current = getSelectedIds();
    const maxSlots = getMaxSlots();

    if (current.includes(charId)) {
      // Remove
      const updated = current.filter(id => id !== charId);
      saveSelections(updated);
    } else {
      if (current.length >= maxSlots) return false; // no slots
      current.push(charId);
      saveSelections(current);
    }
    deploy();
    return true;
  }

  function setSelections(ids) {
    const maxSlots = getMaxSlots();
    const unlocked = new Set(getUnlockedCharacters().map(c => c.id));
    const valid = ids.filter(id => unlocked.has(id)).slice(0, maxSlots);
    saveSelections(valid);
    deploy();
  }

  /* ---- Walker Picker UI ---- */

  function showWalkerPicker() {
    // Remove existing
    document.getElementById('walker-picker-overlay')?.remove();

    const maxSlots = getMaxSlots();
    const selected = new Set(getSelectedIds());
    const unlocked = getUnlockedCharacters();

    if (unlocked.length === 0) {
      alert('Watch some movies first to unlock character walkers!');
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'walker-picker-overlay';
    overlay.innerHTML = `
      <div id="walker-picker">
        <div class="walker-picker-header">
          <h2>Choose Your Walkers</h2>
          <p class="walker-slots-info">${selected.size} / ${maxSlots} slots used</p>
          <button id="walker-picker-close">✕</button>
        </div>
        <div id="walker-picker-grid"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    const grid = overlay.querySelector('#walker-picker-grid');

    unlocked.forEach(char => {
      const isSelected = selected.has(char.id);
      const card = document.createElement('div');
      card.className = 'walker-card' + (isSelected ? ' selected' : '');
      card.dataset.charId = char.id;

      card.innerHTML = `
        <div class="walker-card-img">
          <img src="assets/characters/${char.image}" alt="${char.name}" />
          <span class="walker-check">✔</span>
        </div>
        <span class="walker-card-name">${char.name}</span>
      `;

      card.addEventListener('click', () => {
        const currentSelected = new Set(getSelectedIds());
        const currentMax = getMaxSlots();

        if (currentSelected.has(char.id)) {
          toggleCharacter(char.id);
          card.classList.remove('selected');
        } else {
          if (currentSelected.size >= currentMax) {
            // Flash the slots info
            const info = overlay.querySelector('.walker-slots-info');
            info.style.color = '#E23636';
            setTimeout(() => info.style.color = '', 600);
            return;
          }
          toggleCharacter(char.id);
          card.classList.add('selected');
        }

        // Update slot count
        const newSelected = getSelectedIds();
        overlay.querySelector('.walker-slots-info').textContent =
          `${newSelected.length} / ${getMaxSlots()} slots used`;
      });

      grid.appendChild(card);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    overlay.querySelector('#walker-picker-close').addEventListener('click', () => overlay.remove());
  }

  /* ---- re-deploy on state change ---- */
  function init() {
    state.subscribe(() => {
      // Small delay so nodes render first
      setTimeout(() => deploy(), 300);
    });
  }

  return { init, deploy, destroy, showWalkerPicker, getSelectedIds, getMaxSlots, getUnlockedCharacters, toggleCharacter, setSelections };
})();
