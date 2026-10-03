# P1-U02.4: TV warm-up, end of round and intermission

The owner's POC round 1 items POC1-15, 16 and 17 (`docs/playtests/poc-2026-10-03.md`), in the U01.3 design language
(R102, `art/ui/GUIDE.md` §5a). Live at `https://jammers-preview.dilger.dev/poc/tv/`: `#lobby&n=2` (… `8`, `16`, `32`,
`48`, `140`), `#results&n=8` and `32`, `#intermission&n=8` and `32`; the POC index links them under 6 and 7.

**Machine and browser:** Apple M1 Pro (MacBookPro18,3), macOS 27.0.1, Chromium 151 from Playwright, WebGL on the GPU.
Re-run with `node art/ui/poc/tv/capture-rounds.mjs`: it captures every state at 1080p (and the 8- and 32-player ones at
4K) and checks each in the rendered page (`report.json`).

## The proposals (one each, with why)

| Screen | What it is | Why |
|---|---|---|
| **Warm-up** (the lobby) | **How a warm-up works:** joining drops your car straight into the warm-up yard (the derby bowl) beside everyone else's. You can drive and Cooee at once, so you find your car by moving it, and you tap Ready on your phone. The host starts the race; late joiners keep dropping in. **On the TV:** the yard from the Overview camera (R107's smooth rig), each car on its identity ring. Nameplates show the badge, name and Ready tick up to 12 cars, the badge alone up to 32, and none past 32, where a crowd of plates would hide the cars; there the rings, the roster and Cooee carry identity. The yard grows with the room (about 12 m radius for two cars, the whole floor for 140) and its camera may frame closer than the derby's, so two cars fill the view. At the right: the join card (QR 260 px), the roster sized to its content (cards, then chips, then pages), and Start race with burst ticks, the screen's one big action | POC1-15: the cars couldn't be seen; now they are the lobby, and driving is the warm-up. No player cap: 140 cars all drive in the yard |
| **End of round** | Round 1's content in the new language: the winner's car live as the hero render (32% of the screen) under a torn "Round 3 complete" banner and a strip, tilted podium cards breaking its lower edge (2nd and 3rd with live windows of their cars), every standing in a card (rows grow to fill it when there are few players; columns, then pages, when there are many), and the join band: the QR (260 px), "Jump in · ROO7" with the code highlighted, a "Next race in 42s" tag, and Watch the highlights / Start next round now / Return to lobby | POC1-17: the content was fine, so it stays. The hero render is the language's point 2 (at least 30% of the screen) |
| **Intermission** | The highlights, maximised: the main replay (a broadcast tracking shot of the highlight's car, 1070 × 586 TV px, 30% of the screen) with its caption tag ("Fastest lap · #5 Big Kev"), count and progress. Beside it, the four highlights still to come, each playing live under a small tag. The join band keeps the QR (260 px) with the round's top three and the host's actions filling the rest of it | POC1-16: the replay has 1.7× the area of round 1's (1010 × 360), the side is more highlights, and nothing beside the QR is empty |

Round 1's single results screen did two jobs; it is now the round's two beats: the end of round (the result) and then
the intermission (the highlights). Its "Hide replay" is gone: the end of round has no replay, and the intermission's
replay is the point. Every screen keeps text and the QR inside title-safe and other chrome inside action-safe (GUIDE §4);
the 3D views may bleed. The world mock's changes are camera framings only (a seat-aware orbit and a broadcast tracking
shot, each wide view with its own camera) and the warm-up yard.

## Acceptance

