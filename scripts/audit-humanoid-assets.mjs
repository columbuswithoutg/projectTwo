// Audit the raw Quaternius downloads in _incoming/quaternius/ before building
// game assets: bones, clips, materials, textures, sizes and units.
// Dependency-free (parses .gltf JSON and the .glb JSON chunk directly).
//
//   node scripts/audit-humanoid-assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const H = require('../js/playground3d-humanoid-logic.js');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '_incoming', 'quaternius');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

function readGltf(file) {
  const buf = fs.readFileSync(file);
  if (file.endsWith('.glb')) {
    const jsonLen = buf.readUInt32LE(12);
    return { json: JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')), size: buf.length };
  }
  const json = JSON.parse(buf.toString('utf8'));
  let size = buf.length;
  for (const b of json.buffers || []) if (b.uri && !b.uri.startsWith('data:')) size += fileSize(path.join(path.dirname(file), decodeURIComponent(b.uri)));
  for (const i of json.images || []) if (i.uri && !i.uri.startsWith('data:')) size += fileSize(path.join(path.dirname(file), decodeURIComponent(i.uri)));
  return { json, size };
}
function fileSize(p) { try { return fs.statSync(p).size; } catch { return 0; } }
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const rel = (f) => path.relative(ROOT, f);

function jointsOf(json, skinIdx = 0) {
  const skin = (json.skins || [])[skinIdx];
  if (!skin) return [];
  const parent = new Map();
  (json.nodes || []).forEach((n, i) => (n.children || []).forEach((c) => parent.set(c, i)));
  return skin.joints.map((j) => ({ name: json.nodes[j].name, parent: parent.has(j) ? json.nodes[parent.get(j)].name : null }));
}

function describeModel(file, { bonesInFull = false } = {}) {
  const { json, size } = readGltf(file);
  console.log(`\n=== ${rel(file)}  (${kb(size)} incl. external buffers/images)`);
  for (const m of json.meshes || []) {
    const prims = m.primitives.map((p) => {
      const pos = json.accessors[p.attributes.POSITION];
      const tris = p.indices != null ? json.accessors[p.indices].count / 3 : pos.count / 3;
      const mat = p.material != null ? json.materials[p.material].name : '-';
      return `${pos.count}v/${Math.round(tris)}t mat=${mat}${p.targets ? ` morphs=${p.targets.length}` : ''}`;
    });
    console.log(`  mesh "${m.name}": ${prims.join(' | ')}`);
    if (m.extras && m.extras.targetNames) console.log(`    morph names: ${m.extras.targetNames.join(', ')}`);
  }
  // Overall bounds from POSITION accessors (bind pose, mesh space).
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const m of json.meshes || []) for (const p of m.primitives) {
    const a = json.accessors[p.attributes.POSITION];
    if (a.min && a.max) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], a.min[k]); max[k] = Math.max(max[k], a.max[k]); }
  }
  if (isFinite(min[0])) console.log(`  bounds: x ${min[0].toFixed(3)}..${max[0].toFixed(3)}  y ${min[1].toFixed(3)}..${max[1].toFixed(3)}  z ${min[2].toFixed(3)}..${max[2].toFixed(3)}`);
  const scaledNodes = (json.nodes || []).filter((n) => n.scale && n.scale.some((s) => Math.abs(s - 1) > 1e-3));
  if (scaledNodes.length) console.log(`  scaled nodes: ${scaledNodes.slice(0, 5).map((n) => `${n.name}×${n.scale.map((s) => s.toFixed(2)).join(',')}`).join('; ')}`);
  for (const mat of json.materials || []) {
    const pbr = mat.pbrMetallicRoughness || {};
    const tex = [];
    if (pbr.baseColorTexture) tex.push('base');
    if (mat.normalTexture) tex.push('normal');
    if (pbr.metallicRoughnessTexture) tex.push('mr');
    if (mat.emissiveTexture) tex.push('emissive');
    console.log(`  material "${mat.name}": color=${JSON.stringify((pbr.baseColorFactor || [1, 1, 1, 1]).map((v) => +v.toFixed(2)))} metal=${pbr.metallicFactor ?? 1} rough=${pbr.roughnessFactor ?? 1} tex=[${tex.join(',')}]${mat.alphaMode ? ` alpha=${mat.alphaMode}` : ''}`);
  }
  for (const img of json.images || []) console.log(`  image: ${img.uri || img.name || '(embedded)'} ${img.mimeType || ''}`);
  const joints = jointsOf(json);
  if (joints.length) {
    console.log(`  skin: ${joints.length} joints (${json.skins.length} skin(s))`);
    if (bonesInFull) console.log(`  joints: ${joints.map((j) => j.name).join(', ')}`);
    const cls = H.classifySkeleton(joints);
    const miss = H.missingParts(cls);
    console.log(`  classify: hips=${cls.hips} spine=[${cls.spine}] neck=[${cls.neck}] head=${cls.head}`);
    console.log(`            upperArm.L=[${cls['upperArm.L']}] thigh.L=[${cls['thigh.L']}] shin.L=[${cls['shin.L']}] foot.L=[${cls['foot.L']}]`);
    console.log(`  missing parts: ${miss.length ? miss.join(', ') : 'none'}`);
  }
  return { json, joints };
}

