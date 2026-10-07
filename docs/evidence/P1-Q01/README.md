# P1-Q01 receipts

| Receipt | Kind | State |
|---|---|---|
| `sim-timing-eris.json` | native vs WASM sim timing, worker snapshot cost, sim ms as debris grows (1 to 96 cars, 16 to 1061 dynamic debris bodies) | taken on eris (i5-12400), release `jj` vs the host's WASM build in Node; both end on the same full-state hash |
| `mac-frame-pacing.md` | owner step: headed Mac frame pacing at 1/4/8/12/16/24/32 tiles, 1080p and 4K | not taken; needs the Mac, headed, with the GPU to itself |

Helper: `web/tests/journeys/harness/perf.mjs` (frame pacing, refusal and native-marking guardrails, test in `perf.test.mjs`),
`web/tests/journeys/harness/perf-sim.mjs` (sim timing). Eris numbers (ms per 120 Hz tick; the budget is 8.33):

| Cars | Debris | Native | WASM (Node) | Snapshot bytes |
|---|---|---|---|---|
| 1 | 16 | 0.025 | 0.044 | 1056 |
| 8 | 93 | 0.225 | 0.261 | 7048 |
| 24 | 269 | 1.21 | 1.29 | 20744 |
| 48 | 533 | 4.36 | 4.52 | 41288 |
| 96 | 1061 | 12.06 | 10.65 | 82376 |

The scene is the worst case on purpose: every car on a start grid loses all ten parts at once. Nothing is capped; at 96 cars
and 1061 live debris bodies the sim is over its tick budget on this CPU (native and WASM alike). Next step if that matters for a
real round: profile the broad phase and the wheel-ray predicate under a large pile, then see what the owner's playtest cohorts
need; nothing here is hidden by a cap. WASM runs in Node (V8), so browser-worker overhead isn't in these numbers; the Mac row of
the same command is part of the owner step. Draws and triangles with growing debris in the browser are not measured by the
synthetic scene used for frame pacing (no live debris); the Mac run's `draws` and `triangles` columns are per tile count only.
