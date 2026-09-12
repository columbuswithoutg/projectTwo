// Build the web-ready humanoid assets from the raw Quaternius downloads
// (_incoming/quaternius/, gitignored) into assets/models/humanoid/v1/.
//
//   node scripts/build-humanoid-assets.mjs [--no-quantize]
//
// Outputs:
//   body_male.glb / body_female.glb  Superhero bodies + eyes + eyebrows. The
//                                    skin base colour is swapped to the "Light"
//                                    texture so the engine can tint any tone.
//   hair.glb                         hairstyles/beard/eyebrows, each rigged to
//                                    the Head bone; mesh + node named by style.
//   anims.glb                        the clips the game uses — skeleton only,
//                                    scale tracks and non-root translation
//                                    tracks stripped (the engine bakes body
//                                    shapes into the bind pose; clips must not
//                                    fight it).
//   manifest.json                    clip names/durations, hair names, sizes.
//
// Only decoder-free compression (KHR_mesh_quantization + WebP) — the site's
// CSP blocks the workers/WASM that Draco/Meshopt/KTX2 need.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, mergeDocuments, prune, quantize, resample, textureCompress, unpartition, weld } from '@gltf-transform/functions';
import sharp from 'sharp';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, '_incoming', 'quaternius');
const OUT = path.join(ROOT, 'assets', 'models', 'humanoid', 'v1');
const UBC = path.join(SRC, 'Universal Base Characters[Standard]');
const BODY_DIR = path.join(UBC, 'Base Characters', 'Godot - UE');
const SKIN_DIR = path.join(UBC, 'Base Characters', 'Textures');
const HAIR_DIR = path.join(UBC, 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)');
const UAL_FILE = path.join(SRC, 'Universal Animation Library[Standard]', 'Unreal-Godot', 'UAL1_Standard.glb');
const QUANTIZE = !process.argv.includes('--no-quantize');

const BODIES = {
  male:   { src: 'Superhero_Male_FullBody.gltf',   lightSkin: 'T_Superhero_Male_Ligh.png' },
  female: { src: 'Superhero_Female_FullBody.gltf', lightSkin: 'T_Superhero_Female_Light_BaseColor.png' }
};
const HAIR = [
  'Hair_Buzzed', 'Hair_BuzzedFemale', 'Hair_SimpleParted', 'Hair_Long', 'Hair_Buns',
  'Hair_Beard', 'Eyebrows_Regular', 'Eyebrows_Female'
];
// Everything the game maps to (see PG3DHumanoidLogic.selectAnimState) plus a
// few candidates for emotes/props. The free tier has no wave or get-up clip.
const CLIPS = [
  'Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop',
  'Jump_Start', 'Jump_Loop', 'Jump_Land',
  'Punch_Jab', 'Punch_Cross', 'Death01', 'Hit_Chest', 'Hit_Head',
  'Roll', 'Dance_Loop', 'Idle_Talking_Loop', 'Spell_Simple_Shoot'
];
const ROOT_BONES = new Set(['root', 'pelvis']);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// Some shipped .gltf files reference images that don't exist under that name
// (e.g. "T_Hair_1_Normal_png.png" when the file is "T_Hair_1_Normal.png").
// Resolve each external resource: exact name, then without the stray "_png",
// then the pack's shared texture folders. Substitutions are logged.
const RESOURCE_DIRS = [
  path.join(UBC, 'Base Characters', 'Textures', 'Normals Unity - Godot'),
  path.join(UBC, 'Base Characters', 'Textures'),
  path.join(UBC, 'Hairstyles', 'Textures', 'Normals Unity - Godot'),
  path.join(UBC, 'Hairstyles', 'Textures'),
  BODY_DIR,
  HAIR_DIR
];
function resolveResource(dir, uri) {
  const name = decodeURIComponent(uri);
  const names = [name, name.replace(/_png(\.png)$/i, '$1')];
  for (const d of [dir, ...RESOURCE_DIRS]) {
    for (const n of names) {
      const p = path.join(d, n);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}
async function readInput(file) {
  if (file.endsWith('.glb')) return io.read(file);
  const dir = path.dirname(file);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const resources = {};
  for (const item of [...(json.buffers || []), ...(json.images || [])]) {
    if (!item.uri || item.uri.startsWith('data:')) continue;
    const p = resolveResource(dir, item.uri);
    if (!p) throw new Error(`${path.basename(file)}: missing resource "${item.uri}"`);
    if (p !== path.join(dir, decodeURIComponent(item.uri))) {
      console.warn(`  ${path.basename(file)}: "${item.uri}" → ${path.relative(SRC, p)}`);
    }
    resources[item.uri] = new Uint8Array(fs.readFileSync(p));
  }
  return io.readJSON({ json, resources });
}

function bounds(doc) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const mn = pos.getMin([]), mx = pos.getMax([]);
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], mn[k]); max[k] = Math.max(max[k], mx[k]); }
      const idx = prim.getIndices();
      tris += (idx ? idx.getCount() : pos.getCount()) / 3;
    }
  }
  return { min, max, tris: Math.round(tris) };
}

// Big base colours stay sharper than the detail maps.
async function compressTextures(doc) {
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColor/, resize: [1024, 1024], quality: 85 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(normal|metallicRoughness|occlusion|emissive)/, resize: [512, 512], quality: 90 })
  );
}

// prune() leaves behind accessors that only the (now disposed) animation
// channels/samplers used — in anims.glb that was ~3.4 MB. Drop any accessor
// nothing but the root references.
function dropOrphanAccessors(doc) {
  let n = 0;
  for (const acc of doc.getRoot().listAccessors()) {
    if (acc.listParents().every((p) => p.propertyType === 'Root')) { acc.dispose(); n++; }
  }
  return n;
}

