# P1-S motorbikes · br-bwju.4

2026-10-12. Simulation implementation and versioned proxy fixture; the Postie Bike/Pig Catcher models,
asset contract, renderer integration and visual acceptance belong to br-bwju.5. This fixture is not in the roster.

Validation ran on MacBookPro18,3, aarch64 macOS, pinned Rust 1.99.0, Node 26.10.0. WASM parity uses Node's
WASM runtime and the real `HostSim` fixture surface, not a browser or physical controller. One bike per case;
cohort sizes are test samples. No participant, wheel/debris gameplay budget or expiry was introduced.

Changes generalise suspension axles and damage topology from profiles. Two-wheel arcade balance preserves yaw,
deliberate wheelie lift, drift, real collisions and dynamic rider/part debris. R121 lost-wheel grace produces a
fresh bike and persistent husk/parts. The CLI accepts `--profile`; native and WASM setup accept bike part names.
Rapier 0.36's existing raycast controller, contact damage, springs, debris, respawn, journals, autopilot and shared
fixture harness are reused. Root-cause calculations and impact findings are in `docs/learnings/sim.md`.

Acceptance evidence:

- AC1: `JJ_EVIDENCE_DIR=<out> rch exec -- cargo test -p jj-procgen --release --target aarch64-apple-darwin --test handling bike_ -- --nocapture`.
  `handling.log`, `handling-bank.txt`: all 288 flat surface/speed/lock/ramp/brake cases pass, worst lean 13.8°;
  all 549 generated-road cases pass, zero dives/grazes/rollovers and no failed road-only baseline cases.
  Eight rail-impact regressions pass (`rail-regressions.json`). Tests keep generated scenery and rails.
- AC1: `rch exec -- cargo test -p jj-procgen --release --target aarch64-apple-darwin --test bikes -- --nocapture`.
  `biomes.log`: 3 seeds × all 4 biomes lap, no recovery/wreck, exact replay. Minimum upY: Town .99806327,
  Rocks .95771813, Dirt .962307, Bitumen .94984204.
- AC2/AC3: `rch exec -- cargo test -p jj-sim --release --target aarch64-apple-darwin --test bikes -- --nocapture`.
  `fixtures.log`: four tests pass, including real wall-impact damage, rider separation, lost-wheel grace,
  fresh mass/parts after respawn, persistent dynamic debris and exact replay. Invalid wheel topology is rejected.
- AC2/AC3: `jj sim --json --profile scenarios/bikes/profile.json --out <out> scenarios/bikes/{controls,damage}.json`.
  `controls-cli.json`, `damage-cli.json`: every envelope and replay passes. Wheelie front-air time .591667 s,
  drift time 1.066667 s, no control-fixture wreck. Named damage fixture produces exactly one lost-wheel wreck.
- AC3: build `jj-wasm-host` release for wasm32, then with `--features testing`, bind both with `wasm-bindgen`;
  `JJ_BIN=<native jj> JJ_EVIDENCE_DIR=<out> node --test web/host/tests/bikes-wasm.test.mjs`.
  `wasm-parity.log`, `*-wasm.json`: both native/WASM hashes agree bit for bit, with actual two-wheel/six-part state.
- `rch exec -- cargo clippy -p jj-sim -p jj-fixture -p jj-procgen -p jj-tools -p jj-wasm-host --all-targets --all-features --target aarch64-apple-darwin -- -D warnings` passes (`clippy.log`).
  `npx --prefix web tsc -p web/tsconfig.json --noEmit`, formatting and `git diff --check` pass.
- `rch exec -- cargo test -p jj-sim --release --target aarch64-apple-darwin` passes in full (`sim-suite.log`),
  including the car regression banks and nine derby tests with bike wheel-loss attribution.

Native hashes: controls `4112317d00b7bdd10d2e7fe765d2757aa05f331505e469e6c4293d0a9a848abb`;
damage `c5b3e32070ff6cf5b34de4685262dccfd96be3faa9555fe7d349949115b976bc`.

The workspace matrix remains a CI close requirement. An older remote debug workspace run was superseded as
balance changed; its partial success is not a green receipt. The replacement remote release run was refused
because that project was still active and the other worker had critical pressure. No local workspace fallback ran.
This record does not close the bead or bypass CI.
