// Client build: source files → dist/
//
//   npm run build            one build (also runs on `npm install` via postinstall)
//   npm run dev              build, watch js/ + styles/ + templates, and run server.js
//   node scripts/build.mjs [--watch] [--serve]
//
// WHY THIS IS NOT A NORMAL BUNDLE. The app is ~60 classic scripts that share
// state through top-level `const` / `class` / `function` declarations in the
// global lexical scope, and js/boot.js hot-swaps `window.projects` /
// `window.characters` / `window.LOCATIONS` (which only works because those
// three files use `var`). Any bundler format (iife / esm / cjs) would scope
// all of that away and silently break the live-content refresh. So each
// chunk is the plain CONCATENATION of its files, in the order spa.html used
// to load them, passed through esbuild.transform for minification only —
// no `bundle`, no `format` — which keeps top-level names intact. A build-time
// assertion below proves it for the globals other chunks rely on.
//
// Output (dist/ is gitignored):
//   dist/static/core.<hash>.js      always loaded by spa.html (deferred)
//   dist/static/world.<hash>.js     lazy: Three.js engine, sockets, voice, 3D views
//   dist/static/admin.<hash>.js     lazy: admin panel
//   dist/static/three-shim.<hash>.js  ES module (from js/three-shim.mjs) that exposes window.THREE
//   dist/static/styles.<hash>.css
//   dist/static/*.map               source maps (sources = the concatenated file)
//   dist/spa.html                   from the spa.html template (markers filled)
//   dist/sw.js                      from the sw.js template (version + precache)
//
// Adding a JS file to the app = adding it to the right list in CHUNKS below,
// in dependency order. Lazy chunks are loaded by js/chunk-loader.js from the
// manifest this script writes into dist/spa.html.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const STATIC = path.join(DIST, 'static');
const args = new Set(process.argv.slice(2));
const WATCH = args.has('--watch');
const SERVE = args.has('--serve');

// Order matters within a chunk (config → auth → state → …), exactly as the
// old <script defer> order did. Every chunk assumes `core` has already run.
const CHUNKS = {
  core: [
    // display geometry, then the static content fallbacks (var-declared so
    // boot.js can reassign window.projects etc. after the live fetch)
    'js/world-config.js', 'projects.js', 'characters.js', 'locations.js',
    'js/config.js', 'js/theme.js', 'js/auth.js', 'js/state.js', 'js/layout.js',
    // scene-guess-logic: Scene Guess rules, used by the /world HUD and the admin stills tab
    'js/utils.js', 'js/pan-zoom-logic.js', 'js/pan-zoom.js', 'js/messaging-logic.js', 'js/scene-guess-logic.js', 'js/poster-art.js', 'js/nodeFactory.js', 'js/renderer.js', 'js/orderRenderer.js',
    'js/watch-controls.js', 'js/post-composer.js', 'js/popup.js', 'js/goals.js', 'js/friend-view.js', 'js/friends.js',
    'js/messages.js', 'js/reports.js',
    'js/memory.js', 'js/walker-dialogues.js', 'js/walkerView.js', 'js/walkers.js',
    'js/chunk-loader.js', 'js/router.js', 'js/humanoid-prefetch.js',
    'js/views/login.js', 'js/views/app.js', 'js/views/watchorder.js', 'js/views/board.js',
    'js/views/profile.js', 'js/views/feed.js', 'js/views/characters.js',
    'js/views/messages.js', 'js/views/reports.js',
    'js/views/home-builder.js', 'js/views/home-edit.js',
    'js/views/friend-watch.js', 'js/views/friend-map.js', 'js/views/friend-profile.js',
    'js/boot.js'
  ],
  world: [
    'js/playground.js', 'js/character-schema.js', 'js/theme-color.js',
    // pure logic (also unit-tested) — must precede playground3d.js, which
    // reads PG3DPhysics / WorldNpcLogic constants when its IIFE runs
    'js/playground3d-physics.js', 'js/world-net-logic.js', 'js/world-npc-logic.js', 'js/world-chat-logic.js',
    'js/world-house-logic.js',
    // gear-logic: measured fits for the realistic body's clothes (humanoid reads it)
    'js/playground3d-humanoid-logic.js', 'js/playground3d-gear-logic.js', 'js/playground3d-humanoid.js',
    'js/playground3d-avatar.js', 'js/playground3d-gear.js', 'js/playground3d-input-logic.js', 'js/playground3d-input.js', 'js/playground3d-occlusion.js',
    'js/playground3d-props.js', 'js/playground3d-house.js', 'js/pg-orientation.js', 'js/playground3d-scene.js',
    'js/playground3d.js',
    'js/home-socket.js', 'js/scene-guess.js', 'js/voice-chat.js', 'js/house-editor.js',
    'js/views/customize.js', 'js/views/home.js', 'js/views/world.js', 'js/views/friend-home.js'
  ],
  admin: [
    'js/views/admin/index.js', 'js/views/admin/users.js', 'js/views/admin/moderation.js',
    'js/views/admin/config.js', 'js/views/admin/cms.js',
    // project-logic: prerequisite loops + free cells (also required by routes/admin.js)
    'js/project-logic.js', 'js/views/admin/prereq-picker.js', 'js/views/admin/cms-projects.js',
    'js/views/admin/cms-projects-board.js', 'js/views/admin/cms-characters.js',
    'js/views/admin/cms-locations.js', 'js/views/admin/cms-dialogues.js', 'js/views/admin/cms-scenes.js',
    'js/views/admin/reports.js', 'js/views/admin/audit.js', 'js/views/admin/overview.js'
  ]
};

