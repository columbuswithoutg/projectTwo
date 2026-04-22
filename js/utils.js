/************************************************
 * UTILITY FUNCTIONS
 ************************************************/
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randBetween = (min, max) => min + Math.random() * (max - min);

// Escape HTML for safe interpolation into innerHTML. User-controlled strings
// (usernames, project titles from friends' data, memory captions, file URLs)
// must go through this before reaching template literals.
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

/************************************************
 * VISIBILITY & UNLOCK LOGIC
 ************************************************/
const isPhaseUnlocked = (p) => {
  if (p.phaseNum === 1) return true;
  const unlockerId = PHASE_UNLOCKERS[p.phaseNum];
  return unlockerId && state.isWatched(unlockerId);
};

const allPrereqs = (p) => [
  ...(p.prerequisites || []),
  ...(p.hiddenPrerequisites || [])
];

const isUnlocked = (p) => {
  if (!isPhaseUnlocked(p)) return false;
  return allPrereqs(p).every(id => state.isWatched(id));
};

// Only watched projects sit on the world map. Unlocked-but-unwatched pins
// (including the start node for new users) live on the bottom "up-next"
// shelf — the map shows what's been seen, the shelf shows what's next.
const isVisible = (p) => state.isWatched(p.id);

const isRevealed = (p) =>
  !state.isWatched(p.id) && isUnlocked(p);

const getHighestUnlockedPhase = () => {
  const unlocked = projects.filter(isPhaseUnlocked);
  return unlocked.length ? Math.max(...unlocked.map(p => p.phaseNum)) : 1;
};

/************************************************
 * WORLD COORDINATES & ROAD GEOMETRY (cached)
 *
 * Push-based invalidation: state.subscribe fires on every watch/unwatch,
 * which bumps a version counter. Cached artifacts compare their saved
 * version to the current one — cheap integer compare instead of rebuilding
 * a string key every call (called hundreds of times per physics tick).
 ************************************************/
let _layoutVersion = 0;
let _cachedLayout = null;
let _cachedLayoutVersion = -1;
let _cachedClusterRects = null;
let _cachedRoadGeometry = null;

function invalidateLayoutCache() {
  _layoutVersion++;
  _cachedLayout = null;
  _cachedClusterRects = null;
  _cachedRoadGeometry = null;
}

function getLayoutVersion() { return _layoutVersion; }

function getLayout() {
  if (_cachedLayout && _cachedLayoutVersion === _layoutVersion) return _cachedLayout;
  _cachedLayout = LayoutSystem.computeLayout(projects, isVisible);
  _cachedLayoutVersion = _layoutVersion;
  _cachedClusterRects = null;
  _cachedRoadGeometry = null;
  return _cachedLayout;
}

function getClusterRects() {
  if (_cachedClusterRects) return _cachedClusterRects;
  _cachedClusterRects = LayoutSystem.computeClusterRects(getLayout());
  return _cachedClusterRects;
}

function getRoadGeometry() {
  if (_cachedRoadGeometry) return _cachedRoadGeometry;
  _cachedRoadGeometry = LayoutSystem.buildRoadGeometry(projects, getLayout(), getClusterRects());
  return _cachedRoadGeometry;
}

function getNodePosition(id) {
  return getLayout().get(id) || null;
}

// Subscribe once to state changes so cached artifacts invalidate whenever
// visibility could have changed (watch/unwatch/clear). state.save fires
// listeners, and state.clear does too — covers all mutations we care about.
if (typeof state !== 'undefined' && typeof state.subscribe === 'function') {
  state.subscribe(invalidateLayoutCache);
}
