/************************************************
 * NODE FACTORY
 * Shared DOM creation + state class logic for project nodes.
 * Used by both the geographic map renderer and the flowchart
 * watch-order renderer so visual identity stays consistent.
 ************************************************/
const NodeFactory = (() => {
  // opts.focusable (default true): the node is a keyboard target (Tab +
  // Enter / Space via activateOnKey in the renderer). The chart passes false
  // and makes its wider .flow-cell the target instead, one stop per title.
  function create(project, opts = {}) {
    const node = document.createElement("div");
    node.className = "node pin";
    node.dataset.id = project.id;
    node.title = project.title || project.id;
    if (opts.focusable !== false) {
      node.setAttribute('role', 'button');
      node.dataset.focusable = '1';
    }

    // Title card underneath, poster on top (js/poster-art.js): a missing
    // poster file shows the card instead of an empty tile.
    PosterArt.mount(node, project, { alt: project.title || project.id });

    const check = document.createElement("span");
    check.className = "checkmark";
    check.textContent = "✔";
    node.appendChild(check);

    // Ribbon for a title on the Board's "In progress" column (timer running
    // or mid-series) — otherwise it looks identical to a not-started pin.
    const watching = document.createElement("span");
    watching.className = "watching-badge";
    watching.textContent = "▶ Watching";
    node.appendChild(watching);

    updateState(node, project);
    return node;
  }

  function updateState(node, project) {
    const isWatched = state.isWatched(project.id);
    const locked = !isUnlocked(project);
    const inProgress = state.isInProgress(project.id);
    node.classList.toggle("watched", isWatched);
    node.classList.toggle("locked", locked);
    node.classList.toggle("in-progress", inProgress);
    if (node.dataset.focusable) applyA11y(node, project, { isWatched, locked, inProgress });
  }

  // Accessible name + state for a keyboard target (a node, or the chart's
  // .flow-cell). Locked titles stay reachable so their name is read, but are
  // announced as unavailable and skipped by activateOnKey.
  function applyA11y(el, project, s) {
    const isWatched = s ? s.isWatched : state.isWatched(project.id);
    const locked = s ? s.locked : !isUnlocked(project);
    const inProgress = s ? s.inProgress : state.isInProgress(project.id);
    const open = !locked || isWatched;
    const status = isWatched ? 'watched' : inProgress ? 'watching' : open ? 'not started' : 'locked';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.setAttribute('aria-label', `${project.title || project.id}, ${status}`);
    el.setAttribute('aria-disabled', String(!open));
  }

  return { create, updateState, applyA11y };
})();
