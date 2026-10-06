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

  // A poster that 404s is removed so the title card underneath shows.
  if (typeof document !== 'undefined') {
    document.addEventListener('error', (e) => {
      const t = e.target;
      if (t && t.tagName === 'IMG' && t.hasAttribute('data-poster')) t.remove();
    }, true);
  }

  return { url, html, cardHtml, mount, phaseOf, yearOf };
})();
