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
- `jj-map` native checks including the new geometry case pass. The broader native map/procgen run is still in progress at authoring time; CI is required before closing the bead.

The timed region is `prepare` in both Mac banks; module initialization is outside it. The candidate uses synchronous initialization because the asynchronous Node loader stalled before reaching WASM (not a generator time). The initial unoptimized probe is excluded from the comparison.

Rollback is a normal revert of the geometry optimization commit. No tuning or budget changes are needed.
