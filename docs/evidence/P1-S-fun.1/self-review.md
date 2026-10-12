# Self-review P1-S-fun.1 (br-gw74.13.1): a road-wide jump from the chase and overview cameras

**How:** `node web/host/tests/jump-capture.mjs --map <map.json> --out <dir> --speed 35` on eris (headless Chromium,
software GL, which auto-lowered the resolution to 50–75 %, so the stills are soft). The build is a6f73416 with the host
WASM rebuilt (generator v21). The map is `jj procgen --seed 1 --recipe greybox`, and the jump is its biggest road-wide
one (feature 1: 10.5 m ramp, 2.75 m lip, 82 m table, 9 m wide). A Cruz starts 10 m before the ramp at 35 m/s with full
throttle, and the sim is stepped so each still is a known moment (`capture.json` has the car's state for each one).

## Looked at

- `chase-t45.jpg` (1920×1080, tick 45, on the ramp, 4 wheels down, 34.4 m/s): the ramp spans the road with its side
  slopes inside the corridor, and the lip and table are ahead. The car is centred in frame.
- `chase-t90.jpg` (tick 90, leaving the lip, 2 wheels down, 32 m/s): the table runs straight ahead and the road
  resumes past it.
- `chase-t135.jpg`, `chase-t180.jpg`, `chase-t240.jpg` (ticks 135–240, all four wheels off, 29–25.5 m/s, upY
  0.95–1.00): the car is level and upright in the air. The camera rises with it, so the table looks like a plain road
  under the car and the height doesn't show.
- `overview-t45.jpg`, `overview-t180.jpg` (whole map): the three road-wide jumps read as long tan strips on the
  straights. The track, props and other features draw; the car is under its "#0 Player 0" nameplate.

Nothing blank, broken or clipped. The Keys & Pads drawer is the test page's, not the TV's.

## Defects found and fixed

- Before this pass (sim, not visual): at full throttle, cars on road-wide jumps rolled at the foot of the landing ramp
  (the suspension bottomed out). Fixed by sizing the foot for the take-off speed; see `receipt.md`.

## Remaining defects

- **Big air doesn't read as big air.** The chase camera follows the car's height, so a 2 s, ~5 m flight looks like
  driving along a flat slab. The table is a long, plain tan strip with no lip or ramp-face shading, and the overview
  hides the airborne car under its nameplate: br-gw74.13.1.1.

## Not covered

- A GPU-rendered capture at full resolution: eris's headless Chromium has software GL only.
- The ute through the same jump, visually (the sim fixture covers it: every road-wide jump lands upright).
- Hood camera and phone views: this bead's acceptance asks for chase and overview only.
