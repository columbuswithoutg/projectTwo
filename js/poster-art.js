/************************************************
 * POSTER ART — title cards for posters that are missing
 *
 * Several titles have no poster file yet (the Fox X-Men films, Doomsday).
 * Every poster spot now draws a phase-coloured TITLE CARD (phase, title,
 * year) underneath the image: when the image loads it covers the card, when
 * it's missing the card is what you see — instead of an empty tile. The
 * card doubles as the loading placeholder.
 *
 *   PosterArt.url(p)        versioned poster URL ('' when the project has none)
 *   PosterArt.html(p, opts) card + <img data-poster> markup for innerHTML
 *   PosterArt.cardHtml(p)   just the card
 *   PosterArt.mount(el, p)  append card + image to an element (DOM-built UIs)
 *
 * Character portraits get the same treatment (many character image files
 * don't exist yet): a phase-coloured MONOGRAM — a faint head-and-shoulders
 * silhouette behind the character's initials — drawn under the portrait.
 *   PosterArt.charHtml(c, file, opts)   monogram + <img data-poster> markup
 *   PosterArt.charMount(el, c, file, opts)  same, appended to an element
 *   PosterArt.initials(name)            "Captain America (Sam Wilson)" → "CA"
 * The holder must be position:relative (or the .map-walker chip); the
 * monogram is a circle filling it (styles/components/poster.css).
 *
 * The container must be position:relative with a size (the card fills it,
 * styles/components/poster.css). A broken poster image is removed by ONE
 * capture-phase document listener — inline onerror= attributes are blocked
 * by the CSP (script-src-attr 'none').
 ************************************************/
const PosterArt = (() => {
  const yearOf = (p) => (p && p.release ? String(p.release).slice(0, 4) : '');
  const phaseOf = (p) => {
    const m = String((p && p.phase) || '').match(/\d+/);
    return Math.min(6, Math.max(1, m ? +m[0] : 1));
  };

  function url(p) {
    return p && p.image ? assetUrl(CONFIG.IMAGE_BASE + p.image) : '';
  }

  function cardHtml(p) {
    const n = phaseOf(p);
    const title = (p && (p.title || p.id)) || '';
    const year = yearOf(p);
    return `<span class="poster-card poster-phase-${n}" aria-hidden="true">` +
      `<span class="poster-card-eyebrow">Phase ${n}</span>` +
      `<span class="poster-card-title">${esc(title)}</span>` +
      (year ? `<span class="poster-card-year">${esc(year)}</span>` : '') +
      `</span>`;
  }

  // opts: { alt, cls (extra class on the img), lazy (default true) }
  function html(p, opts = {}) {
    const u = url(p);
    const img = u
      ? `<img class="poster-img${opts.cls ? ' ' + opts.cls : ''}" data-poster src="${esc(u)}" alt="${esc(opts.alt || '')}"` +
        `${opts.lazy === false ? '' : ' loading="lazy"'} draggable="false">`
      : '';
    return cardHtml(p) + img;
  }

  function mount(el, p, opts = {}) {
    el.insertAdjacentHTML('beforeend', html(p, opts));
    return el.querySelector('img[data-poster]');
  }

  // ── Character monograms ──
  // Initials of the name without its "(…)" qualifier: two words → two
  // letters, one word → one letter.
  function initials(name) {
    const full = String(name || '').trim();
    const base = full.replace(/\s*\([^)]*\)/g, '').trim() || full;
    const words = base.split(/[\s-]+/).filter(Boolean);
    if (!words.length) return '?';
    return (words.length > 1 ? words[0][0] + words[1][0] : words[0][0]).toUpperCase();
  }

  // The character's debut phase colours the monogram (same palette as the
  // poster title cards).
  function charPhase(c) {
    const debut = c && c.debut && typeof projects !== 'undefined' && Array.isArray(projects)
      ? projects.find((p) => p.id === c.debut) : null;
    return debut ? phaseOf(debut) : 1;
  }

  function charCardHtml(c) {
    return `<span class="char-art poster-phase-${charPhase(c)}" aria-hidden="true">` +
      `<span class="char-art-initials">${esc(initials(c && c.name))}</span></span>`;
  }

  // file: the image file name under assets/characters/ (falsy → monogram only).
  // opts: { alt (default the name), cls (extra class on the img), lazy (default true) }
  function charHtml(c, file, opts = {}) {
    const img = file
      ? `<img class="char-art-img${opts.cls ? ' ' + opts.cls : ''}" data-poster src="${esc(assetUrl('assets/characters/' + file))}"` +
        ` alt="${esc(opts.alt != null ? opts.alt : (c && c.name) || '')}"${opts.lazy === false ? '' : ' loading="lazy"'} draggable="false">`
      : '';
    return charCardHtml(c) + img;
  }

  function charMount(el, c, file, opts = {}) {
    el.insertAdjacentHTML('beforeend', charHtml(c, file, opts));
    return el.querySelector('img[data-poster]');
  }

  // A poster (or character portrait) that 404s is removed so the card /
  // monogram underneath shows.
  if (typeof document !== 'undefined') {
    document.addEventListener('error', (e) => {
      const t = e.target;
      if (t && t.tagName === 'IMG' && t.hasAttribute('data-poster')) t.remove();
    }, true);
  }

  return { url, html, cardHtml, mount, phaseOf, yearOf, initials, charHtml, charMount };
})();
