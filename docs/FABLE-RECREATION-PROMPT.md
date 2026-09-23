# Prompt for Fable — build "MCU Tracker"

> Paste everything below the line into Fable as a single brief.
> It is a from-scratch build spec, not a patch against an existing repo.

---

## 0. Your brief

Build a full-stack web application called **MCU Tracker**: a Marvel Cinematic
Universe watch-order tracker that doubles as a small multiplayer game world.
The premise is that **watching things is what makes the world exist** — every
project a user marks watched unlocks more of a map, more characters, more rooms
in their personal 3D house, and more islands to walk around in with friends.

Ship the whole thing. Scope is full parity with the feature list below — nothing
here is optional or "phase two".

**You choose the stack.** Pick whatever you judge best for this shape of
application and justify the choice in one short paragraph in the README before
you start writing code. Constraints you must respect whatever you pick:

- Runs as a single deployable web service (a Render/Railway/Fly-style Node or
  edge target). No paid infrastructure beyond a free-tier database and a free
  media host.
- Real-time multiplayer over WebSockets, plus browser-to-browser WebRTC audio.
- Real 3D in the browser (Three.js or a wrapper over it).
- Installable PWA with an offline shell.
- The reference implementation this replaces used: vanilla-JS SPA (no
  framework), Express 5, Mongoose/MongoDB Atlas, Socket.IO, Three.js via
  importmap, Cloudinary for uploads, JWT auth, deployed on Render. You are free
  to keep that, modernise it, or diverge — but say why.

Write it as a real project: tests for the pure logic, CI, a README that stays
current, and a changelog you append to as you ship.

---

## 1. The domain model

Four content collections. All four must be **seeded from static files in the
repo AND editable at runtime through an admin CMS**, with the static files
acting as a fallback when the database is unreachable (see §9).

### 1.1 Projects (71 of them)

Every MCU film and series, Phase 1 through Phase 6. Shape:

```
{
  id: "ironman1",                  // stable slug, referenced by everything else
  title: "Iron Man",
  release: "2008-05-02",
  prerequisites: ["..."],          // project ids that must be watched first
  hiddenPrerequisites: ["..."],    // optional; same effect, not drawn as an arrow
  phase: "Phase 1",
  phaseNum: 1,
  gridX: 0, gridY: 1,              // position on the watch-order flowchart
  location: "malibu",              // foreign key into Locations
  image: "ironman.png"
}
```

Seed the real list: Iron Man through the current Phase 6 releases, including the
Disney+ series (WandaVision, Loki S1/S2, Hawkeye, Ms. Marvel, She-Hulk,
Moon Knight, Secret Invasion, Echo, Agatha, Ironheart, Daredevil: Born Again,
What If…? S1–S3, X-Men 97, Marvel Zombies, Eyes of Wakanda) and the
Netflix/Defenders saga (Daredevil, Jessica Jones, Luke Cage, Iron Fist, The
Defenders, The Punisher). Prerequisites should encode a sane *narrative* watch
order, not release order — several projects (Guardians 1, Doctor Strange,
Moon Knight) deliberately have **no** prerequisites so they act as fresh entry
points.

### 1.2 Phase gating

Separate from per-project prerequisites, whole phases are gated behind one
keystone project each:

```
Phase 2 → requires "avengers1"
Phase 3 → requires "ageofultron"
Phase 4 → requires "endgame"
Phase 5 → requires "loki1"
Phase 6 → requires "loki2"
```

Phase 1 is always open.

### 1.3 The three visibility states

This is the single most important rule in the app. Implement it once, in a
shared module, and derive every view from it:

- `isPhaseUnlocked(p)` — `p.phaseNum === 1`, or the phase's keystone is watched.
- `isUnlocked(p)` — phase unlocked **and** every prerequisite (visible + hidden)
  is watched.
- `isWatched(p)` — the user has marked it watched at least once.
- `isRevealed(p)` — unlocked but not yet watched. This is the "you can watch
  this next" state.

Locked projects are rendered as silhouettes on the flowchart and are **absent
entirely** from the map and the 3D world. Revealed-but-unwatched projects sit
on an "up next" shelf, not on the map proper. Only watched projects place a
node in the world.

### 1.4 Characters (131 of them)

```
{
  id: "hulk",
  name: "Hulk",
  debut: "hulk",                  // project id — character unlocks when it's watched
  image: "hulk.jpg",
  stages: [                        // optional visual evolution
    { after: "thor3",   image: "hulk_gladiator.jpg", look: "Sakaar gladiator armor" },
    { after: "endgame", image: "hulk_smart.jpg",     look: "Smart Hulk" }
  ]
}
```

