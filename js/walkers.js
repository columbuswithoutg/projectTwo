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
  const WALKER_SIZE = isMobile ? 18 : 24;           // px diameter
  const SPEED = isMobile ? 30 : 40;                 // px per second
  const PAUSE_MIN = 800;              // ms pause at node
  const PAUSE_MAX = 2500;
  const ORBIT_RADIUS = isMobile ? 12 : 20;          // how far walkers wander from node center
  const ENCOUNTER_SEP = isMobile ? 20 : 35;         // px separation before dialogue

  const ENCOUNTER_COOLDOWN = 30000;    // ms before same pair can chat again
  const ENCOUNTER_CHECK_INTERVAL = 500; // ms between encounter checks
  const LINE_DURATION = isMobile ? 2000 : 2500;     // ms per dialogue line

  let activeWalkers = [];              // { id, charId, charImg, charName, el, currentNode, targetNode, progress, paused, pauseEnd, pathX1, pathY1, pathX2, pathY2, inEncounter }
  let animFrameId = null;
  let lastTime = 0;
  let lastEncounterCheck = 0;
  let encounterCooldowns = new Map();  // "id1|id2" -> timestamp
  let activeBubbles = [];              // { el, owner }
  let encounterQueue = [];             // { w1, w2 }
  let encounterRunning = false;
  let encounterTimers = [];            // setTimeout IDs for active dialogue, cleared on destroy
  let deployTime = 0;                  // timestamp of last deploy, used for grace period
  const DEPLOY_GRACE = 5000;           // ms — no encounters right after deploy
  let overrideSelections = null;       // when set, deploy uses these instead of localStorage

  /* ---- persistence ---- */
  // Storage format: [{ id: "thor", stage: 1 }, { id: "cap", stage: 0 }, ...]
  // Backward compat: plain string "thor" → { id: "thor", stage: -1 } (-1 = highest unlocked)

  function normalizeEntry(entry) {
    if (typeof entry === 'string') return { id: entry, stage: -1 };
    if (entry && typeof entry.id === 'string') return { id: entry.id, stage: entry.stage ?? -1 };
    return null;
  }

  function loadSelections() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return raw.map(normalizeEntry).filter(Boolean);
    } catch { return []; }
  }

  function saveSelections(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    // Persist to server if logged in — store as JSON-serializable array
    if (Auth.isLoggedIn()) {
      fetch(`${API}/progress/walkers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Auth.getToken()}`
        },
        body: JSON.stringify({ walkers: entries })
      }).catch(() => {});
    }
  }

  async function loadFromServer() {
    if (!Auth.isLoggedIn()) return;
    try {
      const res = await fetch(`${API}/progress/walkers`, {
        headers: { Authorization: `Bearer ${Auth.getToken()}` }
      });
      const data = await res.json();
      if (Array.isArray(data.walkers) && data.walkers.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data.walkers));
      }
    } catch { /* offline — use localStorage */ }
  }

  // Resolve which image to use for a walker entry
  function resolveWalkerImage(entry, char) {
    const stages = getCharStages(char, state);
    if (entry.stage === -1 || entry.stage >= stages.length) {
      return stages[stages.length - 1].image; // highest unlocked
    }
    return stages[Math.max(0, entry.stage)].image;
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

  /* ---- encounters & speech bubbles ---- */

  function centerBetweenWalkers(w1, w2) {
    // Center the viewport on the midpoint between two walkers
    const pos1 = getNodeCenter(w1.currentNode);
    const pos2 = getNodeCenter(w2.currentNode);
    if (!pos1 || !pos2) return;

    const midX = (pos1.x + pos2.x) / 2;
    const midY = (pos1.y + pos2.y) / 2;

    const wrapper = renderer.container;
    const wrapperRect = wrapper.getBoundingClientRect();
    const containerRect = renderer.mapContainer.getBoundingClientRect();

    const scrollLeft = wrapper.scrollLeft + (containerRect.left - wrapperRect.left) + midX - wrapperRect.width / 2;
    const scrollTop = wrapper.scrollTop + (containerRect.top - wrapperRect.top) + midY - wrapperRect.height / 2;

    wrapper.scrollTo({
      left: Math.max(0, scrollLeft),
      top: Math.max(0, scrollTop),
      behavior: 'smooth'
    });
  }

  function positionBubbleAboveWalker(bubble, w) {
    if (!w.el) return;
    const wx = parseFloat(w.el.style.left) + WALKER_SIZE / 2;
    const wy = parseFloat(w.el.style.top);
    bubble.style.left = wx + 'px';
    bubble.style.top = (wy - 8) + 'px';
  }

  function createSpeechBubble(w, text) {
    const bubble = document.createElement('div');
    bubble.className = 'walker-speech-bubble';
    bubble.textContent = text;
    bubble.style.position = 'absolute';
    bubble.style.zIndex = '60';
    renderer.mapContainer.appendChild(bubble);

    positionBubbleAboveWalker(bubble, w);

    return bubble;
  }

  function clearBubblesFor(charId1, charId2) {
    activeBubbles = activeBubbles.filter(b => {
      if (b.owner === charId1 || b.owner === charId2) {
        b.el.remove();
        return false;
      }
      return true;
    });
  }

  function runNextEncounter() {
    if (encounterQueue.length === 0) {
      encounterRunning = false;
      return;
    }

    encounterRunning = true;
    const { w1, w2 } = encounterQueue.shift();

    // Verify both walkers are still active
    if (!activeWalkers.includes(w1) || !activeWalkers.includes(w2)) {
      runNextEncounter();
      return;
    }

    const charMap = new Map(characters.map(c => [c.id, c]));
    const charA = charMap.get(w1.charId);
    const charB = charMap.get(w2.charId);
    if (!charA || !charB) { runNextEncounter(); return; }

    const dialogue = WALKER_DIALOGUES.getDialogue(charA, charB, state);
    if (!dialogue || dialogue.length === 0) { runNextEncounter(); return; }

    // Mark both walkers as in encounter
    w1.inEncounter = true;
    w2.inEncounter = true;

    // Set cooldown for this pair
    const key = WALKER_DIALOGUES.getKey(w1.charId, w2.charId);
    encounterCooldowns.set(key, performance.now() + ENCOUNTER_COOLDOWN);

    // Center the map between the two walkers
    centerBetweenWalkers(w1, w2);

    // --- Separate walkers so they stand side by side ---
    const nodeCenter = getNodeCenter(w1.currentNode);
    if (nodeCenter) {
      // Smoothly slide them apart using CSS transition
      w1.el.style.transition = 'left 0.4s ease, top 0.4s ease';
      w2.el.style.transition = 'left 0.4s ease, top 0.4s ease';

      const leftX = nodeCenter.x - ENCOUNTER_SEP;
      const rightX = nodeCenter.x + ENCOUNTER_SEP;
      const y = nodeCenter.y;

      w1.el.style.left = (leftX - WALKER_SIZE / 2) + 'px';
      w1.el.style.top = (y - WALKER_SIZE / 2) + 'px';
      w2.el.style.left = (rightX - WALKER_SIZE / 2) + 'px';
      w2.el.style.top = (y - WALKER_SIZE / 2) + 'px';

      // Update path coords so bubble tracking works
      w1.pathX1 = leftX; w1.pathY1 = y; w1.pathX2 = leftX; w1.pathY2 = y; w1.progress = 1;
      w2.pathX1 = rightX; w2.pathY1 = y; w2.pathX2 = rightX; w2.pathY2 = y; w2.progress = 1;

      // Remove transition after animation completes so normal walking isn't affected
      setTimeout(() => {
        if (w1.el) w1.el.style.transition = 'none';
        if (w2.el) w2.el.style.transition = 'none';
      }, 450);
    }

    const sepDelay = 500;       // wait for separation animation
    const scrollDelay = 600;    // let smooth scroll finish
    const startDelay = Math.max(sepDelay, scrollDelay) + 300;
    const totalDuration = startDelay + dialogue.length * LINE_DURATION + 500;

    // Extend their pause for the full dialogue duration
    const holdUntil = performance.now() + totalDuration + 1000;
    w1.pauseEnd = holdUntil;
    w2.pauseEnd = holdUntil;

    dialogue.forEach((line, i) => {
      encounterTimers.push(setTimeout(() => {
        clearBubblesFor(w1.charId, w2.charId);

        // Match speaker to the correct walker by charId
        const walker = activeWalkers.find(w => w.charId === line.speaker) ||
                       (line.speaker === w1.charId ? w1 : w2);
        const bubble = createSpeechBubble(walker, line.text);
        activeBubbles.push({ el: bubble, owner: line.speaker, walker });
      }, startDelay + i * LINE_DURATION));
    });

    // Clean up after dialogue ends, then run next queued encounter
    encounterTimers.push(setTimeout(() => {
      clearBubblesFor(w1.charId, w2.charId);
      w1.inEncounter = false;
      w2.inEncounter = false;
      w1.paused = true;
      w1.pauseEnd = performance.now() + randBetween(300, 800);
      w2.paused = true;
      w2.pauseEnd = performance.now() + randBetween(300, 800);

      // Brief pause before next queued encounter
      encounterTimers.push(setTimeout(() => runNextEncounter(), 800));
    }, totalDuration));
  }

  function queueEncounter(w1, w2) {
    // Don't queue duplicates
    const isDuplicate = encounterQueue.some(e =>
      (e.w1 === w1 && e.w2 === w2) || (e.w1 === w2 && e.w2 === w1)
    );
    if (isDuplicate) return;

    encounterQueue.push({ w1, w2 });

    // If nothing is running, start immediately
    if (!encounterRunning) {
      runNextEncounter();
    }
  }

  function checkEncounters(now, graph) {
    if (now - lastEncounterCheck < ENCOUNTER_CHECK_INTERVAL) return;
    lastEncounterCheck = now;

    // Don't trigger encounters right after deploy
    if (now - deployTime < DEPLOY_GRACE) return;

    // Group walkers by current node — must be paused, arrived, and have walked at least once
    const atNode = new Map();
    activeWalkers.forEach(w => {
      if (!w.paused || w.inEncounter) return;
      if (w.progress < 1) return;          // still mid-walk
      if (!w.previousNode) return;         // hasn't moved yet (just spawned)
      const list = atNode.get(w.currentNode) || [];
      list.push(w);
      atNode.set(w.currentNode, list);
    });

    // Check each node for pairs
    atNode.forEach((walkers) => {
      if (walkers.length < 2) return;
      for (let i = 0; i < walkers.length - 1; i++) {
        for (let j = i + 1; j < walkers.length; j++) {
          const w1 = walkers[i];
          const w2 = walkers[j];

          const key = WALKER_DIALOGUES.getKey(w1.charId, w2.charId);
          const cooldownEnd = encounterCooldowns.get(key) || 0;
          if (now < cooldownEnd) continue;

          // Hold both walkers while queued/playing
          const holdTime = 15000;
          w1.pauseEnd = Math.max(w1.pauseEnd, now + holdTime);
          w2.pauseEnd = Math.max(w2.pauseEnd, now + holdTime);

          queueEncounter(w1, w2);
        }
      }
    });
  }

  /* ---- orbital offset ---- */

  // Give each walker a random offset around the node center so they don't stack
  function randomOrbitOffset() {
    const angle = Math.random() * Math.PI * 2;
    const r = ORBIT_RADIUS * (0.4 + Math.random() * 0.6);
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
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

    // Start from current visual position (includes orbit offset)
    const rawX = parseFloat(w.el.style.left);
    const rawY = parseFloat(w.el.style.top);
    const curX = isNaN(rawX) ? from.x : rawX + WALKER_SIZE / 2;
    const curY = isNaN(rawY) ? from.y : rawY + WALKER_SIZE / 2;

    // Destination gets a new random orbit offset
    const destOffset = randomOrbitOffset();

    w.previousNode = w.currentNode;
    w.targetNode = target;
    w.pathX1 = curX;
    w.pathY1 = curY;
    w.pathX2 = to.x + destOffset.x;
    w.pathY2 = to.y + destOffset.y;
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

    checkEncounters(now, graph);

    activeWalkers.forEach(w => {
      if (w.inEncounter) return;  // frozen during dialogue

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

    // Keep speech bubbles positioned above their walkers
    activeBubbles.forEach(b => {
      if (b.walker) positionBubbleAboveWalker(b.el, b.walker);
    });

    animFrameId = requestAnimationFrame(tick);
  }

  /* ---- public API ---- */

  function getSelectedEntries() {
    const raw = overrideSelections !== null
      ? overrideSelections.map(normalizeEntry).filter(Boolean)
      : loadSelections();
    const maxSlots = getMaxSlots();
    const unlocked = new Set(getUnlockedCharacters().map(c => c.id));
    return raw.filter(e => unlocked.has(e.id)).slice(0, maxSlots);
  }

  // Backward-compat: return just the IDs for external consumers
  function getSelectedIds() {
    return getSelectedEntries().map(e => e.id);
  }

  function deploy() {
    // Remove old walkers
    destroy();

    const entries = getSelectedEntries();
    if (entries.length === 0) return;

    const charMap = new Map(characters.map(c => [c.id, c]));
    const visibleIds = getVisibleNodes().map(p => p.id);
    if (visibleIds.length === 0) return;

    const graph = buildGraph();
    const container = renderer.mapContainer;

    entries.forEach((entry, i) => {
      const char = charMap.get(entry.id);
      if (!char) return;

      const imgFile = resolveWalkerImage(entry, char);
      const img = `assets/characters/${imgFile}`;
      const el = createWalkerElement(img);
      container.appendChild(el);

      // Start at the character's debut node if visible, else random visible node
      let startNode = visibleIds.includes(char.debut) ? char.debut : pickRandom(visibleIds);

      const w = {
        id: entry.id,
        charId: entry.id,
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
        duration: 0,
        inEncounter: false
      };

      // Position at start node with orbit offset
      const pos = getNodeCenter(startNode);
      if (pos) {
        const off = randomOrbitOffset();
        w.pathX1 = pos.x + off.x; w.pathY1 = pos.y + off.y;
        w.pathX2 = pos.x + off.x; w.pathY2 = pos.y + off.y;
        positionWalker(w);
      }

      activeWalkers.push(w);
    });

    lastTime = 0;
    deployTime = performance.now();
    animFrameId = requestAnimationFrame(tick);
  }

  function destroy() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = null;
    encounterTimers.forEach(t => clearTimeout(t));
    encounterTimers = [];
    activeWalkers.forEach(w => w.el?.remove());
    activeWalkers = [];
    activeBubbles.forEach(b => b.el.remove());
    activeBubbles = [];
    encounterQueue = [];
    encounterRunning = false;
    encounterCooldowns.clear();
  }

  function toggleCharacter(charId, stageIndex = -1) {
    const current = getSelectedEntries();
    const maxSlots = getMaxSlots();

    const idx = current.findIndex(e => e.id === charId);
    if (idx !== -1) {
      // Remove
      current.splice(idx, 1);
      saveSelections(current);
    } else {
      if (current.length >= maxSlots) return false; // no slots
      current.push({ id: charId, stage: stageIndex });
      saveSelections(current);
    }
    deploy();
    return true;
  }

  function setCharacterStage(charId, stageIndex) {
    const current = getSelectedEntries();
    const entry = current.find(e => e.id === charId);
    if (entry) {
      entry.stage = stageIndex;
      saveSelections(current);
      deploy();
    }
  }

  function setSelections(entries) {
    const maxSlots = getMaxSlots();
    const unlocked = new Set(getUnlockedCharacters().map(c => c.id));
    const valid = entries.map(normalizeEntry).filter(e => e && unlocked.has(e.id)).slice(0, maxSlots);
    saveSelections(valid);
    deploy();
  }

  /* ---- Walker Picker UI ---- */

  function showWalkerPicker() {
    // Remove existing
    document.getElementById('walker-picker-overlay')?.remove();

    const maxSlots = getMaxSlots();
    const selectedEntries = getSelectedEntries();
    const selectedIds = new Set(selectedEntries.map(e => e.id));
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
          <p class="walker-slots-info">${selectedIds.size} / ${maxSlots} slots used</p>
          <button id="walker-picker-close">✕</button>
        </div>
        <div id="walker-picker-grid"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    const grid = overlay.querySelector('#walker-picker-grid');

    function updateSlotCount() {
      const count = getSelectedEntries().length;
      overlay.querySelector('.walker-slots-info').textContent =
        `${count} / ${getMaxSlots()} slots used`;
    }

    unlocked.forEach(char => {
      const isSelected = selectedIds.has(char.id);
      const stages = getCharStages(char, state);
      const currentEntry = selectedEntries.find(e => e.id === char.id);
      const currentStageIdx = currentEntry ? currentEntry.stage : -1;
      // Resolve display image: selected stage or highest unlocked
      const displayImg = currentEntry
        ? resolveWalkerImage(currentEntry, char)
        : stages[stages.length - 1].image;

      const card = document.createElement('div');
      card.className = 'walker-card' + (isSelected ? ' selected' : '');
      card.dataset.charId = char.id;

      card.innerHTML = `
        <div class="walker-card-img">
          <img src="assets/characters/${displayImg}" alt="${char.name}" />
          <span class="walker-check">✔</span>
        </div>
        <span class="walker-card-name">${char.name}</span>
      `;

      // Stage selector row (only if multiple stages unlocked)
      if (stages.length > 1) {
        const stageRow = document.createElement('div');
        stageRow.className = 'walker-stage-row';
        stages.forEach((s, si) => {
          const dot = document.createElement('img');
          dot.src = `assets/characters/${s.image}`;
          dot.className = 'walker-stage-dot';
          dot.title = s.label;
          // Highlight active stage
          const activeIdx = currentStageIdx === -1 ? stages.length - 1 : currentStageIdx;
          if (si === activeIdx) dot.classList.add('active');

          dot.addEventListener('click', (e) => {
            e.stopPropagation();
            // If not selected yet, select it first
            if (!getSelectedIds().includes(char.id)) {
              const entries = getSelectedEntries();
              if (entries.length >= getMaxSlots()) {
                const info = overlay.querySelector('.walker-slots-info');
                info.style.color = '#E23636';
                setTimeout(() => info.style.color = '', 600);
                return;
              }
              const newEntries = [...entries, { id: char.id, stage: si }];
              saveSelections(newEntries);
              deploy();
              card.classList.add('selected');
            } else {
              setCharacterStage(char.id, si);
            }
            // Update main image on card
            card.querySelector('.walker-card-img img').src = `assets/characters/${stages[si].image}`;
            // Update active dot
            stageRow.querySelectorAll('.walker-stage-dot').forEach((d, di) => {
              d.classList.toggle('active', di === si);
            });
            updateSlotCount();
          });
          stageRow.appendChild(dot);
        });
        card.appendChild(stageRow);
      }

      card.addEventListener('click', (e) => {
        // Don't toggle if clicking a stage dot
        if (e.target.classList.contains('walker-stage-dot')) return;

        const currentSelected = new Set(getSelectedIds());
        const currentMax = getMaxSlots();

        if (currentSelected.has(char.id)) {
          toggleCharacter(char.id);
          card.classList.remove('selected');
        } else {
          if (currentSelected.size >= currentMax) {
            const info = overlay.querySelector('.walker-slots-info');
            info.style.color = '#E23636';
            setTimeout(() => info.style.color = '', 600);
            return;
          }
          toggleCharacter(char.id);
          card.classList.add('selected');
        }

        updateSlotCount();
      });

      grid.appendChild(card);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    overlay.querySelector('#walker-picker-close').addEventListener('click', () => overlay.remove());
  }

  /* ---- friend view support ---- */

  function deployWithSelections(ids) {
    overrideSelections = Array.isArray(ids) ? ids : [];
    deploy();
  }

  function restoreSelections() {
    overrideSelections = null;
    deploy();
  }

  /* ---- re-deploy on state change ---- */
  async function init() {
    await loadFromServer();
    state.subscribe(() => {
      // Small delay so nodes render first
      setTimeout(() => deploy(), 300);
    });
  }

  return { init, deploy, destroy, showWalkerPicker, getSelectedIds, getSelectedEntries, getMaxSlots, getUnlockedCharacters, toggleCharacter, setCharacterStage, setSelections, deployWithSelections, restoreSelections };
})();
