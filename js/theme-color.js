/************************************************
 * THEME COLOR — image → dominant colors extractor
 *
 * Used by the /home 3D engine to colour each project room's walls and
 * trim from its poster image. Loads the image into a small offscreen
 * canvas, drops near-gray and transparent pixels, buckets the rest into
 * 5-bit-per-channel cubes, and returns the two most populated cubes'
 * average colours as hex strings.
 *
 * Results are cached in-memory by URL. Falls back to a neutral pair if
 * extraction fails (most likely cause: CORS on a cross-origin URL — our
 * project posters are same-origin under /assets/images so this is rare).
 ************************************************/
const ThemeColor = (() => {
  const cache = new Map();          // url → Promise<{primary, accent}>
  const FALLBACK = { primary: '#888888', accent: '#cccccc' };

  function rgbToHex(r, g, b) {
    const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
  }

  async function _extract(url) {
    return new Promise((resolve) => {
      const img = new Image();
      // Same-origin assets don't need CORS, but set crossOrigin so future
      // CDN-hosted posters still pass through getImageData without taint.
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const W = 32, H = 32;
          const canvas = document.createElement('canvas');
          canvas.width = W; canvas.height = H;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, W, H);
          const data = ctx.getImageData(0, 0, W, H).data;

          // Bucket by 5-bit-per-channel cube (32³ = 32768 possible keys,
          // but we only ever populate a handful for a small image).
          const buckets = Object.create(null);
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
            if (a < 128) continue;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            if (max - min < 30) continue;          // skip near-grays
            const key = `${r >> 3}_${g >> 3}_${b >> 3}`;
            const bucket = buckets[key] || (buckets[key] = { count: 0, r: 0, g: 0, b: 0 });
            bucket.count++;
            bucket.r += r; bucket.g += g; bucket.b += b;
          }

          const sorted = Object.values(buckets)
            .map(x => ({ count: x.count, r: x.r / x.count, g: x.g / x.count, b: x.b / x.count }))
            .sort((a, b) => b.count - a.count);

          if (sorted.length === 0) return resolve(FALLBACK);
          const primary = sorted[0];
          const accent = sorted[1] || sorted[0];
          resolve({
            primary: rgbToHex(primary.r, primary.g, primary.b),
            accent:  rgbToHex(accent.r,  accent.g,  accent.b)
          });
        } catch (_) {
          resolve(FALLBACK);
        }
      };
      img.onerror = () => resolve(FALLBACK);
      img.src = url;
    });
  }

  function extractTheme(url) {
    if (!url) return Promise.resolve(FALLBACK);
    if (cache.has(url)) return cache.get(url);
    const p = _extract(url);
    cache.set(url, p);
    return p;
  }

  return { extractTheme };
})();
