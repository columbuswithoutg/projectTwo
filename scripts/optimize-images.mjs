// Shrink the raster images under assets/characters and assets/images IN
// PLACE — same filenames, same extensions — so nothing in projects.js /
// characters.js / the Mongo CMS copies has to change.
//
//   node scripts/optimize-images.mjs            # rewrite files that get smaller
//   node scripts/optimize-images.mjs --dry-run  # report only
//
// Why in place: image filenames are data (projects.js `image:` fields,
// characters.js `stages[].image`) and are mirrored into Mongo by the seed
// script, so a .jpg → .webp rename would need a data migration and risk
// clobbering admin CMS edits. Browsers sniff image bytes regardless of the
// extension, and 70 of the 71 "png" posters were already JPEG bytes — this
// script keeps that status quo rather than introducing renames.
//
// Targets are sized from how the app actually renders them (styles.css):
//   characters — 80px circular avatars, 52px picker thumbs, 28px map walkers
//   images     — 30×45 map nodes, 44×66 feed posters, one 2/3-ratio spawn tile
// so 600px / 800px on the long edge is several times more than any device
// pixel ratio needs. Every output is a real JPEG (quality 82, mozjpeg).
//
// Idempotent: a file is only rewritten when the new encoding is at least 10%
// (and 4 KB) smaller. Re-encoding an already-optimised JPEG always shaves a
// percent or two, so a plain "smaller" test would re-compress every file on
// every run (generation loss). With the threshold, re-running after adding
// new images touches only the new ones.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');

const TARGETS = [
  { dir: 'assets/characters', maxEdge: 600 },
  { dir: 'assets/images',     maxEdge: 800 }
];
const EXT = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp']);

const kb = n => (n / 1024).toFixed(0).padStart(6) + ' KB';

let totalBefore = 0, totalAfter = 0, rewritten = 0, skipped = 0;

for (const { dir, maxEdge } of TARGETS) {
  const abs = path.join(ROOT, dir);
  const files = fs.readdirSync(abs).filter(f => EXT.has(path.extname(f).toLowerCase())).sort();
  console.log(`\n${dir}  (${files.length} files, max ${maxEdge}px)`);
  for (const name of files) {
    const file = path.join(abs, name);
    const before = fs.statSync(file).size;
    totalBefore += before;
    let out;
    try {
      // Decode from a Buffer, not the path: with a path, libvips keeps the
      // source file open while the pipeline is lazy, and overwriting that
      // same path on Windows then fails with a sharing violation (UNKNOWN).
      const img = sharp(fs.readFileSync(file), { failOn: 'none' }).rotate();  // honour EXIF orientation
      const meta = await img.metadata();
      const w = meta.width || 0, h = meta.height || 0;
      const resize = Math.max(w, h) > maxEdge
        ? (w >= h ? { width: maxEdge } : { height: maxEdge })
        : null;
      out = await (resize ? img.resize({ ...resize, withoutEnlargement: true }) : img)
        .flatten({ background: '#000' })          // any alpha → opaque (JPEG has none)
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      const dims = `${w}x${h}` + (resize ? ` → ≤${maxEdge}` : '');
      const saved = before - out.length;
      if (saved >= 4096 && saved >= before * 0.10) {
        if (!DRY) fs.writeFileSync(file, out);
        rewritten++;
        totalAfter += out.length;
        console.log(`  ${kb(before)} → ${kb(out.length)}  ${name}  (${meta.format}, ${dims})`);
      } else {
        skipped++;
        totalAfter += before;
      }
    } catch (err) {
      skipped++;
      totalAfter += before;
      console.log(`  SKIP ${name}: ${err.message}`);
    }
  }
}

console.log(`\n${DRY ? '[dry-run] ' : ''}${rewritten} rewritten, ${skipped} left as-is`);
console.log(`total ${(totalBefore / 1048576).toFixed(1)} MB → ${(totalAfter / 1048576).toFixed(1)} MB`);
