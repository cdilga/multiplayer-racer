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

**Not measured here (open `ev:hardware` rows):** Chromium at 6x CPU throttle against the 4 s stand-in budget (the node
figure scaled by 6 is ~1.1 s worst, an estimate, not a measurement), and the real phone host (P1-Q02 checklist).
