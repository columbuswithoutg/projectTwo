# Prompt for Fable — build "Watchverse" (Claude's cut)

> Paste everything below the line into Fable as a single brief.
> This is a from-scratch build spec. It is a *reimagining* of an existing
> project (an MCU watch-order tracker that doubles as a multiplayer game
> world), keeping its best ideas and deliberately changing the parts that
> aged badly. Where this brief says "keep" or "change", it is comparing
> against that reference — you never need to see the reference to build this.

---

## 0. Your brief

Build **Watchverse**: a watch-order tracker for a fictional cinematic
universe that doubles as a small multiplayer game world. The core premise —
the one idea everything serves — is:

> **Watching things is what makes the world exist.** Every title a user
> marks watched unlocks more of a map, more characters in their roster,
> more rooms in their personal 3D house, and more islands to walk around
> in with friends.

Ship the whole thing. Everything in this brief is in scope; nothing is
"phase two".

### Stack — my choices, not yours

The reference project was vanilla JS with no build step, JS globals as a
data layer, and a `vm.runInNewContext` trick to read them server-side. It
worked, but it fought its own tooling. This build makes different calls:

- **TypeScript everywhere** — client, server, and a shared `core/` package.
- **One shared pure-logic package** (`core/`): the unlock/visibility rules,
  phase gating, island grouping (union-find), jump/fall/walkability math,
  punch-target selection, goal computation, and room-layout validation all
  live here as dependency-free functions, imported by both the client and
  the server, and covered by unit tests. The server must enforce with the
  *same functions* the client renders with — no logic duplication.
- **Vite** for the client build. No heavyweight UI framework — a thin
  hand-rolled SPA router and view modules are fine (the app is mostly
  canvas/WebGL surfaces, not forms) — but you may use a light reactive
  library for the admin panel if you justify it in the README.
- **Node + Express (or Fastify) + Socket.IO** as a single deployable
  service, serving the built client. Free-tier friendly: one web service,
  one free-tier MongoDB or Postgres, one free media host (Cloudinary-style)
  for user uploads. No other infrastructure.
- **Three.js** for the 3D surfaces. **WebRTC** for voice. **PWA** with an
  offline shell.
- Real tests, CI on push, a README that stays current, and a dated
  changelog you append to as you ship.

### Content packs — the biggest change

The reference hard-coded one copyrighted universe (71 MCU titles, 131
characters, real film dialogue). This build separates **engine** from
**content**:

- All world content loads from a **content pack**: a versioned directory of
  schema-validated JSON files (`projects.json`, `characters.json`,
  `locations.json`, `dialogues.json`, `pack.json` manifest) plus an
  `assets/` tree. Loading a different pack is a file swap plus a reseed —
  zero code changes.
- Ship one complete **original demo pack**: an invented superhero-flavored
  universe (your own names, posters, and dialogue — no real-world IP, no
  quotes from real films) with **~30 projects across 5 phases, ~60
  characters, ~20 locations**, sized to exercise every mechanic below:
  multiple prerequisite chains, several no-prerequisite entry points, phase
  keystones, character stage evolutions, a cosmos band on the map, and
  enough dialogue pairs that walkers feel alive by six watched titles.
- Validate packs at seed time with a schema and clear error messages. The
  pack format is documented so a user could author an MCU pack privately.

---

## 1. The domain model

### 1.1 Projects

```jsonc
{
  "id": "vigil1",                    // stable slug, referenced by everything
  "title": "Vigil",
  "release": "2008-05-02",
  "prerequisites": ["..."],          // ids that must be watched first
  "hiddenPrerequisites": ["..."],    // same effect, not drawn as an arrow
  "phase": 1,
  "gridX": 0, "gridY": 1,            // position on the watch-order flowchart
  "location": "baytown",             // foreign key into locations
  "image": "vigil1.png"
}
```

