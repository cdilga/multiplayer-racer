# P1-U05.2: in-world rework (camera framing, distance setting, full-screen countdown, the flash in the reel)

The owner's POC round 1 items POC1-12, 13 and 07/21's flash motion (`docs/playtests/poc-2026-10-03.md`; rulings R98,
R99), on the live mocks at `https://jammers-preview.dilger.dev/poc/` (TV mock, in-world mock, motion reel).

**Machine and browser:** Apple M1 Pro (MacBookPro18,3), Chromium 151.0.7922.34 from Playwright 1.62.1, channel chromium
with the GPU flags; perf headed on the GPU (ANGLE Metal). This is Chromium, not Safari and not the TV. Re-run with
`node art/ui/poc/tv/capture-framing.mjs`, which writes `report.json`, `captures/` and `countdown/`, and with
`JJ_EVIDENCE_DIR=docs/evidence/P1-U05.2/motion node art/ui/poc/motion/record.mjs`, which writes `motion/`.

## Decisions (one each, with why)

| Item | What | Why |
|---|---|---|
| Framing as data | `art/ui/poc/shared/framing.json` (`jj.framing.v1`) holds the chase rigs, the first-person eye and mirror, and round 0's rig for comparison. The TV mock and the in-world mock both read it, and it becomes the TUNE input for P1-R05 at G-DESIGN | One set of numbers for both mocks and the game, not constants in three places |
| Chase camera (POC1-12) | Mid (the default): 8.4 m back, 4.4 m up, aimed 17 m down the track at 0.3 m, field of view 58°. Round 0 was 5.2 m back, 2.05 m up, aimed 4 m ahead at 0.95 m, 62° | Higher and further back with the aim down the road: the car shrinks and the track ahead fills the tile |
| Distance setting (POC1-12) | Near (6.6 m back, 3.3 m up, aimed 12 m ahead), Mid, Far (11.5 m back, 6.2 m up, aimed 24 m ahead). The host picks the default and each player may override it for their own tile. The mock takes `&dist=near\|mid\|far` and `&pdist=2:near,5:far`, and the pause card has the host setting (U02.3) | Owner: playtests may want different values at high and low counts, or per player. Nothing is capped by count; the playtest picks |
| Segmented first person (POC1-12) | A bonnet cam 0.45 m forward and 1.5 m up, aimed 26 m ahead and slightly down (field of view 72°), so the road gets most of the tile and a strip of bonnet keeps it first person. A rear-view mirror (36% × 17% of the tile, top centre) takes the sky band, looking back from 2.3 m so the car's own wing doesn't fill it | "Spend the screen on what helps the driver": the mirror shows who's behind in the part of the tile that was empty sky |
| Countdown (POC1-13) | One full-screen 3-2-1-GO over the grid, one beat each (`countdown-beat`, 1000 ms). The exposure flash (backdrop brightness, white-to-saffron wash) peaks within 60 ms and decays across the beat; the number punches in and fades. Cars hold until GO. Reduced motion holds the wash at 60% for each beat and swaps the numbers, with no scale and no fade | R99: one overlay, the same high-exposure flash as Identify |
| The reel (POC1-07/21) | The motion reel's countdown (a) and Identify (c) now play the full-screen countdown and the Cooee flash ("Cooee #6" over an exposure flash in the seat colour), driven frame by frame from the same token durations, in both full and reduced motion. It's the shared reference for the TV and the controller (P1-U03.2) | One reference the controller copies |

## Acceptance

| AC | Result (`report.json`) |
|---|---|
| POC1-12: higher camera showing the track ahead; cars visibly smaller by default; segmented first person; a distance setting (host default and per player) at low and high counts; framing values recorded as TUNE inputs | The share of the tile covered by the player's own car's screen box, and the horizon's height from the top, round 0 → now: **1 tile** 2.8% → 1.4%, horizon 0.43 → 0.38; **8 tiles** 3.0% → 1.5%, 0.43 → 0.38; **24 tiles** 5.5% → 2.9%, 0.42 → 0.37; **32 tiles** 3.9% → 2.3%, 0.43 → 0.37. That's about half the area in every case, and a horizon higher in the tile (more track below it). Near and far: **8 tiles** 2.4% and 1.1%; **32 tiles** 4.4% and 1.7%. Per-player overrides on one grid (`pdist=2:near,5:far,7:far`): seat 2 2.8%, seats 5 and 7 1.2%, the rest 2.0%. First person: `captures/grid_n=4_fp=2.jpg`, `grid_n=8_fp=2,5.jpg`. Before and after: `captures/grid_n=*_cam=round0.jpg` against `grid_n=*.jpg`. The values are in `art/ui/poc/shared/framing.json`. |
| POC1-13: one full-screen countdown with the high-exposure flash, replacing the per-tile one; reduced-motion variant | One `.cd-flash` overlay and no per-tile count in every frame. Full motion, flash opacity on beat "3": 0 at 0 ms, 0.97 at 40, 0.78 at 120, 0.11 at 500, 0.00 at 950; the same curve on "1" and "GO!". Reduced: 0.6 throughout every beat, one transform (no scale). The world is held on 3, 2 and 1 and runs on GO. Frames: `countdown/full-*.jpg`, `countdown/reduced-*.jpg`. U02.3's overlay check allows only this overlay over playing tiles. |
| POC1-07: the Identify flash tween in the motion reel as the shared reference | `motion/reel.webm` and `motion/reel-reduced.webm`, stills `motion/stills/full-c-identify-peak.jpg` and `reduced-c-identify-peak.jpg`; countdown stills `full-a-countdown-3.jpg` and `-go.jpg`. All motions are within tolerance of their token durations (`motion/timeline.json`). |

## Frame cost (headed, ANGLE Metal on the M1 Pro, 1920×1080, 360 frames after 1.5 s settle)

| State | Frame p50 / p95 (ms) | Render submit (ms) | Draws |
|---|---|---|---|
| 24 tiles, round 0 rig | 8.3 / 9.2 | 1.24 | 552 |
| 24 tiles, new framing | 8.3 / 8.6 | 1.23 | 552 |
| 24 tiles, three first-person tiles with mirrors | 8.3 / 8.5 | 1.40 | 621 |
| 32 tiles, round 0 rig | 8.3 / 9.3 | 1.60 | 752 |
| 32 tiles, new framing | 8.3 / 9.2 | 1.56 | 736 |
| 32 tiles, three first-person tiles with mirrors | 8.3 / 8.9 | 1.70 | 811 |

The new framing costs the same as round 0: the frame is vsync-bound at 120 Hz either way. Each first-person mirror
is one more viewport pass, about 0.05 ms of submit and 23 draws here. This is a mock's cost on a laptop GPU, not a
G-PERF receipt.

## Known gaps

- The in-world mock (`poc/world/`) uses the same chase and bonnet-cam framing but has no mirror segment. Its tiles are
  sub-cameras of one ArrayCamera, and a mirror there is R05's to build.
- The mirror isn't flipped left to right as a real mirror would be: flipping the projection inverts face culling in the
  mock's materials. R05 decides.
- The car-size numbers measure the car's projected box, not its pixels; they compare rigs and don't state the
  absolute size.
