/************************************************
 * PROJECT POPUP
 ************************************************/
// How many cast chips show before "+N more" — one row, so the popup still
// fits a short desktop window (Endgame alone lists 38).
const POPUP_CAST_PREVIEW = 6;

// The cast of a title from project-details.js, each in the look they wear
// in that title (not the newest look the user has unlocked). Ids the live
// character list doesn't have (renamed or removed in the CMS) are skipped.
function projectCast(projectId) {
  const d = (typeof projectDetails !== 'undefined') && projectDetails[projectId];
  if (!d || !Array.isArray(d.cast) || !Array.isArray(characters)) return [];
  const merged = (typeof MERGED_CHARACTER_IDS !== 'undefined') ? MERGED_CHARACTER_IDS : {};
  const seen = new Set();
  return d.cast.map(([id, look]) => {
    const ch = characters.find(c => c.id === (merged[id] || id));
    if (!ch || seen.has(ch.id)) return null;
    seen.add(ch.id);
    const stage = look !== 'base' && (ch.stages || []).find(s => s.after === look);
    return { ch, image: stage ? stage.image : ch.image, label: stage ? stage.look : '' };
  }).filter(Boolean);
}

// Spoiler-free synopsis for everyone; the cast only once the title is
// watched (it gives away who turns up). Hidden on a friend's read-only map:
// their progress isn't the viewer's, so it can't tell what's a spoiler.
function popupDetailsHtml(project, showCast) {
  const d = (typeof projectDetails !== 'undefined') && projectDetails[project.id];
  if (!d) return '';
  const cast = showCast ? projectCast(project.id) : [];
  const chip = ({ ch, image, label }) => `
        <li class="popup-cast-chip" title="${esc(label ? `${ch.name} — ${label}` : ch.name)}">
          <span class="character-avatar">${PosterArt.charHtml(ch, image, { alt: '' })}</span>
          <span class="popup-cast-name">${esc(ch.name)}</span>
        </li>`;
  return `
  ${d.synopsis ? `
  <div class="popup-synopsis">
    <p>${esc(d.synopsis)}</p>
  </div>` : ''}
  ${cast.length ? `
  <section class="popup-cast" aria-label="Characters in this title">
    <p class="popup-cast-label">Characters in this</p>
    <ul class="popup-cast-list">
      ${cast.slice(0, POPUP_CAST_PREVIEW).map(chip).join('')}
    </ul>
    ${cast.length > POPUP_CAST_PREVIEW ? `
    <ul class="popup-cast-list popup-cast-more" hidden>
      ${cast.slice(POPUP_CAST_PREVIEW).map(chip).join('')}
    </ul>
    <button type="button" class="popup-cast-toggle">+${cast.length - POPUP_CAST_PREVIEW} more</button>` : ''}
  </section>` : ''}`;
}

function showPopup(project) {
  $('.node-popup')?.remove();

  const isWatched = state.isWatched(project.id);
  const count = state.getCount(project.id);
  const memories = state.getMemories(project.id);
  const watchedWith = state.getWatchedWith(project.id);
  // Read-only while a friend's progress is shown (FriendView.enter sets
  // state.readonly on every /friend/:username tab): no watch controls,
  // memory edits or co-watch requests — those would act on OUR account.
  const isReadonly = !!state.readonly;

  const popup = document.createElement('div');
  popup.className = 'node-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-modal', 'true');
  popup.setAttribute('aria-label', project.title);
  popup.innerHTML = `
  <button class="popup-close" aria-label="Close">✕</button>
  <h3>${esc(project.title)}</h3>
  ${popupDetailsHtml(project, isWatched && !isReadonly)}

  ${isWatched ? `
    <p class="watch-count">${FriendView.getActive()?.shareToken
      ? 'Watched'   /* a share page carries watched status only, no counts */
      : `Watched ${count} time${count !== 1 ? 's' : ''}`}</p>
${watchedWith.length ? (() => {
      const currentUsername = Auth.getUsername();
      const formatted = watchedWith.map(name =>
        name === currentUsername ? '<span class="watched-with-you">✓ you</span>' : `<span>${esc(name)}</span>`
      );
      return `
    <div class="watched-with-info">
      <p class="watched-with-label">Watched with:</p>
      <div class="watched-with-list">
        ${formatted.map(f => `<div class="watched-with-entry">${f}</div>`).join('')}
      </div>
    </div>
  `;
    })() : ''}
  ` : ''}

${(() => {
    const rec = visibleRecommended(project);
    return rec.length ? `
  <div class="popup-recommended">
    <p class="popup-recommended-label">Recommended first <span>(optional)</span></p>
    <ul class="goal-req-list">
      ${rec.map(r => `
        <li class="goal-req is-optional${r.watched ? ' is-met' : ''}">
          <span class="goal-req-mark">${r.watched ? '✓' : '○'}</span>
          <span class="goal-req-title">${esc(r.title)}</span>
        </li>`).join('')}
    </ul>
  </div>` : '';
  })()}

${!isReadonly ? `
  <div class="popup-watch-controls"></div>
  ${isWatched ? `
    <button class="popup-action secondary" id="watched-with-friend-btn">Watched with a Friend</button>
    <button class="popup-action secondary" id="add-memory-btn">Add Memory</button>
  ` : ''}
