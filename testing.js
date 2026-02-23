/************************************************
 * CONFIG
 ************************************************/
const H_SPACING = 200; // horizontal space between nodes (gridX)
const V_SPACING = 140; // vertical space between nodes (gridY)
const PHASE_Y_OFFSET = 0; // Phase 1 only

/************************************************
 * DATA: PHASE 1 UPDATED
 ************************************************/
const projects = [
    { id: "ironman1", title: "Iron Man (2008)", prerequisites: [], phase: "Phase 1", gridX: 0, gridY: 1, watched: false },
    { id: "ironman2", title: "Iron Man 2 (2010)", prerequisites: ["ironman1"], phase: "Phase 1", gridX: 0, gridY: 2, watched: false },
    { id: "thor1", title: "Thor (2011)", prerequisites: ["ironman2"], phase: "Phase 1", gridX: 0, gridY: 3, watched: false },
    { id: "hulk", title: "The Incredible Hulk (2008)", prerequisites: ["ironman2"], phase: "Phase 1", gridX: -1, gridY: 3, watched: false },
    { id: "cap1", title: "Captain America: The First Avenger (2011)", prerequisites: ["ironman2"], phase: "Phase 1", gridX: 1, gridY: 3, watched: false },

    {
        id: "avengers1",
        title: "The Avengers (2012)",
        prerequisites: ["thor1", "cap1", "hulk"],
        phase: "Phase 1",
        gridX: 0,
        gridY: 4,
        watched: false
    }
];

/************************************************
 * STATE / STORAGE
 ************************************************/
const saved = JSON.parse(localStorage.getItem("watchProgress") || "{}");
projects.forEach(p => {
  if (saved[p.id] !== undefined) p.watched = saved[p.id];
});

/************************************************
 * PHASE INDEX
 ************************************************/
const phaseIndex = {};
[...new Set(projects.map(p => p.phase))].forEach((p, i) => phaseIndex[p] = i);

/************************************************
 * HELPERS
 ************************************************/
function isUnlocked(project) {
  return project.prerequisites.every(id => projects.find(p => p.id === id)?.watched);
}

function gridToPixelX(x) {
  const container = document.getElementById("map-container");
  return container.clientWidth / 2 + x * H_SPACING - 60; // -60 centers node
}

function gridToPixelY(project) {
  const container = document.getElementById("map-container");
  const height = container.clientHeight || 700;
  const offset = phaseIndex[project.phase] * PHASE_Y_OFFSET * V_SPACING;
  return height - (project.gridY * V_SPACING + offset);
}

/************************************************
 * RENDER FUNCTIONS
 ************************************************/
function renderPhases() {
  const container = document.getElementById("phase-labels");
  container.innerHTML = "";

  [...new Set(projects.map(p => p.phase))].forEach(phase => {
    const div = document.createElement("div");
    div.className = "phase";
    div.textContent = phase;
    container.appendChild(div);
  });
}

function renderNodes() {
  const nodeContainer = document.getElementById("nodes");
  nodeContainer.innerHTML = "";

  projects.forEach(project => {
    const unlocked = isUnlocked(project);

    const node = document.createElement("div");
    node.className = "node";
    if (!unlocked && !project.watched) node.classList.add("locked");
    if (project.watched) node.classList.add("watched");

    node.style.left = `${gridToPixelX(project.gridX)}px`;
    node.style.top = `${gridToPixelY(project)}px`;

    node.textContent = project.title;

    if (unlocked && !project.watched) {
      node.onclick = () => {
        showChoicePopup(project);
      };
    }

    nodeContainer.appendChild(node);
  });
}

function renderConnections() {
    const svg = document.getElementById("connections");
    svg.innerHTML = "";
  
    projects.forEach(target => {
      // Only draw connections to unlocked nodes
      if (!isUnlocked(target) && !target.watched) return;
  
      target.prerequisites.forEach(pid => {
        const prereq = projects.find(p => p.id === pid);
        if (!prereq) return;
  
        // Draw line from prerequisite to unlocked target node
        const x1 = gridToPixelX(prereq.gridX)-410;
        const y1 = gridToPixelY(prereq);
        const x2 = gridToPixelX(target.gridX)-410;
        const y2 = gridToPixelY(target);
  
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", x1);
        line.setAttribute("y1", y1);
        line.setAttribute("x2", x2);
        line.setAttribute("y2", y2);
        line.setAttribute("stroke", "#94a3b8");
        line.setAttribute("stroke-width", "3");
  
        svg.appendChild(line);
      });
    });
  }

/************************************************
 * STORAGE
 ************************************************/
function saveProgress() {
  const data = {};
  projects.forEach(p => data[p.id] = p.watched);
  localStorage.setItem("watchProgress", JSON.stringify(data));
}

/************************************************
 * CLEAR FUNCTION
 ************************************************/
function clearProgress() {
  localStorage.removeItem("watchProgress");
  projects.forEach(p => p.watched = false);
  renderAll();
}

/************************************************
 * POPUP LOGIC
 ************************************************/
function showChoicePopup(project) {
  const popup = document.createElement("div");
  popup.style.position = "fixed";
  popup.style.top = "50%";
  popup.style.left = "50%";
  popup.style.transform = "translate(-50%, -50%)";
  popup.style.background = "#1e293b";
  popup.style.padding = "20px";
  popup.style.borderRadius = "8px";
  popup.style.boxShadow = "0 0 10px #000";
  popup.style.zIndex = "1000";

  const text = document.createElement("p");
  text.style.color = "#fff";
  text.textContent = `Choose an action for "${project.title}"`;
  popup.appendChild(text);

  const markBtn = document.createElement("button");
  markBtn.textContent = "Marked as watched";
  markBtn.style.marginTop = "10px";
  markBtn.style.padding = "6px 12px";
  markBtn.style.cursor = "pointer";
  markBtn.onclick = () => {
    project.watched = true;
    saveProgress();
    document.body.removeChild(popup);
    renderAll();
  };

  popup.appendChild(markBtn);

  // optional: click outside to close
  popup.onclick = (e) => {
    if (e.target === popup) document.body.removeChild(popup);
  };

  document.body.appendChild(popup);
}

/************************************************
 * CLEAR BUTTON RENDER
 ************************************************/
function renderClearButton() {
  let container = document.getElementById("clear-button-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "clear-button-container";
    container.style.margin = "10px";
    document.body.insertBefore(container, document.getElementById("map-container"));
  }
  container.innerHTML = "";

  const btn = document.createElement("button");
  btn.textContent = "Clear Progress";
  btn.style.padding = "8px 16px";
  btn.style.border = "none";
  btn.style.borderRadius = "6px";
  btn.style.background = "#ef4444";
  btn.style.color = "#fff";
  btn.style.cursor = "pointer";
  btn.onclick = clearProgress;

  container.appendChild(btn);
}

/************************************************
 * MAIN
 ************************************************/
function renderAll() {
  renderPhases();
  renderNodes();
  renderConnections();
  renderClearButton();
}

renderAll();
window.onresize = renderAll;