A character appears in the roster once its debut project is watched, and its
portrait **swaps to the latest stage whose `after` project the user has
watched**. Iron Man → Mark VII → nanotech. Thor → short hair → Love and Thunder.
Black Widow → blonde → white suit. This progression is a headline feature: the
roster visibly ages alongside the user's progress.

### 1.5 Locations (36 of them)

Fixed rectangles on an abstract 8000 × 5600 canvas.

```
{
  id: "wakanda",
  name: "Wakanda",
  worldX: 4200, worldY: 2100,      // CENTER of the rectangle
  width: 540, height: 340,          // sized by expected member count
  background: "wakanda.webp"
}
```

Sizing convention: 1–2 member projects → 280×200, 3–4 → 400×280, 5–7 → 540×340,
NYC (27+) → 1000×600. Locations with `worldY` above a `cosmosThresholdY` of 3400
render in a distinct "cosmos" band (Xandar, Sakaar, Titan, Knowhere, Vormir,
Hala, Sovereign, the Quantum Realm, the TVA, the Multiverse). Earth locations
preserve honest *relative* geography (SF west of NYC, London east of the
Americas, Wakanda in Africa's latitude band) with inter-city distances scaled up
hard so every card has ocean around it.

### 1.6 Dialogues

Keyed conversations between character pairs, keyed `"id1|id2"` with the ids
sorted alphabetically:

```
"cap|ironman": [
  { requires: "avengers1", lines: ["Big man in a suit of armor. Take that off, what are you?",
                                   "Genius, billionaire, playboy, philanthropist."] },
  { requires: "ageofultron", lines: ["Language!", "Did you just say 'language'?", "It just slipped out."] },
  { requires: "civilwar", startsWith: "ironman", lines: ["He's my friend.", "So was I."] }
]
```

`lines[0]` is spoken by the initiator, alternating. `startsWith` overrides who
speaks first (default: the alphabetically-first id). `requires` gates the
exchange behind a watched project — **a user must not see dialogue from a film
they have not watched.** Source lines from the actual films, lightly adapted for
a two-character format. Also author defeat lines and victory lines per character.

---

## 2. Screens

### 2.1 `/` — Watch Order (the primary surface)

A flowchart of all 71 projects laid out by `gridX`/`gridY`, with curved
prerequisite arrows between them. Poster art on each node. Four visual states:
locked (silhouette), revealed (glowing, "watch next"), watched (full colour,
checkmark), and current-focus.

Clicking a node opens a project popup: poster, title, release date, phase, the
characters who debut in it, a watch/unwatch control, a rewatch counter, a
"watched with" field for tagging friends, and the memory gallery for that
project (§4).

Nav drawer with links to every other surface, plus a **Goals** panel: given the
current progress, list the locked projects that are exactly *one step* away —
every requirement either already watched or currently revealed. Never recurse
into projects the user cannot see yet; the guide should read as "watch these two
and Phase 4 opens", not as a full dependency dump.

### 2.2 `/map` — Universe Map

Pan/zoom canvas of the 8000 × 5600 world. Each unlocked location appears as its
authored rectangle with its backdrop image; its member projects are small
30 × 45 pins in a row along the location's bottom edge, in release order. The
location is the dominant visual, not the pins.

Roads connect locations along the prerequisite graph — straight lines or cubic
béziers, with endpoints tucked *inside* the location rectangle so the road reads
as entering the city rather than stopping short of it. Zoom presets: whole-world,
region, and default. Locations snap-animate into view when selected.

**Walkers.** This is the map's soul. The user deploys circular character
portraits (one slot per watched project) that autonomously roam the road network:

- Walk node-to-node along random paths at a tuneable speed, pausing for a random
  interval between legs, with a bob and a lean into the walk direction.
- Physics: a collision radius that must stay within the road half-width, plus
  damping and bounce off road edges.
- **Encounters.** When two walkers come within an encounter distance, they stop
  and play a dialogue exchange from §1.6 — speech bubbles, line by line, gated by
  what the user has watched. Per-pair cooldown so the same two do not chat on
  loop.
- **Fights.** With a tuneable spawn chance, a villain walker spawns at a node.
  Nearby hero walkers converge on it. Each character has combat stats (HP, a
  melee weapon that orbits them, an optional ranged weapon that fires
  projectiles). HP bars render above the walkers, hits flash, the loser faints
  and shows a defeat line; the winner shows a victory line. Villains get an HP
  multiplier. A "no-show" timeout cleans up fights nobody joins, and a deploy
  grace period stops a freshly-deployed walker being instantly jumped. The whole
  fight system is a user-toggleable setting.

All walker physics constants (speed, pause min/max, encounter distance and
cooldown, fight spawn chance) are **live-tuneable from the admin panel** and
pushed to clients at boot.

### 2.3 `/world` — the 3D walkable world (multiplayer)

A Three.js recreation of the map that you walk around in person.

**Geometry.** Group the user's unlocked projects into connected components
("islands") via union-find over the prerequisite edges — two projects are
connected when one is a prerequisite of the other and *both* are unlocked. Each
island becomes a floating landmass with its member projects as landmarks. On
entry, the user picks which island to spawn on (one card per island, anchored on
its root project — Iron Man, Guardians, Doctor Strange…). A fresh account gets
one island with one node.

**Movement.** Third-person chase camera, camera-relative WASD (joystick on
touch), procedural walk cycle, jump on Space. Gaps between adjacent islands are
roughly 2.0–2.8 world units and a *running* jump (air speed × 1.25) clears
them — distant islands stay unreachable until you unlock the projects between.
Land on nothing and you fall below the world, fade out, and respawn at your last
safe spot after ~1 second or −8 units, whichever comes first.

**Multiplayer.** One global room. Every player sees every other player's avatar,
lerped between position broadcasts, with a floating nametag. Ephemeral text chat
and emotes. Server-authoritative, JWT-authenticated sockets.

**Punch and knockdown.** `F` (or a touch button) throws a 300 ms jab with a
600 ms cooldown. The nearest player or NPC within 1.4 units horizontally and 1.5
vertically is knocked down: tips backward to flat, lies there 1.8 s with input
dead, then eases back up. Every swing broadcasts; hits carry the victim's id and
the server validates room membership plus a rate floor before relaying.

**The Infinity Stones (shared PvP).** Six stones — Space, Mind, Reality, Power,
Time, Soul — exist **once, globally, server-authoritative**, spawning free in a
ring around the universal spawn island.

- Walk onto a free stone to claim it. Held stones orbit their holder so everyone
  can see who is carrying what.
- **Punching a holder steals exactly one stone from them.**
- Hold all six and a pulsing **SNAP** button appears (also bound to `G`).
  Snapping dusts a random ~50% of the *other* players in the room — they fade,
  respawn at spawn — and then all six stones scatter free for a fresh round.
- The server verifies all-six ownership and a minimum interval before honouring
  a snap, picks victims via a partial Fisher–Yates shuffle, and increments a
  persistent lifetime `stoneSnaps` counter on the snapper.
- Stones are released back to the world when a holder disconnects **and** when a
  duplicate socket for the same user is evicted — a stone must never be
  strandable.
- A friends leaderboard ranks lifetime snaps.

**Proximity voice chat.** Opt-in mic toggle opens a WebRTC P2P mesh with every
other voice-enabled peer in the room. The server only relays SDP/ICE — audio
never touches it. A ~100 ms loop reads each remote player's position and ramps a
per-peer gain node on a linear falloff (full volume at 0 units, silent at 25),
so voices fade as players walk apart. Voice-activity detection puts a glow on
speaking players' nametags. Deterministic glare-safe negotiation (lower socket
id initiates). STUN by default; make TURN configurable via environment variables
for cross-NAT users, and document the setup.