Prerequisites encode a *narrative* watch order, not release order. Several
projects deliberately have **no** prerequisites so they act as fresh entry
points into the universe.

### 1.2 Phase gating

Whole phases are gated behind one keystone project each, declared in the
pack manifest:

```jsonc
"phaseKeystones": { "2": "assembly1", "3": "riftwar", "4": "reckoning", "5": "paradox1" }
```

Phase 1 is always open.

### 1.3 The three visibility states — the load-bearing rule

Implement once, in `core/`, and derive every view from it:

- `isPhaseUnlocked(p)` — phase 1, or the phase's keystone is watched.
- `isUnlocked(p)` — phase unlocked **and** every prerequisite (visible and
  hidden) is watched.
- `isWatched(p)` — marked watched at least once.
- `isRevealed(p)` — unlocked but not yet watched: the "watch this next" state.

Locked projects render as silhouettes on the flowchart and are **absent
entirely** from the map and the 3D world. Revealed projects sit on an
"up next" shelf, not on the map. Only watched projects place a node in the
world. The server enforces the same rules for anything server-authoritative
(room counts, island membership) using the same `core/` functions.

### 1.4 Characters

```jsonc
{
  "id": "warden",
  "name": "The Warden",
  "debut": "vigil1",                 // unlocks when this project is watched
  "image": "warden.png",
  "stages": [
    { "after": "riftwar", "image": "warden_exiled.png", "look": "Exile armor" }
  ],
  "combat": { "hp": 120, "melee": "hammer", "ranged": "bolt", "villain": false }
}
```

A character appears in the roster once its debut is watched, and its
portrait **swaps to the latest stage whose `after` project is watched** —
the roster visibly ages alongside the user's progress. This is a headline
feature, so the demo pack must give at least 10 characters multi-stage
evolutions.

### 1.5 Locations

Fixed rectangles on an abstract 8000 × 5600 canvas, positioned with honest
*relative* geography and a distinct "cosmos" band above a threshold Y for
off-world locations. Sized by expected member count (small 280×200 up to a
1000×600 metropolis). Each has a backdrop image.

### 1.6 Dialogues

Keyed conversations between character pairs (`"id1|id2"`, ids sorted):

```jsonc
"marrow|warden": [
  { "requires": "assembly1", "lines": ["You fight like a rumor.", "You bleed like a fact."] },
  { "requires": "riftwar", "startsWith": "warden", "lines": ["...", "..."] }
]
```

`lines[0]` is spoken by the initiator, alternating; `startsWith` overrides
who starts. `requires` gates the exchange — **a user must never see
dialogue referencing a title they have not watched.** All lines are
original writing in each character's voice. Also author per-character
defeat and victory lines.

---

## 2. Screens

### 2.1 `/` — Watch Order (the primary surface)

A flowchart of all projects laid out by `gridX`/`gridY` with curved
prerequisite arrows. Poster art per node. Four visual states: locked
(silhouette), revealed (glowing), watched (full color + checkmark), and
current focus.

Clicking a node opens a popup: poster, title, release, phase, debuting
characters, watch/unwatch, a rewatch counter, a "watched with" friend tag,
and that project's memory gallery (§4).

A **Goals panel** lists the locked projects exactly *one step* away —
every requirement already watched or currently revealed. Never recurse
into projects the user can't see yet; it should read as "watch these two
and Phase 4 opens", not a dependency dump.

### 2.2 `/map` — the universe map

Pan/zoom canvas of the 8000 × 5600 world. Unlocked locations appear as
their authored rectangles with backdrops; member projects are small pins
along the bottom edge in release order — the location is the visual, not
the pins. Roads connect locations along the prerequisite graph, endpoints
tucked *inside* the rectangles. Zoom presets; snap-animate to a selected
location.

**Walkers — the map's soul.** The user deploys circular character
portraits (one slot per watched project) that autonomously roam the roads:

- Node-to-node random paths, tuneable speed, random pauses, a bob and a
  lean into the walk direction.
