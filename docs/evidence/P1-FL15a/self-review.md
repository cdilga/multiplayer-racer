# Self-review P1-FL15a (br-bbki.15.1): terrain-first landscapes

Captured on the Mac (Apple M1 Pro, Playwright Chromium on the GPU path, emulated 1920x1080 TV viewport), local
real jj-server, generated maps from this tree's `target/release/jj` (`tools/maps/review-landscape.mjs`). "Today" is the
deployed rainbow preview `v02-a1f7bf4b` (CI run 4897) through the real room flow (`tools/maps/review-landscape-preview.mjs`),
the same seeds (2-4) and recipes. Set pieces (P1-FL15b, another worker's, in the same tree) are on in the captures.

## Looked at

- [compare-rocks.jpg](compare-rocks.jpg), TV, seeds 2-4: today the road runs on a flat plain past kit rock pillars
  (route relief 6-12 m); now it runs in gorges with rock walls both sides, the far pillars framing the exit, and the
  whole-course overview shows domes the road cuts through. Overview camera now frames the raised course.
- [compare-outback-dirt.jpg](compare-outback-dirt.jpg), TV, seeds 2-4: today a flat oval on a red plain (relief 1.7-8 m);
  now cuttings through mesa breakaways with walls both sides and other legs of the road seen across the landscape.
- [compare-town.jpg](compare-town.jpg), TV, seeds 2-4: today flat streets (relief 1.1-7.4 m); now road cuttings through
  hills and climbs between them. The whole-course overview still reads fairly flat: town hills are soft and the high
  camera compresses height (see Remaining defects).
- [compare-outback-bitumen.jpg](compare-outback-bitumen.jpg), TV, seeds 2-4: today a flat highway loop (relief 1.2-7.6 m);
  now cuttings through mesas and ridges, the road climbing to a gantry through a breakaway. The overview reads as a plain
  with a few mesas: most of its relief is a long gentle tilt, which a top-down view hides.
- `frames/<biome>-s2-{cutting,climb,high,overview}.jpg` (16 frames, TV): each checked for terrain showing through the
  road, the car on the road, walls both sides at the cutting point, no blank or black frame.

Fixture metrics (`landforms.txt`, release, 20 seeds x 4 biomes, the validated map the game prepares, set pieces on):
route relief >= 25 m on every seed (mean 39 m), and on every seed a corridor of >= 25 m with ground >= 6 m above the road
on both sides within 8-40 m; 40 seeds pass too. Autopilot (Cruz, set pieces off so the terrain is judged alone): 40/40
laps (10 seeds x 4 biomes) and 20/20 figure-eight laps with no recovery or wreck; the R122 handling bank shows no dives
and no roll-overs attributable to terrain (the one remaining, Greybox seed 6, is a crest placed by the new set-piece
course straights). Terrain bank (grade, curvature, bank, edge, idempotence) green on 100 seeds x 5 biomes.

## Defects found and fixed

- Corridors measured 15 m out landed mid-wall: the metric now takes the highest ground 8-40 m out each side.
- Swell scaling turned short laps into 100-200 m canyons without gaining road relief: replaced by a tilt across the
  course plus noise, scaling capped.
- Gorge walls were ~50 m wide soft slopes: batter now per biome (Rocks 5:1); walls are painted `rock`, so they render as
  rock instead of ground colour.
- Wall feet showed big sawtooth "teeth" at the rock/ground colour boundary: the rock threshold moved to the wall's foot
  (slope 0.6), which removes most of them (residual noted below).
- Capture tool read `origin_x` (the map has `originX`), so its "cutting" frame fell back to route point 0: fixed.
- The browser's WASM was stale against the tree (host hung loading new maps): rebuilt with `scripts/build-host-wasm.sh`.
- Overview camera looked at y = 0 while the course is tens of metres up: it now targets the route's mean height and fits
  the field's lowest and highest ground (`web/host/src/render/world.ts`; course-overview journey green on Chromium and
  WebKit).
- Rocks had no jumps left (steep everywhere): flow beats (~200 m held to 3 %, on the straightest stretches at the
  land's highs and lows) bring the core's jumps back (~1 per seed per biome).
- Steep climbs terraced into 2.5 m steps (bed planes level along the road): planes now carry the road's slope.
- Figure-eight underpasses: a sag the autopilot bounced out of, an embankment beside the underpass, and a ground cap that
  dug a drop in front of the deck: all fixed; crossings tests and both-level bots green.

## Remaining defects

- Road ribbon: on some steep cuttings terrain shows through the road in cell-sized patches, and a faint sawtooth remains
  where wall meets floor. Renderer-side (ribbon offset, slope-blended ground colour): **br-bbki.15.3**.
- Town and Bitumen overviews read flatter than their chase views (gentle tilt + top-down camera). Taste call for the
  owner; the road relief is there (>= 25 m on every seed).
- With set pieces **off**, the shortest figure-eight sprints (652-680 m: Rocks 12, 14; Bitumen 12, 14, 15 of 40 seeds)
  reach 21-24.9 m of relief: the deck's span is ~30 % of such a lap and its grade is capped for the deck. The game's
  path (set pieces on) passes on 40 seeds; noted rather than tuned further while the course designer is still moving.
- Rooftop lots: Town's steeper ground leaves 9 lots over ten seeds (the roof bank wants 10). Proposed fix (lots terrace
  their own footprint) is with the roofs owner.
- Terrain stops at the grid edge (60 m past the course) and a flat plane continues beyond: the far skyline is the
  plane, not landforms. Not in this bead's acceptance; worth a follow-up with the renderer's backdrop.

## Not covered

Physical phones/TVs, Safari, WebKit captures of the landscapes (the overview journey ran on WebKit), the owner's taste
review. The comparison's "today" is the deployed preview build, not a local build of the previous commit.
