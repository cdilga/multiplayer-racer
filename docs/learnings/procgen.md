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
