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
 * COORDINATE SYSTEM
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

const toPixel = (gridX, gridY, bounds) => ({
  x: (gridX - bounds.minX) * CONFIG.H_SPACING,
  y: (gridY - bounds.minY) * CONFIG.V_SPACING
});