| AC | Result |
|---|---|
| POC1-15: the warm-up is reworked with a worked proposal for how it works, at 2, 8, 16 and 32 players, in the new language | The proposal is above (and in `art/ui/poc/tv/README.md`). Every seat's car is inside the yard view at 2, 8, 16, 32, 48 and 140 players; plates per the rule above (2, 8, 16, 32 plates; none at 48 and 140) (`report.json` `carsInYard`, `plates`). The yard takes 60% of the screen; the roster shows every player or names its page; Start race is in the side panel. Captures: `captures/1080p-lobby_n=*.jpg`, `captures/4k-lobby_n=8.jpg`, `4k-lobby_n=32.jpg` |
| POC1-16: the intermission maximises the highlights, with more content beside the main replay, the QR prominent and no wasted space beside it, at 8 and 32 players | The main replay takes 30% of the screen (1070 × 586 TV px), with the highlight's car inside it. Four upcoming highlights play beside it, each with its car inside its window. The QR is 260 px. The widest empty run in the join band is 48 TV px (round 1's, between the join text and the buttons, was about 270 px, read off `docs/evidence/P1-U02/captures/1080p/results_n=8.jpg`). Captures: `captures/*intermission_n=8.jpg`, `*intermission_n=32.jpg` |
| POC1-17: the end-of-round screen keeps its content and takes the new style | Round complete, the podium with points, every standing (32 players: "Page 1 of 3"), the next-race timer, the join QR (260 px) and the three host actions are all present (`report.json` `endOfRound`). The style is a torn banner, strips and tags, tilted podium cards and the hero render at 32% of the screen. Captures: `captures/*results_n=8.jpg`, `*results_n=32.jpg` |

Every state passes its checks: nothing off the screen, no text or QR outside title-safe, no chrome outside action-safe,
no page errors and no requests outside the local server (`report.json`).

## Fresh-eyes review

`review.md` is a Sonnet subagent's review with no prior context, made from the images, the owner's notes and the six
points only. It reviewed the first full version. What changed after it:

| Review point | What changed |
|---|---|
| 1. Warm-up plates sit on cars and each other from 16 up | Plates: badge, name and tick up to 12; badge only up to 32; none past 32. A plate moves up one step at most where two overlap, then overlaps at its car. The Ready tick is teal (it was dark green on navy) |
| 2. Warm-up cars tiny at 2 and 8 | The yard is smaller for small rooms and its camera may frame closer (22 m against the derby's 120 m): at 2 players each car is about 130 px long |
| 3. Sidebar and toolbar read as a web app; duplicates | The roster sizes to its content; the footer drops its room code (the join card has it) and its ready count |
| 4. Start race buried in the toolbar | Start race is a 96 px button with burst ticks under the roster; the footer keeps only fullscreen and the menu |
| 5. No TV safe margins | Every screen now keeps text and the QR inside title-safe and chrome inside action-safe, and the capture script checks it. That also caught something the review didn't: some labels were 20–22 px, under the TV's 24 px minimum; none are now |
| 6. Intermission QR shrank to 200 px | 260 px on every screen |
| 7. Up-next labels cover the thumbnails; rigid rail | Each label is a small tag in the corner; the cards tilt |
| 8. "Biggest air" over grounded cars | The main caption is "Fastest lap" (the mock has no jumps) |
| 9. Stair-stepped podium chips; small "Next round" | The top three are one column, first larger; the "Next round in 42s" strip is 36 px |
| 10. Standings half empty at 8 | Rows grow to fill the card when there are few players |
| 11. Sub-labels too small | Nothing under 24 px (see 5) |
| Not taken | The review's "totals column": the round's points are round 1's content, and session totals are the game's (P1-R). Burst ticks only frame the warm-up's Start race: the language allows them at most once per screen, and the other screens' primary keeps its saffron outline. The intermission's left side stays the replay's: the replay is the point |

## Known gaps

- The highlights are mock camera work on the scripted laps (an orbit or a tracking shot of the named car), not
  replays of recorded moments; picking and recording highlights is the game's work (P1-R beads).
- Pages turn by `&page=` in the mock; the 6-second timer is the game's.
- U02.3's footer band sits at the screen's bottom edge, outside title-safe, by its own design after Physical Soccer's
  host footer; it is reported here, not changed.
