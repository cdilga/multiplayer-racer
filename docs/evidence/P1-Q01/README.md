# P1-Q01 receipts (G-SIM and G-PERF)

Taken 2026-10-10 on the owner's Mac, headed, with the owner present. Hardware: MacBook Pro (MacBookPro18,3), Apple M1 Pro
(8 cores, 14-core GPU), 16 GB, built-in Liquid Retina XDR 3024x1964. Browser: headed Google Chrome 154.0.8037.98 (Playwright),
WebGL backend. Build: `5719295e30f9` plus the uncommitted `programs` probe in `web/host/src/main.ts` (see Helper).

| Receipt | What |
|---|---|
| `frame-pacing-mac.json` | host frame pacing p50/p95/p99/max + hitch attribution at 1/4/8/12/16/24/32 tiles, 1080p and 4K render sizes (synthetic 32-car field, greybox, look on) |
| `debris-growth-mac.json` | the LIVE host (real sim worker) with 1 to 96 cars, every part stripped at tick 30 (16 to 1061 uncapped debris bodies): draws, triangles, frame pacing, worker tick rate, skipped snapshots, 1080p and 4K |
| `sim-timing-Chriss-MacBook-Pro.json` | native (`jj sim`, release) vs WASM (host build in Node) ms per 120 Hz tick, snapshot bytes and write cost, same state hash; Mac row |
| `sim-timing-eris.json` | the same on eris (i5-12400) |

## Frame pacing (steady 600 frames after 120 warm-up; ms)

