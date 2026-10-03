# P1-S01 evidence: the jj-sim core and scenario runner

`local-checks.txt` (eris): `cargo test -p jj-sim -p jj-tools` (rng 1, determinism 2, determinism scan 2, Rapier API 6,
scenario bank 1; plus the jj-tools suites), the scenario run, the wasm32 check and clippy. CI on Gitea runs the workspace
tests (the scenario bank runs through the real `jj` binary there too).

| Acceptance | Test |
|---|---|
| Native scenarios `idle-settle` and `straight-throttle` pass their envelopes | `crates/jj-tools/tests/scenarios.rs` runs `jj scenario --json scenarios/*.json` and requires every envelope: idle-settle (settled by 2 s, still at 4 s, upright, 4 wheels down, 0.82 m chassis height); straight-throttle (10 m/s at 2 s, 23 m/s and 79 m at 6 s, no lateral drift or heading change) |
| Same inputs + seed → same full-state hash across two runs; journal replay reproduces it | `crates/jj-sim/tests/determinism.rs`: two cars, a scripted 5 s of throttle/steer/brake on the greybox, two runs hash alike (and another seed doesn't); the journal round-tripped through its postcard bytes replays to the identical hash |
| A Rapier 0.36 API fixture pins update_vehicle before step, brake vs engine-force units, a sleeping chassis waking on control input, per-wheel state access, disabling one wheel | `crates/jj-sim/tests/rapier_api.rs` (6 tests; findings in `docs/learnings/sim.md`): engine force integrates with dt, brake is an impulse per tick (1.6 m/s/s exactly) and is ignored per wheel under engine force, only positive engine force wakes a sleeping chassis, update_vehicle pumps velocity into a sleeping chassis (so jj-sim's chassis never sleep), per-wheel raycast state, and disabling a wheel by zeroing its suspension force and grip |
| The static determinism scan rejects wall clock / unseeded random in sim code, shown failing on an injected case | `crates/jj-sim/tests/determinism_scan.rs`: no `SystemTime`, `Instant::now`, `std::time`, `thread_rng`, `rand::random`, `OsRng`, `getrandom`, `HashMap`/`HashSet` in `crates/jj-sim/src`; `the_scan_catches_injected_cases` |
| `jj-sim` passes `cargo check --target wasm32-unknown-unknown` | `local-checks.txt` |

Native vs WASM physics identity is a measured claim for S02 (the worker) and S03; S01 checks the build. The map's canonical
bytes are already proven identical (P1-M01).
