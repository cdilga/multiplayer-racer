# P1-M08b: timing receipt (the next round starts on time)

**Hardware / runtime / build:** Apple M1 Pro (arm64 Mac, the dev laptop), Chromium 151.0.7922.34 (Playwright headless) for the
browser rows and Node v26.10.0 (V8) through `wasm-bindgen-test-runner` 0.2.129 for the WASM row; release `jj-wasm-procgen` and
`jj-wasm-host`, `scripts/build-host-wasm.sh`, branch `v0.2-revamp` with the P1-M04..M08b changes (generator version 7).
Cohort: the Playtest-1 recipe (town, rocks, outback dirt, outback bitumen), seeds 0..24 (WASM row) and the seeds named below.

| Row | Measured | Budget |
|---|---|---|
| Generate + validate one Playtest-1 track in WASM (Node, release), worst of 24 seeds | 404 ms (mean 245 ms) | 1.5 s laptop |
| First track of a round, `start` pressed to the map staged in the page (Chromium, procgen worker + stage + `MapReady`) | 753 ms | the Countdown is 3 s |
| Second track prepared during the Intermission (round 1 raced one lap on the autopilot) | ready with 49.9 s of the 60 s Intermission left | 60 s Intermission |
| Reroll to staged map with the page's CPU throttled 6x (`Emulation.setCPUThrottlingRate`), four rerolls | 877 to 1235 ms | 4 s (phone-host stand-in) |
| The same, generator thread scaled by 6 (its worker thread is not throttled by that emulation) | 1.22 to 1.93 s | 4 s |

Tests: `web/host/tests/prepare.test.mjs` (`two rounds back to back play two different generated four-biome tracks`,
`preparation finishes well inside the intermission with the page CPU throttled 6x`) and `crates/jj-procgen/tests/wasm_parity.rs`
(`generate_and_validate_in_wasm_stays_inside_the_laptop_budget`; run with `JJ_WASM_BUDGET_MS=0` to print the numbers).
Raw numbers: `browser-run.json`.

**Not measured:** the real phone host (a P1-Q02 checklist row), a headed browser with the GPU for the stage cost, and the owner's laptop.
Two different tracks played back to back: seeds 4 and 5, preparations 1 and 2, both `town > rocks > outback-dirt > outback-bitumen > town`.
