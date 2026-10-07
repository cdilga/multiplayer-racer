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