// Globals that other code resolves by name at runtime. If esbuild ever
// renamed top-level symbols these would vanish and the app would die with
// ReferenceErrors, so the build refuses to write such output.
const EXPECT_GLOBALS = {
  core: ['Router', 'Auth', 'state', 'Chunks', 'CONFIG', 'API', 'Walkers', 'WALKER_DIALOGUES',
         'FriendView', 'WatchOrderView', 'AppView', 'LoginView', 'HomeEditView', 'esc', 'toast',
         'MessagesView', 'ReportsView', 'Messages', 'MessagesBadge', 'Reports', 'showReportDialog', 'PanZoom', 'PosterArt'],
  world: ['Playground', 'Playground3D', 'Multiplayer', 'VoiceManager', 'PG3DProps', 'HouseEditor', 'SceneGuess',
          'HomeView', 'CustomizeView', 'WorldView', 'FriendHomeView'],
  admin: ['AdminView']
};
// Globals attached as properties (`root.PG3DPhysics = api` in the UMD-style
// files) rather than declared — checked for a `.Name =` assignment instead.
const EXPECT_ATTACHED = {
  core: ['MessagingLogic', 'HumanoidPrefetch', 'SceneGuessLogic', 'PanZoomLogic'],
  admin: ['ProjectLogic'],
  world: ['PG3DPhysics', 'WorldNetLogic', 'PG3DInputLogic', 'WorldNpcLogic', 'WorldChatLogic', 'WorldHouseLogic', 'PG3DHouse', 'PG3DHumanoidLogic', 'PG3DHumanoid', 'PG3DGearLogic',
          'PG3DAvatar', 'PG3DGear', 'PG3DInput', 'PG3DOcclusion', 'PGOrientation', 'PG3DScene']
};
// Must stay `var` (window properties): js/boot.js does window[key] = items.
const VAR_GLOBALS = ['projects', 'characters', 'LOCATIONS'];

const PRECACHE_STATIC = ['/spa.html', '/assets/favicon.jpg', '/assets/avengers-logo.svg', '/manifest.json'];

