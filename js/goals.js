/************************************************
 * GOALS — the road to Avengers: Doomsday
 *
 * One checklist: Marvel's official "stream these before Avengers: Doomsday"
 * list (marvel.com), ticked off against what the user has watched. It
 * replaced the old "one step ahead" goals (every locked title whose
 * requirements were all in view), so this panel now names titles the user
 * may not have unlocked yet — on purpose, it's Marvel's public list.
 *
 * The list lives in js/share-logic.js (the story share and its server-side
 * link preview count the same titles).
 ************************************************/

const DOOMSDAY_ID = ShareLogic.DOOMSDAY_ID;

// → { target, items: [{ id, title, watched, ready }], met, total }
// ready = unlocked and not watched yet (something you can watch now).
// The ticking-off is ShareLogic.doomsdayProgress, the same rule the
// server's link preview uses ("3 of 16"), so page, card and preview agree;
// a title the live content doesn't have is left off.
function computeDoomsdayGoal() {
  const byId = state.byId;
  const prog = ShareLogic.doomsdayProgress(state.data.keys(), id => !!byId?.has(id));
  const items = prog.items.map(({ id, watched }) => {
    const p = byId.get(id);
    return { id, title: p.title || id, watched, ready: !watched && isUnlocked(p) };
  });
  return {
    target: byId?.get(DOOMSDAY_ID) || null,
    items,
    met: prog.met,
    total: prog.total
  };
}

// "in theaters December 18" before release, "now in theaters" after.
function _doomsdayReleaseText(target) {
  const iso = target && target.release;
  const d = iso ? new Date(iso + 'T00:00:00') : null;
  if (!d || isNaN(d)) return 'in theaters';
  if (d <= new Date()) return 'now in theaters';
  return 'in theaters ' + d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

/************************************************
 * GOALS PANEL UI — modeled on showFriendsPanel() in js/friends.js
 ************************************************/
function showGoalsPanel() {
  $('.goals-panel')?.remove();

  const g = computeDoomsdayGoal();
  const title = g.target ? g.target.title : 'Avengers: Doomsday';
  const seenTarget = g.target && state.isWatched(g.target.id);
  const pct = g.total ? Math.round((g.met / g.total) * 100) : 0;

  const panel = document.createElement('div');
  panel.className = 'goals-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'goals-panel-heading');

  const status = seenTarget
    ? `You've seen ${esc(title)}.`
    : g.met === g.total
      ? `All caught up — you're ready for ${esc(title)}.`
      : `${g.total - g.met} to go.`;

  const body = `
    <div class="goal-card goal-card--feature">
      <div class="goal-card-head">
        <span class="goal-card-title">${esc(title)}</span>
        <span class="goal-card-progress">${g.met} / ${g.total}</span>
      </div>
      <div class="goal-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${g.total}" aria-valuenow="${g.met}" aria-label="Titles watched">
        <span class="goal-progress-fill" style="width:${pct}%"></span>
      </div>
      <p class="goal-status">${status}</p>
      <ul class="goal-req-list">
        ${g.items.map(r => `
          <li class="goal-req${r.watched ? ' is-met' : ''}${!r.watched && !r.ready ? ' is-locked' : ''}"
              data-action="${r.ready ? 'goal-req' : ''}" data-id="${esc(r.id)}"${r.ready ? ' tabindex="0" role="button"' : ''}
              ${!r.watched && !r.ready ? 'title="Not unlocked yet — keep watching to reach it"' : ''}>
            <span class="goal-req-mark">${r.watched ? '✓' : '✗'}</span>
            <span class="goal-req-title">${esc(r.title)}</span>
          </li>
        `).join('')}
      </ul>
    </div>
  `;

  panel.innerHTML = `
    <div class="goals-box">
      <button class="popup-close" id="close-goals" aria-label="Close">✕</button>
      <h3 id="goals-panel-heading">Goals</h3>
      <p class="goals-subtitle">Stream these on Disney+, then catch <strong>${esc(title)}</strong> ${_doomsdayReleaseText(g.target)}.</p>
      <div class="goals-list">${body}</div>
      ${state.readonly ? '' : `<button type="button" class="btn btn--primary goals-share-btn" id="goals-share">Share to story</button>`}
    </div>
  `;

  document.body.appendChild(panel);

  const close = wireModalDismiss(panel, () => panel.remove(), {
    initialFocus: panel.querySelector('#close-goals')
  });
  panel.querySelector('#close-goals').addEventListener('click', close);
  panel.querySelector('#goals-share')?.addEventListener('click', () => {
    close();
    ShareProgress.open();
  });
  activateOnKey(panel, '.goal-req[data-action="goal-req"]');

  panel.querySelectorAll('.goal-req[data-action="goal-req"]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const project = state.byId?.get(id);
      if (!project) return;
      close();
      const cell = document.querySelector(`.flow-cell[data-id="${CSS.escape(id)}"]`);
      if (cell) {
        cell.scrollIntoView({ block: 'center', inline: 'center', behavior: smoothBehavior() });
        cell.classList.add('goal-highlight');
        setTimeout(() => cell.classList.remove('goal-highlight'), 1600);
      }
      showPopup(project);
    });
  });
}
