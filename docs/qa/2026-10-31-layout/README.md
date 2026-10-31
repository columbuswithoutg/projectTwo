# Layout overlap audit — 2026-10-31

Checked every page at 7 window sizes, desktop and mobile, looking for parts that overlap, hang off the screen, or can't be scrolled to. Admin pages were left out.

Sizes: 360×780, 390×844, 740×360 (phone landscape), 768×1024, 1024×768, 1280×800, 1920×1080.

Pages: `/`, `/map`, `/board`, `/feed`, `/profile`, `/characters`, `/messages`, `/reports`, `/home`, `/home/edit`, `/customize`, `/world`, `/login`, `/s/<token>` and `/s/<token>/map`. The two share pages were checked both logged in and logged out.

## Method
I injected a detector script on each page. It checks five things:
- **Overlapping controls:** a button, link, tab or heading whose box crosses another one.
- **Covered controls:** a control where most of five sample points land on something else.
- **Off-screen controls:** a control that sticks out past the left or right edge.
- **Unreachable content:** content below the fold with nothing that can scroll to it.
- **Sideways scroll:** the whole page scrolls horizontally.

To prove the detector works, I put the old CSS back temporarily and confirmed it flags both bugs you reported.

## Findings and fixes

| # | Where | Problem | Fix | File |
|---|---|---|---|---|
| 1 | `/s/<token>`, all sizes | The page couldn't scroll. The app locks `html` and `body` to the screen height, and `.share-page` had no scroll area of its own, so everything below the hero card was cut off (content was 1541px tall in a 1080px window). | `.share-page` is now screen height with `overflow-y: auto`. The top bar stays pinned inside it. | `styles/pages/share.css` |
| 2 | `/s/<token>/map`, logged out | The old `.flow-wrapper` is positioned absolutely under `#header`, so the map slid up under the "Tap a poster / Start your own" banner. | Inside `.share-order` the map is now `position: relative` and fills the space below the banner. | `styles/pages/share.css` |
| 3 | Top bar on `/`, `/board`, `/feed` and `/map`, phones ≤480px | The tabs were centred absolutely, so they ran under ☰ and the avatar. At 360px they overlapped ☰ by 5px and the avatar by 17px. | At ≤480px the tabs sit in the bar's row between ☰ and the avatar, and their text size and padding shrink to fit (`clamp`). They stay 44px tall for touch. | `styles/components/header.css` |
| 4 | `/world` header, phones | The game chip and the 🔑 keeper chip ran past the right edge: the keeper chip ended at x=450 on a 360px screen. | Both chips can now shrink and end in "…". Below 420px the "WORLD" title is hidden, because "← Back" plus the chips need that space. | `styles/hud/world.css` |
| 5 | Board cards, all sizes | Long titles such as "Shang-Chi and the Legend…" wrapped under the ⋮⋮ drag grip. | Titles get 26px of right padding when the card has a grip. | `styles/pages/board.css` |

## Flagged but not bugs
- **`/world` jump, punch and fullscreen buttons:** they're round, so the detector's corner sample points land on the 3D canvas beside them. At the button centres, the buttons are on top. While the world is loading, the "Almost ready" screen covers them on purpose.
- **`/map` 🌍 button:** it was caught mid-way through its scale-in animation. Once settled, it's on top.
- **Board ⋮⋮ grip vs. title:** the title's padded box still overlaps the grip, but the title text no longer does (measured with a text range).

## Not covered
- **Sparse test data:** the QA account has 2 cards, an empty feed and no messages, so very full lists weren't exercised.
- **Comic theme:** not swept.
- **`/friend/*` pages:** not checked; they share the same top bar.
- **Pop-ups:** the Quote Guess and Scene Guess overlays and the pop-up dialogs weren't opened. Quote Guess phone layout was fixed in 221f4f0.

## Other session's "?" button
The "?" help button from the parallel help-button session is in the top bar on these checks. At 360px it fits: tabs end at x=270, "?" is at 274–306, the avatar at 306–350. In the `/world` header it also fits, after fix 4.

Re-checked after its final phone rule (32px, no shrink): `/`, `/board`, `/feed`, `/map` and `/world` at 360px and 390px have no header overlaps and no sideways scroll. "?" sits at 274–306 (360px) and 304–336 (390px) in the main bar, and at 316–348 and 346–378 in `/world`. The only off-screen buttons were in the closed slide-out menu, which is hidden off the left edge by design.

## Cleanup
- **Delete:** QA user `claude_qa_lay1816`. It has an active share token.
- **Tests:** `npm test` gave 1008 pass and 1 fail. The failure was `test/help-logic.test.js` ("every screenshot exists"), in the other session's help feature, not these CSS changes. That session reports it passes now that its screenshots are in `assets/help/`; I haven't re-run it.
