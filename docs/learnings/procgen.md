# Procgen learnings (append-only)

## 2026-10-07 · Terrain undulation (P1-M03c)

- **Inner edges are steeper than the centerline.** On a corner the inner edge is shorter by `1 - κ·half` (a 13 m hairpin
  with a 12 m road: 1.86x), so the same rise is a steeper grade there. A profile bounded on the centerline alone broke the
  edge limit; the profile's slope is damped by `f = 1 - |κ|·half` in tight corners (mean removed so the loop closes).
- **Nearest-point heights make cliffs.** Off-road ground taken from the nearest route point jumps where the nearest
  point flips: a hairpin's interior, or two road parts the 20 m clearance lets pass close. Use an inverse-distance blend
  of every nearby route point's bed plane (kernel `1/(d²+1)³`, compact support) instead; it is continuous and still
  exact inside the road bed.
- **Bank must be rate-limited.** Edge grade = profile grade + `half · d(tan bank)/ds`; a bank that follows the corner's
  curvature directly adds far more than the biome's grade budget. Limit `d(tan bank)/ds` to a share of the grade budget
  over `half` (and damp it by the same `f`). The bank therefore ramps out onto the straight after a corner and lags across
  a chicane's reversal: tests judge it only well inside a corner.
- **Measure at 5 m / 10 m, not 2.5 m.** Heights are whole centimetres, so grade over 2.5 m carries ±0.4 % of noise
  and curvature over 2.5 m ±0.3 %/m; measure grade over 5 m and curvature over 10 m.
- **Route points are mm-rounded; the generator's centerline isn't.** Tests that recompute the road edge from
  `map.route.points` differ from assembly's surface painting by up to 1 mm at the edge; skip a ±2 mm band.
- **Grid spacing is the only data-level lever on the road edge's saw-tooth.** 10 m cells gave 7 m stair-steps; 2.5 m
  gives ~1.8 m. Surfaces are per vertex, so a diagonal still steps at the cell size; only a rendered ribbon along the
  route (width, y and bank are all on the route points) removes it.
- **Debug test time.** The 100-seed × 5-biome bank takes ~9 s in release and ~140 s in debug, so it samples 30 seeds in a
  debug build (`JJ_SEEDS=N` overrides; 600 seeds passed in release).

## 2026-10-07 · Feature pieces (P1-M03d)

- **Follow-up for the host map renderer (not done here):** draw the road as a ribbon along the route (its `width`, `y`
  and `bank` are all on the route points) instead of painting the surface per grid cell; that removes the cell-sized
  saw-tooth on diagonals that a finer grid only shrinks (M03c).
- **The sim reads only the heightfield.** `jj-sim` ignores `map.features`, so a feature's geometry has to be baked into
  `terrain.heights`; the `Feature` record is metadata for the validator, the envelope check and the renderer. A ramp is
  therefore only as sharp as the 2.5 m grid: the lip's drop takes a cell or two, and a 4 m ramp is ~1.6 cells wide.
- **Standard line = over the ramp.** The validator wants 4 m of bypass beside a ramp, so a ramp centred on the 12 m road
  is at most 4 m wide; the autopilot (centerline) takes it, a human can take the bypass. Harder jumps (opt-in) aren't
  generated yet.
- **Whoops are exempt from the curvature limit** (they are rough by design: grade only); crests keep 0.012 (a car at
  25 m/s stays grounded), creek dips 0.045 (they only compress the suspension).
- **Regenerating the pipeline.** `terrain::undulate` rewrites heights from scratch; `features::place` adds to them, so
  call it exactly once after `undulate` (the idempotence test runs both).
- **jj-sim is a native-only dev-dependency** of jj-procgen (`cfg(not(target_arch = "wasm32"))`), so the WASM parity
  build never compiles Rapier.

## 2026-10-07 · Dressing scatter (P1-M03e)

- **Scatter is not road furniture.** `scatter` places only the pieces a biome's `Spec` lists, off the road. Corner chevrons
  (R104: a row of posts, one chevron each), Australian W-beam guard rail on posts (R105), and the finish gantry (R106: no
  "Checkpoint N") are deterministic roadside pieces tied to corners and the finish, not scatter, and belong with the sign
  kit and the biome beads. The generic `generic/barrier` registry entry still says "tyre wall, rail or concrete": its
  description should lose "tyre wall" when someone touches the kit (R105). Real-format Australian signs (R113) stay the
  sign kit's (`signs/`); scatter never invents signage.
