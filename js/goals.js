/************************************************
 * GOALS — "what's needed to watch a project" guide
 *
 * Locked projects are intentionally invisible everywhere else (map:
 * display:none, flowchart: not rendered, both click handlers silently
 * no-op) — see isUnlocked()/isVisible()/isRevealed() in js/utils.js. That
 * leaves nothing to explain WHY a title is locked. This panel answers
 * that, but deliberately only "one step ahead": a locked project is listed
 * here only when every one of its requirements is already watched or
 * revealed (i.e. something the user can already see). Anything deeper in
 * the chain simply doesn't appear — no title the user hasn't reached yet
 * is ever named.
 *
 * computeGoals() reuses isUnlocked/isPhaseUnlocked/isRevealed/allPrereqs
 * from js/utils.js verbatim rather than reimplementing the unlock rules.
 ************************************************/

// A project qualifies as a "goal" when it's locked, not yet watched, and
// EVERY one of its requirements (prerequisites + hiddenPrerequisites, plus
// its phase unlocker if the phase itself isn't open yet) is something the
// user can already see — watched or revealed. This is a single filter, not
// a recursive walk: a requirement that is itself still locked disqualifies
// the whole goal from appearing at all.
function computeGoals() {
  if (typeof projects === 'undefined' || !Array.isArray(projects)) return [];

  const goals = [];
  for (const p of projects) {
    if (state.isWatched(p.id)) continue;
    if (isUnlocked(p)) continue; // already revealed — not a "goal", it's ready to watch

    const reqIds = allPrereqs(p).slice();
    if (!isPhaseUnlocked(p)) {
      const unlockerId = PHASE_UNLOCKERS[p.phaseNum];
      if (unlockerId) reqIds.push(unlockerId);
    }
    if (!reqIds.length) continue; // nothing to show a checklist for

    const seenReq = new Set();
    const requirements = [];
    let visible = true;
    for (const id of reqIds) {
      if (seenReq.has(id)) continue;
      seenReq.add(id);
      const req = state.byId?.get(id);
      const watched = state.isWatched(id);
      const revealed = !watched && req && isRevealed(req);
      if (!watched && !revealed) { visible = false; break; }
      requirements.push({ id, title: req ? (req.title || id) : id, watched });
    }
    if (!visible) continue;

    const met = requirements.filter(r => r.watched).length;
    goals.push({ project: p, requirements, met, total: requirements.length });
  }

  // Closest-to-complete first.
  goals.sort((a, b) => (b.met / b.total) - (a.met / a.total));
  return goals;
}

/************************************************
 * GOALS PANEL UI — modeled on showFriendsPanel() in js/friends.js
 ************************************************/
function showGoalsPanel() {
  $('.goals-panel')?.remove();

  const goals = computeGoals();

  const panel = document.createElement('div');
  panel.className = 'goals-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'goals-panel-heading');

  const body = goals.length
    ? goals.map(g => `
        <div class="goal-card">
          <div class="goal-card-head">
            <span class="goal-card-title">${esc(g.project.title)}</span>
            <span class="goal-card-progress">${g.met} / ${g.total}</span>
          </div>
          <ul class="goal-req-list">
            ${g.requirements.map(r => `
              <li class="goal-req${r.watched ? ' is-met' : ''}" data-action="${r.watched ? '' : 'goal-req'}" data-id="${esc(r.id)}">
                <span class="goal-req-mark">${r.watched ? '✓' : '✗'}</span>
                <span class="goal-req-title">${esc(r.title)}</span>
              </li>
            `).join('')}
          </ul>
        </div>
      `).join('')
    : `<p class="goals-empty">Nothing new to work toward — keep watching.</p>`;

  panel.innerHTML = `
    <div class="goals-box">
      <button class="popup-close" id="close-goals" aria-label="Close">✕</button>
      <h3 id="goals-panel-heading">Goals</h3>
      <p class="goals-subtitle">What's next, one step ahead</p>
      <div class="goals-list">${body}</div>
    </div>
  `;

  document.body.appendChild(panel);

  const close = wireModalDismiss(panel, () => panel.remove(), {
    initialFocus: panel.querySelector('#close-goals')
  });
  panel.querySelector('#close-goals').addEventListener('click', close);

  panel.querySelectorAll('.goal-req[data-action="goal-req"]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const project = state.byId?.get(id);
      if (!project) return;
      close();
      const cell = document.querySelector(`.flow-cell[data-id="${CSS.escape(id)}"]`);
      if (cell) {
        cell.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        cell.classList.add('goal-highlight');
        setTimeout(() => cell.classList.remove('goal-highlight'), 1600);
      }
      showPopup(project);
    });
  });
}