function describeAnims(file, bodyJointNames) {
  const { json, size } = readGltf(file);
  console.log(`\n=== ${rel(file)}  (${kb(size)})  — ${(json.animations || []).length} clips`);
  const nodeName = (i) => json.nodes[i].name;
  const clips = (json.animations || []).map((a) => {
    let dur = 0;
    const paths = { translation: new Set(), rotation: new Set(), scale: new Set(), weights: new Set() };
    for (const ch of a.channels) {
      const s = a.samplers[ch.sampler];
      const inp = json.accessors[s.input];
      if (inp.max) dur = Math.max(dur, inp.max[0]);
      paths[ch.target.path].add(nodeName(ch.target.node));
    }
    return { name: a.name, dur, t: paths.translation.size, r: paths.rotation.size, s: paths.scale.size, tNodes: [...paths.translation] };
  });
  for (const c of clips) console.log(`  ${c.name.padEnd(34)} ${c.dur.toFixed(2)}s  rot:${c.r} pos:${c.t} scale:${c.s}${c.t && c.t <= 3 ? `  pos-on=[${c.tNodes}]` : ''}`);
  const joints = jointsOf(json);
  const animBones = new Set(joints.map((j) => j.name));
  if (bodyJointNames) {
    const body = new Set(bodyJointNames);
    const onlyBody = [...body].filter((n) => !animBones.has(n));
    const onlyAnim = [...animBones].filter((n) => !body.has(n));
    console.log(`  rig match vs body: ${body.size - onlyBody.length}/${body.size} body joints present in anim rig`);
    if (onlyBody.length) console.log(`    body-only joints: ${onlyBody.join(', ')}`);
    if (onlyAnim.length) console.log(`    anim-only joints: ${onlyAnim.slice(0, 40).join(', ')}${onlyAnim.length > 40 ? ' …' : ''}`);
  }
  return clips;
}

if (!fs.existsSync(ROOT)) { console.error(`Missing ${ROOT}`); process.exit(1); }
const files = walk(ROOT);
const bodies = files.filter((f) => /Godot - UE[\\/].*FullBody\.gltf$/.test(f));
const hairs = files.filter((f) => /Rigged to Head Bone[\\/].*\.gltf$/.test(f));
const anims = files.filter((f) => /UAL1_Standard\.glb$/.test(f));

let bodyJoints = null;
for (const f of bodies) {
  const { joints } = describeModel(f, { bonesInFull: !bodyJoints });
  bodyJoints = bodyJoints || joints.map((j) => j.name);
}
for (const f of hairs) describeModel(f);
for (const f of anims) describeAnims(f, bodyJoints);