- Collision radius kept within the road half-width; damping and edge bounce.
- **Encounters:** two walkers within an encounter distance stop and play a
  dialogue exchange (§1.6) as speech bubbles, line by line, gated by watch
  progress, with a per-pair cooldown.
- **Fights:** with a tuneable spawn chance a villain spawns at a node;
  nearby heroes converge. Combat stats from the pack (HP, orbiting melee
  weapon, optional projectile ranged weapon). HP bars, hit flashes, loser
  faints with a defeat line, winner gets a victory line, villains get an
  HP multiplier. A no-show timeout cleans up ignored fights; a deploy
  grace period protects fresh walkers. Fights are user-toggleable.

All walker physics constants are **live-tuneable from the admin panel**
and pushed to clients at boot.

### 2.3 `/world` — the shared 3D world (multiplayer)

A Three.js world you walk around in person.

- **Geometry:** group the user's unlocked projects into connected
  components ("islands") via union-find over prerequisite edges (both ends
  unlocked). Each island is a floating landmass; its projects are
  landmarks. On entry the user picks a spawn island (one card per island).
  A fresh account gets one island with one node.
- **Movement:** third-person chase camera, camera-relative WASD (joystick
  on touch), procedural walk cycle, Space to jump. Gaps between adjacent
  islands (~2.0–2.8 units) are clearable only with a *running* jump (air
  speed ×1.25); distant islands stay unreachable. Miss and you fall, fade,
  and respawn at your last safe spot.
- **Multiplayer:** one global room, JWT-authenticated sockets, positions
  lerped between broadcasts, floating nametags, ephemeral chat and emotes.
  Server-authoritative.
- **Punch:** `F` / touch button, 300 ms jab, 600 ms cooldown, nearest
  target within 1.4 u horizontal / 1.5 u vertical is knocked down — tips
  flat, 1.8 s input-dead, eases back up. Server validates membership and a
  rate floor before relaying.
- **The six Relic Stones (shared PvP):** six stones exist **once,
  globally, server-authoritative**, spawning in a ring around the
  universal spawn island. Walk onto a free stone to claim it; held stones
  orbit their holder visibly. **Punching a holder steals exactly one.**
  Hold all six → a pulsing **SNAP** button (`G`): a random ~50% of the
  *other* players dust, fade, and respawn, then all six scatter for a
  fresh round. Server verifies all-six ownership plus a minimum interval,
  picks victims via partial Fisher–Yates, and increments a persistent
  lifetime snap counter. Stones release on holder disconnect **and** on
  duplicate-socket eviction — a stone must never be strandable. Friends
  leaderboard ranks lifetime snaps.
- **Proximity voice:** opt-in mic toggle opens a WebRTC P2P mesh (server
  relays only SDP/ICE). A ~100 ms loop ramps per-peer gain on a linear
  falloff (full at 0 u, silent at 25 u). Voice-activity detection glows
  the speaker's nametag. Glare-safe deterministic negotiation (lower
  socket id initiates). STUN default; TURN configurable via env vars,
  documented.

### 2.4 `/home` — your personal 3D house

A private 3D space built from watched projects. **One room per two watched
projects, enforced server-side.** Rooms are 1×1 grid cells placed in an
edit mode. Each room's floor is textured with its project's poster; walls
take the poster's auto-extracted dominant colors. Doorways cut
automatically at shared edges, two units wide, centered. Same avatar,
camera, and movement as `/world`.

Friends can visit (`/friend/:username/home`) — same socket infrastructure
scoped to a per-owner room, with chat, emotes, and proximity voice.

### 2.5 `/customize` — the avatar builder

A live-rendered 3D character builder with **16 slots** (the reference had
35; trim to the ones that read at gameplay camera distance): skin, build,
hair style + color, eye color, facial hair, glasses/mask, hat/helmet,
shirt style + color, outerwear, pants style + color, shoe style, gloves,
suit, emblem + color. Every slot is a small integer index; the saved
character is a compact object of numbers, **range-validated server-side**.