### 2.4 `/home` — your personal 3D house

A private 3D space built from the projects you have watched. **One room unlocks
per two watched projects** (enforced server-side, not just in the UI). Each room
is a 1 × 1 cell on a grid; the user places them in an edit mode.

Per room: the floor is textured with that project's poster, and the walls are
coloured from the dominant colours auto-extracted from that poster. Doorways are
cut automatically at every shared edge between adjacent rooms, two units wide and
centred. The same avatar, camera, and movement as `/world`.

Friends can visit your home (`/friend/:username/home`) — same socket
infrastructure, scoped to a per-owner room instead of the global one, with chat,
emotes, and proximity voice.

### 2.5 `/customize` — the avatar builder

A ~35-slot layered 3D character builder, rendered live. Slots: gender, skin,
build, hair style + colour, eye colour + shape, facial hair style + colour,
glasses, hat, helmet + colour, mask, shirt style + colour + accent, outerwear
style + colour + accent, pants style + colour + accent, shoe style + colour +
accent, gloves, belt, suit + colour, prop + colour, emblem + colour, accessory
colour. Every slot is a small integer index into a shared option array, so the
saved character is a compact object of numbers.

The avatar rig itself: rounded-box head and torso (the torso tapers from hips to
shoulders), two-segment capsule limbs with knee and elbow bend in the walk cycle,
sphere hands, a neck cylinder, landing squash after a jump, and a subtle idle
sway that is phase-offset per character so a crowd does not sync up. Share
geometries through a cache keyed on shape + dimensions, and be careful not to
dispose shared geometry when a rig is torn down.

