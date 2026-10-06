/************************************************
 * PROJECT LOGIC — pure helpers behind the admin project editor
 *
 *   lockDeps(p)            ids that LOCK p: required + hidden prerequisites
 *                          + its phase's unlocker (Phase N waits for one title)
 *   findPrereqCycle()      would saving this edit create a lock loop (projects
 *                          that wait on each other and so can never unlock)?
 *   dependentsOf()         everything whose locks lead back to a project — the
 *                          candidates that would close a loop if required
 *   validatePrereqLists()  explicit errors instead of the old silent trimming
 *                          (unknown ids, self, both lists, too many, bad ids)
 *   occupiedCells() / firstFreeCell() / defaultNewCell()
 *                          a board cell for "+ Add new" that isn't taken
 *
 * Shared by: routes/admin.js (server validation),
 *            js/views/admin/cms-projects.js + prereq-picker.js (the form).
 * Unit tests: test/project-logic.test.js.
 *
 * UMD-ish: attaches to window.ProjectLogic in the browser, exports via
 * module.exports under Node (same pattern as messaging-logic.js).
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ProjectLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Mirrors PHASE_UNLOCKERS in js/config.js and server/watchRules.js.
  const DEFAULT_PHASE_UNLOCKERS = { 2: 'avengers1', 3: 'ageofultron', 4: 'endgame', 5: 'loki1', 6: 'loki2' };
  const ID_REGEX = /^[a-z0-9_-]{1,80}$/i;
  const PREREQ_MAX = 20;

  function parsePhase(phase) {
    if (typeof phase === 'number') return phase;
    const m = String(phase || '').match(/\d+/);
    return m ? +m[0] : 1;
  }

  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

  // [{ id, via }] — what must be watched before p can start.
  function lockDeps(p, phaseUnlockers) {
    const pu = phaseUnlockers || DEFAULT_PHASE_UNLOCKERS;
    const out = [];
    for (const id of list(p && p.prerequisites)) out.push({ id, via: 'required' });
    for (const id of list(p && p.hiddenPrerequisites)) out.push({ id, via: 'hidden' });
    const phase = parsePhase(p && p.phase);
    if (phase !== 1 && pu[phase]) out.push({ id: pu[phase], via: 'phase' });
    return out;
  }

  // id → project, with `edit` (a project with id + any changed fields)
  // merged over the stored copy.
  function _byId(projects, edit) {
    const m = new Map();
    for (const p of projects || []) if (p && p.id) m.set(p.id, p);
    if (edit && edit.id) m.set(edit.id, Object.assign({}, m.get(edit.id) || {}, edit));
    return m;
  }

  // Would `edit` (saved over `projects`) sit on a lock loop? → null, or the
  // loop as [{ id, via }] starting and ending at edit.id (via = how each step
  // locks the previous one: 'required' | 'hidden' | 'phase').
  function findPrereqCycle(projects, edit, opts) {
    if (!edit || !edit.id) return null;
    const pu = (opts && opts.phaseUnlockers) || DEFAULT_PHASE_UNLOCKERS;
    const byId = _byId(projects, edit);
    const start = edit.id;
    const seen = new Set();
    // Iterative DFS keeping the path, so long chains can't blow the stack.
    const stack = [{ id: start, deps: lockDeps(byId.get(start), pu), i: 0 }];
    const path = [{ id: start, via: null }];
    seen.add(start);
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.i >= top.deps.length) { stack.pop(); path.pop(); continue; }
      const dep = top.deps[top.i++];
      if (dep.id === start) return path.concat([{ id: start, via: dep.via }]);
      if (seen.has(dep.id) || !byId.has(dep.id)) continue;   // unknown ids can't lock anything
      seen.add(dep.id);
      stack.push({ id: dep.id, deps: lockDeps(byId.get(dep.id), pu), i: 0 });
      path.push({ id: dep.id, via: dep.via });
    }
    return null;
  }

  // Ids whose locks lead (directly or through others) back to `id`. Making
  // any of them a required prerequisite of `id` would close a loop.
  function dependentsOf(projects, id, opts) {
    const pu = (opts && opts.phaseUnlockers) || DEFAULT_PHASE_UNLOCKERS;
    const rev = new Map();   // dep id → [ids that wait on it]
    for (const p of projects || []) {
      if (!p || !p.id) continue;
      for (const d of lockDeps(p, pu)) {
        if (!rev.has(d.id)) rev.set(d.id, []);
        rev.get(d.id).push(p.id);
      }
    }
    const out = new Set();
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift();
      for (const next of rev.get(cur) || []) {
        if (next === id || out.has(next)) continue;
        out.add(next);
        queue.push(next);
      }
    }
    return out;
  }

  // Projects that list `id` directly as a required prerequisite.
  function requiredBy(projects, id) {
    return (projects || []).filter((p) => p && list(p.prerequisites).includes(id)).map((p) => p.id);
  }

  // Validate both lists of a project edit against the known project ids.
  // → { required, recommended, errors: [{ code, ids?, list? }] } — the lists
  //   come back de-duplicated; nothing is ever dropped silently.
  function validatePrereqLists(edit, knownIds, opts) {
    const max = (opts && opts.max) || PREREQ_MAX;
    const known = knownIds instanceof Set ? knownIds : new Set(knownIds || []);
    const selfId = edit && edit.id;
    const errors = [];
    const clean = (raw, name) => {
      if (raw != null && !Array.isArray(raw)) { errors.push({ code: 'not-a-list', list: name }); return []; }
      const ids = [];
      const bad = [];
      for (const v of raw || []) {
        if (typeof v !== 'string' || !ID_REGEX.test(v)) { bad.push(String(v)); continue; }
        if (!ids.includes(v)) ids.push(v);
      }
      if (bad.length) errors.push({ code: 'bad-id', list: name, ids: bad });
      if (selfId && ids.includes(selfId)) errors.push({ code: 'self', list: name, ids: [selfId] });
      const unknown = ids.filter((id) => id !== selfId && !known.has(id));
      if (unknown.length) errors.push({ code: 'unknown', list: name, ids: unknown });
      if (ids.length > max) errors.push({ code: 'too-many', list: name, max, count: ids.length });
      return ids;
    };
    const required = clean(edit && edit.prerequisites, 'required');
    const recommended = clean(edit && edit.recommendedPrerequisites, 'recommended');
    const both = recommended.filter((id) => required.includes(id));
    if (both.length) errors.push({ code: 'both', ids: both });
    return { required, recommended, errors };
  }

  // One readable sentence for an error from validatePrereqLists /
  // findPrereqCycle. titleOf(id) → display title.
  function errorText(err, titleOf) {
    const t = titleOf || ((id) => id);
    const names = (ids) => (ids || []).map(t).join(', ');
    const where = err.list === 'recommended' ? 'recommended prerequisites' : 'required prerequisites';
    switch (err.code) {
      case 'not-a-list': return `The ${where} must be a list.`;
      case 'bad-id':     return `Invalid project id in the ${where}: ${names(err.ids)}.`;
      case 'self':       return 'A project can’t be its own prerequisite.';
      case 'unknown':    return `No project with id ${names(err.ids)} — remove it from the ${where}.`;
      case 'too-many':   return `At most ${err.max} ${where} (this has ${err.count}).`;
      case 'both':       return `${names(err.ids)} can’t be both required and recommended.`;
      case 'cycle':      return `${(err.path || []).map((s) => t(s.id)).join(' → ')}: projects in a loop wait on each other and can never unlock.`;
      default:           return 'Invalid prerequisites.';
    }
  }

  // ── board cells ──

  function occupiedCells(projects, excludeId) {
    const occ = new Map();   // "gx,gy" → id
    for (const p of projects || []) {
      if (!p || p.id === excludeId) continue;
      occ.set(`${p.gridX | 0},${p.gridY | 0}`, p.id);
    }
    return occ;
  }

  // The first free cell searching outward from `anchor` in square rings,
  // in a fixed order (top row →, right column ↓, bottom row ←, left column ↑).
  function firstFreeCell(occ, opts) {
    const a = (opts && opts.anchor) || { gx: 0, gy: 0 };
    const maxR = opts && opts.maxRadius != null ? opts.maxRadius : 40;
    const free = (gx, gy) => !occ.has(`${gx},${gy}`);
    if (free(a.gx, a.gy)) return { gx: a.gx, gy: a.gy };
    for (let r = 1; r <= maxR; r++) {
      for (let x = a.gx - r; x <= a.gx + r; x++) if (free(x, a.gy - r)) return { gx: x, gy: a.gy - r };
      for (let y = a.gy - r + 1; y <= a.gy + r; y++) if (free(a.gx + r, y)) return { gx: a.gx + r, gy: y };
      for (let x = a.gx + r - 1; x >= a.gx - r; x--) if (free(x, a.gy + r)) return { gx: x, gy: a.gy + r };
      for (let y = a.gy + r - 1; y > a.gy - r; y--) if (free(a.gx - r, y)) return { gx: a.gx - r, gy: y };
    }
    return null;
  }

  // Where "+ Add new" puts a project: the first free cell below the lowest
  // row (column 0), so it shows up at the bottom of the board, never on top
  // of another project.
  function defaultNewCell(projects) {
    let maxY = -1;
    for (const p of projects || []) if (p && Number.isFinite(p.gridY)) maxY = Math.max(maxY, p.gridY | 0);
    return firstFreeCell(occupiedCells(projects), { anchor: { gx: 0, gy: maxY + 1 } }) || { gx: 0, gy: maxY + 1 };
  }

  return {
    DEFAULT_PHASE_UNLOCKERS, ID_REGEX, PREREQ_MAX,
    parsePhase, lockDeps, findPrereqCycle, dependentsOf, requiredBy,
    validatePrereqLists, errorText,
    occupiedCells, firstFreeCell, defaultNewCell
  };
});