- **A hard-core footprint rule flattens clumping.** Piece footprints (8-18 m buildings) are as big as a cluster's spread,
  so the no-overlap rule packs a cluster evenly and Clark-Evans R barely drops below 1. Judge clumping by Clark-Evans R and
  the share of empty 30 m squares, not nnCv alone (nnCv is also high for isolated outliers).
- **Ground at the rounded pose.** Poses are whole millimetres; read the ground at the rounded x/z, or a later re-grounding
  (undulate, features) moves `y` by 1 mm and breaks idempotence.
- **Bounds bind the scatter.** `assemble` grows the bounds from route + dressing + props, so scatter (which runs after
  assembly) fills the route's bounds-plus-60 m margin only and keeps every footprint inside it.

## 2026-10-07 · Biome trait, selector, transitions, wayfinding (P1-M03f)

- **A biome is one file.** `biome/<name>.rs` is a unit struct implementing `BiomeDef` (just `data()`), and its line in
  `biome::def`. `terrain::params`, `features::density` and `scatter::spec` now delegate to it, so the M04-M07 tasks edit
  no other procgen file. `biome::check_data` is the data check a biome runs on itself.
- **The lap ends in the first biome.** `[A, B]` is segments `A, B, A`: a closed loop's seam (start corridor, finish) must
  not carry a transition. Boundaries are placed on straights (<= 0.12 rad of turn within 25 m), 60 m apart, 40 m blend
  zones. `generate_recipe` returns `NoStraight` when a boundary can't be placed: 92 % of seeds fit `[greybox, dirt]`, 55 %
  fit a four-biome lap, so P1-M03g's fallback recipe (retry another structure draw, fewer biomes) is real work.
- **Judge a straight with margin.** Select checks the turn on the float centerline, validation re-checks it on the
  mm-rounded map; a corner starting at the window's last point flips between them. Select widens its window by one point.
- **Wayfinding is stand-ins until P1-R10.** `crates/jj-procgen/kit/wayfinding/*.json` (chevron-post, guard-rail,
  finish-gantry) are compiled into `jj_procgen::registry()` (generic kit plus these); R10's `assets/kit/wayfinding/`
  replaces them under the same ids. Generated maps validate against that registry, not `Registry::generic()`; `jj procgen`
  falls back to it while the checked-in kit lacks the family.
- **Wayfinding goes before scatter; scatter sees it as obstacles** (and never clears it). Tests that measure the
  scatter's own spacing filter the `wayfinding/` pieces out: rails 4 m apart would fail any overlap or nnCv test.
- **Terrain across biomes.** `undulate_along` takes parameters per route point: the profile's grade/curvature/relief are the
  strictest on the route; bank limit, ground relief, wavelength and blend follow the point and are blended into the cells
  by the heights' own inverse-distance weights, so there's no step at a boundary.

## 2026-10-07 · Validator integration, fallback ladder, bot bank (P1-M03g)

- **`prepare(seed, recipe)` always returns a validated track** and logs every rung: the recipe on the seed's own course,
  then on two derived course draws, then the recipe cut shorter one biome at a time on the seed's own course, then the
  first biome alone (the conservative recipe). Four-biome bank (100 seeds): 55 requested, 40 redrawn (24 + 16), 4 shorter,
  1 conservative; mean 1.74 generations per seed. A redrawn seed is a different (still reproducible) route from the
  seed's own course: callers must key on the returned map, not assume draw 0.
- **`check` is the one acceptance test**: jj-map's validator plus transitions, feature envelopes and wayfinding; anything
  that rejects a map must be added there so the ladder sees it.
- **The sim's scenario runner takes one fixed map**, so the generated-seed bot bank lives in `tests/bank.rs` (jj-sim as a
  native dev-dependency) rather than `scenarios/procgen/`. Autopilot on 100 generated four-biome seeds (the first 3 for
  3 laps): no softlock, no recovery, no wreck, no out-of-bounds tick; its lap runs 0.94-1.30 x `refLapMs` (mean 1.14),
  so the 15 m/s reference is a touch fast for the low-skill autopilot, not for a player.
- **`ev:hardware` WASM timing:** worst 184 ms per seed (release, Node 26, M1 Pro), 24 seeds; see
  `docs/evidence/P1-M03g/wasm-timing.md`. The test prints the numbers only when `JJ_WASM_BUDGET_MS=0` makes it fail.
- **Manifest:** `wasm-bindgen` is a wasm32-only dev-dependency of jj-procgen (for `Date.now`), so `Cargo.lock` changed.

## 2026-10-07 · Procgen worker and round preparation (P1-M08a, main side)

