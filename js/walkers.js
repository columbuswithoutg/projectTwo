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

  const PHYSICS = Object.freeze({
    WALKER:     { size: 24, r: 12, speed: 40, pauseMin: 800, pauseMax: 2500 },
    ROAD:       { halfW: 13, damping: 0.998, bounce: 0.85 },
    ENCOUNTER:  { dist: 36, cooldown: 30000, lineDuration: 2500 },
    WEAPON:     { radius: 18, size: 14, baseSpeed: 3.5, hitCooldown: 300 },
    FIGHT:      { spawnChance: 0.15, villainHpMult: 1.5, defeatDisplayMs: 2000, deployGrace: 5000 },
    PROJECTILE: { speed: 120, cooldown: 1400, size: 6 },
  });

  // Primary walker state. `paused` remains an orthogonal flag (a walker can
  // be paused during WALKING, ENCOUNTER, or after DEFEATED revive).
  const W_STATE = Object.freeze({
    WALKING:   'walking',
    ENCOUNTER: 'encounter',
    FIGHTING:  'fighting',
    DEFEATED:  'defeated',
  });

  let activeWalkers = [];
  let animFrameId = null;
  let lastTime = 0;
  let encounterCooldowns = new Map();  // "id1|id2" -> timestamp
  let activeBubbles = [];              // { el, owner }
  let encounterQueue = [];             // { w1, w2 }
  let encounterRunning = false;
  let encounterTimers = [];            // setTimeout IDs for active dialogue, cleared on destroy
  let deployTime = 0;                  // timestamp of last deploy, used for grace period
  let cachedGraph = null;              // cached adjacency (layout-version keyed)
  let cachedRoads = null;              // cached road segments
  let cachedRects = null;              // cached cluster rects
  let activeFights = new Map();        // nodeId -> { villain, participants: Set, started }
  let faintedWalkers = new Set();      // walkers waiting to revive after fight
  let activeProjectiles = [];          // { x, y, vx, vy, ownerId, dmg, el, isVillainProj }
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

  // Read node centers from the authored world layout — independent of DOM transforms
  // (fight zoom / world zoom can compose without breaking geometry).
  function getNodeCenter(nodeId) {
    const pos = getNodePosition(nodeId);
    if (!pos) return null;
    return { x: pos.x, y: pos.y };
  }

  function getClusterOf(nodeId) {
    const pos = getNodePosition(nodeId);
    return pos ? pos.clusterId : null;
  }

  /* ---- walker DOM element ---- */

  function createWalkerElement(charImg) {
    const wrap = document.createElement('div');
    wrap.className = 'map-walker';
    wrap.style.width = PHYSICS.WALKER.size + 'px';
    wrap.style.height = PHYSICS.WALKER.size + 'px';
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
    if (w1._cx == null || w2._cx == null) return;
    const midX = (w1._cx + w2._cx) / 2;
    const midY = (w1._cy + w2._cy) / 2;
    if (renderer) {
      renderer._setCamera(Math.max(renderer.worldZoom, 0.9), midX, midY, true);
    }
  }

  function positionBubbleAboveWalker(bubble, w) {
    if (!w.el || w._cx == null) return;
    bubble.style.left = w._cx + 'px';
    bubble.style.top = (w._cy - PHYSICS.WALKER.size / 2 - 8) + 'px';
  }

  function createSpeechBubble(w, text) {
    const bubble = document.createElement('div');
    bubble.className = 'walker-speech-bubble';
    bubble.textContent = text;
    bubble.style.position = 'absolute';
    bubble.style.zIndex = '60';
    renderer.mapContainer.appendChild(bubble);

    positionBubbleAboveWalker(bubble, w);

    // Safety auto-dismiss: if encounter cleanup never removes the bubble
    // (e.g., walker navigates away mid-dialogue), fade it out after a
    // generous lifetime so it never sticks forever.
    setTimeout(() => {
      if (!bubble.parentElement) return;
      bubble.classList.add('fade-out');
      setTimeout(() => bubble.remove(), 260);
    }, PHYSICS.ENCOUNTER.lineDuration * 2 + 1500);

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
      [w1, w2].forEach(w => {
        w.location = 'node';
        w.currentEdge = null;
        w.paused = true;
        w.pauseEnd = performance.now() + randBetween(200, 500);
        giveRandomVelocity(w);
      });
      runNextEncounter();
    }

    // Verify they're still close enough — skip stale encounters
    if (w1._cx != null && w2._cx != null) {
      const dist = Math.hypot(w2._cx - w1._cx, w2._cy - w1._cy);
      if (dist > PHYSICS.ENCOUNTER.dist * 3) {
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
    w1.state = W_STATE.ENCOUNTER;
    w2.state = W_STATE.ENCOUNTER;

    // Set cooldown for this pair
    const key = WALKER_DIALOGUES.getKey(w1.charId, w2.charId);
    encounterCooldowns.set(key, performance.now() + PHYSICS.ENCOUNTER.cooldown);

    // Center the map between the two walkers
    centerBetweenWalkers(w1, w2);

    // Collision already keeps them apart — just let the scroll settle
    const scrollDelay = 600;
    const startDelay = scrollDelay + 300;
    const totalDuration = startDelay + dialogue.length * PHYSICS.ENCOUNTER.lineDuration + 500;

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
      }, startDelay + i * PHYSICS.ENCOUNTER.lineDuration));
    });

    // Clean up after dialogue ends, then run next queued encounter
    encounterTimers.push(setTimeout(() => {
      clearBubblesFor(w1.charId, w2.charId);

      // Release walkers. They may have bumped either inside a cluster or
      // mid-road — preserve that context so we don't teleport them.
      [w1, w2].forEach(w => {
        let inClusterId = null;
        if (cachedRects && w._cx != null) {
          for (const [cid, r] of cachedRects) {
            if (w._cx >= r.left && w._cx <= r.right &&
                w._cy >= r.top && w._cy <= r.bottom) {
              inClusterId = cid;
              break;
            }
          }
        }

        if (inClusterId) {
          const rect = cachedRects.get(inClusterId);
          const nearest = nearestMemberNode(rect, w._cx, w._cy) || w.currentNode;
          w.currentNode = nearest;
          w.location = 'node';
          w.currentEdge = null;
          w.edgeT = null;
          w._perpOffset = 0;
          w._cx = Math.max(rect.left + PHYSICS.WALKER.r, Math.min(w._cx, rect.right - PHYSICS.WALKER.r));
          w._cy = Math.max(rect.top + PHYSICS.WALKER.r, Math.min(w._cy, rect.bottom - PHYSICS.WALKER.r));
          giveRandomVelocity(w);
        } else if (w.currentEdge && cachedRoads?.get(w.currentEdge) && w.targetNode) {
          // Mid-road — resume travel toward targetNode.
          w.location = 'road';
          const targetPos = getNodeCenter(w.targetNode);
          if (targetPos) {
            const dx = targetPos.x - w._cx;
            const dy = targetPos.y - w._cy;
            const len = Math.hypot(dx, dy) || 1;
            w.vx = (dx / len) * PHYSICS.WALKER.speed;
            w.vy = (dy / len) * PHYSICS.WALKER.speed;
          } else {
            giveRandomVelocity(w);
          }
        } else {
          // Off-map / no road context — last-resort nearest-node snap.
          let bestNode = w.currentNode;
          let bestDist = Infinity;
          getVisibleNodes().forEach(p => {
            const pos = getNodeCenter(p.id);
            if (!pos) return;
            const d = Math.hypot(pos.x - w._cx, pos.y - w._cy);
            if (d < bestDist) { bestDist = d; bestNode = p.id; }
          });
          w.currentNode = bestNode;
          w.location = 'node';
          w.currentEdge = null;
          const clusterId = getClusterOf(bestNode);
          const rect = clusterId ? cachedRects?.get(clusterId) : null;
          if (rect) {
            w._cx = Math.max(rect.left + PHYSICS.WALKER.r, Math.min(w._cx, rect.right - PHYSICS.WALKER.r));
            w._cy = Math.max(rect.top + PHYSICS.WALKER.r, Math.min(w._cy, rect.bottom - PHYSICS.WALKER.r));
          }
          giveRandomVelocity(w);
        }

        w.state = W_STATE.WALKING;
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
    w.el.style.left = (w._cx - PHYSICS.WALKER.r) + 'px';
    w.el.style.top = (w._cy - PHYSICS.WALKER.r) + 'px';
  }

  // Walker physics consumes the same road geometry the renderer draws. The
  // shared source is LayoutSystem.buildRoadGeometry, cached in utils.js as
  // getRoadGeometry — walkers and visible SVG paths never diverge.
  const _sampleAt = LayoutSystem.sampleAt;

  // Build cluster bounding rectangles with road openings. A cluster groups
  // every visible node that shares a `location`. Walkers roam the whole
  // cluster AABB and leave through any outbound inter-cluster road.
  //
  // Returns Map<clusterId, rect>, and Map<nodeId, clusterId> for convenience
  // (walker.currentNode still resolves to a specific movie node for fights).
  function buildNodeRects(graph, roadSegments) {
    const clusterRects = getClusterRects();
    const rects = new Map();

    clusterRects.forEach((cr, clusterId) => {
      const rect = {
        id: clusterId,
        left: cr.minX,
        top: cr.minY,
        right: cr.maxX,
        bottom: cr.maxY,
        cx: cr.cx,
        cy: cr.cy,
        clusterId,
        memberIds: cr.memberIds.slice(),
        memberPositions: cr.memberPositions.slice(),
        openings: []
      };
      rects.set(clusterId, rect);
    });

    // For each inter-cluster edge, compute opening points on the boundary of
    // each endpoint cluster (toward the edge direction). Intra-cluster edges
    // don't create openings — walkers just wander the AABB between them.
    roadSegments.forEach((road, key) => {
      if (road.fromClusterId === road.toClusterId) return;

      // From-cluster opening: exit direction points toward the road's first
      // sample tangent (bezier) or its straight direction.
      const fromRect = rects.get(road.fromClusterId);
      const toRect = rects.get(road.toClusterId);
      if (!fromRect || !toRect) return;

      if (road.type === 'bezier') {
        const firstSample = road.samples[0];
        const lastSample = road.samples[road.samples.length - 1];
        fromRect.openings.push({
          x: firstSample.x, y: firstSample.y,
          ux: firstSample.tx, uy: firstSample.ty,
          edgeKey: key, targetClusterId: road.toClusterId,
          targetNodeId: road.toId, fromNodeId: road.fromId,
          direction: 'forward',
        });
        toRect.openings.push({
          x: lastSample.x, y: lastSample.y,
          ux: -lastSample.tx, uy: -lastSample.ty,
          edgeKey: key, targetClusterId: road.fromClusterId,
          targetNodeId: road.fromId, fromNodeId: road.toId,
          direction: 'backward',
        });
      } else {
        fromRect.openings.push({
          x: road.x1, y: road.y1,
          ux: road.ux, uy: road.uy,
          edgeKey: key, targetClusterId: road.toClusterId,
          targetNodeId: road.toId, fromNodeId: road.fromId,
          direction: 'forward',
        });
        toRect.openings.push({
          x: road.x2, y: road.y2,
          ux: -road.ux, uy: -road.uy,
          edgeKey: key, targetClusterId: road.fromClusterId,
          targetNodeId: road.fromId, fromNodeId: road.toId,
          direction: 'backward',
        });
      }
    });

    return rects;
  }

  // Find the nearest member node to a walker inside a cluster — used to keep
  // `walker.currentNode` updated for fight spawn and dialogue triggers.
  function nearestMemberNode(cluster, cx, cy) {
    if (!cluster || !cluster.memberPositions.length) return null;
    let best = cluster.memberPositions[0];
    let bestDist = Infinity;
    for (const m of cluster.memberPositions) {
      const d = Math.hypot(m.x - cx, m.y - cy);
      if (d < bestDist) { bestDist = d; best = m; }
    }
    return best.id;
  }

  // Bounce walker off cluster AABB walls from INSIDE, with openings toward
  // outbound inter-cluster roads. `rect` is a cluster rect (from
  // buildNodeRects which now returns cluster-keyed rects).
  function bounceInsideNode(w, rect) {
    if (!rect) return;
    const pad = PHYSICS.WALKER.r;

    // Check if walker is near an opening — if so, transition to the road.
    // Sealed during fights so participants don't wander off.
    if (w.state !== W_STATE.FIGHTING) {
      for (const op of rect.openings) {
        const distToOpening = Math.hypot(w._cx - op.x, w._cy - op.y);
        if (distToOpening < PHYSICS.ROAD.halfW * 2 + PHYSICS.WALKER.r) {
          const movingOut = w.vx * op.ux + w.vy * op.uy;
          if (movingOut > 0) {
            w.location = 'road';
            w.currentEdge = op.edgeKey;
            w.edgeDirection = op.direction;
            // edgeT is initialised by the road branch using the road's length
            w.edgeT = null;
            w._perpOffset = 0;
            w.previousNode = w.currentNode;
            w.targetNode = op.targetNodeId;
            w.targetCluster = op.targetClusterId;
            return;
          }
        }
      }
    }

    // Bounce off cluster AABB walls
    if (w._cx - pad < rect.left) {
      w._cx = rect.left + pad;
      if (w.vx < 0) w.vx = -w.vx * PHYSICS.ROAD.bounce;
    }
    if (w._cx + pad > rect.right) {
      w._cx = rect.right - pad;
      if (w.vx > 0) w.vx = -w.vx * PHYSICS.ROAD.bounce;
    }
    if (w._cy - pad < rect.top) {
      w._cy = rect.top + pad;
      if (w.vy < 0) w.vy = -w.vy * PHYSICS.ROAD.bounce;
    }
    if (w._cy + pad > rect.bottom) {
      w._cy = rect.bottom - pad;
      if (w.vy > 0) w.vy = -w.vy * PHYSICS.ROAD.bounce;
    }

    // Sync currentNode to the nearest cluster member so fight/dialogue gating
    // reads the right movie. Throttled — the nearest-member loop is O(members)
    // and recomputing it every frame for big clusters (NYC has 20+ members) is
    // wasteful when the walker barely moved. Run every ~180ms per walker.
    const now = performance.now();
    if (!w._nearestCheckAt || now - w._nearestCheckAt > 180) {
      const nearest = nearestMemberNode(rect, w._cx, w._cy);
      if (nearest) w.currentNode = nearest;
      w._nearestCheckAt = now;
    }
    w.clusterId = rect.id;
  }

  // Give walker a random velocity inside a node (for bouncing around)
  function giveRandomVelocity(w) {
    const angle = Math.random() * Math.PI * 2;
    const spd = (w.state === W_STATE.FIGHTING ? (w.moveSpeedMult || PHYSICS.WALKER.speed) : PHYSICS.WALKER.speed) * 0.8;
    w.vx = Math.cos(angle) * spd;
    w.vy = Math.sin(angle) * spd;
  }

  /* ---- fight system ---- */

  function createWeaponElement(weaponType) {
    const color = WEAPON_COLORS[weaponType] || WEAPON_COLORS._default;
    const el = document.createElement('div');
    el.className = 'walker-weapon';
    el.style.color = color;

    // Build weapon shape via inline SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', PHYSICS.WEAPON.size);
    svg.setAttribute('height', PHYSICS.WEAPON.size);
    svg.setAttribute('viewBox', '0 0 14 14');
    svg.style.display = 'block';
    svg.style.overflow = 'visible';

    const shape = WEAPON_SHAPES[weaponType] || WEAPON_SHAPES._default;
    svg.innerHTML = shape.replace(/\{c\}/g, color);
    el.appendChild(svg);

    el.style.width = PHYSICS.WEAPON.size + 'px';
    el.style.height = PHYSICS.WEAPON.size + 'px';
    renderer.mapContainer.appendChild(el);
    return el;
  }

  function createHpElement() {
    const el = document.createElement('div');
    el.className = 'walker-hp';
    renderer.mapContainer.appendChild(el);
    return el;
  }

  function createHpBarElement() {
    const wrap = document.createElement('div');
    wrap.className = 'walker-hp-bar';
    const fill = document.createElement('div');
    fill.className = 'walker-hp-bar-fill';
    wrap.appendChild(fill);
    renderer.mapContainer.appendChild(wrap);
    return wrap;
  }

  function spawnDamageNumber(target, dmg) {
    if (!renderer.mapContainer || !target) return;
    const el = document.createElement('div');
    el.className = 'walker-damage-number';
    el.textContent = '-' + Math.max(1, Math.round(dmg));
    el.style.left = target._cx + 'px';
    el.style.top = (target._cy - PHYSICS.WALKER.r - 18) + 'px';
    renderer.mapContainer.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  function initFightProps(w) {
    const stats = WALKER_STATS[w.charId] || WALKER_STATS._default;
    w.hp = stats.hp;
    w.maxHp = stats.hp;
    w.atkSpeedMult = stats.atkSpeed;
    w.moveSpeedMult = stats.moveSpeed;
    // Melee weapon (orbiting)
    w.meleeWeapon = stats.melee ? stats.melee[0] : 'fist';
    w.meleeDmg = stats.melee ? stats.melee[1] : 10;
    // Ranged weapon (projectiles) — null means no ranged
    w.rangeWeapon = stats.range ? stats.range[0] : null;
    w.rangeDmg = stats.range ? stats.range[1] : 0;
    // For display, use melee weapon as the orbiting shape
    w.weaponType = w.meleeWeapon;
    w.weaponAngle = Math.random() * Math.PI * 2;
    w.weaponEl = null;
    w.rangeWeaponEl = null;  // secondary weapon display for ranged
    w.hpEl = null;
    w.hpBarEl = null;
    w.isVillain = false;
    w.lastHitBy = new Map();
    w._lastShot = 0;
  }

  function equipForFight(w) {
    if (!w.weaponEl) {
      w.weaponEl = createWeaponElement(w.weaponType);
    }
    if (!w.hpEl) {
      w.hpEl = createHpElement();
    }
    if (!w.hpBarEl) {
      w.hpBarEl = createHpBarElement();
    }
    w.state = W_STATE.FIGHTING;
  }

  function unequipFight(w) {
    w.weaponEl?.remove();
    w.weaponEl = null;
    w.hpBarEl?.remove();
    w.hpBarEl = null;
    w.hpEl?.remove();
    w.hpEl = null;
    w.state = W_STATE.WALKING;
  }

  function setFightClass(nodeId, on) {
    const el = renderer.nodeElements?.get(nodeId);
    if (!el) return;
    el.classList.toggle('active-fight', !!on);
  }

  /* ---- fight zoom ---- */
  let fightZoomed = false;
  let zoomEndTimer = null;

  function startFightZoom(nodeId) {
    if (!renderer.wrapper) return;

    // Zoom to the whole CLUSTER that the fight belongs to — with grid packing
    // the cluster is the visual "node" the user sees. Scaling to NODE_WIDTH
    // would zoom into a single tile, which reads as wrong for multi-tile clusters.
    const clusterId = getClusterOf(nodeId);
    const rect = clusterId ? getClusterRects().get(clusterId) : null;
    const pos = getNodePosition(nodeId);
    if (!rect && !pos) return;

    if (zoomEndTimer) {
      clearTimeout(zoomEndTimer);
      zoomEndTimer = null;
    }

    // Cancel any in-flight world zoom/pan tween — composing our inner
    // transform on top of a still-animating outer transform desyncs the math
    // and leaves the fight framed somewhere off-screen.
    if (typeof renderer._cancelTween === 'function') renderer._cancelTween();

    const wRect = renderer.wrapper.getBoundingClientRect();
    const worldZ = renderer.worldZoom || 1;
    // Frame the cluster (or fall back to the node rect if somehow absent) at
    // ~80% of the shorter viewport axis so there's some breathing room and
    // speech bubbles above participants stay on-screen.
    const targetW = rect ? rect.width : CONFIG.NODE_WIDTH;
    const targetH = rect ? rect.height : CONFIG.NODE_HEIGHT;
    const centerX = rect ? rect.cx : pos.x;
    const centerY = rect ? rect.cy : pos.y;

    // Ideal inner scale would frame the cluster at 80% of whichever viewport
    // axis binds first. Clamp to [1, 3] — a fight zoom must never SHRINK (≥1)
    // and shouldn't zoom so far that walker motion is unwatchable (≤3). The
    // shrink case happens when the user is already zoomed in close and the
    // cluster already fills > 80% of the viewport.
    const rawScale = Math.min(
      (wRect.width * 0.8) / (targetW * worldZ),
      (wRect.height * 0.8) / (targetH * worldZ)
    );
    const innerScale = Math.max(1, Math.min(3, rawScale));

    // Compose with the outer world zoom/pan: we apply translate+scale to
    // #map-container so that (centerX, centerY) lands at viewport center.
    const effectiveScale = worldZ * innerScale;
    const tx = (wRect.width / 2 - renderer.panX) / effectiveScale - centerX;
    const ty = (wRect.height / 2 - renderer.panY) / effectiveScale - centerY;

    const container = renderer.mapContainer;
    container.style.transformOrigin = '0 0';
    container.style.transition = 'transform 0.5s ease';
    container.style.transform = `scale(${innerScale}) translate(${tx}px, ${ty}px)`;
    fightZoomed = true;
    // Lock camera input — wheel/pan/pinch/keys would desync the composed
    // inner+outer transform and drift the view off the fight.
    renderer.cameraLocked = true;
  }

  function endFightZoom() {
    if (!fightZoomed) return;
    const container = renderer.mapContainer;

    container.style.transition = 'transform 0.5s ease';
    container.style.transform = '';

    if (zoomEndTimer) clearTimeout(zoomEndTimer);
    zoomEndTimer = setTimeout(() => {
      container.style.transformOrigin = '';
      container.style.transition = '';
      fightZoomed = false;
      zoomEndTimer = null;
    }, 500);
    // Unlock camera input — user can zoom/pan again now that fight is resolved.
    renderer.cameraLocked = false;
  }

  function centerOnNode(nodeId) {
    // Now delegates to the renderer's camera system.
    const pos = getNodePosition(nodeId);
    if (!pos || !renderer) return;
    renderer._setCamera(Math.max(renderer.worldZoom, 0.9), pos.x, pos.y, true);
  }

  function spawnVillain(nodeId) {
    if (activeFights.size > 0) return;  // only one fight at a time globally

    // Pool villain candidates across every watched movie in this cluster.
    // Previously we only looked at VILLAIN_DATA[nodeId] — and because roads
    // dedupe to one prereq per cluster pair, `nodeId` was almost always the
    // same member (e.g. `hulk` for NYC), so only Abomination ever spawned.
    // Sourcing from the whole cluster rotates through Fisk, Kilgrave,
    // Cottonmouth, Kingpin, Loki, Thanos, etc.
    const fightClusterId = getClusterOf(nodeId);
    const clusterRect = fightClusterId ? getClusterRects().get(fightClusterId) : null;
    const candidates = [];
    const members = clusterRect ? clusterRect.memberIds : [nodeId];
    members.forEach(mid => {
      if (!state.isWatched(mid)) return; // only watched movies contribute villains
      const ids = VILLAIN_DATA[mid];
      if (!ids || !ids.length) return;
      ids.forEach(vid => candidates.push({ villainId: vid, anchorNodeId: mid }));
    });
    if (candidates.length === 0) return;

    // Don't start a fight while walkers staged to this cluster are still
    // waiting in the stagger queue — they can't be enrolled retroactively.
    const hasPendingWalker = activeWalkers.some(w =>
      !w._spawned && w.clusterId === fightClusterId
    );
    if (hasPendingWalker) return;

    if (Math.random() >= PHYSICS.FIGHT.spawnChance) return;

    const pick = pickRandom(candidates);
    const villainCharId = pick.villainId;
    const anchorNodeId = pick.anchorNodeId;
    const villainChar = characters.find(c => c.id === villainCharId);
    if (!villainChar) return;

    const stats = WALKER_STATS[villainCharId] || WALKER_STATS._default;

    // Villain spawns at a RANDOM position inside the fight cluster's
    // rectangle (anywhere in NYC, not right on the Daredevil pin). The
    // fight is still anchored on the villain's own movie node (so HP bars,
    // joinFight cluster lookup, etc. reference the correct nodeId).
    const rect = clusterRect;
    if (!rect) return;
    const inset = PHYSICS.WALKER.r + 10;
    const pos = {
      x: rect.minX + inset + Math.random() * Math.max(1, rect.width - inset * 2),
      y: rect.minY + inset + Math.random() * Math.max(1, rect.height - inset * 2),
    };
    nodeId = anchorNodeId;

    // Create villain walker
    const imgFile = typeof getCharImage === 'function' ? getCharImage(villainChar, state) : villainChar.image;
    const img = `assets/characters/${imgFile}`;
    const el = createWalkerElement(img);
    el.classList.add('villain');
    renderer.mapContainer.appendChild(el);

    const w = {
      id: `villain_${villainCharId}_${Date.now()}`,
      charId: villainCharId,
      charName: villainChar.name,
      charImg: img,
      el,
      currentNode: nodeId,
      clusterId: getClusterOf(nodeId),
      targetNode: null,
      previousNode: null,
      vx: 0, vy: 0,
      _cx: pos.x, _cy: pos.y,
      currentEdge: null,
      location: 'node',
      state: W_STATE.WALKING,
      paused: false,
      pauseEnd: 0,
      _spawned: true
    };

    initFightProps(w);
    w.hp = Math.round(stats.hp * PHYSICS.FIGHT.villainHpMult);
    w.maxHp = w.hp;
    w.isVillain = true;
    equipForFight(w);        // set inFight=true before velocity so moveSpeed is used
    giveRandomVelocity(w);
    applyWalkerPosition(w);

    activeWalkers.push(w);

    // Create fight
    const fight = { villain: w, participants: new Set(), nodeId, started: performance.now() };
    activeFights.set(nodeId, fight);
    setFightClass(nodeId, true);

    // Zoom into fight node
    startFightZoom(nodeId);

    // Enroll all walkers in the node
    joinFight(nodeId);
  }

  function joinFight(nodeId) {
    const fight = activeFights.get(nodeId);
    if (!fight) return;

    // Enroll every walker currently in the same cluster as the fight node —
    // with big clusters like NYC, "at this movie" now means "in this region."
    const fightClusterId = getClusterOf(nodeId);

    activeWalkers.forEach(w => {
      if (w === fight.villain) return;
      if (w.isVillain) return;
      if (w.state === W_STATE.DEFEATED) return;
      if (w.clusterId === fightClusterId && w.location === 'node' && w._spawned) {
        if (!fight.participants.has(w)) {
          fight.participants.add(w);
          equipForFight(w);
          const stats = WALKER_STATS[w.charId] || WALKER_STATS._default;
          w.hp = stats.hp;
          w.maxHp = stats.hp;
        }
      }
    });
  }

  function handleWalkerFaint(w) {
    w.state = W_STATE.DEFEATED;
    w.vx = 0;
    w.vy = 0;
    w.el.classList.add('fainted');
    unequipFight(w);
    faintedWalkers.add(w);
  }

  function handleVillainDefeat(fight, nodeId) {
    if (fight._resolving) return;
    fight._resolving = true;
    const villain = fight.villain;
    villain.state = W_STATE.DEFEATED;
    villain.vx = 0;
    villain.vy = 0;

    // Show defeat line
    const line = WALKER_DIALOGUES.getDefeatLine(villain.charId);
    const bubble = createSpeechBubble(villain, line);
    activeBubbles.push({ el: bubble, owner: villain.charId, walker: villain });

    setTimeout(() => {
      // Clean up villain
      bubble.remove();
      activeBubbles = activeBubbles.filter(b => b.walker !== villain);
      unequipFight(villain);
      villain.el?.remove();
      const idx = activeWalkers.indexOf(villain);
      if (idx !== -1) activeWalkers.splice(idx, 1);

      // End fight
      activeFights.delete(nodeId);
      setFightClass(nodeId, false);
      // Clear any remaining projectiles
      activeProjectiles.forEach(p => p.el.remove());
      activeProjectiles = [];

      // Release participants
      fight.participants.forEach(w => {
        unequipFight(w);
        if (w.state !== W_STATE.DEFEATED) {
          giveRandomVelocity(w);
          w.paused = true;
          w.pauseEnd = performance.now() + randBetween(300, 800);
        }
      });

      // Zoom out and start revive checks
      endFightZoom();
      checkFaintedRevives();
    }, PHYSICS.FIGHT.defeatDisplayMs);
  }

  function handleVillainWins(fight, nodeId) {
    if (fight._resolving) return;
    fight._resolving = true;
    const villain = fight.villain;
    villain.vx = 0;
    villain.vy = 0;

    // Show victory line
    const line = WALKER_DIALOGUES.getVictoryLine(villain.charId);
    const bubble = createSpeechBubble(villain, line);
    activeBubbles.push({ el: bubble, owner: villain.charId, walker: villain });

    setTimeout(() => {
      bubble.remove();
      activeBubbles = activeBubbles.filter(b => b.walker !== villain);
      unequipFight(villain);
      villain.el?.remove();
      const idx = activeWalkers.indexOf(villain);
      if (idx !== -1) activeWalkers.splice(idx, 1);

      activeFights.delete(nodeId);
      setFightClass(nodeId, false);
      // Clear any remaining projectiles
      activeProjectiles.forEach(p => p.el.remove());
      activeProjectiles = [];

      // Zoom out, then revive fainted walkers after delay
      endFightZoom();
      setTimeout(() => checkFaintedRevives(), 1500);
    }, PHYSICS.FIGHT.defeatDisplayMs);
  }

  function checkFaintedRevives() {
    if (faintedWalkers.size === 0) return;

    // Compute fight clusters once per revive check, not per walker.
    const fightClusterIds = new Set();
    activeFights.forEach((_, nodeId) => {
      const c = getClusterOf(nodeId);
      if (c) fightClusterIds.add(c);
    });

    faintedWalkers.forEach(w => {
      if (fightClusterIds.has(w.clusterId)) return;

      // Check overlap with any active walker
      const overlapping = activeWalkers.some(other =>
        other !== w && other.state !== W_STATE.DEFEATED && other._spawned &&
        Math.hypot(other._cx - w._cx, other._cy - w._cy) < PHYSICS.WALKER.size
      );

      if (!overlapping) {
        w.state = W_STATE.WALKING;
        w.el.classList.remove('fainted');
        const stats = WALKER_STATS[w.charId] || WALKER_STATS._default;
        w.hp = stats.hp;
        w.maxHp = stats.hp;
        giveRandomVelocity(w);
        faintedWalkers.delete(w);
      }
    });

    if (faintedWalkers.size > 0) {
      setTimeout(checkFaintedRevives, 500);
    }
  }

  // Projectile SVG shapes per weapon type — smaller than melee weapons
  const PROJECTILE_SHAPES = {
    repulsor:   `<circle cx="5" cy="5" r="4" fill="{c}" opacity="0.8"/><circle cx="5" cy="5" r="2" fill="#fff" opacity="0.6"/>`,
    blaster:    `<ellipse cx="5" cy="5" rx="4" ry="2.5" fill="{c}"/><circle cx="7" cy="5" r="1.5" fill="#fff" opacity="0.5"/>`,
    arrow:      `<line x1="1" y1="5" x2="9" y2="5" stroke="{c}" stroke-width="1.5"/><polygon points="9,5 6,3 6,7" fill="{c}"/>`,
    beam:       `<rect x="1" y="3" width="8" height="4" rx="2" fill="{c}" opacity="0.7"/><rect x="2" y="4" width="6" height="2" fill="#fff" opacity="0.4"/>`,
    photon:     `<polygon points="5,0 6.5,3.5 10,3.5 7.5,5.5 8.5,10 5,7 1.5,10 2.5,5.5 0,3.5 3.5,3.5" fill="{c}" opacity="0.8"/>`,
    shield:     `<circle cx="5" cy="5" r="4" fill="{c}" opacity="0.6"/><circle cx="5" cy="5" r="2.5" fill="none" stroke="#fff" stroke-width="1"/>`,
    shotgun:    `<circle cx="3" cy="4" r="1.5" fill="{c}"/><circle cx="5" cy="6" r="1.5" fill="{c}"/><circle cx="7" cy="4" r="1.5" fill="{c}"/>`,
    pistol:     `<circle cx="5" cy="5" r="2.5" fill="{c}"/><circle cx="5" cy="5" r="1" fill="#fff" opacity="0.5"/>`,
    sting:      `<polygon points="10,5 5,7 0,5 5,3" fill="{c}"/><circle cx="5" cy="5" r="1.5" fill="#fff" opacity="0.4"/>`,
    redwing:    `<polygon points="5,2 9,5 5,5 1,5" fill="{c}"/><polygon points="5,5 8,8 5,7 2,8" fill="{c}" opacity="0.6"/>`,
    drone:      `<rect x="2" y="3.5" width="6" height="3" rx="1" fill="{c}"/><circle cx="5" cy="5" r="1" fill="#fff"/>`,
    chi:        `<circle cx="5" cy="5" r="3" fill="{c}" opacity="0.5"/><polygon points="5,1.5 6.5,4 5,3.5 3.5,4" fill="{c}"/>`,
    disc:       `<circle cx="5" cy="5" r="3.5" fill="{c}" opacity="0.6"/><circle cx="5" cy="5" r="2" fill="{c}"/>`,
    web:        `<circle cx="5" cy="5" r="3" fill="none" stroke="{c}" stroke-width="0.8"/><line x1="5" y1="2" x2="5" y2="8" stroke="{c}" stroke-width="0.4"/><line x1="2" y1="5" x2="8" y2="5" stroke="{c}" stroke-width="0.4"/>`,
    magic:      `<circle cx="5" cy="5" r="3.5" fill="none" stroke="{c}" stroke-width="1.2"/><circle cx="5" cy="5" r="1.5" fill="{c}" opacity="0.5"/>`,
    hex:        `<polygon points="5,1 9,5 5,9 1,5" fill="{c}" opacity="0.7"/>`,
    rings:      `<circle cx="5" cy="5" r="3.5" fill="none" stroke="{c}" stroke-width="1.2"/><circle cx="5" cy="5" r="1.5" fill="none" stroke="{c}" stroke-width="0.8"/>`,
    psychic:    `<circle cx="5" cy="5" r="3" fill="{c}" opacity="0.4"/><line x1="2" y1="2" x2="8" y2="8" stroke="{c}" stroke-width="0.8"/><line x1="8" y1="2" x2="2" y2="8" stroke="{c}" stroke-width="0.8"/>`,
    tesseract:  `<rect x="2" y="2" width="6" height="6" fill="{c}" opacity="0.6" transform="rotate(45,5,5)"/>`,
    darkEnergy: `<circle cx="5" cy="5" r="3.5" fill="{c}" opacity="0.5"/><circle cx="5" cy="5" r="1.5" fill="#fff" opacity="0.3"/>`,
    necrosword: `<polygon points="10,5 6,6.5 7,8 3,6.5 0,5 3,3.5 3,2 6,3.5" fill="{c}"/>`,
    aether:     `<ellipse cx="5" cy="5" rx="4" ry="2.5" fill="{c}" opacity="0.6"/><ellipse cx="5" cy="5" rx="2.5" ry="4" fill="{c}" opacity="0.4"/>`,
    tendril:    `<g transform="rotate(90,5,5)"><path d="M5,0 Q7,3 6,5 Q8,6 6,8 Q5,10 5,10 Q5,10 4,8 Q2,6 4,5 Q3,3 5,0" fill="{c}" opacity="0.6"/></g>`,
    suit:       `<polygon points="5,1 8,4 8,7 5,9 2,7 2,4" fill="none" stroke="{c}" stroke-width="1"/><circle cx="5" cy="5" r="1.5" fill="{c}"/>`,
    mind:       `<circle cx="5" cy="5" r="3" fill="none" stroke="{c}" stroke-width="0.8" stroke-dasharray="1.5,1.5"/><circle cx="5" cy="5" r="1.5" fill="{c}" opacity="0.5"/>`,
    pulse:      `<circle cx="5" cy="5" r="2" fill="{c}"/><circle cx="5" cy="5" r="3.5" fill="none" stroke="{c}" stroke-width="0.6" opacity="0.5"/>`,
    _default:   `<circle cx="5" cy="5" r="3" fill="{c}"/><circle cx="5" cy="5" r="1.5" fill="#fff" opacity="0.3"/>`
  };

  // Create a shaped projectile DOM element
  function createProjectileElement(weaponType, color, aimAngle) {
    const el = document.createElement('div');
    el.className = 'walker-projectile';
    const ps = 10;
    el.style.width = ps + 'px';
    el.style.height = ps + 'px';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', ps);
    svg.setAttribute('height', ps);
    svg.setAttribute('viewBox', '0 0 10 10');
    svg.style.display = 'block';
    svg.style.overflow = 'visible';

    const shape = PROJECTILE_SHAPES[weaponType] || PROJECTILE_SHAPES._default;
    svg.innerHTML = shape.replace(/\{c\}/g, color);
    el.appendChild(svg);

    // Rotate projectile to face travel direction (SVGs point right = 0°, matching atan2)
    const deg = aimAngle * 180 / Math.PI;
    el.style.transform = `rotate(${deg}deg)`;

    renderer.mapContainer.appendChild(el);
    return el;
  }

  // Fire a projectile toward target's current position with aim spread — travels in a straight line, no homing
  function fireProjectile(attacker, target, now) {
    const dx = target._cx - attacker._cx;
    const dy = target._cy - attacker._cy;
    const len = Math.hypot(dx, dy) || 1;

    // Add random aim spread (±15 degrees) so shots can miss
    const baseAngle = Math.atan2(dy, dx);
    const spread = (Math.random() - 0.5) * 0.52;  // ~±15 degrees in radians
    const aimAngle = baseAngle + spread;

    const color = WEAPON_COLORS[attacker.rangeWeapon] || WEAPON_COLORS._default;

    const proj = {
      x: attacker._cx + Math.cos(aimAngle) * PHYSICS.WALKER.r,
      y: attacker._cy + Math.sin(aimAngle) * PHYSICS.WALKER.r,
      vx: Math.cos(aimAngle) * PHYSICS.PROJECTILE.speed,
      vy: Math.sin(aimAngle) * PHYSICS.PROJECTILE.speed,
      ownerId: attacker.id,
      ownerIsVillain: attacker.isVillain,
      dmg: attacker.rangeDmg,
      el: createProjectileElement(attacker.rangeWeapon, color, aimAngle),
      born: now
    };
    activeProjectiles.push(proj);
  }

  // Find the nearest valid target for a ranged attacker
  function findTarget(attacker, fighters) {
    let best = null;
    let bestDist = Infinity;
    for (const f of fighters) {
      if (f === attacker || f.state === W_STATE.DEFEATED || f.hp <= 0) continue;
      if (f.isVillain === attacker.isVillain) continue;
      const d = Math.hypot(f._cx - attacker._cx, f._cy - attacker._cy);
      if (d < bestDist) { bestDist = d; best = f; }
    }
    return best;
  }

  function applyDamage(target, dmg, now, attackerId) {
    const lastHit = target.lastHitBy?.get(attackerId) || 0;
    if (now - lastHit < PHYSICS.WEAPON.hitCooldown) return false;

    target.lastHitBy.set(attackerId, now);
    target.hp -= dmg;

    target.el.classList.add('hit-flash');
    setTimeout(() => target.el.classList.remove('hit-flash'), 180);

    spawnDamageNumber(target, dmg);
    return true;
  }

  function processFightDamage(now, dtSec) {
    activeFights.forEach((fight, nodeId) => {
      const allFighters = [...fight.participants, fight.villain];

      for (const attacker of allFighters) {
        if (attacker.state === W_STATE.DEFEATED || attacker.hp <= 0) continue;

        // --- Melee: orbiting weapon always does contact damage ---
        const wx = attacker._cx + Math.cos(attacker.weaponAngle) * PHYSICS.WEAPON.radius;
        const wy = attacker._cy + Math.sin(attacker.weaponAngle) * PHYSICS.WEAPON.radius;

        for (const target of allFighters) {
          if (target === attacker || target.state === W_STATE.DEFEATED || target.hp <= 0) continue;
          if (attacker.isVillain === target.isVillain) continue;

          const dist = Math.hypot(wx - target._cx, wy - target._cy);
          if (dist < PHYSICS.WALKER.r + PHYSICS.WEAPON.size / 2) {
            if (applyDamage(target, attacker.meleeDmg, now, attacker.id + '_melee')) {
              if (target.hp <= 0) {
                target.hp = 0;
                if (target.isVillain) { handleVillainDefeat(fight, nodeId); return; }
                else {
                  handleWalkerFaint(target);
                  if (![...fight.participants].some(p => p.state !== W_STATE.DEFEATED)) { handleVillainWins(fight, nodeId); return; }
                }
              }
            }
          }
        }

        // --- Ranged: fire projectiles if character has range weapon ---
        if (attacker.rangeWeapon) {
          // Hybrid fighters (have both melee + range) shoot slower
          const hybridPenalty = attacker.meleeDmg > 0 ? 1.5 : 1.0;
          const lastShot = attacker._lastShot || 0;
          if (now - lastShot >= (PHYSICS.PROJECTILE.cooldown * hybridPenalty) / attacker.atkSpeedMult) {
            const target = findTarget(attacker, allFighters);
            if (target) {
              fireProjectile(attacker, target, now);
              attacker._lastShot = now;
            }
          }
        }
      }
    });

    // Process projectile movement and hits. Projectile bounds are the fight's
    // cluster rect (walkers fight within the cluster, not a single node box).
    const fightNodeId = activeFights.size > 0 ? activeFights.keys().next().value : null;
    const fightClusterId = fightNodeId ? getClusterOf(fightNodeId) : null;
    const nodeRect = fightClusterId ? cachedRects?.get(fightClusterId) : null;

    for (let i = activeProjectiles.length - 1; i >= 0; i--) {
      const p = activeProjectiles[i];
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;

      // Remove if too old (2 seconds max) or out of node bounds
      const age = now - p.born;
      const outOfBounds = nodeRect && (
        p.x < nodeRect.left || p.x > nodeRect.right ||
        p.y < nodeRect.top || p.y > nodeRect.bottom
      );
      if (age > 2000 || outOfBounds) {
        p.el.remove();
        activeProjectiles.splice(i, 1);
        continue;
      }

      // Check hit against all fighters
      let hit = false;
      activeFights.forEach((fight, nodeId) => {
        if (hit) return;
        const allFighters = [...fight.participants, fight.villain];
        for (const target of allFighters) {
          if (target.state === W_STATE.DEFEATED || target.hp <= 0) continue;
          if (target.id === p.ownerId) continue;
          if (target.isVillain === p.ownerIsVillain) continue;

          const dist = Math.hypot(p.x - target._cx, p.y - target._cy);
          if (dist < PHYSICS.WALKER.r + PHYSICS.PROJECTILE.size) {
            if (applyDamage(target, p.dmg, now, p.ownerId)) {
              if (target.hp <= 0) {
                target.hp = 0;
                if (target.isVillain) { handleVillainDefeat(fight, nodeId); }
                else {
                  handleWalkerFaint(target);
                  if (![...fight.participants].some(pp => pp.state !== W_STATE.DEFEATED)) { handleVillainWins(fight, nodeId); }
                }
              }
            }
            hit = true;
          }
        }
      });

      if (hit) {
        p.el.remove();
        activeProjectiles.splice(i, 1);
        continue;
      }

      // Update projectile DOM position
      p.el.style.left = (p.x - PHYSICS.PROJECTILE.size) + 'px';
      p.el.style.top = (p.y - PHYSICS.PROJECTILE.size) + 'px';
    }
  }

  /* ---- animation loop ---- */

  function tick(now) {
    if (!lastTime) lastTime = now;
    const dt = Math.min(now - lastTime, 50);
    lastTime = now;

    // Geometry rebuilds only when the layout version bumps (on every
    // state.subscribe fire). Road segments, cluster rects, and the graph
    // all invalidate together — they derive from the same source.
    const version = getLayoutVersion();
    if (!cachedRoads || tick._version !== version) {
      cachedGraph = buildGraph();
      cachedRoads = getRoadGeometry();
      cachedRects = buildNodeRects(cachedGraph, cachedRoads);
      tick._version = version;
    }
    const graph = cachedGraph;
    const roadSegments = cachedRoads;
    const nodeRects = cachedRects;
    const dtSec = dt / 1000;

    // Pass 1: move walkers
    activeWalkers.forEach(w => {
      if (!w._spawned) {
        if (now >= w.pauseEnd) {
          w._spawned = true;
          w.el.style.display = '';
          // Start bouncing inside node immediately
          w.location = 'node';
          giveRandomVelocity(w);
        }
        return;
      }

      if (w.state === W_STATE.ENCOUNTER) return;
      if (w.state === W_STATE.DEFEATED) return;

      // During a fight, only fighters move — everyone else freezes
      if (activeFights.size > 0 && w.state !== W_STATE.FIGHTING) return;

      // Update weapon spin if in fight
      if (w.state === W_STATE.FIGHTING) {
        w.weaponAngle = (w.weaponAngle || 0) + w.atkSpeedMult * PHYSICS.WEAPON.baseSpeed * dtSec;
      }

      // Velocity integration
      w._cx += w.vx * dtSec;
      w._cy += w.vy * dtSec;

      if (w.location === 'node') {
        // Bouncing inside the walker's current cluster AABB. If the walker's
        // currentNode was invalidated (hidden via state change, e.g. clear
        // progress), snap to the nearest visible cluster instead of drifting.
        if (!w.clusterId || !nodeRects.has(w.clusterId)) {
          let best = null, bestDist = Infinity;
          nodeRects.forEach((r, cid) => {
            const d = Math.hypot(r.cx - w._cx, r.cy - w._cy);
            if (d < bestDist) { bestDist = d; best = r; }
          });
          if (best) {
            w.clusterId = best.id;
            w.currentNode = nearestMemberNode(best, w._cx, w._cy) || best.memberIds[0];
            w._cx = Math.max(best.minX + PHYSICS.WALKER.r, Math.min(w._cx, best.maxX - PHYSICS.WALKER.r));
            w._cy = Math.max(best.minY + PHYSICS.WALKER.r, Math.min(w._cy, best.maxY - PHYSICS.WALKER.r));
          }
        }
        const rect = nodeRects.get(w.clusterId);
        bounceInsideNode(w, rect);

        if (w.location === 'road') return; // transitioned out

        if (w.state !== W_STATE.FIGHTING) {
          if (w.paused && now >= w.pauseEnd) {
            w.paused = false;
            if (rect && rect.openings.length > 0 && Math.random() < 0.7) {
              // Head toward a random opening (outbound road)
              const op = pickRandom(rect.openings);
              const dx = op.x - w._cx;
              const dy = op.y - w._cy;
              const len = Math.hypot(dx, dy) || 1;
              w.vx = (dx / len) * PHYSICS.WALKER.speed;
              w.vy = (dy / len) * PHYSICS.WALKER.speed;
            } else if (rect && rect.memberPositions.length > 1) {
              // Wander toward a random member node inside the same cluster
              const target = pickRandom(rect.memberPositions);
              const dx = target.x - w._cx;
              const dy = target.y - w._cy;
              const len = Math.hypot(dx, dy) || 1;
              w.vx = (dx / len) * PHYSICS.WALKER.speed;
              w.vy = (dy / len) * PHYSICS.WALKER.speed;
            } else {
              giveRandomVelocity(w);
            }
          }
        }

      } else if (w.location === 'road') {
        const road = roadSegments.get(w.currentEdge);
        if (!road) {
          // Road vanished (layout change) — snap back to the walker's cluster.
          w.location = 'node';
          w.currentEdge = null;
          w.edgeT = null;
          const fr = nodeRects.get(w.clusterId);
          if (fr) { w._cx = fr.cx; w._cy = fr.cy; }
          giveRandomVelocity(w);
          return;
        }

        if (road.type === 'straight') {
          const relX = w._cx - road.x1;
          const relY = w._cy - road.y1;
          const perpDist = relX * road.px + relY * road.py;
          const maxPerp = road.halfW - PHYSICS.WALKER.r;

          if (Math.abs(perpDist) > maxPerp) {
            const sign = perpDist > 0 ? 1 : -1;
            w._cx -= road.px * (perpDist - sign * maxPerp);
            w._cy -= road.py * (perpDist - sign * maxPerp);
            const vPerp = w.vx * road.px + w.vy * road.py;
            w.vx -= 2 * vPerp * road.px * PHYSICS.ROAD.bounce;
            w.vy -= 2 * vPerp * road.py * PHYSICS.ROAD.bounce;
          }

          const alongDist = relX * road.ux + relY * road.uy;
          if (alongDist >= road.length || alongDist <= 0) {
            w.currentNode = alongDist >= road.length ? road.toId : road.fromId;
            w.clusterId = alongDist >= road.length ? road.toClusterId : road.fromClusterId;
            w.location = 'node';
            w.currentEdge = null;
            w.targetNode = null;
            w.paused = true;
            w.pauseEnd = now + randBetween(PHYSICS.WALKER.pauseMin, PHYSICS.WALKER.pauseMax);

            if (!w.isVillain) {
              if (activeFights.has(w.currentNode)) joinFight(w.currentNode);
              else spawnVillain(w.currentNode);
            }
          }
        } else {
          // Bezier road: parameterise motion by arc-length `edgeT`, 0..road.length.
          const dir = w.edgeDirection === 'forward' ? 1 : -1;
          if (w.edgeT == null) w.edgeT = dir > 0 ? 0 : road.length;

          const samp = _sampleAt(road.samples, w.edgeT);
          // Velocity projected onto the unit tangent — signed. Positive when
          // the walker is moving in the curve's forward direction.
          const speedAlong = w.vx * samp.tx + w.vy * samp.ty;
          w.edgeT += speedAlong * dtSec;

          // Lateral offset tracking (bounce off the curved corridor)
          if (w._perpOffset == null) w._perpOffset = 0;
          const lateralV = w.vx * samp.nx + w.vy * samp.ny;
          w._perpOffset += lateralV * dtSec;
          const maxPerp = road.halfW - PHYSICS.WALKER.r;
          if (Math.abs(w._perpOffset) > maxPerp) {
            const sign = w._perpOffset > 0 ? 1 : -1;
            w._perpOffset = sign * maxPerp;
            const vPerp = w.vx * samp.nx + w.vy * samp.ny;
            w.vx -= 2 * vPerp * samp.nx * PHYSICS.ROAD.bounce;
            w.vy -= 2 * vPerp * samp.ny * PHYSICS.ROAD.bounce;
          }

          w._cx = samp.x + samp.nx * w._perpOffset;
          w._cy = samp.y + samp.ny * w._perpOffset;

          // Also reorient velocity along the tangent so the walker doesn't
          // drift off-curve if the tangent changes (curves bend underfoot).
          const currentSpeed = Math.hypot(w.vx, w.vy);
          if (currentSpeed > 0.01) {
            const travelSign = Math.sign(speedAlong) || dir;
            w.vx = samp.tx * currentSpeed * travelSign;
            w.vy = samp.ty * currentSpeed * travelSign;
          }

          const reachedEnd = w.edgeT >= road.length || w.edgeT <= 0;
          if (reachedEnd) {
            const arrivedForward = w.edgeT >= road.length;
            w.currentNode = arrivedForward ? road.toId : road.fromId;
            w.clusterId = arrivedForward ? road.toClusterId : road.fromClusterId;
            w.location = 'node';
            w.currentEdge = null;
            w.targetNode = null;
            w.edgeT = null;
            w._perpOffset = 0;
            w.paused = true;
            w.pauseEnd = now + randBetween(PHYSICS.WALKER.pauseMin, PHYSICS.WALKER.pauseMax);

            if (!w.isVillain) {
              if (activeFights.has(w.currentNode)) joinFight(w.currentNode);
              else spawnVillain(w.currentNode);
            }
          }
        }
      }

      // Speed enforcement — use character moveSpeed during fights
      const charSpeed = w.state === W_STATE.FIGHTING ? (w.moveSpeedMult || PHYSICS.WALKER.speed) : PHYSICS.WALKER.speed;
      const spd = Math.hypot(w.vx, w.vy);
      if (spd > charSpeed * 1.5) {
        w.vx = (w.vx / spd) * charSpeed;
        w.vy = (w.vy / spd) * charSpeed;
      } else if (spd < charSpeed * 0.6) {
        const boost = charSpeed * 0.7;
        if (spd > 0.01) {
          w.vx = (w.vx / spd) * boost;
          w.vy = (w.vy / spd) * boost;
        } else {
          // Dead stop — give random direction
          const angle = Math.random() * Math.PI * 2;
          w.vx = Math.cos(angle) * boost;
          w.vy = Math.sin(angle) * boost;
        }
      }
    });

    // Keep camera centered on active fight (skip when zoomed — view is already locked)
    if (activeFights.size > 0 && !fightZoomed) {
      const fightNodeId = activeFights.keys().next().value;
      if (!tick._lastFightCenter || now - tick._lastFightCenter > 1000) {
        centerOnNode(fightNodeId);
        tick._lastFightCenter = now;
      }
    } else {
      tick._lastFightCenter = 0;
    }

    // Pass 1.5: fight damage processing
    processFightDamage(now, dtSec);

    // Pass 1.6: safety net — if every enrolled participant is defeated but
    // the villain has no one left to hit (so no damage event fires the
    // normal endgame check), resolve the fight here.
    activeFights.forEach((fight, nodeId) => {
      if (fight._resolving) return;
      if (fight.participants.size === 0) return;
      const anyLive = [...fight.participants].some(p => p.state !== W_STATE.DEFEATED);
      if (!anyLive && fight.villain.state !== W_STATE.DEFEATED) {
        handleVillainWins(fight, nodeId);
      }
    });

    // Pass 2: walker-walker elastic collision + encounter detection
    const graceActive = (now - deployTime < PHYSICS.FIGHT.deployGrace);
    for (let i = 0; i < activeWalkers.length; i++) {
      const a = activeWalkers[i];
      if (!a._spawned || a._cx == null || a.state === W_STATE.DEFEATED) continue;
      for (let j = i + 1; j < activeWalkers.length; j++) {
        const b = activeWalkers[j];
        if (!b._spawned || b._cx == null || b.state === W_STATE.DEFEATED) continue;

        const dx = b._cx - a._cx;
        const dy = b._cy - a._cy;
        const dist = Math.hypot(dx, dy);
        const minDist = PHYSICS.WALKER.size;

        if (dist < minDist && dist > 0.01) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;

          const aLocked = a.state === W_STATE.ENCOUNTER;
          const bLocked = b.state === W_STATE.ENCOUNTER;

          if (aLocked && bLocked) {
            continue;
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
            if (aVn > 0) { a.vx -= 2 * aVn * nx * PHYSICS.ROAD.bounce; a.vy -= 2 * aVn * ny * PHYSICS.ROAD.bounce; }
          } else if (aLocked && !bLocked) {
            const bVn = b.vx * nx + b.vy * ny;
            if (bVn < 0) { b.vx -= 2 * bVn * nx * PHYSICS.ROAD.bounce; b.vy -= 2 * bVn * ny * PHYSICS.ROAD.bounce; }
          }
        }

        // Encounter detection (suppress during fights)
        if (!graceActive && !encounterRunning && encounterQueue.length === 0 &&
            dist < PHYSICS.ENCOUNTER.dist &&
            a.state === W_STATE.WALKING && b.state === W_STATE.WALKING &&
            !a.isVillain && !b.isVillain &&
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

    // Pass 3: apply to DOM + weapon/HP positions
    activeWalkers.forEach(w => {
      if (w._spawned && w.state !== W_STATE.ENCOUNTER) applyWalkerPosition(w);

      // Update melee weapon orbit position + rotation (every character has one)
      if (w.state === W_STATE.FIGHTING && w.state !== W_STATE.DEFEATED && w.weaponEl) {
        const wx = w._cx + Math.cos(w.weaponAngle) * PHYSICS.WEAPON.radius;
        const wy = w._cy + Math.sin(w.weaponAngle) * PHYSICS.WEAPON.radius;
        w.weaponEl.style.left = (wx - PHYSICS.WEAPON.size / 2) + 'px';
        w.weaponEl.style.top = (wy - PHYSICS.WEAPON.size / 2) + 'px';
        const deg = (w.weaponAngle * 180 / Math.PI) + 90;
        w.weaponEl.style.transform = `rotate(${deg}deg)`;
      }

      // Update HP display (numeric + bar)
      if (w.state === W_STATE.FIGHTING && w.hpEl) {
        const hpPct = Math.max(0, w.hp / w.maxHp);
        const low = hpPct < 0.3;
        const warn = !low && hpPct < 0.6;

        w.hpEl.style.left = w._cx + 'px';
        w.hpEl.style.top = (w._cy - PHYSICS.WALKER.r - 18) + 'px';
        w.hpEl.textContent = Math.max(0, Math.ceil(w.hp));
        w.hpEl.classList.toggle('low', low);
        w.hpEl.classList.toggle('warn', warn);

        if (w.hpBarEl) {
          w.hpBarEl.style.left = w._cx + 'px';
          w.hpBarEl.style.top = (w._cy - PHYSICS.WALKER.r - 8) + 'px';
          w.hpBarEl.classList.toggle('low', low);
          w.hpBarEl.classList.toggle('warn', warn);
          const fill = w.hpBarEl.firstElementChild;
          if (fill) fill.style.transform = `scaleX(${hpPct})`;
        }
      }
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
    const result = raw.filter(e => {
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

    // Resolve stage: -1 → actual highest unlocked stage index
    let needsSave = false;
    result.forEach(e => {
      if (e.stage === -1) {
        const char = charMap.get(e.id);
        if (char) {
          e.stage = getCharStages(char, state).length - 1;
          needsSave = true;
        }
      }
    });
    if (needsSave && overrideSelections === null) {
      saveSelections(result);
    }

    return result;
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
        clusterId: getClusterOf(startNode),
        targetNode: null,
        previousNode: null,
        vx: 0, vy: 0,
        _cx: 0, _cy: 0,
        currentEdge: null,
        location: 'node',
        state: W_STATE.WALKING,
        paused: true,
        pauseEnd: spawnAt,
        _spawned: spawnIndex === 0
      };

      // Initialize fight stats
      initFightProps(w);

      // Spawn at a RANDOM position inside the start node's location rectangle
      // (rather than at the pin's exact coordinates, which sit in the bottom
      // shelf). Walker physics bounces off the location's outer edges.
      const rect = getClusterRects().get(getClusterOf(startNode));
      if (rect) {
        const inset = PHYSICS.WALKER.r + 4;
        w._cx = rect.minX + inset + Math.random() * Math.max(1, rect.width - inset * 2);
        w._cy = rect.minY + inset + Math.random() * Math.max(1, rect.height - inset * 2);
        applyWalkerPosition(w);
      } else {
        const pos = getNodeCenter(startNode);
        if (pos) { w._cx = pos.x; w._cy = pos.y; applyWalkerPosition(w); }
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
    // Pending fight-zoom cleanup timer — if unmount runs mid-fight, the
    // 500ms timer would fire with `renderer.mapContainer` already nulled
    // and throw.
    if (zoomEndTimer) {
      clearTimeout(zoomEndTimer);
      zoomEndTimer = null;
    }
    activeWalkers.forEach(w => {
      w.el?.remove();
      w.weaponEl?.remove();
      w.hpEl?.remove();
    });
    activeWalkers = [];
    activeBubbles.forEach(b => b.el.remove());
    activeBubbles = [];
    encounterQueue = [];
    encounterRunning = false;
    encounterCooldowns.clear();
    activeFights.clear();
    faintedWalkers.clear();
    activeProjectiles.forEach(p => p.el.remove());
    activeProjectiles = [];
    // Reset zoom if active
    if (fightZoomed) {
      const container = renderer.mapContainer;
      if (container) { container.style.transform = ''; container.style.transformOrigin = ''; container.style.transition = ''; }
      fightZoomed = false;
    }
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
            <span class="walker-remove">✕</span>
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
              info.textContent = `${getMaxSlots()} / ${getMaxSlots()} — tap a selected walker to swap`;
              info.style.color = '#E23636';
              setTimeout(() => {
                updateSlotCount();
                info.style.color = '';
              }, 1500);
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
  let _stateUnsubscribe = null;
  let _pendingDeployTimer = null;
  async function init() {
    if (!_walkerInitDone) {
      await loadFromServer();
      // Capture the unsubscribe handle so resetInit() (logout) can clean up.
      // Without this, each logout→login cycle adds another subscriber, which
      // multiplies deploy() calls across sessions.
      _stateUnsubscribe = state.subscribe(() => {
        if (_pendingDeployTimer) clearTimeout(_pendingDeployTimer);
        _pendingDeployTimer = setTimeout(() => {
          _pendingDeployTimer = null;
          deploy();
        }, 300);
      });
      _walkerInitDone = true;
    }
  }

  function resetInit() {
    if (_stateUnsubscribe) {
      _stateUnsubscribe();
      _stateUnsubscribe = null;
    }
    if (_pendingDeployTimer) {
      clearTimeout(_pendingDeployTimer);
      _pendingDeployTimer = null;
    }
    _walkerInitDone = false;
  }

  return { init, deploy, destroy, resetInit, showWalkerPicker, getSelectedIds, getSelectedEntries, getMaxSlots, getUnlockedCharacters, toggleCharacter, setCharacterStage, setSelections, deployWithSelections, restoreSelections };
})();
