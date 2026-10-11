# P1-M03g preparation budget repair

2026-10-11, CyanBridge. The budget remains 1500 ms and the original seeds 0–23 remain in the test.

## Reproduced

- Gitea CI run [3284](http://192.168.11.12:3001/cdilga/multiplayer-racer/actions/runs/3284), Rust WASM tests at opt level 1: worst 6914 ms, mean 1706 ms.
- RCH on eris (Intel i5-12400, Linux), both dev/test opt level 1: worst 3230 ms, mean 791 ms; the same budget failed. Seed/recipe/arena parity passed.
- Mac release WASM in Node 26.10.0 (Apple M1 Pro, 16 GiB, macOS 27.0.1), profiled bank: mean 2160.4 ms, p50 1618.0 ms, p95 7104.1 ms, maximum 10039.1 ms. Raw rows: `baseline.jsonl`.

These are shared-machine measurements with other work running and profiler overhead, not isolated hardware qualification. The 24-seed bank is a sample, not a limit. Tail percentiles are coarse at this sample size.

## Attribution and change

The release CPU profile puts 47.4 of 52.2 seconds inside `jj_map::geom::RouteGeom::nearest`, including 41.1 seconds in software FMA used by `hypot`. `baseline-hotspots.json` retains sampled totals and the raw profile hash.

Opportunity score: impact 5 × confidence 5 / effort 1 = 25. Before evaluating `hypot`, reject a projected point only when either absolute coordinate distance exceeds the current best Euclidean distance. Either coordinate is a lower bound; such a point cannot win. Candidate points still use the original `hypot`, in original order, with the original strict comparison.

- Ordering and tie breaking remain unchanged, including rounded-distance ties.
- Projection, winning distance, lateral offset, width interpolation and RNG operations remain unchanged.
- No course points, dressing, biomes, redraws or validation checks are removed.
- The new unit case covers duplicate points, equal-distance segments/endpoints, changing road width and a large-coordinate rounded tie.

## Verification

- `cargo test --locked --target wasm32-unknown-unknown -p jj-procgen --test wasm_parity`, RCH eris, dev/test opt level 1: **4/4 pass**, including the unchanged preparation budget and unchanged seed/recipe/arena goldens.
- Mac release WASM profiled bank: mean **267.0 ms**, p50 **196.0 ms**, p95 **682.2 ms**, maximum **1102.2 ms**. Raw rows: `candidate.jsonl`; profile totals/hash: `candidate-hotspots.json`.
- `RCH_REQUIRE_REMOTE=1 rch exec -- cargo test -p jj-map -p jj-procgen`, eris, unoptimized native test profile: **87 pass, 1 ignored across 24 suites**, exit 0. This includes the geometry regression, seed/recipe/arena goldens and biome/autopilot banks. RCH build `30055395930145049`; run 08:45–09:15 UTC. CI is still required before closing the bead.

The timed region is `prepare` in both Mac banks; module initialization is outside it. The candidate uses synchronous initialization because the asynchronous Node loader stalled before reaching WASM (not a generator time). The initial unoptimized probe is excluded from the comparison.

Rollback is a normal revert of the geometry optimization commit. No tuning or budget changes are needed.

## Second bound after CI 3309

CI [3309](http://192.168.11.12:3001/cdilga/multiplayer-racer/actions/runs/3309)
still exceeded the unchanged budget: worst **1795 ms**, mean **416 ms**. The prior improvement
was real but insufficient for this runner. The bead therefore remains open until green CI.

The candidate release profile still attributed 5.045 of 6.561 seconds to `RouteGeom::nearest`,
including 3.860 seconds in software FMA. Opportunity score: impact 5 × confidence 5 / effort 2 =
12.5. Seed a distance upper bound from an actual projected point: a cheap first pass chooses the
projection with the smallest maximum coordinate distance, then computes its original `hypot`.
The original ordered pass can reject distant projections immediately, instead of running `hypot`
for each successively closer segment.

- Ordering is preserved: the answer is selected only in the original segment order.
- Tie-breaking is unchanged: the first strictly smaller original `hypot` wins; bound rejection
  uses strict `>` on coordinate lower bounds, retaining ties.
- Projection arithmetic, candidate `hypot`, winning geometry, RNG and validator checks are unchanged.
- The bound comes from an actual candidate, so any projection rejected by it cannot beat that
  candidate or the best result already found. The bound only shrinks.

Fresh Mac release WASM banks (same machine/Node as above, other work running, CPU profiler enabled):
before mean **632.8 ms**, p50 **472.0 ms**, p95 **1624.1 ms**, max **2855.0 ms**; after mean
**367.2 ms**, p50 **314.9 ms**, p95 **1003.5 ms**, max **1365.6 ms**. These are shared-machine
measurements, not hardware qualification. `bound-before.jsonl` and `bound-after.jsonl` retain every
row: all 24 canonical SHA-256 hashes, validity and fallback choices match exactly.

The fresh profiles attribute 12.196 seconds before and 5.942 seconds after to `nearest`; software
FMA self time falls from 9.326 to 0.944 seconds. The additional geometry oracle compares every
returned field's bits against the original exhaustive implementation over 16 generated routes,
both open and closed, and 441 query points per route. Both geometry tests pass on eris.

`RCH_REQUIRE_REMOTE=1 rch exec -- cargo test --config profile.dev.opt-level=1 --config
profile.test.opt-level=1 --locked --target wasm32-unknown-unknown -p jj-map -p jj-procgen --test
wasm_parity`: **5/5 pass on eris**, including the unchanged 24-seed budget and original goldens.
Both profiles are explicitly configured in the Cargo arguments, matching CI. An earlier
continuation used environment variables outside RCH; those were not forwarded, so its worst
1985 ms before / 1693 ms after are **unoptimized** measurements, not opt-level-1 evidence.

The broad native `jj-map`/`jj-procgen` run at explicit opt level 1 on eris also passes:
**88 tests, 1 ignored across 24 suites**. The seed/recipe/arena goldens and biome, handling and
autopilot banks remain intact. Log: `/tmp/jj-procgen-bound-native.log`, 09:42–09:48 UTC.

Rollback remains a normal revert of the second geometry optimization commit.


## Immutable segment cache after CI 3316

CI [3316](http://192.168.11.12:3001/cdilga/multiplayer-racer/actions/runs/3316)
still failed the unchanged preparation budget: worst **1691 ms**, mean **422 ms**.
All seven browser lanes passed. The second-bound profile still spends 4.936 seconds
in nearest's own segment projection loop.

RouteGeom now precomputes the immutable segment start, differences, squared length
and length once in its constructor. Both nearest passes keep the original segment
order and arithmetic; they reuse these values instead of recomputing/indexing them
for every query. No reciprocal multiplication or changed distance formula is used.
Opportunity score: impact 5 × confidence 5 / effort 1 = 25.

On the same shared Mac release-WASM/Node profiled bank, the prior bound bank's mean
**367.2 ms**, p50 **314.9 ms**, p95 **1003.5 ms**, maximum **1365.6 ms** becomes mean
**110.0 ms**, p50 **91.3 ms**, p95 **310.5 ms**, maximum **440.3 ms**. These sequential
shared-machine measurements include profiler overhead and are not hardware
qualification. `cache-after.jsonl` matches all 24 prior `bound-after.jsonl` canonical
hashes, validity and fallback choices exactly. `cache-hotspots.json` retains the raw
profile hash and attribution: nearest inclusive **1.722 seconds**, self **1.413 seconds**.

- RCH eris, explicit dev/test opt level 1, original map/procgen WASM parity: **5/5 pass**,
  including the original 24-seed 1500 ms budget and all seed/recipe/arena goldens.
  Log `/tmp/jj-procgen-cache-wasm-opt1.log`, 10:18 UTC.
- Broad native map/procgen bank on eris at explicit opt level 1: **88 pass, 1 ignored
  across 24 suites**, exit 0. Geometry's exhaustive bit comparison and duplicate/tie
  regression remain green, along with terrain, handling, autopilot and generated-map
  banks. Log `/tmp/jj-procgen-cache-native.log`, 10:18–10:23 UTC.
- Native compatibility libraries after the cache: **71/71** pass, including the host's
  unchanged mixed-roster golden and determinism cases. The fresh local host/procgen
  release WASM build also passes.

The bead remains open until green CI containing this change. Rollback is a normal
revert of the immutable segment cache commit.