- **Flow.** Director -> `PrepareRequested{preparation, seed = session seed + id}` (a sim event) -> `RoundPreparer`
  (`web/host/src/procgen/prepare.ts`) -> the procgen Web Worker (`jj-wasm-procgen`: `prepare(seed, recipe)` returns
  canonical bytes, map JSON and the ladder's log) -> `World.stageMap` builds the meshes without showing them -> `MapReady`
  to the sim worker (`encode_map_ready`) -> the sim validates and commits at the next Countdown -> only then
  `World.commitMap` swaps the new map in (the room view says `Countdown` with verdict `ok` and nothing left prepared).
  The old presentation stays until then; a map the sim refuses is never shown.
- **Stale = dropped on main first.** A job the director has superseded (reroll, retry) is dropped after the worker returns
  and before the renderer or the sim see it (`stats.superseded`); the sim still counts and drops a stale `MapReady` that
  does get through (`room.preparation.staleDropped`). The procgen worker is synchronous, so a superseded job still
  finishes (~150-200 ms); it just never lands.
- **Failure = an empty `MapReady`.** The sim fails the preparation on unreadable bytes, the director retries once (main
  asks for `greybox` alone that time) and then settles in the Lobby; nothing invalid loads and nothing rerolls forever.
- **A reroll works from the Lobby too** (the director requests a preparation there), so "a prepared map replaced by a
  reroll" is testable without finishing a round.
- **The renderer needs a kit module for every id a map uses.** Generated maps carry `wayfinding/*` pieces, which only
  exist as procgen stand-ins (`crates/jj-procgen/kit/`); `render/kit/registry.ts` reads those entries as well as
  `assets/kit/` and `render/kit/wayfinding/` holds the stand-in geometry (it must fit the collider bounds: `map.test.mjs`
  checks within 3 %). P1-R10 replaces both under the same ids.
- **JSON seeds.** `PrepareRequested.seed` crosses as a JSON number: seeds above 2^53 would lose digits in `JSON.parse`
  (the session seed is 1 today). Keep session seeds below 2^53 or move the seed to a string in the event.
- **Not warmed up.** `stageMap` builds geometry, but the GPU upload happens at the first draw after `commitMap`; there is
  no shader/upload warm-up before `MapReady` yet (master 11.2a asks for one).
- **Biome pieces: the collider is the bounds.** `map.test.mjs` fails a kit module whose drawn extents differ from its
  registry collider by more than 3 %, so a tree's canopy is the cylinder radius (and the tree never collides), a power
  pole has no crossarm, a house's `heightCm` is the ridge height, and a flat disc at a tussock's rim keeps its bounds exact.
  One kit id has one geometry: a parameter that would change the shape (a house's roof pitch) can't vary what is drawn.
- **Rules before scatter.** `lineside::place` (houses facing the street, lane lines, junction stubs, signs) runs before the
  scatter, which treats everything placed as an obstacle and clears only its own pieces (`rule_ids` names the rest).
  A rule piece anchored to the edge keeps its whole footprint clear of every part of the route; a centre-anchored one (a
  lane line) lies on the road and is lifted by the ribbon's height (`ROAD_SURFACE_LIFT_M`) or it hides under it.
- **Sign panels aren't colliders.** The sign kit's panels are 100 mm thick: placed with `collides: false`, or the validator's
  250 mm wall rule rejects the map. Signs try spots a little ahead, behind and across the road before giving up.
- **The road is a ribbon.** The map renderer draws the road as strips that follow the heightfield and never paints it into
  the ground cells (which stepped at the grid's spacing). The ribbon sits 5 cm above the ground; anything meant to be seen
  on the road is lifted by about 7 cm.
- **Captures: step the sim, don't drive open-loop.** An open-loop stick leaves the road at the first bend and the capture shows
  a wreck on bare earth. `biome-capture.mjs` puts the cars on the test surface's autopilot and steps until the lead car is at a
  named point of a named biome stretch (`__jjPrepare.mapInfo()` gives the segments and route). `world.project` projects through
  the overview camera, not a chase tile's, so colour checks (`readability.test.mjs`) find the road in the picture itself: between
  the cream edge lines on a row above the car, with the ground just outside them.
- **Surface colours need a margin.** Graded dirt against red earth was only ~20 apart (CIE76) in flat colour; the pair is now
  `#e0b684` / `#a4502e` (~40, and ~40 measured on screen at 1080p and in a 640x360 tile).
- **Four biomes need course draws.** The selector's boundary search is wide (0.9 of a gap) and the Playtest-1 recipe gets 8
  course draws before the ladder drops a biome: 76 of 100 seeds on their own course, 24 on a derived draw, none dropped.
- **Dev map.** `?test&map=<name>` (with `&room`) validates `maps/<name>.json` through `validateMap` (the sim's registry)
  and refuses a broken one with the validator's `rule at: detail` lines in a banner; the director then settles in the Lobby.

## Capture honesty (second review round)
- Add `&res=1&autores=off` to any capture or measurement URL; otherwise the host lowers the render resolution and a "1080p"
  frame is really 960x540 (`readability.json` records the real viewport now).
- Hide chrome (`.jj-chip`, `.jj-render-chip`, `aside`, `.jj-hud`, buttons) with an injected style for evidence frames only.
- A route's segment list can name a biome twice (town at both ends of the lap); `filter(name)[0]` picks the first.
- Z-fighting between a decal slab and its wall shows up as "dithered" textures; push decals 5 mm or more proud.
- A power line is a linked span between consecutive poles (`Lineside.link`), not a per-pole piece.
# 2026-10-11 · Exact nearest-segment pruning

Segment boxes must enclose the *computed* projection endpoints: `a + (b - a)`
can round differently from `b`. Seed an upper bound from an actual projection's
original hypot, reject only coordinate lower bounds above it, and retain original
segment order and strict distance comparisons. Squared-distance comparisons can
change rounded ties. The exhaustive bit oracle and canonical 24-seed WASM bank
qualify the optimisation; the 1500 ms preparation budget remains unchanged.

## 2026-10-12 · Generated jumps launch and receive the car (br-gw74.7 / .7.1 / .10)

The apparent grip at the lip came from geometry: the 2.5 m terrain grid rounded a short ramp into a crest.
The existing explicit jump collider resolves the lip at 25 cm; the final bank probes its worst height error at
0.8 cm. No tyre grip, suspension, force or impulse multiplier changed.

A reserved landing envelope is not a physical landing. The receiving table previously ended before the design
flight, so a boosted car fell onto flat ground at full descent. Extend the table through the flight, then descend
with a concave quadratic transition whose slope reaches zero at the road. The existing 0.012/m vertical-curvature
limit determines the blend length and descent slope. Subdivide table and descent at 25 cm too, so they follow the
route and terrain instead of bridging them with one long panel. Validate both the receiving length and the blend;
reject missing tables, short reservations, zero slope and invalid transitions.

Start the straight-approach fixture inside the generator's guaranteed entry. Five route points put it 12.5 m back,
beyond the 12 m entry; on Rocks seed 7 its heading was 4.75 degrees against a 12.3-degree ramp. Four points (10 m)
measure the promised approach without that artificial sideways flight. Keep the speed, airtime and landing bars.
Measure the longest continuous flight and uprightness from first touchdown through the actual exit, not total
airtime from unrelated bumps or uprightness after a possible recovery. Ten seeds in Greybox, Rocks, OutbackDirt and
OutbackBitumen place 94 jumps; exercise each at 15/22/26/30 m/s and with the real boost action at the lip.

The renderer had a separate, stale shape formula. A metadata match would miss that. `jj procgen` and
`__jjRender.jumpShapes()` now fingerprint expanded triangle positions as uploaded f32 bytes; the generated-jump
journey compares every jump's actual draw buffer with the Rust collision mesh, then compares native/WASM replay
state. Captures use full resolution and keep real UI visible; wait for captions to finish naturally rather than
following the older chrome-hiding advice above.

# 2026-10-12 · Index references must follow canonical sorting (br-gw74.11)

Roof kickers reference dressing indices, but dressing is an unordered collection sorted on load. Rebase `roofTarget`
to the same house before sorting features, or a multi-house map validates against one house and loads another. The
regression uses two houses, reverses authoring order with the reference adjusted, compares canonical bytes and checks
idempotence/round-trip. Generator stages that sort dressing must preserve these references too.

## 2026-10-12 · Course families need feasible angle fitting (br-xlvx.7)

Family weights and corner/straight parameters are generator data. Sampling labels alone cannot establish variety:
measure every straight and tight-corner density, validate actual generated maps, then lap/replay every family in
every biome. Speedway need not contain a hairpin; require variety across the mixed bank instead of retaining an
old per-seed assertion that defeats the owner's course families.

Proportional angle scaling can push one sweeper outside its real range even when the turn budget is feasible.
Clamp to each kind's range, redistribute the remaining turn through available capacity, and redraw only when the
type list cannot meet the budget. Preserve self-clearance and length bands; retain rare-fallback measurements.

More curved routes exposed bitumen guidepost under-density: `avoid_corners` suppressed the reflector-post rule.
Permit those posts beside bends while retaining the shared placement clearance checks. Evidence bank tests that
write straight to `JJ_EVIDENCE_DIR` require the caller to create that directory before running them.

### Jump approaches need their own straightness check (2026-10-12, br-xlvx.7)

The whole-feature 0.12 rad turn budget admitted a six-degree bend inside seed 9's nominal 12 m jump entry.
At 30 m/s the Cruz launched diagonally, drifted 3.7 m from the line and landed on the table's sloped edge;
touchdown upY was almost 1, then fell to .656. This was not a post-landing run-out defect. Trace the actual
heading, lateral position and receiving-surface height before changing the physics. Placement and envelope
checks now require the entry through the ramp to be straight (0.01 rad quantization tolerance), while retaining
the receiving envelope's existing turning budget. Data-defined ordinary ramp grades .18–.21 restore mean
continuous racing flight (.85 s) without changing boost forces or any landing/flight acceptance threshold.

## 2026-10-12 · Taller rock terrain exposes surface mismatches (br-xlvx.4)

Blending both original road profiles under an explicit crossing made a bump on the lower road as relief increased.
Seed4 Rocks/Town hit that bump and spun; previous rock budgets completed the same seed unaided. Rasterise the lower
road corridor and suppress upper-road ground weights inside its bed, fading them back beyond the shoulder. The upper
road is supplied by its explicit deck, not by the shared ground. The 24 pure/mixed rock lap/replay samples then finished
without recovery, wreck or slow windows.

Endpoint clearance does not guarantee a bridge approach clears intervening hills. On forced-crossing Rocks seed0,
gate39 was at y3.44 m while the car drove on ground at y5.55 m. Envelope each approach edge against the actual ground
edge, retaining the raised cosine where it clears the hill. The 15 forced-crossing laps/replays then reached both
levels unaided; grade validation remains required.

The analytical route and quantised heightfield diverge more with taller profiles. Project ground-route heights onto
the actual bilinear surface before explicit decks/features. Derive the kill plane below the lowest ground, retaining
the twenty-metre fall margin, so an ordinary off-road valley cannot itself wreck a car.

Bank planes must extend across the entire road bed, including grid vertices outside the painted edge. Clamping bank
at half-width flattened those vertices; bilinear edge sampling exceeded the existing cross-slope tolerance on seed7
Rocks. Extending the bank to the bed boundary passes the focused sweep without relaxing the assertion.

Floating-point interpolation can let harmless dressing change the road. When dressing expands the terrain bounds,
subtracting its shifted origin in floating point moves half-millimetre rounding ties (seed13, route point104).
For integer route poses, split the millimetre offset into cell and remainder as integers. For metre-valued feature
queries, split the world-grid fraction before subtracting the origin. Keep cell and fraction separate through the
bilinear sample. The dressing-invariance fixture then passes without changing its whole-route equality assertion.

## 2026-10-16 · Terrain-first landscapes (P1-FL15a, br-bbki.15.1)

- **Route the road under the landscape, not over it.** The profile is the grade-limited *lower* envelope of the land
  sampled across the road (two passes each way round the loop make any profile Lipschitz at `g`), mixed toward the
  *upper* envelope by a per-biome `fill` share (embankments over gullies). Both envelopes are inside the grade, so any
  mix is too. A lower envelope cuts through whatever it can't climb: that is where the gorges come from.
- **Don't route on the full landform heights.** Routing on domes that cover most of a Rocks lap pins the road to the
  gaps between them (notches ~200 m apart), and it can never climb more than `g × 100 m` between notches, whatever the
  swells do. Route on the swells plus at most `climbM` of any landform; the heightfield keeps the full landform, so the
  road still runs in a gorge.
- **Relief comes from a tilt, not noise.** Two-octave noise normalised along the route loses half its relief to the
  envelope (peaks are steeper than the road may climb). A plane tilted along the route's widest spread (80 %) plus
  noise (20 %), normalised together, gives each side of the loop a clean climb. Scaling the swells up when relief
  falls short doesn't help on grade-bound laps and turns the off-road ground into 100-200 m canyons: cap it (1.25× per
  retry, 3 retries).
- **Grade budget is per segment.** The bank's change of cross slope only costs edge grade at corner entries and exits.
  Compute the bank first (it depends only on plan curvature), then give each segment `0.88·limit·f − half·Δtan(bank)/ds`
  (at least `0.6·limit·f`). Short (600-700 m) sprint figure-eights are where 25 m of relief is tight.
- **Crossings: route the lower road a deck height under the upper.** `crossings::place` used the highest ground at
  the plateau, which, once roads differ in height, is the upper road's own bed, so the deck towered 6.5 m over it
  (29 % grades). Now the terrain caps the lower road at `upper − deckHeight` near its crossing point. The upper road
  takes the deck's own cosine-and-plateau shape across its span (unbanked ±10 m past it, grade capped so the cosine
  peaks inside `maxGradeMilli`). The deck's top is the lower road's y + deck height.
- **Features need room on steep roads.** Crests/whoops/creek dips now check the natural grade under them
  (`LIMITS.piece_road_grade` 0.12), like jumps; otherwise the 0.22 envelope rejects them on 15 % climbs.
- **Every lap gets one long cutting** of the biome's leading landform kind, lying along the road on the longest stretch
  outside the keep-outs, standing 10 m above `climbM`. Random through-roles alone left 1-in-20 laps without one, and a
  ridge *across* the road only makes a 15-20 m cutting.
- **Keep-outs:** the start corridor, the finish run-in, a crossing's upper (deck) span and ±60 m around where the lower
  road passes under it. A crossing's declared spans cover two thirds of a short figure-eight, so don't keep out the
  lower span whole.
- **Measure a corridor** with `terrain::corridor_depth_m`: on each side the highest ground 8-40 m out, the lower side,
  minus road y; ≥ 6 m is a cutting/gorge. Sampling 15 m out only lands mid-wall.

## Set pieces (P1-FL15b, R132)

- **A piece owns its span's road profile.** `setpieces::place` runs after the terrain (and crossings), before the small
  features; it overwrites heights and route `y` in its footprint, and the features' ranges are cut around it
  (`setpieces::clear_of`). Component banks that re-run terrain or features on a finished map must build it with
  `GeneratorData { set_pieces: false, .. }`, or the re-undulate wipes the pits.
- **Join the terrain with matching slope.** The approach and run-out are cubic Hermites from the terrain road's height
  *and grade* at the span ends; an ease that started flat put a kink (a crest) where a 12 % terrain climb met it, and the
  autopilot flipped there at 25 m/s. Every blend is checked for grade and crest curvature (`MAX_CREST` 0.0125/m).
- **The kicker's side slopes must stay on the road bed.** With the flat top the full road width, its side triangles
  climbed the canyon wall beside the road and the front boundary edge's pseudo-normal turned into a wall: cars stopped
  dead at the ramp's foot. Flat top = road − 2 × `EDGE_SLOPE_M`.
- **The pit starts 1.5 cells past the lip** (bilinear ground under the lip must stay at take-off height, or the kicker's
  last sections sink and the validator's take-off ground drops); the far rim may round over, every band landing comes
  down past its margin.
- **Far rim about level with the lip.** A rim below the take-off ground makes the fall long and the descent ~20° onto a
  9° landing; level with the lip, the fall is short and the car comes down close to parallel.
- **Sight from afar is measured from the mid chase camera** (8.4 m back, 4.4 m up, ±44° on 16:9), and counted as time in
  view during the 15 s before the commitment point: a corner swings the landmark out of frame for a moment. Two domes
  (the Olgas' group) chosen for the view, one flank dome beside a canyon's channel.
- **Course beats:** a set piece needs a ~100 m straight core; the course designer gives each lap one 140-180 m beat
  straight away from the start, and falls back to the plain draw (same stream state) if that course doesn't close.
- **Bed planes need the road's slope.** The off-road IDW blends each route point's bed plane; a plane level along the
  road (only tilted by bank) terraces a 14 % climb into 2.5 m steps under the sharp `1/(d²+1)³` kernel, which the
  terrain bank reads as vertical curvature. Each plane now carries `slope · ahead` (clamped to one point spacing, or a
  corner leaks it into the cross slope).
- **Anything applied after the curvature relaxation leaves a kink.** The underpass cap and the deck's cosine shape now
  run inside the relaxation loop (deck shape, cap, envelope, relax, until the relaxation changes nothing); a cap applied
  after it made a -14 % → 0 sag that threw the bot into a recovery.
- **Under a deck the ground follows the lower road and the landscape, not the upper bed.** Otherwise a deck-high
  embankment stands beside the underpass (cars turning there scrape and roll). Keep the upper bed only near the span's
  ends, and cap the ground within the upper bed across the span interior at the upper road's height (a hill under the
  span lifts the deck over it) — but not near the ends, where it digs a drop in front of the deck's leading edge.
- **Tests that guessed "off-road" or "deck" from height break on tall terrain.** `rock` is off-road too; a deck mark is
  one whose nearest route point in 3D is on the upper span, not one above 3 m.
- **Town lots vs relief.** 25 m of relief on a 250 m-wide sprint town makes most ground 10-13 %, over the rooftop lots'
  10 %; Town keeps its hills either cut through or far out and its fine detail low (0.6 m). Lots now terrace their own
  footprint (`roofs::terrace`): level at the ground's middle height, faded out over 4 m, never within 1 m of the road's
  edge, refused past 1.5 m of cut or fill. A sloping terrace pitched the kicker and the car overshot the roof; a deep
  cut left the hill behind the house at roof height and the car rolled off into it.
- **The browser's WASM is a build artefact.** `scripts/build-host-wasm.sh` after a jj-map/jj-sim change, or the host
  hangs silently loading a map whose JSON the stale parser rejects.
- **The underpass dip is per biome (`underpass` share).** On flat ground (Greybox) a deck-height dip makes a 2 m trench
  whose sides roll a bike flicked off the road at 35 m/s; there the old design (both roads level, the deck rising
  over) is right. Steep biomes dip fully so the deck rides at the upper road's level.
- **Flow beats (`flowPerKm`).** A landscape that climbs everywhere leaves the core's jumps nowhere to go (a jump wants
  ≤ 4.5 % natural grade over ~150 m): ~200 m windows held to 3 % on the straightest stretches, preferring the land's
  highest and lowest ground (a level run there costs no relief), bring them back (Rocks 0 → ~1 jump per seed).
- **A gentle biome beside a steep one can stop the profile settling.** Greybox (3 %, curvature 0.002/m) meeting Outback
  Dirt (18 %) asks for a grade change sharper than the road may bend: the relaxation bleeds the climb back into Greybox,
  the envelope cuts it, and `PROFILE_ROUNDS` runs out with the relaxation last (grade 5 % on a 3 % biome). The biome
  grade limit is now ramped (`terrain::ramp`: it changes by at most half the curvature limit per metre); one biome's
  limit is constant, so single-biome maps don't change. Ramping the whole budget instead (flow beats, bank twist) cost
  relief: two single-biome seeds fell under 25 m.
- **Long beat straights put crests past their design speed.** A crest keeps a car grounded to 25 m/s; on a beat straight
  the handling bank's 35 m/s flick lands on its brow and rolls. That's the stated gap (crests past their design range),
  filed with the road-only runs, not a turn roll-over.
- **Bridge piers are geometry, not decoration (br-xlvx.3).** The bridge mesh is shared by the sim (collider) and the
  renderer (fingerprint-checked against it), so piers live in `jj-map::bridge::piers` and its TS mirror with the same
  constants and arithmetic (JS numbers are f64, so the same formulas in the same order agree); a renderer-only pier would
  be a ghost a car drives through.
- **Figure-eights need room.** On a 650 m sprint the deck's span is a third of the lap and its grade is capped for the
  deck's cosine; the lobes can't climb 25 m. The family has a minimum length (`figureEight.minLengthM`, 850 m).
- **Time a fork the way the autopilot drives it (br-bbki.16.1).** The autopilot plans corners at
  `0.7 × √(7 / κ)` (≈ 0.35 g) and ignores the surface, so a gain estimate at 0.8 g on a dirt pace made every chord cut
  3–11 s faster in the pack. `forks.gripG` / `branchPace` match the bot; `tests/forks.rs` measures the real split.
- **Wayfinding across a junction is a wall.** The road's guard rails and chevrons on a corner's outside stood across a
  fork's mouth and wedged cars at the merge. Clear wayfinding at fork mouths only (`forks::in_mouth`; the corner lint
  skips them), never along the whole branch, or rails vanish from roads the branch merely passes near.
- **Bot branch choices must be balanced, not rolled.** A per-car coin flip gave 3 of 16 on one fork; choose by car index
  plus forks met (offset by a per-seed bit) so a pack splits evenly and R29 holds without luck.
- **Rhythm is spacing as much as count (P1-FL15c).** Two set pieces placed 13 s apart leave one unbroken flow beat over
  half the lap even though the lap "has" its pieces. Place each further piece a quarter-lap clear of the others first.
- **Biome × family is a design choice, not noise.** A Town speedway (800 m straights through streets) can't pass the
  40% one-beat rule without technical clusters, and those clusters take the straights Town's rooftop lots need. Ruling
  the family out for Town (`familiesOffIn`) fixed the rhythm at the cost of 2 lots; check roofs whenever course
  families or straights change.
- **Shared enums break exhaustive matches across agents.** A new `jj_map::PieceKind` variant in the tree stops
  procgen compiling mid-run; match the kinds you mean and give the rest a `_` arm.
- **An overpass leap inherits the bridge's road heights (br-xlvx.10.3).** Removing a bridge's feature leaves its deck
  ramp heights on the upper road; the leap only rewrites heights from its own run-in on, so a ramp that started earlier
  floated 2.6 m over the ground and its layered gate never counted (seed 78's bot never finished). Put the upper road
  back on its ground before trying a leap (`overpass::leap_crossings`), and refuse a leap whose embankment reshapes the
  ground under any road it doesn't set (a loop-over's own arc runs beside its exit straight).
- **A leap needs about twice a bridged loop-over's road.** Its climb and landing on the exit straight push a loop-over
  to ~1.1 km; on a sprint lap it never fit and was dropped. Shrink an unfitting first loop-over below the leap angle
  (a compact bridge) instead of dropping it, and keep later ones compact.
- **Judge a leap's landing with the air input a player uses.** Since br-bbki.24 a throttle pinned in the air raises the
  nose on purpose; a bank that flies flat out lands nose-high. Fly neutral (it holds the take-off pitch) and judge the
  first second after touchdown, not where an unsteered car ends up on a curving road.
- **Profile the whole draw, and count early returns (br-cxqk).** On the 24-seed guard sample the time went: set-piece
  placement ~45% (each refused candidate stamps a trial map; most stamps are refused for sight), validate ~20%, terrain
  undulation ~25% (almost all of it `smooth_curvature` rescanning every point every iteration). A checkpoint timer that
  sits after an early `return` silently drops those draws' cost: time each call site, not just the straight path.
- **Redraws dominate, and most are set pieces.** 44 of 59 rejected draws were short of their set pieces. Short and
  many-biome laps fail because the course's beat straights leave only ~40 m of kicker positions (40 m straight run-up +
  kicker to landing end must sit on the straight), and those then fail run-out terrain or sight. Longer beats (180-220 m)
  and a wider biome-boundary margin did not help; trying beat sites first did (mean draws 3.46 -> 2.92).