async function finish(doc, file, { geometry = true } = {}) {
  const dropped = dropOrphanAccessors(doc);
  if (dropped) console.log(`  dropped ${dropped} orphan accessors`);
  await doc.transform(
    unpartition(),
    ...(geometry ? [weld()] : []),
    dedup(),
    prune({ keepLeaves: true }),
    ...(geometry && QUANTIZE ? [quantize()] : [])
  );
  if (geometry) await compressTextures(doc);
  const out = path.join(OUT, file);
  await io.write(out, doc);
  return fs.statSync(out).size;
}

async function buildBody(key) {
  const def = BODIES[key];
  const doc = await readInput(path.join(BODY_DIR, def.src));
  const root = doc.getRoot();
  for (const tex of root.listTextures()) {
    if (/Superhero_.*Dark/i.test(tex.getURI())) {
      tex.setImage(fs.readFileSync(path.join(SKIN_DIR, def.lightSkin))).setMimeType('image/png').setURI(def.lightSkin);
    }
  }
  // Predictable names for the engine: Body / Eyes / Eyebrows.
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const mat = mesh.listPrimitives()[0].getMaterial();
    const m = mat ? mat.getName() : '';
    const name = /Superhero/i.test(m) ? 'Body' : /Eyes/i.test(m) ? 'Eyes' : /Hair/i.test(m) ? 'Eyebrows' : mesh.getName();
    mesh.setName(name);
    node.setName(name);
  }
  const b = bounds(doc);
  const size = await finish(doc, `body_${key}.glb`);
  return { file: `body_${key}.glb`, height: +(b.max[1] - b.min[1]).toFixed(3), tris: b.tris, bytes: size };
}

async function buildHair() {
  let doc = null;
  const info = [];
  for (const name of HAIR) {
    const src = await readInput(path.join(HAIR_DIR, `${name}.gltf`));
    for (const node of src.getRoot().listNodes()) {
      if (node.getMesh()) { node.setName(name); node.getMesh().setName(name); }
    }
    info.push({ name, tris: bounds(src).tris });
    if (!doc) doc = src; else mergeDocuments(doc, src);
  }
  const [scene0, ...rest] = doc.getRoot().listScenes();
  for (const s of rest) { for (const child of s.listChildren()) scene0.addChild(child); s.dispose(); }
  const size = await finish(doc, 'hair.glb');
  return { file: 'hair.glb', styles: info, bytes: size };
}

async function buildAnims() {
  const doc = await io.read(UAL_FILE);
  const root = doc.getRoot();
  const keep = new Set(CLIPS);
  const found = new Set();
  for (const anim of root.listAnimations()) {
    if (!keep.has(anim.getName())) {
      // Dispose children first — a bare anim.dispose() leaves its samplers
      // alive, and they keep ~3 MB of keyframe accessors referenced.
      for (const ch of anim.listChannels()) ch.dispose();
      for (const s of anim.listSamplers()) s.dispose();
      anim.dispose();
      continue;
    }
    found.add(anim.getName());
    for (const ch of anim.listChannels()) {
      const p = ch.getTargetPath();
      const node = ch.getTargetNode();
      if (p === 'scale' || (p === 'translation' && !(node && ROOT_BONES.has(node.getName())))) {
        const sampler = ch.getSampler();
        ch.dispose();
        if (sampler && !sampler.listParents().some((x) => x.propertyType === 'AnimationChannel')) sampler.dispose();
      }
    }
  }
  const missing = CLIPS.filter((c) => !found.has(c));
  if (missing.length) throw new Error(`Clips not found in ${path.basename(UAL_FILE)}: ${missing.join(', ')}`);
  // Skeleton only — the mannequin mesh isn't needed.
  for (const node of root.listNodes()) { node.setMesh(null); node.setSkin(null); }
  await doc.transform(resample());
  const clips = root.listAnimations().map((a) => {
    let dur = 0;
    for (const s of a.listSamplers()) dur = Math.max(dur, s.getInput().getMax([])[0]);
    return { name: a.getName(), duration: +dur.toFixed(3), channels: a.listChannels().length };
  });
  const size = await finish(doc, 'anims.glb', { geometry: false });
  return { file: 'anims.glb', clips, bytes: size };
}

if (!fs.existsSync(SRC)) { console.error(`Missing ${SRC} — download the Quaternius Standard packs first.`); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const manifest = {
  version: 1,
  license: 'CC0-1.0',
  generated: new Date().toISOString().slice(0, 10),
  quantized: QUANTIZE,
  bodies: {},
  hair: null,
  anims: null
};
for (const key of Object.keys(BODIES)) {
  manifest.bodies[key] = await buildBody(key);
  console.log(`body_${key}.glb  ${kb(manifest.bodies[key].bytes)}  ${manifest.bodies[key].tris} tris  height ${manifest.bodies[key].height}`);
}
manifest.hair = await buildHair();
console.log(`hair.glb  ${kb(manifest.hair.bytes)}  ${manifest.hair.styles.map((s) => s.name).join(', ')}`);
manifest.anims = await buildAnims();
console.log(`anims.glb  ${kb(manifest.anims.bytes)}  ${manifest.anims.clips.length} clips`);
for (const c of manifest.anims.clips) console.log(`  ${c.name.padEnd(20)} ${c.duration}s  ${c.channels} channels`);
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const total = Object.values(manifest.bodies).reduce((s, b) => s + b.bytes, 0) + manifest.hair.bytes + manifest.anims.bytes;
console.log(`total ${kb(total)} → ${path.relative(ROOT, OUT)}`);