Ship Avengers preset builds. Validate every slot's range server-side.

### 2.6 `/characters` — the roster

Grid of all 131 characters. Locked ones are silhouettes with "debuts in ⟨title⟩".
Unlocked ones show their current-stage portrait (§1.4) with the stage's `look`
description and the project that unlocked the look.

### 2.7 `/profile`

Watch statistics, progress by phase, profile picture upload, an appearance
control (Light / Dark / System — see §7), the friends entry point, and, for
admins only, a discreet ⚙ link into the admin panel.

### 2.8 `/login`

Register and login tabs. Registration plays an animated success step — a
checkmark and a toast — before landing on the Login tab with the username
prefilled and the password field focused. Skip the animation under
`prefers-reduced-motion`.

---

## 3. Friends and social

- Send, accept, and decline friend requests by username.
- View a friend's watch order, map, home, and profile read-only at
  `/friend/:username`, `/friend/:username/map`, `/friend/:username/home`,
  `/friend/:username/profile`. Entering a friend view must not leak their
  progress into the viewer's own state — auto-exit friend mode on any navigation
  away from `/friend/*`, including browser back/forward and address-bar edits.
- **Watch parties:** invite a friend to watch a project together; accepting
  records the co-watch on both accounts.
- Leaderboard of lifetime Infinity Stone snaps across you and your friends.

---

## 4. Memories

Attach photos and short videos to any watched project, with captions. Uploads go
to a media host (Cloudinary or equivalent) — never to the app's own filesystem,
which must be assumed ephemeral. Memories appear in the project popup as a
gallery with a lightbox. Deleting a memory must delete the remote asset too, not
just the database row.

---

## 5. Admin panel (`/admin`, hidden route)

Six tabs. Reachable only via the ⚙ on `/profile`, which only renders for admins.

| Tab | Contents |
|---|---|
| **Users** | Searchable list. Detail view. Ban / unban with a reason, force password reset, delete. Green dot for users active in the last 5 minutes and a relative "active 3m ago". |
| **Moderation** | Memories grid (delete an upload, which also wipes it from the media host) and pending friend requests. |
| **CMS** | Sub-tabs for Projects, Characters, Locations, Dialogues. Full per-field create/edit/delete forms for all four collections. |
| **Config** | Live sliders for walker speed, pause min/max, encounter distance and cooldown, and fight spawn chance, plus the default Fights and Dialogues toggles applied to new accounts. Saving pushes to connected clients. |
| **Audit Log** | Paginated, action-filterable forensic record of every destructive admin action. |
| **Overview** | Total users, banned count, memory count, and a 30-day signup bar chart. |

**The CMS Projects tab needs a drag-to-move board mode** alongside the list mode:
every project as a node at its `gridX`/`gridY` with prerequisite arrows,
pointer-drag with a free-cell drop check, click an empty cell to create a project
there, click a node to edit, arrow keys to nudge, and staged moves committed
through a single "Save layout" that validates against current DB state, rejects
cell collisions, and writes one audit entry for the batch.

**Admin promotion has no UI path, by design.** An admin is made by setting a flag
directly in the database.

---

## 6. Auth and security

- Register / login with hashed passwords. JWT with a 7-day expiry carrying
  `{ id, isAdmin, tokenVersion }`.
- Every authenticated request verifies the signature, then checks a short
  in-memory cache (≈30 s, keyed on user + tokenVersion) before hitting the
  database, so the common path costs nothing.
- **`tokenVersion` rotation:** ban, unban, and password reset all bump the
  stored version. A mismatch against the token's claim is a 401 — which logs the
  user out of every other tab and device instantly.
- **The `isAdmin` JWT claim is for UX gating only.** Every admin endpoint
  re-reads `isAdmin` from the database on every call, so demoting an admin takes
  effect immediately rather than whenever their week-old token happens to expire.
  Treat this as a load-bearing security property.
- Authenticated responses set `Cache-Control: private, no-store` so one user's
  data cannot be served to the next account signed in on the same browser.
- Throttled `lastActiveAt` write (at most once per minute per user) powering the
  admin online indicator.
- A centralised route-level auth gate in the router — not per-view checks —
  redirecting unauthenticated users to `/login` with a history *replace* so the
  gated URL never enters the back stack. Keep per-view checks as a backstop.
- Rate limiting on auth and upload endpoints.
- Refuse to boot if the JWT secret is shorter than 32 characters.
- Security headers on: enforced CSP with an explicit allowlist, nosniff, frame
  options, referrer policy, HSTS, COOP, and a cross-origin resource policy.
  Response compression.
