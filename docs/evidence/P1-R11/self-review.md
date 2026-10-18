# P1-R11: the Derby Overview camera and the Grid ⇄ Overview switch

**What was built.**

- **Overview camera** (`web/host/src/camera/overview/rig.ts`, values in `assets/profiles/camera.json` `overview`): a TS
  port of the accepted POC rig (P1-U05.4). It has a fixed 60° pitch and never rotates.
  - It frames the cars' box (each car now and 1.6 s ahead) plus a margin, never the empty arena.
  - Centre and zoom follow critically damped springs with dead zones; zoom-out never waits in the dead zone.
  - The centre stays inside the arena. A car thrown out of the bowl widens the frame instead of being cropped.
  - Where a car is heading stops at the bowl's lip.
  - A raised car (on a bank, the lip or in the air) is framed by the ground point it covers.
  - It is stepped by game time, so a paused game holds the camera too.
- **In the world** (`render/world.ts`):
  - Arena maps start in the Overview, tracks in the Grid. The host's choice holds while the kind of map stays the same.
  - The Overview frames the gameplay area between the bands, and its image is centred on that area.
  - Its framing is published as data (`__jjOverview.stats()`): each car's screen box, the median car height against
    the TV target, the padded envelope's unused share, and the spread flag.
  - A deterministic replay (`__jjOverview.replay`) runs recorded positions through a fresh rig.
- **Identity:**
  - A ring under each car in its seat colour (`ui/overview/rings.ts`): one instanced draw, tilted with the car.
  - Plates with name and number, scaled with the car's on-screen size: never under 14 px at 1080p, 28 device px at 4K.
- **Edge bands** (`ui/overview/band.ts`):
  - A thin top band with the derby clock and the damage-points standings. Every seat is shown: the run shrinks a
    little, then scrolls as a ticker.
  - A non-blocking "Cars spread out · V for the Grid" chip when the field wants ≥ 90 % of the whole-arena frame (or
    reads under the target) for a game second.
  - The footer's standings ticker hides while the Overview's band shows them, and ranks by derby points in a derby.
- **Switch:**
  - The footer's "Camera: Overview / Grid" button, and the V key. It works at any time, mid-round, without pausing.
  - A 300 ms dip through the paper backdrop.
  - On a track the button is greyed and a press says "Overview is for derby arenas: on a track every player keeps
    their own tile."
- **P1-M10's captures** keep their whole-bowl harness camera through `?overview=arena`.

**Checks.** `web/tests/journeys/r11-overview.test.mjs`, on eris:

| Run | Result |
|---|---|
| Chromium with GPU (`JJ_CHROMIUM_GPU=1`, RTX on eris) | 6/6 |
| SwiftShader | 3/3; the three 24-car and dpr-2 scenes skip without a GPU and are on the gpu.yml list (`scripts/ci/plan.mjs`) |

`m10-bowl` (8 and 32 cars) and `g06-derby` still pass with the change.

- **derby-overview-8 / -24** (`derby-overview-<n>.json`, with the metric mask and viewing profile):
  - All 8 and all 24 cars are in frame.
  - Median car height is 110.5 px at 8 cars and 85.8 px at 24, against a TV-profile target of 34.4 px (3.5 % of the
    gameplay frame).
  - **Unused ground is 0.58 at 8 cars and 0.56 at 24: the 35 % target is not met, and this is reported.** The cars are
    spread over a round bowl, but the 16:9 frame is far wider than the field, so its sides stay empty. Cropping cars
    to close the gap is ruled out (master §6.4).
  - The test guards ≤ 0.65 against regressions.
  - A bowl wider than it is deep would meet the target; that is noted on br-0v6i, the arena-features bead.
- **Spread** (`derby-overview-spread.json`):
  - One car is thrown onto the plain past the far lip and the rest sit at the near floor edge. The frame grows to 91 m,
    past the 61 m whole-arena frame, and crops nobody.
  - The chip shows, the round keeps running and the view doesn't switch by itself.
- **Switch:** mid-round, with a 300 ms animation. The grid's six tiles come back, the band goes, and V switches back.
  On a track the switch is disabled and the reason shows.
