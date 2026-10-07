# Self-review P1-M08b (four-biome Playtest-1 tracks)

Captured with `node web/host/tests/biome-capture.mjs playtest` (real host page, test build, default recipe: town, rocks,
outback dirt, outback bitumen, back to town; seed 2, which took the ladder's second course draw). The cars run on the autopilot
and the sim is stepped until the lead car is at the named place on the named stretch (`capture.json` records the point). Headed Chrome.

## Looked at
- `lap-1-town-tv-1080p.jpg` (point 42 of the town): dark tarmac bending right, cream edge lines, a row of rail and posts on the
  outside of the bend, about a dozen gum trees on the skyline. No building is in this frame.
- `lap-2-rocks-tv-1080p.jpg` (point 135 of the rocks stretch): a light graded-dirt road between tall banded red towers on both
  sides, a yellow feature pad around the car, spinifex, desert oaks, a warning sign and a green sign far ahead.
- `lap-3-dirt-tv-1080p.jpg` (point 189, dirt): graded dirt curving right, rail and a cone on the left, spinifex and oaks, and on the
  horizon the dark tarmac of the bitumen where the road changes.
- `lap-4-bitumen-tv-1080p.jpg` (point 240, bitumen): sealed road with yellow dashes and double white edge lines, rail runs, a
  warning sign ahead, and two tan town buildings on each side near the horizon where the lap returns to town.
- `lap-dirt-to-bitumen-tiles-1080p.jpg` (four tiles at the dirt to bitumen junction): the lower-left tile shows the graded dirt ending
  across the road in a straight line where the dark tarmac with a yellow centre line begins; the other tiles are already on the
  tarmac, and the lower-right tile shows the green "A87 STUART HWY / ALICE SPRINGS / DARWIN" sign.
- `lap-dirt-tiles-laptop-1366.jpg` (1366x768, four tiles): four cars bunched on the graded dirt with the tarmac visible ahead.
- `plot-playtest-four-biomes.png`: the whole lap top-down: town houses on the top straight, the tower-lined stretch, the brown
  dirt road with a spinifex field, the bitumen with lane lines, the finish gantry, back to town.
- `seed-bank.txt`: 100 seeds, every one town, rocks, dirt, bitumen, town, and where the dirt to bitumen cut falls.
- `bot-playtest.txt`: the autopilot on all 100 seeds: no softlock flagged (three laps on seeds 0 to 2).
- `browser-run.json`, `timing.md`: the browser tests (two rounds back to back, the 6x throttle run) and the timing receipt.

## Defects found and fixed
- An earlier capture (`lap-tv-1080p.jpg`) showed a wrecked car alone on flat red earth and my review described a town corner that
  wasn't in it. Cause: the capture drove the cars open-loop for 20 s and they left the road at the first bend; the road was not
  unreadable. Those files are gone; every shot is now taken with the cars on the autopilot at a named place, and this review was
  written after looking at each file named above.
- Only 55 of 100 seeds fit a four-biome lap at first. The boundary search is wider and the Playtest-1 recipe gets 8 course draws
  before any biome is dropped: 76 on the seed's own course, 24 on a derived draw, none dropped.
- The packed-dirt road and the red ground were only about 20 apart in colour distance; they are now about 40 (see P1-M06).

## Remaining defects
- A redrawn seed (24 of 100) is a different route from the seed's own course; the header still names the requested seed.
- Transitions have no dressing beyond the blended ground, the road surface change and the entry sign.
- The town frame at point 42 shows no buildings (they stand on the straights); the buildings are in the `lap-4` and P1-M04 frames.
- The cars bunch and bump at the start of the autopilot run.

## Not covered
- Phones; a real phone host; a real laptop. The Chromium 6x throttle slows the page's main thread only (the generator's worker
  thread isn't throttled by that emulation, so its time is also reported scaled by 6). The timing receipt is an Apple M1 Pro
  with Playwright Chromium, not the owner's laptop.
- A fresh-eyes review by someone other than me.