Every row is `resolutionSource: native` and `countsAsNative: true` (render size equals the canvas's native size). Zero hitches
(frame over 2x median and 25 ms) in any of the 14 rows; the display runs at 120 Hz (8.3 ms) and held it.

| Tiles | 1080p p50/p95/p99/max | 4K p50/p95/p99/max | Draws | Triangles |
|---|---|---|---|---|
| 1 | 8.3 / 9.2 / 9.3 / 9.4 | 8.3 / 8.9 / 9.3 / 9.4 | 39 | 140k |
| 4 | 8.3 / 9.1 / 9.3 / 9.4 | 8.3 / 8.9 / 9.3 / 9.4 | 121 | 323k |
| 8 | 8.3 / 9.2 / 9.3 / 9.4 | 8.3 / 9.1 / 9.3 / 9.4 | 232 | 616k |
| 12 | 8.3 / 9.1 / 9.4 / 9.4 | 8.3 / 9.3 / 9.4 / 9.4 | 342 | 908k |
| 16 | 8.3 / 9.2 / 9.3 / 9.4 | 8.3 / 9.2 / 9.4 / 9.4 | 451 | 1.20M |
| 24 | 8.3 / 9.2 / 9.3 / 9.4 | 8.3 / 9.3 / 9.4 / 9.4 | 675 | 1.79M |
| 32 | 8.3 / 9.2 / 9.3 / 9.4 | 8.3 / 9.3 / 9.4 / 9.4 | 898 | 2.37M |

This scene has no live debris and no heavy damage, so it says "the renderer and tile grid are fine at 32 tiles"; the debris table
below is the one that stresses the host.

## Debris growth, live host (draws / triangles / sim rate as debris grows; nothing capped)

Tiles = min(cars, 24). Last of four 240-frame windows. `simHz` is ticks the worker really advanced per wall second (budget 120).

| Cars | Debris bodies | Draws | Triangles | 1080p p50/p99/max | 4K p50/p99/max | simHz | Resolution source |
|---|---|---|---|---|---|---|---|
| 1 | 16 | 46 | 65k | 8.3 / 9.4 / 9.4 | 8.3 / 9.2 / 9.4 | 120 | native |
| 4 | 49 | 145 | 0.46M | 8.3 / 9.3 / 9.4 | 8.3 / 10.1 / 10.3 | 120 | native |
| 8 | 93 | 283 | 1.6M | 8.3 / 9.3 / 9.3 | 8.3 / 9.4 / 9.4 | 120 | native |
| 16 | 181 | 555 | 6.0M | 8.3 / 9.3 / 9.3 | 8.4 / 17.3 / 17.6 | 120 | native |
| 24 | 269 | 820 | 13.1M | 16.6 / 21.7 / 25.1 | 15.7 / 24.6 / 27.3 | 120 | native |
| 32 | 357 | 821 | 17.4M | 17.5 / 26.4 / 30.0 | 17.3 / 31.2 / 32.8 | 120 | native |
| 48 | 533 | 822 | 25.8M | 24.4 / 33.9 / 34.1 | 27.8 / 38.1 / 41.6 | 120 | native |
| 96 | 1061 | 829 | 34.7M (1080p) / 51.3M (4K) | 37.5 / 45.5 / 47.8 | 49.2 / 59.7 / 65.9 | 16.3 (1080p) / 13.1 (4K) | AUTO-LOWERED |

Findings, with next steps:

1. **The host drops below 60 fps from 24 tiles with the full ten-part strip (13 M triangles) at both 1080p and 4K**, and
   frame time scales with triangles, not pixels (1080p and 4K are within a few ms of each other up to 48 cars). Draws stay near
   820 (instancing works), so the cost is triangle count: 24 tiles each draw the whole field, so a 24-tile frame is about
   24x the vertex work of a single view. Next step: per-tile LOD on distant cars and debris (vehicle LOD budgets are in R02),
   then re-run this table. Not hidden by a cap.
2. **96 cars (1061 debris bodies) is over the sim budget in the browser worker: 16 Hz at 1080p and 13 Hz at 4K against 120.**
   Native on this Mac needs 24.6 ms per tick and WASM 18.3 ms (budget 8.33), so both are over; at 48 cars native is 7.8 ms
   (inside) and WASM 12.1 ms (over). The sim ran 120 Hz up to 48 cars in the browser too, but the Node WASM mean there (12.1 ms)
   says it is close to the edge. Next step: profile the broad phase and wheel-ray predicate under a large pile (as already noted
   in the eris receipt).
3. **The host auto-lowered its resolution at 96 cars (R111's measured last resort)**, in both sizes. Those two rows are marked
   `auto-lowered`, `countsAsNative: false`, and are not native evidence; the first two windows of each ran native.
4. Hitch attribution (heuristic: shader-program count, heap drop, Long Animation Frame script/render time) found 19 hitches at
   48 cars 1080p and a handful at 4K, classified in each window's `hitches.byKind`; the clean rows have none.
5. Skipped snapshots stay at 9-43 per run across all sizes (a flat startup cost, they do not grow with debris).

## Native vs WASM sim timing (Mac, ms per 120 Hz tick; budget 8.33)

Both end on the same full-state hash at every size (parity true).

| Cars | Debris | Native | WASM (Node) | Snapshot bytes | Snapshot write (median) |
|---|---|---|---|---|---|
| 1 | 16 | 0.077 | 0.136 | 1056 | 0.003 ms |
| 4 | 49 | 0.293 | 0.314 | 3624 | 0.006 ms |
| 8 | 93 | 0.563 | 0.560 | 7048 | 0.007 ms |
| 16 | 181 | 1.39 | 1.42 | 13896 | 0.013 ms |
| 24 | 269 | 2.20 | 6.49 (p95 25) | 20744 | 0.018 ms |
| 48 | 533 | 7.84 | 12.10 (p95 48) | 41288 | 0.037 ms |
| 96 | 1061 | 24.62 | 18.28 | 82656 | 0.120 ms |

The Mac WASM figures at 24 and 48 cars are noisy (p95 25 and 48 ms): other agents were running browser tests on this Mac during
the run (CPU contention); the eris table in the earlier version of this file (1.29 / 4.52 ms WASM at 24 / 48 cars) is the quieter
reading. Native, which is a separate process timed by difference, was less affected.

## Honest gaps

- **True 4K backing store: not available.** The built-in display is 3024x1964. The 4K rows set the Playwright viewport to
  3840x2160 at devicePixelRatio 1, so the host really rendered 3840x2160 pixels (`renderPixels` in the receipt), but they were
  not scanned out to a 4K panel and the window was not that size on screen. Frame times therefore include the GPU work of a 4K
  canvas but not a 4K display's scanout. A TCL at 4K is still an owner row in P1-Q02.
- **Brave's GPU process (about 25 to 36 % CPU) was running on the Mac the whole time** and was accepted by name
  (`--accept-busy Brave`, recorded under `gpuContention.acknowledgedBusy`). Other agents' headless browser runs overlapped some
  runs; the helper waited for them to go quiet and re-ran rows that saw a neighbour (`attempts`, `clean` per row; every row
  recorded is `clean: true`). An earlier draft run before these guards existed was discarded.
- **Worker snapshot cost in the browser** is covered by the snapshot write cost in WASM (Node) and by the published/skipped
  counters and tick rate above; the main-thread snapshot decode time in the page is not measured separately.
- Hitch kinds for sim-step stalls cannot be seen from the main thread (the sim is in a worker); they appear as `simHz` below
  120 and as skipped snapshots.
- GPU pacing is the rAF interval, not GPU timestamps; `look-cost.mjs` (R10/R12) is the GPU-synchronous measurement.
- Triton's GTX 1080 second GPU and the TCL were not part of this run.

## Helper and rerun

`web/tests/journeys/harness/perf.mjs` (frame pacing, guards, lock, hitch attribution), `perf-debris.mjs` (live debris growth),
`perf-sim.mjs` (sim timing). The refusal and native-marking tests run in CI: `web/tests/journeys/q01-perf-helper.test.mjs`.
The helper refuses headless runs and overlapping GPU use (lock file plus a busy-GPU-process check at start and after every row;
it waits up to 10 min for a neighbour first, then refuses). It also needs the host's `programs()` probe added to `__jjRender`
in `web/host/src/main.ts` (shader-compile attribution).

```
scripts/build-host-wasm.sh && cargo build --release -p jj-tools --bin jj && npm --prefix web run build
node web/tests/journeys/harness/perf.mjs frame-pacing --out docs/evidence/P1-Q01/frame-pacing-mac.json
node web/tests/journeys/harness/perf-debris.mjs --out docs/evidence/P1-Q01/debris-growth-mac.json
JJ_BIN=target/release/jj node web/tests/journeys/harness/perf-sim.mjs --cars 1,2,4,8,16,24,48,96
```

Add `--accept-busy <app>` to accept a named idle-ish neighbour; it is recorded in the receipt.
