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
  const WALKER_R = WALKER_SIZE / 2;                  // radius
  const SPEED = isMobile ? 30 : 40;                  // px per second
  const PAUSE_MIN = 800;              // ms pause at node
  const PAUSE_MAX = 2500;

  const ROAD_HALF_W = isMobile ? 9 : 13;            // half the visual road width
  const DAMPING = 0.998;                              // friction per frame
  const BOUNCE = 0.85;                                // energy kept after wall bounce
  const ENCOUNTER_DIST = WALKER_SIZE * 1.5;           // dialogue trigger distance
  const ENCOUNTER_COOLDOWN = 30000;
  const LINE_DURATION = isMobile ? 2000 : 2500;

  let activeWalkers = [];              // { id, charId, charImg, charName, el, currentNode, targetNode, vx, vy, _cx, _cy, currentEdge, paused, pauseEnd, inEncounter, _spawned }
  let animFrameId = null;
  let lastTime = 0;
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

  // Each stage starts at the node that unlocked it
  function getStageStartNode(char, stageIndex, visibleIds) {
    if (stageIndex <= 0) {
      return visibleIds.includes(char.debut) ? char.debut : pickRandom(visibleIds);
    }
    // Stage N corresponds to char.stages[N-1].after
    const stageData = char.stages?.[stageIndex - 1];
    if (stageData && visibleIds.includes(stageData.after)) {
      return stageData.after;
    }
    return visibleIds.includes(char.debut) ? char.debut : pickRandom(visibleIds);
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
    // Center the viewport on the actual walker positions
    if (w1._cx == null || w2._cx == null) return;

    const midX = (w1._cx + w2._cx) / 2;
    const midY = (w1._cy + w2._cy) / 2;

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
    if (!w.el || w._cx == null) return;
    bubble.style.left = w._cx + 'px';
    bubble.style.top = (w._cy - WALKER_SIZE / 2 - 8) + 'px';
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

    // Helper to release walkers and skip to next
    function releaseAndSkip() {
      w1.vx = 0; w1.vy = 0;
      w2.vx = 0; w2.vy = 0;
      w1.paused = true;
      w1.pauseEnd = performance.now() + randBetween(200, 500);
      w2.paused = true;
      w2.pauseEnd = performance.now() + randBetween(200, 500);
      runNextEncounter();
    }

    // Verify they're still close enough — skip stale encounters
    if (w1._cx != null && w2._cx != null) {
      const dist = Math.hypot(w2._cx - w1._cx, w2._cy - w1._cy);
      if (dist > ENCOUNTER_DIST * 3) {
        releaseAndSkip();
        return;
      }
    }

    const charMap = new Map(characters.map(c => [c.id, c]));
    const charA = charMap.get(w1.charId);
    const charB = charMap.get(w2.charId);
    if (!charA || !charB) { releaseAndSkip(); return; }

    const dialogue = WALKER_DIALOGUES.getDialogue(charA, charB, state);
    if (!dialogue || dialogue.length === 0) { releaseAndSkip(); return; }

    // Mark both walkers as in encounter
    w1.inEncounter = true;
    w2.inEncounter = true;

    // Set cooldown for this pair
    const key = WALKER_DIALOGUES.getKey(w1.charId, w2.charId);
    encounterCooldowns.set(key, performance.now() + ENCOUNTER_COOLDOWN);

    // Center the map between the two walkers
    centerBetweenWalkers(w1, w2);

    // Collision already keeps them apart — just let the scroll settle
    const scrollDelay = 600;
    const startDelay = scrollDelay + 300;
    const totalDuration = startDelay + dialogue.length * LINE_DURATION + 500;

    // Extend their pause for the full dialogue duration
    const holdUntil = performance.now() + totalDuration + 1000;
    w1.pauseEnd = holdUntil;
    w2.pauseEnd = holdUntil;

    dialogue.forEach((line, i) => {
      encounterTimers.push(setTimeout(() => {
        clearBubblesFor(w1.charId, w2.charId);

        // Use the specific encounter walkers, not a global search
        const walker = line.speaker === w1.charId ? w1 : w2;
        const bubble = createSpeechBubble(walker, line.text);
        activeBubbles.push({ el: bubble, owner: line.speaker, walker });
      }, startDelay + i * LINE_DURATION));
    });

    // Clean up after dialogue ends, then run next queued encounter
    encounterTimers.push(setTimeout(() => {
      clearBubblesFor(w1.charId, w2.charId);

      // Release walkers at current position, find nearest node
      [w1, w2].forEach(w => {
        w.vx = 0;
        w.vy = 0;
        w.currentEdge = null;

        // Find nearest node
        if (w._cx != null) {
          let bestNode = w.currentNode;
          let bestDist = Infinity;
          getVisibleNodes().forEach(p => {
            const pos = getNodeCenter(p.id);
            if (!pos) return;
            const d = Math.hypot(pos.x - w._cx, pos.y - w._cy);
            if (d < bestDist) { bestDist = d; bestNode = p.id; }
          });
          w.currentNode = bestNode;
        }
        w.inEncounter = false;
        w.paused = true;
        w.pauseEnd = performance.now() + randBetween(300, 800);
        applyWalkerPosition(w);
      });

      // Cooldown before next encounter can play
      encounterTimers.push(setTimeout(() => runNextEncounter(), 5000));
    }, totalDuration));
  }

  function queueEncounter(w1, w2) {
    // Max 2 queued encounters — don't let them pile up
    if (encounterQueue.length >= 2) return;

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

  /* ---- physics helpers ---- */

  // Apply computed position to DOM
  function applyWalkerPosition(w) {
    if (!w.el) return;
    w.el.style.left = (w._cx - WALKER_R) + 'px';
    w.el.style.top = (w._cy - WALKER_R) + 'px';
  }

  function pickNextTarget(w, graph) {
    const neighbors = graph.get(w.currentNode) || [];
    if (neighbors.length === 0) return w.currentNode;
    const filtered = neighbors.filter(n => n !== w.previousNode);
    return pickRandom(filtered.length ? filtered : neighbors);
  }

  // Build road segment geometry for each graph edge
  function buildRoadSegments(graph) {
    const segments = new Map();
    const seen = new Set();
    graph.forEach((neighbors, nodeId) => {
      neighbors.forEach(neighborId => {
        const key = [nodeId, neighborId].sort().join('|');
        if (seen.has(key)) return;
        seen.add(key);

        const from = getNodeCenter(nodeId);
        const to = getNodeCenter(neighborId);
        if (!from || !to) return;

        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;

        // Road starts/ends at node edge — compute intersection along road direction
        const fromEl = renderer.nodeElements.get(nodeId);
        const toEl = renderer.nodeElements.get(neighborId);
        // Use the dimension along the road direction (not max)
        const absUx = Math.abs(ux);
        const absUy = Math.abs(uy);
        const fromOff = fromEl
          ? (fromEl.offsetWidth / 2) * absUx + (fromEl.offsetHeight / 2) * absUy + 6
          : 60;
        const toOff = toEl
          ? (toEl.offsetWidth / 2) * absUx + (toEl.offsetHeight / 2) * absUy + 8
          : 60;

        segments.set(key, {
          fromId: nodeId, toId: neighborId,
          x1: from.x + ux * fromOff, y1: from.y + uy * fromOff,
          x2: to.x - ux * toOff, y2: to.y - uy * toOff,
          ux, uy,
          px: -uy, py: ux,  // perpendicular
          length: Math.max(0, len - fromOff - toOff),
          halfW: ROAD_HALF_W
        });
      });
    });
    return segments;
  }

  // Build node bounding rectangles
  function buildNodeRects() {
    const rects = [];
    const containerRect = renderer.mapContainer.getBoundingClientRect();
    getVisibleNodes().forEach(p => {
      const el = renderer.nodeElements.get(p.id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      rects.push({
        id: p.id,
        left: r.left - containerRect.left,
        top: r.top - containerRect.top,
        right: r.right - containerRect.left,
        bottom: r.bottom - containerRect.top
      });
    });
    return rects;
  }

  // Bounce walker off a rectangle (circle vs AABB)
  function bounceOffRect(w, rect) {
    const closestX = Math.max(rect.left, Math.min(w._cx, rect.right));
    const closestY = Math.max(rect.top, Math.min(w._cy, rect.bottom));
    const dx = w._cx - closestX;
    const dy = w._cy - closestY;
    const dist = Math.hypot(dx, dy);

    if (dist < WALKER_R && dist > 0.01) {
      const nx = dx / dist;
      const ny = dy / dist;
      // Push out
      w._cx = closestX + nx * WALKER_R;
      w._cy = closestY + ny * WALKER_R;
      // Reflect velocity
      const vDotN = w.vx * nx + w.vy * ny;
      if (vDotN < 0) {
        w.vx -= 2 * vDotN * nx * BOUNCE;
        w.vy -= 2 * vDotN * ny * BOUNCE;
      }
    }
  }

  // Launch walker from a node onto a road with velocity
  function launchWalker(w, graph, roadSegments) {
    const target = pickNextTarget(w, graph);
    if (target === w.currentNode) return;

    const edgeKey = [w.currentNode, target].sort().join('|');
    const road = roadSegments.get(edgeKey);
    if (!road) return;

    const isFrom = (road.fromId === w.currentNode);
    const dirX = isFrom ? road.ux : -road.ux;
    const dirY = isFrom ? road.uy : -road.uy;

    // Position at the road opening (not node center) so we're outside the node rect
    const startX = isFrom ? road.x1 : road.x2;
    const startY = isFrom ? road.y1 : road.y2;
    w._cx = startX;
    w._cy = startY;

    // Small random perpendicular drift for variety
    const drift = (Math.random() - 0.5) * 0.3;
    w.vx = (dirX + road.px * drift) * SPEED;
    w.vy = (dirY + road.py * drift) * SPEED;

    w.previousNode = w.currentNode;
    w.targetNode = target;
    w.currentEdge = edgeKey;
    w.paused = false;
  }

  /* ---- animation loop ---- */

  function tick(now) {
    if (!lastTime) lastTime = now;
    const dt = Math.min(now - lastTime, 50);  // cap dt to prevent huge jumps
    lastTime = now;

    const graph = buildGraph();
    // Cache geometry — rebuild every 2 seconds, not every frame
    if (!tick._geoTime || now - tick._geoTime > 2000) {
      tick._roads = buildRoadSegments(graph);
      tick._rects = buildNodeRects();
      tick._geoTime = now;
    }
    const roadSegments = tick._roads;
    const nodeRects = tick._rects;
    const dtSec = dt / 1000;

    // Pass 1: move walkers
    activeWalkers.forEach(w => {
      // Hidden walkers waiting to spawn
      if (!w._spawned) {
        if (now >= w.pauseEnd) {
          w._spawned = true;
          w.el.style.display = '';
          w.pauseEnd = now + randBetween(100, 500);
        }
        return;
      }

      if (w.inEncounter) return;

      if (w.paused) {
        if (now >= w.pauseEnd) {
          launchWalker(w, graph, roadSegments);
        }
        return;
      }

      // Velocity integration
      w._cx += w.vx * dtSec;
      w._cy += w.vy * dtSec;

      // Road edge bounce — keep within road corridor
      const road = roadSegments.get(w.currentEdge);
      if (road) {
        // Perpendicular distance from road centerline
        const relX = w._cx - road.x1;
        const relY = w._cy - road.y1;
        const perpDist = relX * road.px + relY * road.py;
        const maxPerp = road.halfW - WALKER_R;

        if (Math.abs(perpDist) > maxPerp) {
          const sign = perpDist > 0 ? 1 : -1;
          w._cx -= road.px * (perpDist - sign * maxPerp);
          w._cy -= road.py * (perpDist - sign * maxPerp);
          // Reflect perpendicular velocity component
          const vPerp = w.vx * road.px + w.vy * road.py;
          w.vx -= 2 * vPerp * road.px * BOUNCE;
          w.vy -= 2 * vPerp * road.py * BOUNCE;
        }

        // Check if walker reached the end of the road
        const alongDist = relX * road.ux + relY * road.uy;
        if (alongDist >= road.length || alongDist <= 0) {
          // Arrived at target node
          // Use actual exit direction, not original travel direction
          w.currentNode = alongDist >= road.length ? road.toId : road.fromId;

          // Check if node is occupied
          const nodeOccupied = activeWalkers.some(other =>
            other !== w && other._spawned && other.paused &&
            !other.inEncounter && other.currentNode === w.currentNode
          );

          if (nodeOccupied) {
            // Keep moving — pick new road
            launchWalker(w, graph, roadSegments);
          } else {
            w.vx = 0;
            w.vy = 0;
            w.paused = true;
            w.pauseEnd = now + randBetween(PAUSE_MIN, PAUSE_MAX);
            // Snap to node center
            const nc = getNodeCenter(w.currentNode);
            if (nc) { w._cx = nc.x; w._cy = nc.y; }
          }
        }
      }

      // Bounce off node rectangles — skip nodes on the walker's current road
      const curRoad = roadSegments.get(w.currentEdge);
      for (const rect of nodeRects) {
        if (curRoad && (rect.id === curRoad.fromId || rect.id === curRoad.toId)) continue;
        bounceOffRect(w, rect);
      }

      // Damping + speed enforcement
      w.vx *= DAMPING;
      w.vy *= DAMPING;
      const spd = Math.hypot(w.vx, w.vy);
      if (spd > SPEED * 1.5) {
        // Cap max speed
        w.vx = (w.vx / spd) * SPEED;
        w.vy = (w.vy / spd) * SPEED;
      } else if (spd < SPEED * 0.5 && spd > 0.01) {
        // Boost back up — walkers never slow to a crawl
        w.vx = (w.vx / spd) * SPEED;
        w.vy = (w.vy / spd) * SPEED;
      }
    });

    // Pass 2: walker-walker elastic collision + encounter detection
    const graceActive = (now - deployTime < DEPLOY_GRACE);
    for (let i = 0; i < activeWalkers.length; i++) {
      const a = activeWalkers[i];
      if (!a._spawned || a._cx == null) continue;
      for (let j = i + 1; j < activeWalkers.length; j++) {
        const b = activeWalkers[j];
        if (!b._spawned || b._cx == null) continue;

        const dx = b._cx - a._cx;
        const dy = b._cy - a._cy;
        const dist = Math.hypot(dx, dy);
        const minDist = WALKER_SIZE;

        if (dist < minDist && dist > 0.01) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;

          const aLocked = a.inEncounter;
          const bLocked = b.inEncounter;

          // Separate
          if (aLocked && bLocked) {
            // both locked
          } else if (aLocked) {
            b._cx += nx * overlap;
            b._cy += ny * overlap;
          } else if (bLocked) {
            a._cx -= nx * overlap;
            a._cy -= ny * overlap;
          } else {
            a._cx -= nx * overlap / 2;
            a._cy -= ny * overlap / 2;
            b._cx += nx * overlap / 2;
            b._cy += ny * overlap / 2;
          }

          // Elastic velocity exchange (equal mass)
          if (!aLocked && !bLocked && !a.paused && !b.paused) {
            const aVn = a.vx * nx + a.vy * ny;
            const bVn = b.vx * nx + b.vy * ny;
            a.vx += (bVn - aVn) * nx;
            a.vy += (bVn - aVn) * ny;
            b.vx += (aVn - bVn) * nx;
            b.vy += (aVn - bVn) * ny;
          } else if (!aLocked && bLocked) {
            const aVn = a.vx * nx + a.vy * ny;
            if (aVn > 0) { a.vx -= 2 * aVn * nx * BOUNCE; a.vy -= 2 * aVn * ny * BOUNCE; }
          } else if (aLocked && !bLocked) {
            const bVn = b.vx * nx + b.vy * ny;
            if (bVn < 0) { b.vx -= 2 * bVn * nx * BOUNCE; b.vy -= 2 * bVn * ny * BOUNCE; }
          }
        }

        // Encounter detection
        if (!graceActive && !encounterRunning && encounterQueue.length === 0 &&
            dist < ENCOUNTER_DIST &&
            !a.inEncounter && !b.inEncounter &&
            a.charId !== b.charId &&
            a.previousNode && b.previousNode) {
          const key = WALKER_DIALOGUES.getKey(a.charId, b.charId);
          const cooldownEnd = encounterCooldowns.get(key) || 0;
          if (now >= cooldownEnd) {
            const cMap = new Map(characters.map(c => [c.id, c]));
            const cA = cMap.get(a.charId);
            const cB = cMap.get(b.charId);
            const testDialogue = (cA && cB) ? WALKER_DIALOGUES.getDialogue(cA, cB, state) : null;
            if (testDialogue && testDialogue.length > 0) {
              a.vx = 0; a.vy = 0;
              b.vx = 0; b.vy = 0;
              a.paused = true; b.paused = true;
              a.pauseEnd = now + 15000; b.pauseEnd = now + 15000;
              queueEncounter(a, b);
            }
          }
        }
      }
    }

    // Pass 3: apply to DOM
    activeWalkers.forEach(w => {
      if (w._spawned && !w.inEncounter) applyWalkerPosition(w);
    });

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
    const charMap = new Map(characters.map(c => [c.id, c]));
    const unlocked = new Set(getUnlockedCharacters().map(c => c.id));
    return raw.filter(e => {
      if (!unlocked.has(e.id)) return false;
      const char = charMap.get(e.id);
      if (!char) return false;
      // Verify the specific stage is unlocked
      if (e.stage !== -1) {
        const stages = getCharStages(char, state);
        if (e.stage >= stages.length) return false;
      }
      return true;
    }).slice(0, maxSlots);
  }

  // Backward-compat: return just the IDs for external consumers
  function getSelectedIds() {
    return getSelectedEntries().map(e => e.id);
  }

  function deploy() {
    if (!renderer.mapContainer) return;  // view not mounted
    // Remove old walkers
    destroy();

    const entries = getSelectedEntries();
    if (entries.length === 0) return;

    const charMap = new Map(characters.map(c => [c.id, c]));
    const visibleIds = getVisibleNodes().map(p => p.id);
    if (visibleIds.length === 0) return;

    const graph = buildGraph();
    const container = renderer.mapContainer;

    // Track how many walkers share each start node for staggering
    const nodeSpawnCount = new Map();

    entries.forEach((entry, i) => {
      const char = charMap.get(entry.id);
      if (!char) return;

      const imgFile = resolveWalkerImage(entry, char);
      const img = `assets/characters/${imgFile}`;
      const el = createWalkerElement(img);
      container.appendChild(el);

      // Start at the node that unlocked this stage
      const resolvedStage = entry.stage === -1 ? getCharStages(char, state).length - 1 : Math.max(0, entry.stage);
      let startNode = getStageStartNode(char, resolvedStage, visibleIds);

      // Stagger walkers from same node — each one waits before appearing
      const spawnIndex = nodeSpawnCount.get(startNode) || 0;
      nodeSpawnCount.set(startNode, spawnIndex + 1);
      const spawnAt = performance.now() + 500 + spawnIndex * 3000;  // 3s apart

      const w = {
        id: `${entry.id}_s${entry.stage}_${i}`,
        charId: entry.id,
        stageIndex: entry.stage,
        charImg: img,
        charName: char.name,
        el,
        currentNode: startNode,
        targetNode: startNode,
        previousNode: null,
        vx: 0, vy: 0,
        _cx: 0, _cy: 0,
        currentEdge: null,
        paused: true,
        pauseEnd: spawnAt,
        inEncounter: false,
        _spawned: spawnIndex === 0
      };

      // Position at start node center
      const pos = getNodeCenter(startNode);
      if (pos) {
        w._cx = pos.x;
        w._cy = pos.y;
        applyWalkerPosition(w);
      }

      // Hide until spawn time
      if (!w._spawned) {
        el.style.display = 'none';
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

    const idx = current.findIndex(e => e.id === charId && e.stage === stageIndex);
    if (idx !== -1) {
      current.splice(idx, 1);
      saveSelections(current);
    } else {
      if (current.length >= maxSlots) return false;
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
    document.getElementById('walker-picker-overlay')?.remove();

    const maxSlots = getMaxSlots();
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
          <p class="walker-slots-info">${getSelectedEntries().length} / ${maxSlots} slots used</p>
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

    function isSelected(charId, stageIdx) {
      return getSelectedEntries().some(e => e.id === charId && e.stage === stageIdx);
    }

    // Build flat list: each unlocked stage = one card
    unlocked.forEach(char => {
      const stages = getCharStages(char, state);

      stages.forEach((stage, si) => {
        const selected = isSelected(char.id, si);
        const label = si === 0 ? char.name : `${char.name} — ${stage.label}`;

        const card = document.createElement('div');
        card.className = 'walker-card' + (selected ? ' selected' : '');

        card.innerHTML = `
          <div class="walker-card-img">
            <img src="assets/characters/${stage.image}" alt="${label}" loading="lazy" />
            <span class="walker-check">✔</span>
          </div>
          <span class="walker-card-name">${label}</span>
        `;

        card.addEventListener('click', () => {
          if (isSelected(char.id, si)) {
            toggleCharacter(char.id, si);
            card.classList.remove('selected');
          } else {
            if (getSelectedEntries().length >= getMaxSlots()) {
              const info = overlay.querySelector('.walker-slots-info');
              info.style.color = '#E23636';
              setTimeout(() => info.style.color = '', 600);
              return;
            }
            toggleCharacter(char.id, si);
            card.classList.add('selected');
          }
          updateSlotCount();
        });

        grid.appendChild(card);
      });
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
  let _walkerInitDone = false;
  async function init() {
    if (!_walkerInitDone) {
      await loadFromServer();
      state.subscribe(() => {
        // Small delay so nodes render first
        setTimeout(() => deploy(), 300);
      });
      _walkerInitDone = true;
    }
  }

  function resetInit() {
    _walkerInitDone = false;
  }

  return { init, deploy, destroy, resetInit, showWalkerPicker, getSelectedIds, getSelectedEntries, getMaxSlots, getUnlockedCharacters, toggleCharacter, setCharacterStage, setSelections, deployWithSelections, restoreSelections };
})();