// The realistic-character model folder — read from PG3DHumanoidLogic.ASSET_BASE
// (the one place it is defined), then handed to the core chunk
// (js/humanoid-prefetch.js) and the service worker's model cache.
function modelInfo() {
  const logic = read('js/playground3d-humanoid-logic.js');
  const m = logic.match(/const ASSET_BASE = '([^']+)'/);
  if (!m) throw new Error('[build] ASSET_BASE not found in js/playground3d-humanoid-logic.js');
  const base = m[1];                                   // '/assets/models/humanoid/v1/'
  const rel = base.replace(/^\//, '');
  let manifest = null;
  try { manifest = JSON.parse(read(rel + 'manifest.json')); } catch (_) { /* no models built */ }
  const files = manifest ? [
    'manifest.json',
    ...Object.values(manifest.bodies || {}).map((b) => b.file),
    manifest.hair && manifest.hair.file,
    manifest.anims && manifest.anims.file
  ].filter(Boolean).map((f) => base + f) : [];
  // New models (a new vN folder or a rebuilt manifest) → a new cache name;
  // the worker drops the old one when it activates.
  const cache = 'mcu-models-' + hash(base + (manifest ? JSON.stringify(manifest) : ''));
  return { base, files, cache };
}

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

function assertGlobals(name, code) {
  const missing = [];
  for (const g of EXPECT_GLOBALS[name] || []) {
    // `const Router=`, `function esc(`, `class WatchState`, or a merged
    // declaration `var a=1,projects=[`.
    const re = new RegExp('(?:\\b(?:var|let|const|function|class)\\s+|,\\s*)' + g + '\\b\\s*[=(]');
    if (!re.test(code)) missing.push(g);
  }
  for (const g of EXPECT_ATTACHED[name] || []) {
    if (!new RegExp('\\.' + g + '\\s*=[^=]').test(code)) missing.push(g + ' (attached)');
  }
  if (name === 'core') {
    for (const g of VAR_GLOBALS) {
      if (!new RegExp('\\bvar\\b[^;]*?\\b' + g + '\\s*=').test(code)) missing.push('var ' + g);
    }
  }
  if (missing.length) {
    throw new Error(`[build] ${name}: top-level globals missing after minify: ${missing.join(', ')}. ` +
      'esbuild must not rename top-level names of a classic script — do not add bundle/format options.');
  }
}

async function buildChunk(name, define) {
  const concat = CHUNKS[name]
    .map((rel) => `// ---- ${rel} ----\n` + read(rel))
    .join('\n;\n') + '\n';
  const out = await esbuild.transform(concat, {
    minify: true,
    sourcemap: 'external',
    sourcefile: `${name}.concat.js`,
    target: 'es2022',
    legalComments: 'none',
    logLevel: 'warning',
    define: define || {}
  });
  assertGlobals(name, out.code);
  const file = `${name}.${hash(out.code)}.js`;
  fs.writeFileSync(path.join(STATIC, file), out.code + `\n//# sourceMappingURL=${file}.map\n`);
  fs.writeFileSync(path.join(STATIC, file + '.map'), out.map);
  return { name, file, url: '/dist/' + file, raw: concat.length, bytes: out.code.length };
}

// styles/index.css imports the partials (and declares the cascade layers);
// esbuild bundles them into one minified file. No url() in the CSS points at
// a file on disk (only data: URIs), so nothing else gets pulled in.
function cssSourceBytes(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? cssSourceBytes(p) : (e.name.endsWith('.css') ? fs.statSync(p).size : 0);
  }
  return n;
}
async function buildCss() {
  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, 'styles', 'index.css')],
    bundle: true,
    minify: true,
    write: false,
    // Site-absolute URLs (the brand mark's mask image) are served as-is.
    external: ['/assets/*'],
    logLevel: 'warning'
  });
  const code = res.outputFiles[0].text;
  const file = `styles.${hash(code)}.css`;
  fs.writeFileSync(path.join(STATIC, file), code);
  return { name: 'styles', file, url: '/dist/' + file, raw: cssSourceBytes(path.join(ROOT, 'styles')), bytes: code.length };
}

function buildShim() {
  const code = read('js/three-shim.mjs');
  const file = `three-shim.${hash(code)}.js`;
  fs.writeFileSync(path.join(STATIC, file), code);
  return { name: 'three-shim', file, url: '/dist/' + file, raw: code.length, bytes: code.length };
}

function fill(template, replacements) {
  let s = read(template);
  for (const [marker, value] of Object.entries(replacements)) {
    if (!s.includes(marker)) throw new Error(`[build] ${template}: marker ${marker} not found`);
    s = s.split(marker).join(value);
  }
  return s;
}