` : ''}

  ${memories.length ? `
    <div class="memories-section">
      <h4>Memories</h4>
      <div class="memories-grid">
        ${memories.map((m, i) => `
          <div class="memory-item" data-index="${i}">
            ${m.type === 'video'
              ? `<video src="${esc(m.url)}" preload="metadata"></video>`
              : `<img src="${esc(m.url)}" alt="${esc(m.caption)}" loading="lazy" />`
            }
            <div class="memory-overlay">
              <button class="memory-view-btn" data-index="${i}" data-url="${esc(m.url)}">View</button>
              ${!isReadonly ? `<button class="memory-delete" type="button" data-url="${esc(m.url)}" title="Delete memory" aria-label="Delete memory${m.caption ? ': ' + esc(m.caption) : ''}">✕</button>` : ''}
            </div>
            ${m.caption ? `<p class="memory-caption">${esc(m.caption)}</p>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  ` : ''}
`;

  document.body.appendChild(popup);
  const close = wireModalDismiss(popup, () => popup.remove(), {
    initialFocus: popup.querySelector('.popup-close')
  });
  popup.querySelector('.popup-close').onclick = close;

  popup.querySelector('.popup-cast-toggle')?.addEventListener('click', (e) => {
    const more = popup.querySelector('.popup-cast-more');
    more.hidden = !more.hidden;
    e.currentTarget.textContent = more.hidden
      ? `+${more.children.length} more` : 'Show fewer';
  });

  if (!isReadonly) {
    // Start watching → timer → Mark as watched (js/watch-controls.js). The
    // popup closes once the project lands in Done; while in progress it stays
    // open so the countdown is visible.
    WatchControls.mount(popup.querySelector('.popup-watch-controls'), project, {
      showCount: false,
      onChange: (action, result) => {
        if (action === 'complete' && result.finished) {
          // Map view: re-center camera on the project. Flow view: no camera.
          renderer.setCenterTarget?.(project.id);
          close();
        }
      }
    });

    popup.querySelector('#watched-with-friend-btn')?.addEventListener('click', () => {
      close();
      showWatchedWithFriendModal(project);
    });

    popup.querySelector('#add-memory-btn')?.addEventListener('click', () => {
      close();
      showAddMemoryModal(project);
    });

    popup.querySelectorAll('.memory-delete').forEach(btn => {
      btn.onclick = async () => {
        const url = btn.dataset.url;
        // One tap used to delete the photo for good — ask first.
        const sure = await confirmDialog({
          title: 'Delete this memory?',
          message: 'It comes off this title for good — the photo isn’t kept anywhere else.',
          confirmLabel: 'Delete',
          danger: true
        });
        if (!sure) return;
        // Only remove it on screen once the server confirms — otherwise a
        // failed delete looks done and the memory reappears on reload.
        let ok = false;
        try {
          // Auth.fetch adds the bearer header and ends a dead session on 401.
          const res = await Auth.fetch(`${API}/progress/memory`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: project.id, url })
          });
          ok = !!(res && res.ok);
        } catch (_) { /* network error → ok stays false */ }
        if (!ok) {
          toast("Couldn't delete that memory. Please try again.", 'error');
          return;
        }
        const entry = state.data.get(project.id);
        if (entry) entry.memories = entry.memories.filter(m => m.url !== url);
        btn.closest('.memory-item').remove();
      };
    });
  }

  popup.querySelectorAll('.memory-view-btn').forEach(btn => {
    btn.onclick = () => {
      // Read the list now, not the copy captured when the popup opened: a
      // memory deleted since then must not show (or be steppable) in the
      // lightbox. Find it by URL — the indexes shift after a delete.
      const current = state.getMemories(project.id);
      let index = current.findIndex(m => m.url === btn.dataset.url);
      if (index === -1) index = Math.min(parseInt(btn.dataset.index, 10) || 0, current.length - 1);
      if (index < 0) return;
      close();
      showMemoryLightbox(current, index, project);
    };
  });

}

// (The pre-SPA auth modal — showAuthModal/updateAuthUI — was removed with
// the legacy multi-page files. Login lives at /login in js/views/login.js.)
