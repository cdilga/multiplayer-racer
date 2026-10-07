# P1-M03g: generate + validate timing in WASM (receipt)

**What:** `jj_procgen::prepare(seed, [town, rocks, outback-dirt, outback-bitumen])`, i.e. the four-biome lap through the
whole fallback ladder (every attempt generated and fully validated: jj-map rules, transitions, feature envelopes,
wayfinding), per seed, 24 seeds (0..24). Test: `crates/jj-procgen/tests/wasm_parity.rs`
`generate_and_validate_in_wasm_stays_inside_the_laptop_budget` (asserts worst <= 1500 ms).

**Hardware / runtime / build:** Apple M1 Pro (arm64 Mac), Node v26.10.0 (V8) through `wasm-bindgen-test-runner` 0.2.129,
`cargo test --locked --release --target wasm32-unknown-unknown -p jj-procgen --test wasm_parity`, working tree on branch
`v0.2-revamp` with the P1-M03g changes (generator version 6). Not a browser.

| Build | Worst per seed | Mean | Budget |
|---|---|---|---|
| release WASM | 184 ms | 125 ms | <= 1.5 s (laptop) |
| debug WASM | 283 ms | 198 ms | (not the shipped build) |

Reproduce the numbers (the test prints them only by failing): `JJ_WASM_BUDGET_MS=0 cargo test --locked --release --target
wasm32-unknown-unknown -p jj-procgen --test wasm_parity`.

## Browser measurement (Chromium, with and without the 6x CPU throttle)

`web/host/tests/procgen-browser-timing.mjs` runs the same `prepare(seed, default recipe)` for seeds 0..23 on the page's main
thread in headless Chromium (software GL) on eris (Intel i5-12400, 12 cores, linux/x64; Chromium 151.0.7922.34; procgen
build `jj-wasm-procgen 0.2.0`, script from commit bd37214, run on eris at 1ef04e8). The throttle is
`Emulation.setCPUThrottlingRate` through CDP; it slows the page's main thread, which is why the generator runs there (it
doesn't reach workers). Raw numbers: `browser-timing.json`.

| Throttle | Worst seed | Mean | Budget | Plans (24 seeds) |
|---|---|---|---|---|
| none | 292 ms (seed 23) | 190 ms | <= 1.5 s (laptop) | 15 requested, 6 redrawn-1, 3 redrawn-2 |
| 6x | 1825 ms (seed 23) | 1194 ms | <= 4 s (phone-host stand-in) | same |

Every seed is valid in both runs. The 6x figure is a measurement in a real browser, not the node figure times six (which
predicted ~1.1 s; the browser is about 1.7x worse than that estimate, still well inside the 4 s stand-in). The real phone
host stays an open row for the P1-Q02 checklist.