- Escape every user-controlled string (usernames, captions, titles from a
  friend's data) before it reaches the DOM.

---

## 7. Theming

Two complete themes plus a System option, chosen in `/profile`.

- **Dark is the hard default.** An unset or invalid stored preference resolves to
  dark regardless of the OS setting; only an explicit "System" choice follows the
  OS live.
- The light theme is a white "Marvel comics print" look: white surfaces,
  near-black text, red accents.
- **The map and the 3D world are scenes and stay dark in both themes** — poster
  art needs a dark canvas, for the same reason Netflix is dark. Give them fixed
  scene tokens that the theme switch does not touch.
- Brand accent is Marvel red `#ED1D24`, with `#ff4b51` as the light variant.
  Text on the accent gradient is white. Destructive confirms use a deeper crimson
  so they stay visually distinct from the brand accent.
- Drive everything through semantic CSS custom properties (surface, text, border,
  scrim, shadow) with a single dark-override block. No hard-coded colour literals
  scattered through the stylesheet.
- An anti-flash inline script in the document head resolves the theme before
  first paint.

---

## 8. Performance and boot

- **Mount instantly.** Render the SPA immediately against the content bundled in
  the repo; fetch the live database copy in the background and only re-render the
  affected views if it *meaningfully* differs (compare a normalised signature
  that ignores database bookkeeping fields). A cold server must never mean a user
  staring at a splash screen.
- Cap those background content fetches (≈4 s) so a hung server cannot hold a
  refresh hostage.
- A themed boot splash painted before any JavaScript runs, removed once the first
  view mounts, with a timeout safety net in case the transition event never fires.
- PWA: web manifest plus a service worker that precaches the app shell and static
  content and serves stale-while-revalidate for scripts and assets. **Never cache
  API or socket traffic.** A cache version constant that, when bumped, deletes
  old caches on activate.
- In the 3D engine: cache poster textures so they are downloaded once and reused
  across home ↔ world transitions, and avoid per-frame allocation in HUD ticks.
- Lazy-load images in modals and secondary views. Cache-bust assets through a
  version query parameter so replacing a file in place actually propagates.

---

## 9. Data resilience (build this deliberately)

Content lives in the database, but **the repo carries a complete static copy of
all four collections** as the fallback. The content endpoints read the database
first and fall back to the static files when a collection is empty or the
database errors. The app must fully boot, render, and be navigable with the
database completely down — only user-specific data (progress, friends, memories)
degrades.

Ship two scripts: an idempotent seed (static files → database, safe to re-run,
with a wipe flag) and its inverse (database → static files, with a dry-run flag)
so CMS edits can be snapshotted back into the repo.

---

## 10. Testing, CI, docs

- Unit tests for every piece of pure logic — the unlock/visibility rules, the
  jump/fall/walkability maths, punch target selection, island grouping, layout
  packing. Pull that logic into dependency-free modules specifically so it is
  testable.
- CI on push: a full syntax/type check plus the test suite.
- A README that documents the stack (with your justification for choosing it),
  the repo layout, setup and environment variables, the architecture (boot order,
  auth flow, the fallback system, the admin model), common operations, and the
  known constraints. **Append a dated changelog entry every time a feature ships
  or a bug is fixed** — this is a standing requirement, not a one-off.

---

## 11. Assets

The reference project ships ~70 project poster images, ~100 character portraits,
and ~36 location backdrops. You cannot ship Marvel's copyrighted art, so:

- Build the app so every image is referenced by filename through the content
  collections, with a documented drop-in directory per category
  (`projects/`, `characters/`, `locations/`) and a manifest listing exactly which
  filenames each collection expects.
- Ship generated placeholder art — typographic poster cards, initial-based
  character chips, and abstract location backdrops in a palette that matches each
  location's mood — so the app is visually complete and demoable out of the box
  with nothing missing.
- Make swapping in real art a pure file-drop operation requiring no code change.

---

## 12. What "done" looks like

A new user can register, land on an almost entirely locked watch order, mark
*Iron Man* watched, and immediately watch the world grow: Malibu appears on the
map, Tony and Pepper and Rhodey join the roster, a first island materialises in
the 3D world. Two projects in, their first room unlocks at home. Six projects in,
walkers are having real conversations on the roads between cities. After
*The Avengers*, Phase 2 opens and the map doubles. Along the way they add a
friend, tag them on a co-watch, upload a photo from the night they watched
*Endgame*, walk into the shared 3D world, hear that friend's voice get louder as
they approach, punch a stone out of their hands, and snap.

Build that.
