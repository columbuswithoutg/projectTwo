/************************************************
 * NODE FACTORY
 * Shared DOM creation + state class logic for project nodes.
 * Used by both the geographic map renderer and the flowchart
 * watch-order renderer so visual identity stays consistent.
 ************************************************/
const NodeFactory = (() => {
  function create(project) {
    const node = document.createElement("div");
    node.className = "node pin";
    node.dataset.id = project.id;
    node.title = project.title || project.id;

    if (project.image) {
      const img = document.createElement("img");
      img.src = CONFIG.IMAGE_BASE + project.image;
      img.loading = "lazy";
      img.draggable = false;
      img.alt = "";
      img.onerror = () => img.remove();
      node.appendChild(img);
    }

    const check = document.createElement("span");
    check.className = "checkmark";
    check.textContent = "✔";
    node.appendChild(check);

    updateState(node, project);
    return node;
  }

  function updateState(node, project) {
    const isWatched = state.isWatched(project.id);
    const locked = !isUnlocked(project);
    node.classList.toggle("watched", isWatched);
    node.classList.toggle("locked", locked);
  }

  return { create, updateState };
})();
