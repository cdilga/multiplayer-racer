# Self-review P1-M08b (four-biome Playtest-1 tracks), second pass

Captured with `JJ_HEADLESS=1 node web/host/tests/biome-capture.mjs playtest` (real host page, test build, default recipe: town,
rocks, outback dirt, outback bitumen, town; seed 2 which took the ladder's second course draw; `res=1&autores=off`; HUD hidden;
headless Chromium, software GL). The route's segment list has two town stretches (0-109 and 266-365). The script picks the
first segment of a name, so "town" shots are on the first one. `capture.json` records every point.

## Looked at
- `lap-1-town-tv-1080p.jpg` (town point 81, the end of the first town): the road runs straight between two tall banded red domes;
  a small ramp with stone walls and white lines is ahead, a yellow steep-descent diamond on the right and a brown "BIG RED ROCK"
  sign on the left. It is the town-to-rocks exit, not a street: no building is in this frame.
- `lap-2-rocks-tv-1080p.jpg` (rocks point 139): light dirt road bending through spinifex and desert oaks, a yellow creek-dip
  sign on the right, a green sign and the dark bitumen far ahead. No dome in view at this point of the rocks stretch.
- `lap-3-dirt-tv-1080p.jpg` (dirt point 189) and `lap-dirt-tiles-laptop-1366.jpg`: graded dirt with spinifex and oaks and the
  tarmac ahead; I only re-checked these two against their contact sheets, not at full size.
- `lap-4-bitumen-tv-1080p.jpg` (bitumen point 241): sealed road with yellow centre dashes, a shopfront on each side, a water tower, a
  kangaroo sign, a power pole at the right edge: the lap returning to town.
- `lap-dirt-to-bitumen-tiles-1080p.jpg` (four tiles): cars at the dirt-to-bitumen change; houses with bins and mailboxes on the
  right, a green sign, an orange traffic cone, and a power pole with wires on the horizon in the lower tiles.
- `plot-playtest-four-biomes.png`, `seed-bank.txt` (100 seeds, every one town, rocks, dirt, bitumen, town), `bot-playtest.txt`
  (100 seeds, no softlock flagged), `browser-run.json`, `timing.md`: unchanged by this round's data edits except the
  goldens (re-blessed, wasm parity green). I did not re-run the timing receipt this round.

## Defects found and fixed
- The 1080p frames are true 1080p (`res=1&autores=off`), with no HUD or banners.
- Roads in M04 to M07 changed as listed in their reviews (power-line spans, window z-fight, double edge line, marker pads, domes).

## Remaining defects
- The first-town shot does not show a street; M04 and the tiles frame above are the town evidence.
- A redrawn seed (24 of 100) is a different route from the seed's own course; the header still names the requested seed.
- Transitions have no dressing beyond the blended ground, the road surface change and the entry sign.
- Cars bunch and bump at the start of the autopilot run.

## Not covered
- Phones; a real phone host; a real laptop (the 6x throttle emulates the main thread only; M1 Pro receipt, not the owner's laptop).
- A fresh-eyes review of this pass.
