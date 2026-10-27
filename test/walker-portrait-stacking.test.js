/************************************************
 * Walker chips stack the portrait <img> ABOVE the monogram.
 *
 * createWalkerElement (js/walkers.js) puts PosterArt.charHtml's monogram
 * (.char-art: position:absolute; inset:0) first, then the portrait <img>.
 * An absolutely positioned sibling paints over a static <img>, so unless
 * the img carries a class that poster.css positions above .char-art, every
 * walker shows only its initials even when the portrait loaded.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// Lift createWalkerElement out of the Walkers IIFE (it only needs document,
// PHYSICS and PosterArt) and run it against a minimal fake DOM.
function buildWalkerElement() {
  const src = read('js/walkers.js');
  const start = src.indexOf('function createWalkerElement(');
  assert.ok(start >= 0, 'createWalkerElement not found in js/walkers.js');
  let depth = 0, end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const fakeEl = (tag) => ({
    tagName: tag.toUpperCase(), className: '', style: {}, attrs: {}, children: [], html: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); return c; },
    insertAdjacentHTML(_pos, h) { this.html += h; }
  });
  const ctx = {
    document: { createElement: fakeEl },
    PHYSICS: { WALKER: { size: 28 } },
    PosterArt: { charHtml: () => '<span class="char-art poster-phase-1"><span class="char-art-initials">IM</span></span>' }
  };
  vm.runInNewContext(src.slice(start, end) + '\nthis.out = createWalkerElement("/assets/characters/ironman.jpg", { id: "ironman", name: "Iron Man" });', ctx);
  return ctx.out;
}

test('walker chip: monogram markup is there and the portrait img carries .char-art-img', () => {
  const wrap = buildWalkerElement();
  assert.match(wrap.html, /class="char-art\b/, 'monogram fallback missing');
  const img = wrap.children.find(c => c.tagName === 'IMG');
  assert.ok(img, 'portrait <img> missing');
  assert.ok('data-poster' in img.attrs, 'img lost data-poster (PosterArt error fallback)');
  assert.ok(img.className.split(/\s+/).includes('char-art-img'),
    `walker portrait img has class "${img.className}" — without .char-art-img the absolute .char-art monogram covers it`);
});

test('poster.css lifts .char-art-img above the absolutely positioned .char-art', () => {
  const css = read('styles/components/poster.css');
  const charArt = css.match(/^\.char-art\s*\{([^}]*)\}/m);
  assert.ok(charArt && /position:\s*absolute/.test(charArt[1]), '.char-art is expected to be position:absolute');
  const img = css.match(/\.char-art-img\s*\{([^}]*)\}/);
  assert.ok(img, '.char-art-img rule missing from styles/components/poster.css');
  assert.match(img[1], /position:\s*(relative|absolute)/);
  assert.match(img[1], /z-index:\s*[1-9]/);
});