function prune(keep) {
  for (const f of fs.readdirSync(STATIC)) {
    if (!keep.has(f)) { try { fs.unlinkSync(path.join(STATIC, f)); } catch (_) { /* in use; next run */ } }
  }
}

// The anti-flash snippet in spa.html duplicates js/theme.js's defaulting and
// theme-colour values (it has to run before any script). Refuse to build if
// they drift apart — a mismatch flashes the wrong toolbar colour on load.
function assertThemeSnippet() {
  const theme = read('js/theme.js');
  const spa = read('spa.html');
  const metas = [...theme.matchAll(/(cinematic|comic): \{ meta: '(#[0-9a-f]{6})' \}/g)].map((m) => [m[1], m[2]]);
  if (metas.length !== 2) throw new Error('[build] js/theme.js THEMES not found');
  for (const [name, hex] of metas) {
    if (!spa.includes(`'${hex}'`) && !spa.includes(`"${hex}"`)) {
      throw new Error(`[build] spa.html anti-flash snippet lacks ${name} theme-color ${hex} (js/theme.js)`);
    }
  }
}

export async function build() {
  const t0 = Date.now();
  fs.mkdirSync(STATIC, { recursive: true });
  assertThemeSnippet();

  const models = modelInfo();
  const define = { __MODEL_BASE__: JSON.stringify(models.base) };
  const [core, world, admin] = await Promise.all(['core', 'world', 'admin'].map((n) => buildChunk(n, define)));
  const css = await buildCss();
  const shim = buildShim();

  const manifest = {
    world: { scripts: ['/socket.io/socket.io.js', world.url], modules: [shim.url] },
    admin: { scripts: [admin.url] }
  };
  const spa = fill('spa.html', {
    '<!-- build:styles -->': `<link rel="stylesheet" href="${css.url}" />`,
    '<!-- build:scripts -->':
      `<script type="application/json" id="chunk-manifest">${JSON.stringify(manifest)}</script>\n` +
      `  <script defer src="${core.url}"></script>`
  });
  fs.writeFileSync(path.join(DIST, 'spa.html'), spa);

  const version = 'mcu-' + hash([core, world, admin, css, shim].map((o) => o.file).join('|') + spa);
  const sw = fill('sw.js', {
    '__CACHE_VERSION__': version,
    '__PRECACHE__': JSON.stringify([...PRECACHE_STATIC, core.url, css.url]),
    '__MODEL_CACHE__': models.cache,
    '__MODEL_FILES__': JSON.stringify(models.files)
  });
  fs.writeFileSync(path.join(DIST, 'sw.js'), sw);

  const outputs = [core, world, admin, css, shim];
  prune(new Set(outputs.flatMap((o) => [o.file, o.file + '.map'])));

  for (const o of outputs) console.log(`  ${o.file.padEnd(28)} ${kb(o.raw).padStart(8)} → ${kb(o.bytes).padStart(7)}`);
  console.log(`[build] ${version} in ${Date.now() - t0} ms`);
  return { version, outputs };
}

async function main() {
  try {
    await build();
  } catch (err) {
    console.error(err.message || err);
    if (!WATCH) process.exit(1);
  }

  if (WATCH) {
    let timer = null, running = false, queued = false;
    const run = async () => {
      if (running) { queued = true; return; }
      running = true;
      try { await build(); } catch (err) { console.error(err.message || err); }
      running = false;
      if (queued) { queued = false; run(); }
    };
    const trigger = () => { clearTimeout(timer); timer = setTimeout(run, 150); };
    fs.watch(path.join(ROOT, 'js'), { recursive: true }, trigger);
    fs.watch(path.join(ROOT, 'styles'), { recursive: true }, trigger);
    for (const f of ['projects.js', 'characters.js', 'locations.js', 'spa.html', 'sw.js']) {
      fs.watch(path.join(ROOT, f), trigger);
    }
    console.log('[build] watching js/, styles/, spa.html, sw.js and the content files');
  }

  if (SERVE) {
    const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code == null ? 0 : code));
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { child.kill(); process.exit(0); });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
