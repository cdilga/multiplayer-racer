# P1-U01.3: design language rework (R102)

The owner's POC round 1 item POC1-03 (`docs/playtests/poc-2026-10-03.md`, ruling R102): move the guide, tokens and
component sheet toward the four reference screens' language (`art/ui/refs/owner-2026-10-03/`), not their content. The
live POC (`https://jammers-preview.dilger.dev/poc/`) shows the reworked sheet once `poc-deploy.yml` runs.

## What changed

| Where | Change |
|---|---|
| `art/ui/tokens.json` v0.2.0 (+ schema) | A new `language` block holds the primitives. It names what is taken from the references and what isn't. Slants: heading −2°, tag skew −10° and tilt −3°, strip skew −6°, seeded panel tilt up to ±1.5°. Banners: torn ink heading, brush tags in saffron, warning or teal, strips, a highlighter, burst ticks. Plus eight `textBacking` pairs, `corners` (panels 2/3 px, buttons 4/6 px, badges 3/4 px, chips pill), `placement` (offsets and overlaps on free screens), `density` and `renders`. `layout.radiusPx` shrinks from 8/10 px to 4/6 px and now means only the control radius. The `identify-pulse` text follows R99 ("Cooee #7" flash). |
| `art/ui/check.mjs` | Checks every `textBacking` pair against WCAG AA for its size. Every banner, tag and strip fill must have a passing pair for the text it carries, and the render stand-in must exist. |
| `art/ui/sheets/tokens-css.js` | New seeded shape helpers, never animated: `paintPath` (torn and brush), `strokePath` (highlighter) and `tiltFor`. Also new CSS variables for corners and slants. `wobblePath` keeps its exact shapes. |
| `art/ui/sheets/components.*` | **Section 00 "Design language"** has a free screen built only from the primitives (a tilted panel, an overhanging banner, a tag, a strip, a big cut-out render breaking the panel edge, burst ticks, a highlighter) and rows for banners, tags, strips, highlighter and ticks, and corners. Every section head is now a saffron tag plus a torn ink banner. Panels are squared, tilted where free and padded more tightly. The TV strip uses a banner and ticks. |
| `art/ui/renders/` | `make.py` cuts Spike J's L0 hero render of the Cruz Missile out of its grey backdrop into `cruz-missile-hero.png`, the sheets' stand-in for a big render. |
| `art/ui/poc/shared/tokens.js` | Gives the TV and phone mocks the corner and slant variables and re-exports the shape helpers, so U02.3, U02.4 and U03.2 can build from them. |
| `art/ui/GUIDE.md` | New §5a covers the six points, each with what we do and its token, the corner rule, what's not taken, and how the shapes are made. Principle 4 now reads "hand-made, not web-grid". |
| `art/ui/sheets/render.mjs` | `--out <dir>`, so this bead's render doesn't overwrite P1-U01's round-0 evidence. |

## Acceptance

| AC | Result |
|---|---|
| POC1-03: guide, tokens and component sheet express non-grid placement, big renders, banner-backed headings, compact density, slants and high contrast, colour behind text, no uniform rounded corners; they state what is taken and what isn't | Sheet: `after/components.png`, section 00 and every section head. Before/after next to the four references: `compare-before.jpg`, `compare-after.jpg`. Guide §5a has the table of six points and the not-taken list (also in `tokens.language.notTaken`). Fresh-eyes review: `review.md` (of the first render), and what was done about it below. |
| POC1-03: tokens carry the new primitives; `check.mjs`, contrast and the CVD sheet pass on the new set | `node art/ui/check.mjs`: schema valid; all 22 contrast pairs, 8 backing pairs (ink on saffron 9.06, paper on ink 14.81, saffron on ink 9.06, paper on cobalt 4.82, paper on success 5.64, ink on warning 6.18, ink on teal 7.24, ink on red-earth 4.03 for large type only), 12 badges and 12 CVD seat pairs pass. `render.mjs` renders cvd, fonts, brand and components with no errors, and CI's `checks` job runs `check.mjs`. The TV, phone, motion and POC index pages and the brand sheet load with no errors on the new tokens (Chromium smoke run). |

Renders: Chromium from Playwright 1.62.1 on the Mac. The before is `docs/evidence/P1-U01/components.png` (round 0,
unchanged).

## The fresh-eyes review and what changed after it

`review.md` is a Sonnet subagent's review with no prior context, made from the images only. It reviewed the first
render. Acting on it:

| Finding | Done |
|---|---|
| Section 00's copy echoed the references ("Next race in 42s", "+24 points", "You're #7"), and older round-0 headlines did too ("Round highlights", "Next round starts in 42s", "Vote on your controller") | Now our own words: "On the grid", "Fastest lap +5", "Cooee #9" (R99's term), "Race results", "Grid opens in 0:42", "Pick your car". Seat names in 00 changed to #9 Roo Boy, #14 Nina, #5 Big Kev. The fixture names (Dusty, Pip, Ash, ROO7) are our round-0 mock data, which the references were drawn from. The sheet now says so. |
| "42S" read as a typo (banners are uppercase) | Accents that are numbers or units keep their case (`.lc`). |
| "You're #7" was white on mid-orange, the weakest contrast on the page | It's now an ink strip with a saffron number (paper on ink 14.8:1). |
| The render's wing was clipped by the frame, and its ink outline was hard to see | The car sits inside the frame with a 5 px outline. |
| The twelve section banners read as one stamp | Each banner gets a seeded ±1° jitter on top of the −2° slant (`slant.headingJitterDeg`). |
| Flat colour blocks, no texture | The free screen's ground carries a printed halftone. |
| Slant never reaches buttons; component tables are level | Kept on purpose. The references' own buttons are level rectangles with a small radius, and their life comes from the banners, tags and ticks around them. The placement rule keeps lists, tables and anything a gamepad walks in order aligned, so the state tables in 01–10 stay level. |
| Density is uneven: empty areas in 01, 06, 10 and the TV mock | The sheet is a specimen. Screen density belongs to the screen beads (U02.3, U02.4, U03.2). |

## Known gaps

- The TV and phone mocks don't use the language yet. Restyling them is U02.3, U02.4 and U03.2, which this bead
  unblocks.
- The render is a stand-in cut from a spike capture at 2× nearest. The renderer makes the real renders.
- The brand sheet and wordmark are unchanged. The references' logo lockup is content, and ours stays.