The rig: rounded-box head and tapering torso, two-segment capsule limbs
with knee/elbow bend in the walk cycle, sphere hands, neck cylinder,
landing squash after jumps, and idle sway phase-offset per character so
crowds don't sync. Share geometries via a cache keyed on shape+dims and
never dispose shared geometry on rig teardown. Ship a handful of preset
builds themed on the demo pack's heroes.

### 2.6 `/characters` — the roster

Grid of every character. Locked = silhouette + "debuts in ⟨title⟩".
Unlocked = current-stage portrait with the stage's `look` description and
the project that unlocked it.

### 2.7 `/profile`

Watch statistics, per-phase progress, profile picture upload, appearance
control (Light / Dark / System — §7), the friends entry point, and a
discreet ⚙ admin link rendered only for admins.

### 2.8 `/login`

Register and login tabs. Registration plays an animated success step
(checkmark + toast) before landing on Login with the username prefilled
and the password focused; skipped under `prefers-reduced-motion`.

---

## 3. Friends and social

- Send / accept / decline friend requests by username.
- Read-only friend views at `/friend/:username{,/map,/home,/profile}`.
  Friend mode must never leak the friend's progress into the viewer's own
  state — auto-exit on any navigation away from `/friend/*`, including
  back/forward and address-bar edits.
- **Watch parties:** invite a friend to co-watch a project; accepting
  records it on both accounts.
- Snap leaderboard across you and your friends.

---

## 4. Memories

Photos and short videos attached to any watched project, with captions.
Uploads go to the media host — never the app's filesystem, which is
assumed ephemeral. Gallery + lightbox in the project popup. Deleting a
memory deletes the remote asset too, not just the row.

---

## 5. Admin panel (`/admin`, hidden route)

Six tabs, reachable only via the profile ⚙ (admins only):

| Tab | Contents |
|---|---|
| **Users** | Search, detail, ban/unban with reason, force password reset, delete. Online dot (active < 5 min) + relative "active 3m ago". |
| **Moderation** | Memories grid (delete also wipes the media host) and pending friend requests. |
| **CMS** | Sub-tabs for Projects, Characters, Locations, Dialogues — full CRUD against the live DB copy of the pack. |
| **Config** | Live sliders for walker speed, pause min/max, encounter distance/cooldown, fight spawn chance, plus default Fights/Dialogues toggles for new accounts. |
| **Audit Log** | Paginated, action-filterable record of every destructive admin action. |
| **Overview** | Totals (users, banned, memories) + a 30-day signup chart. |

The CMS Projects tab includes a **drag-to-move board mode**: nodes at
`gridX`/`gridY` with prerequisite arrows, pointer drag with free-cell drop
checks, click-empty-cell to create, click-node to edit, arrow-key nudge,
and staged moves committed via one "Save layout" that validates against
current DB state, rejects collisions, and writes a single audit entry.

**Admin promotion has no UI path, by design** — a flag set directly in the
database.

---

## 6. Auth and security

Keep every property below — they were the reference's best engineering:

- Hashed passwords; JWT (7-day) carrying `{ id, isAdmin, tokenVersion }`.
- Auth middleware: verify signature → ~30 s in-memory cache keyed on
  user+tokenVersion → DB check on miss. **tokenVersion rotation** on ban /
  unban / password reset; a mismatch is a 401, instantly logging out every
  other tab and device.
- **The `isAdmin` JWT claim is UX-only.** Every admin endpoint re-reads
  `isAdmin` from the DB per call, so demotion is immediate. Load-bearing;
  never optimize it away.
- Authenticated responses: `Cache-Control: private, no-store`.
- Throttled `lastActiveAt` writes (≤ once/min per user).
- A centralized router-level auth gate (history *replace*, so gated URLs
  never enter the back stack), with per-view checks kept as backstop.
