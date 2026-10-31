/************************************************
 * HELP CENTRE — the "?" button in every header and the "How to use" panel
 * it opens: every feature, grouped by area, each with a screenshot and
 * short steps. Content + rules live in js/help-logic.js (HelpLogic).
 *
 *   HelpCentre.buttonHtml(s)  the "?" for a header; carries a red dot until
 *                             this user has opened the current guide version
 *   HelpCentre.open(section)  open the panel (optionally at one section)
 *
 * Every [data-help-open] button works through one delegated click listener,
 * so a view only has to drop buttonHtml() into its header markup.
 ************************************************/
const HelpCentre = (() => {
  const IMG_BASE = '/assets/help/';

  function _userKey() {
    let id = null;
    try { id = decodeJwtPayload(Auth.getToken())?.id || null; } catch (_) { /* logged out */ }
    return HelpLogic.seenKey(id);
  }
  function _needsDot() {
    let stored = null;
    try { stored = localStorage.getItem(_userKey()); } catch (_) { /* storage blocked */ }
    return HelpLogic.needsDot(stored);
  }
  function _markSeen() {
    try { localStorage.setItem(_userKey(), String(HelpLogic.GUIDE_VERSION)); } catch (_) { /* storage blocked */ }
    document.querySelectorAll('[data-help-dot]').forEach(d => { d.hidden = true; });
    document.querySelectorAll('[data-help-open]').forEach(b => b.setAttribute('aria-label', 'How to use — every feature'));
  }

  // section: the area the panel opens at (e.g. 'world' from the World header).
  function buttonHtml(section) {
    const dot = _needsDot();
    return `<button type="button" class="help-btn" data-help-open="${esc(section || '')}" title="How to use"
              aria-label="How to use — every feature${dot ? ' (not viewed yet)' : ''}">
        <span aria-hidden="true">?</span>
        <span class="help-dot" data-help-dot${dot ? '' : ' hidden'}></span>
      </button>`;
  }

  function _cardHtml(sectionId, c) {
    const shot = c.img ? `
      <button type="button" class="help-shot" data-help-zoom="${esc(IMG_BASE + c.img)}" aria-label="Show the picture bigger: ${esc(c.title)}">
        <img src="${esc(IMG_BASE + c.img)}" alt="Screenshot: ${esc(c.title)}" loading="lazy" decoding="async">
      </button>` : '';
    const keys = c.keys && c.keys.length ? `
      <dl class="help-keys">
        ${c.keys.map(([k, what]) => `<div><dt><kbd>${esc(k)}</kbd></dt><dd>${esc(what)}</dd></div>`).join('')}
      </dl>` : '';
    return `
      <article class="help-card${c.img ? '' : ' help-card--noimg'}" id="help-${esc(sectionId)}-${esc(c.id)}">
        ${shot}
        <div class="help-card-body">
          <h4>${esc(c.title)}</h4>
          ${c.note ? `<p class="help-note">${esc(c.note)}</p>` : ''}
          <ol class="help-steps">${c.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
          ${keys}
        </div>
      </article>`;
  }

  function _listHtml(sections) {
    if (!sections.length) return '<p class="help-empty">Nothing matches that. Try another word, like "chat" or "friends".</p>';
    return sections.map(s => `
      <section class="help-section" id="help-sec-${esc(s.id)}" aria-labelledby="help-sec-h-${esc(s.id)}">
        <h3 id="help-sec-h-${esc(s.id)}">${esc(s.title)}</h3>
        <div class="help-cards">${s.cards.map(c => _cardHtml(s.id, c)).join('')}</div>
      </section>`).join('');
  }

  function open(sectionId) {
    document.querySelector('.help-panel')?.remove();
    const all = HelpLogic.SECTIONS;

    const panel = document.createElement('div');
    panel.className = 'help-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'help-heading');
    panel.innerHTML = `
      <div class="help-box">
        <header class="help-head">
          <h2 id="help-heading">How to use</h2>
          <input type="search" class="help-search" placeholder="Search features…" aria-label="Search features" autocomplete="off">
          <button class="popup-close" type="button" aria-label="Close">✕</button>
        </header>
        <nav class="help-nav" aria-label="Feature areas">
          ${all.map(s => `<button type="button" data-help-sec="${esc(s.id)}">${esc(s.title)}</button>`).join('')}
        </nav>
        <div class="help-list">${_listHtml(all)}</div>
        <div class="help-zoom" hidden>
          <img alt="">
          <button type="button" class="popup-close" aria-label="Close the picture">✕</button>
        </div>
      </div>`;
    document.body.appendChild(panel);

    const list = panel.querySelector('.help-list');
    const zoom = panel.querySelector('.help-zoom');
    const search = panel.querySelector('.help-search');
    const nav = panel.querySelector('.help-nav');

    // In the 3D views the panel must not leak WASD / Space into the game.
    const engine = typeof Playground3D !== 'undefined' ? Playground3D : null;
    if (engine && engine.setInputSuspended) engine.setInputSuspended(true, 'help');

    function closeZoom() { zoom.hidden = true; zoom.querySelector('img').removeAttribute('src'); }
    const close = wireModalDismiss(panel, () => {
      if (engine && engine.setInputSuspended) engine.setInputSuspended(false, 'help');
      panel.remove();
    }, {
      initialFocus: panel.querySelector('.help-head .popup-close'),
      onEscape: () => { if (!zoom.hidden) { closeZoom(); return true; } return false; }
    });
    panel.querySelector('.help-head .popup-close').addEventListener('click', close);

    function setActive(id) {
      nav.querySelectorAll('[data-help-sec]').forEach(b => b.classList.toggle('is-active', b.dataset.helpSec === id));
    }
    // While a jump's smooth scroll runs, the scroll spy below would light up
    // every section it passes; hold the clicked one until it settles.
    let holdUntil = 0;
    function jump(id, smooth = true) {
      const sec = list.querySelector('#help-sec-' + CSS.escape(id));
      if (sec) {
        holdUntil = smooth ? Date.now() + 900 : 0;
        list.scrollTo({ top: sec.offsetTop - list.offsetTop, behavior: smooth ? 'smooth' : 'auto' });
      }
      setActive(id);
    }
    nav.addEventListener('click', (e) => {
      const b = e.target.closest('[data-help-sec]');
      if (!b) return;
      if (search.value) { search.value = ''; list.innerHTML = _listHtml(all); }
      jump(b.dataset.helpSec);
    });
    // Highlight the area being read as the list scrolls.
    list.addEventListener('scroll', () => {
      if (Date.now() < holdUntil) return;
      const top = list.scrollTop + 24;
      let cur = null;
      list.querySelectorAll('.help-section').forEach(s => { if (s.offsetTop - list.offsetTop <= top) cur = s.id.slice(9); });
      if (cur) setActive(cur);
    }, { passive: true });

    search.addEventListener('input', () => {
      const found = HelpLogic.search(all, search.value);
      list.innerHTML = _listHtml(found);
      list.scrollTop = 0;
      setActive(found.length ? found[0].id : null);
    });

    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-help-zoom]');
      if (!b) return;
      zoom.querySelector('img').src = b.dataset.helpZoom;
      zoom.querySelector('img').alt = b.querySelector('img')?.alt || '';
      zoom.hidden = false;
      zoom.querySelector('.popup-close').focus();
    });
    zoom.addEventListener('click', closeZoom);

    _markSeen();
    if (sectionId) jump(sectionId, false); else setActive(all[0].id);
    return close;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-help-open]');
    if (!b) return;
    e.preventDefault();
    open(b.dataset.helpOpen || undefined);
  });

  return { buttonHtml, open };
})();