- **Bit-exact speed-ups are cheap to land: prove them on the goldens.** The prepare gate (stop a gated draw after
  set-piece placement when `check_minimum` or the relief fails), caching each landmark spot's view per eye in
  `choose_landmark`, and incremental `smooth_curvature` changed no golden: native mean 857 -> ~600 ms, no version bump.
- **A deck's cosine leaves its foot level (br-xlvx.10).** Where the road outside a bridge climbs at 10%, the foot was a
  10% crease that threw a 39 m/s bot 0.9 s (seed 98, v28). `terrain::deck_foot` carries the outside grade 30 m into the
  deck; the crossing bank now fails any foot that changes grade by more than 5% (worst 2.4%).
- **Every reshuffle of the maps surfaces latent seeds.** A change that only moves set pieces (v28) re-rolled the bank's
  seeds and exposed a whoops launch (36), the deck crease (98) and the Lion's nose strike after a sag rebound
  (four-biome seed 0). Trace each with the env-driven diagnostics before blaming the change: `diag_bot_trace`
  (`JJ_POINTS`), `diag_postie_rocks_wreck` (`JJ_DIAG_VEHICLE`, `JJ_DIAG_SEED`, `JJ_DIAG_FOUR`, `JJ_NEAR`, `JJ_TICKS`,
  `JJ_NO_BRIDGE/DRESSING/PROPS`).
- **An overpass leap owns its whole bridge span (br-xlvx.10.3).** Rise from the deck's own heights (they are a validated
  road line), sculpt only the approach, flight and landing on the straight, let the run-out follow the road by arc
  length, and embank the ground under every span point the piece didn't sculpt. Resetting the deck to raw ground left
  steps; demanding a straight run-out refused every loop-over leap as "Bent" (the exit straight ends 90-180 m on).
- **`setpieces::local` read far points as beside a piece.** Its lateral is the nearest segment's line, so a point 300 m
  straight ahead of a span's open end had a small lateral and a `u` at the span's end. Harmless while every span ran
  far past `end_u()`; a leap's span ending at its landing made its landing verge take another corner's rails. Points
  past an open end are now off the piece. When a check only fails on maps with one feature, count the thing that's
  missing after every pipeline stage (`setpieces::clear_footprints` here) before reasoning about geometry.
