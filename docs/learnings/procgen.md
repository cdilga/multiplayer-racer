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
