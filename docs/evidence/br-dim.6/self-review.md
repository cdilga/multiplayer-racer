# br-dim.6 self-review: lobby without the warm-up yard, every player on one screen

Build: TV POC `art/ui/poc/tv/` (`#lobby&n=…`), Chromium (Playwright `channel: chromium`, headless, SwiftShader/software GL on this Mac), served locally by `art/ui/lib/serve.mjs`. Not a device, not Safari, not the deployed preview.

## What was built
- The lobby state no longer drives anything: the background is a generic, non-interactive crane view of the track (no cars, no yard). The `warmup` world mode, its camera rig and the old roster code are deleted.
- The roster is one card per player (seat number, name, state: Joining…, Choosing car…, Ready) positioned from `grid.js` `layoutGrid` (the race grid's equal-tile rule; it gained an optional `min` tile size the race grid never passes). For each tier, richest first, the rule picks the biggest equal cards that still meet that tier's minimum: number + name + state label, then number + name + tick, then number + tick, then number alone tinted by state, then a below-floor last resort. No scroll, no pages, no cap.
- QR and Start race share the layout: a side column on landscape, a row above the roster and the button under it on portrait. Heading is the existing torn banner, now "Lobby". Footer, buttons and style unchanged.
- `&st=joining|choosing|ready` forces every seat into one state, for the review matrix. `states.js`: group "Lobby" with n = 2, 8, 16, 32, 48, 60, 140, 150.

## Checks run
- `node art/ui/lib/live-check.mjs --local --fullscreen --viewports 412x915,915x412,820x1180,1366x768,1920x1080` on `#lobby&n=1,8,24,60,150` (25 pages plus the after-resize pass): 25/25 ok (no failed requests, errors, overflow, cut-off text, blank canvas).
- Earlier full `--tv` sweep (all states, same viewports): 277 ok; the only failures are `results&n=8,32` and `intermission&n=8,32` at 412x915 and 820x1180 (another bead's, expected). Re-run after the last edits on lobby, overview and grid at 1920x1080 and 412x915: ok.
- A geometry check of my own (not committed; run for 5 viewports x n = 1, 8, 24, 60, 150 x default and all-joining states): card count equals n, no two cards overlap, every card inside the roster box and the screen, roster box overlaps none of heading / join card / Start race / footer, no card text wider than its card, Start race on screen. All pass. Forced all-choosing and all-ready states were checked only before the tier rework, not on the final build.
- `capture-rounds.mjs` (lobby checks rewritten: roster shows n cards, QR 260 TV px, Start race present, nothing outside title-safe/action-safe): PASS for lobby n = 2, 8, 16, 32, 48, 60, 140, 150 and results/intermission. `grid-check.mjs` (race grid, untouched behaviour): pass.

## Looked at
Images in this folder. The four without a suffix are from the final build; the `-earlier-build` ones are from the run just before the heading moved 18 px lower for title-safe (layout otherwise identical) and were looked at in that build.
- `lobby_n150_1920x1080.jpg` (final): 150 players, number-only tier, 11 columns, every card visible, QR and Start race clear, state read by card colour (green ready, grey choosing, saffron joining).
- `lobby_n150_412x915.jpg` (final): phone portrait, 150 players, number-only, 10 columns x 15 rows, QR row and Start race both on screen.
- `lobby_n24_915x412.jpg` (final): phone landscape, 24 players, three columns of full cards with state labels, side column with QR and Start race.
- `lobby_n8_1366x768_after-resize.jpg` (final): 1366x768 after the shrink-and-grow resize, 8 players, two columns of big full cards.
- Earlier build: n1 1920x1080, n24 1920x1080 and 1366x768, n60 1920x1080 (after resize), 820x1180 and 412x915, n8 412x915 and 915x412, n150 915x412.

## Defects found and fixed
- Opening the lobby first (empty world) threw `Cannot set properties of null (setting 'count')` from `world.js`; guarded `writeInstances` for a world with no cars built.
- Heading ran under the QR column on landscape; its width is now capped to the roster's side.
- Start race overlapped the footer on portrait phones (footer taller than its nominal height, button taller than assumed); both are now measured.
- Tier choice by area alone picked cells too short for the tier's text, so cards clipped at n = 150 (3-digit seat numbers); tiers now carry minimum cell sizes and the number-only tier drops the tick for a state tint.
- Heading outside title-safe (capture-rounds check); moved to the old warm-up heading's position.
- Footer caption was cut on a phone; shortened to "Late joiners welcome".
- `capture-rounds.mjs` still tested the removed yard (cars in view, nameplates); rewritten for the roster.

## Remaining defects
- Phone portrait at 150 players (412x915): the number-only cards render text at about 6.5 px, below the handheld 13 px floor and not scannable at arm's length; 150 cards in a 380 x 480 px box cannot be legible without paging or scrolling, both barred by the owner rule. Phone landscape at 150 (915x412) shows number + tick at about 9 px for the same reason. A phone host at 100+ players is the stress end, not a normal room; the owner should judge. A bigger lever (a smaller join row, a Start race beside the roster) is left for the QR/space bead.
- Names appear only while the cards are big enough: at 1920x1080 they show up to n = 32 and go above it (n = 48 and 60 show number + tick, n = 140 and 150 number only). Names are cut at 12 graphemes with an ellipsis ("Maximilian A…", the stress name at seat 12), the same rule as the HUD, rather than shrunk further.
- At 1920x1080 and 1366x768 with 60 players the cards are wide with a lot of white space around number + tick, because the name tier needs more height than 60 rows allow; a two-line name card tier would use the space (not built).
- The QR solver is not built (br-u02-qr-list-space-jdc): the join card is a fixed size.
- State colours at the number-only tier (green / grey / saffron) rely on colour plus the card's tint only; no pattern or glyph for colour-blind viewers at that tier.

## Not covered
- Every lobby state at every viewport was checked by the scripts, but only the images listed above were looked at; the other n (2, 16, 32, 48, 140) and viewport combinations were not viewed individually.
- Forced all-joining / all-choosing / all-ready screenshots were not looked at (geometry only).
- No real phone, no TV, no Safari/WebKit, no GPU renderer (software GL), no actual full-screen toggle press (the shrink-and-grow resize stands in for it), no deployed-preview run.
- Reduced-motion and the 4K / 21:9 screens were not run.