- **Plates at 4K** (`plates-4k.json`): all eight are "#n Racer n" at 54 to 59 device px.
- **24-car melee** (`derby-melee-24.json`, with the camera path):
  - 16 s at 60 samples/s with controller input, replayed through the rig.
  - Measured after the first second: acceleration p95 14.9 m/s² and max 22.3 m/s² (the round-start zoom-out from the
    grid); jerk p95 26.4 m/s³. The bounds are max 25, p95 18 and jerk p95 45. The POC rig's 12.9 m/s² was on a near-fixed
    whole-bowl frame.
  - No car leaves the frame on any sample.
  - The car sent at the wall (sample 600) reaches it at sample 771. Its arrival point is already in frame half a second
    after it sets off: NDC (−0.29, 0.48).

## Looked at

- **`derby-overview-8-1920x1080.jpg`:**
  - Eight cars spread over the floor, each with its coloured ring and a "#n Racer n" plate.
  - The top band reads "Derby · 2:54 left" then "1st #1 Racer 1 0 pts …". The footer reads "Camera: Overview".
  - "THREE! TWO! ONE!" is still fading at the bottom.
- **`derby-overview-24-1920x1080.jpg`:** 24 cars, rings and plates, none overlapping badly. The top band's standings
  scroll as a ticker at full size.
- **`derby-overview-8-3840x2160.jpg`:** the same at dpr 2. Plates are crisp and big.
- **`derby-overview-spread-1920x1080.jpg`:**
  - The bowl is whole, with #1 on the plain among the rocks beyond the far lip and the other five at the near edge.
  - "Cars spread out · V for the Grid" is at the right of the top band.
- **`derby-grid-after-switch-1920x1080.jpg`:** six tiles with "1st 0 pts" and "2:51 left". The footer reads
  "Camera: Grid".
- **`track-switch-disabled-1920x1080.jpg`:** a two-car race in the Grid. The greyed "Camera: Grid" button and the
  explanation are above the footer.
- **`derby-overview-12-1366x768.jpg`, `derby-overview-12-834x1112.jpg`:** a 12-car start on a laptop and a portrait
  tablet host. The bands are thinner and the ticker runs.
- **`derby-overview-12-resized-from-1366x768.jpg`, `derby-overview-12-resized-from-834x1112.jpg`:** after resizing to
  1920x1080 and 1112x834 mid-round, the framing follows and every car is still in frame.

## Defects found and fixed

- **Standings unreadable at 24 cars:** the band squeezed 24 seats into 1920 px of tiny type. It now scrolls as a
  ticker below 80 % scale.
- **Score unlabelled:** a bare "0" after the name read as part of it. It now reads "0 pts".
- **Car outside the bowl cropped under the band:**
  - The frame stopped at the whole arena; a car past the lip now widens it.
  - A car's height is framed as the ground it covers.
  - Zoom-out could sit in the dead zone, and zoomed out too slowly (12 m/s, now 20 m/s).
- **Jumpy centre in a melee:** cars' look-ahead points ran through the bowl wall and swung the frame past the whole
  arena. They now stop at the lip, and the pan is smoother (goal 0.8 s, pan 1.3 s).
- **Per-tile HUD left behind:** tile pills and arrows stayed over the Overview. The tiles' layout now clears, and
  returns with the grid.
- **Duplicate standings:** the footer listed race positions in a derby. It now ranks by derby points, and hides while
  the Overview's band shows them.

## Remaining defects

- **Unused ground:** 0.56–0.58 of the frame against the 35 % target, for the round bowl (reported above; br-0v6i).
- **Off-centre field:** in a portrait host the frame is near the whole arena, so a field on one side of the bowl sits
  low in the frame. The centre may only drift as far as the arena allows.
- **Start clump:** the 12-car start packs the cars in an arc, and their plates crowd. Plate decluttering beyond the
  stacking nudge is P1-R07's; the packed start is P1-M10's remaining defect.
- **Chase camera off the map:** in the spread test, #1's Grid tile is solid red. Its chase camera is inside a rock or
  car, out on the plain. That is a P1-R05 case for a car thrown out of the arena, not this camera's.
- **Spawn puffs:** test placements leave cars in spawn puffs inside their rings, from the placement.
- **Melee driving:** the recorded field mostly ran round the bowl's wall (radius 27–34 m) rather than chasing.
  Synthetic seats may be on autopilot; the camera numbers are for that field.

## Not covered

- A real TV at 3 m, Safari/WebKit, and a real phone host.
- The phone HUD is unchanged (P1-S10's derby strip).
- A match against the accepted POC Overview mock is the .style child behind G-DESIGN. These captures were reviewed
  fresh against the current POC Overview (`art/ui/poc/tv` `#overview`): one shared view, fixed pitch, rings, thin bands.