- Rate limits on auth, upload, and admin; socket event rate floors.
- Refuse to boot if the JWT secret is under 32 characters.
- Enforced CSP with an explicit allowlist, nosniff, frame options,
  referrer policy, HSTS, COOP, CORP; compression on.
- Escape every user-controlled string before it reaches the DOM.

---

## 7. Theming

- **Dark is the hard default** — unset/invalid preference resolves to dark
  regardless of OS; only an explicit "System" choice follows the OS.
- The light theme is a clean "comics print" look: white surfaces,
  near-black text, red accents. Pick an accent red for the brand; use a
  deeper crimson for destructive confirms so they stay distinct.
- **The map and 3D world are scenes and stay dark in both themes** —
  poster art needs a dark canvas. Fixed scene tokens untouched by the
  theme switch.
- Semantic CSS custom properties throughout (surface, text, border, scrim,
  shadow) with a single dark-override block; no scattered color literals.
- Anti-flash inline script resolves the theme before first paint.

---

## 8. Performance and boot

- **Mount instantly** against the pack content bundled in the client
  build; fetch the live DB copy in the background and re-render affected
  views only if a normalized signature meaningfully differs. Cap
  background fetches (~4 s). A cold server must never mean staring at a
  splash.
- Themed boot splash painted before any JS runs, removed on first mount,
  with a timeout safety net.
- PWA: manifest + service worker precaching the shell and static content,
  stale-while-revalidate for scripts/assets, **never caching API or socket
  traffic**, and a cache version constant that purges old caches on bump.
- 3D engine: cache poster textures across home ↔ world transitions; no
  per-frame allocation in HUD ticks.
- Lazy-load images in modals and secondary views; cache-bust assets via a
  version query param.

---

## 9. Data resilience

Content lives in the database, but **the repo carries the complete pack as
the fallback**. Content endpoints read the DB first and fall back to the
bundled pack when a collection is empty or the DB errors. The app must
fully boot, render, and be navigable with the database down — only
user-specific data (progress, friends, memories) degrades.

Ship two scripts: an idempotent seed (pack → DB, safe to re-run, `--wipe`
flag) and its inverse (DB → pack files, `--dry-run` flag) so CMS edits can
be snapshotted back into the repo.

---

## 10. Testing, CI, docs

- Unit tests for everything in `core/` — visibility rules, phase gating,
  goals, island grouping, jump/fall/walkability, punch-target selection,
  room-layout validation — plus the pack schema validator.
- One Socket.IO integration test driving two real socket clients through
  grab → steal-on-punch → snap → scatter, asserting server state at each
  step (the reference proved this flow manually; automate it).
- CI on push: typecheck + lint + full test suite.
- README: stack rationale, repo layout, setup and env vars, architecture
  (boot order, auth flow, the fallback system, the admin model, the pack
  format), common operations, known constraints — and **a dated changelog
  entry appended every time a feature ships or a bug is fixed**, as a
  standing requirement.

---

## 11. Assets

All art is original and generated at build/design time — typographic
poster cards per project, initial-or-symbol character chips, and abstract
location backdrops in a palette matching each location's mood — so the
demo pack is visually complete out of the box. Every image is referenced
by filename through the pack, with a manifest listing exactly which
filenames each collection expects, so replacing art (or an entire pack) is
a pure file-drop operation.

---

## 12. What "done" looks like

A new user registers, lands on an almost entirely locked watch order,
marks the first film watched, and immediately watches the world grow: a
city appears on the map, three characters join the roster, a first island
materializes in the 3D world. Two projects in, their first room unlocks at
home. Six projects in, walkers are having real conversations on the roads
between cities. After the phase keystone, Phase 2 opens and the map
doubles. Along the way they add a friend, tag them on a co-watch, upload a
photo from watch night, walk into the shared 3D world, hear that friend's
voice get louder as they approach, punch a stone out of their hands, and
snap.

Build that.
