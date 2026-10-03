# P1-F05a: `jj sim`, the native introspection surface

Date 2026-10-03, GentlePike. Bead `br-p1-f05a-3s6`. Closes on green Gitea CI (`ev:ci`). Commits:

- **A** `484ef03`: `jj sim`, observation, placement, trace and compare.
- **B** `ca49ed6`: trace rows carry `events`.
- **C** `e90913e`: compare lists every differing key at its first tick.

## What exists

There is one mechanism. S01's scenario runner became `jj sim`, `jj scenario` is gone, and the bank (`scenarios/*.json`)
runs through `jj sim` in `crates/jj-tools/tests/scenarios.rs`. A fixture is S01's scenario format plus the fields below.
Every capability goes through the real reducers or journaled sim commands:

| R90 / §13a | How |
|---|---|
| **See** | Per car: pose, velocities, speed, heading, route progress (distance, fraction, route point, lateral offset), the inputs applied, and per-wheel contact, suspension, impulses and slip angle (`jj_sim::observe`). Per seat: number, colour, name, presence, connected, car binding, Ready. Also the director's phase, round, timer and driving mode. Recorded at the fixture's `observe` ticks and at the end. |
| **Set up** | `cars` on a route point or at a pose with a velocity; `seats` claimed through the seat reducer (Hello, Claim, tick); `phase` reached through the director's own inputs (Start now, map ready, Start now again, …); `place` teleports mid-run through the new journaled `Setup::PlaceCar`. |
| **Step** | `ticks`, or stop early on an `until` predicate. Inputs are applied-tick spans. |
| **Replay** | Every run replays its own journal from bytes and reports `replayHash` and `replayMatches`; a mismatch fails the run. `tests/determinism.rs::placing_a_car_is_journaled_so_the_run_still_replays` covers placement. |
| **Assert** | `expect` envelopes on the outcome signature (§13b.1): state now (`speed`, `upY`, `travel`, …) and accumulators (`maxSpeed`, `maxYawRateDegS`, `maxSlipDeg`, `airtimeS`, `minUpY`, `progressM`). A failure prints what was observed against the envelope and the whole signature, then exits 1. |
| **Trace / compare** | `--trace` writes one JSON row per tick (cars, wheels, inputs, `events`: the journal's setup commands and input changes since the last row) and a summary row (state hash, signature). `--compare` prints ACCEPTED \| CURRENT \| TUNED: summary keys, then every per-tick key at the first tick it differs. `--set field=value` tunes the vehicle profile for the TUNED run. |

Every run writes `target/jj-runs/sim-<scenario>/` (`outcome.json`, `journal.bin`, `trace.jsonl`). `jj sim --help` has
worked examples. Exits: 0 pass, 1 an envelope failed or the replay differed, 2 usage or I/O.

## Acceptance → evidence

| AC | Test (CI) | Evidence here |
|---|---|---|
| With no browser: greybox, three cars, three seats, 600 ticks, read every car's pose/speed/progress and every seat's state as JSON, replay to the same full-state hash | `crates/jj-tools/tests/sim_cli.rs::an_agent_sets_up_three_cars_and_seats_steps_600_ticks_reads_json_and_replays` (fixture `tests/fixtures/sim/three-seats.json`) | `transcript.txt` (state hash = replay hash `512ba1ef…`) and the full `three-seats.json` |
| A failing fixture prints what it observed against its outcome signature and exits non-zero | `a_failing_fixture_prints_what_it_observed_against_its_signature_and_exits_1` (`failing-envelope.json`) | the end of `transcript.txt` (`exit 1`) |
| `jj sim --trace` of `straight-throttle` on two commits feeds `jj sim --compare`, which shows the differing keys in an ACCEPTED \| CURRENT \| TUNED table | `trace_feeds_compare_which_shows_the_differing_keys` (one build in CI: CURRENT against a `--set` TUNED run, plus the identical case) | `compare-table.txt` and `compare.json`: commit A's trace as ACCEPTED, commit B's as CURRENT, commit B with `max_engine_force=3000` as TUNED |

### Reading the compare table

- **A → B.** The dynamics are identical: the state hash `bd515c3b…` is the same and no car key differs. The only
  differing keys are B's new `events` (the spawn at tick 0, the throttle input at tick 1), which is exactly what changed
  between the two commits.
- **TUNED.** The engine change shows first in the driven rear wheels' `forwardImpulse` at tick 2 (29.17 → 12.50 N·s),
  then in every dynamic key. The signature ends at 9.9 m/s instead of 23.0 m/s, with 34 m of progress instead of 79 m.

A CI job builds one commit, so the CI test can't trace two commits. The cross-commit comparison is this evidence, from
binaries built at A and B (Mac arm64, `cargo build -p jj-tools`; jj-sim and jj-tools clean at each commit). Trace
SHA-256 values are in `compare-table.txt`.

## Runs

```
$ cargo test -p jj-tools -p jj-sim                   (Mac)      all pass
$ rch exec -- cargo clippy --locked --all-targets --no-deps -p jj-sim -p jj-tools -- -D warnings   exit 0
$ rch exec -- cargo test --locked -p jj-sim -p jj-tools                                             all pass
$ rch exec -- cargo check --locked --target wasm32-unknown-unknown -p jj-wasm-host -p jj-sim        exit 0
```

## Known gaps (later beads)

- Part states and sim events (contacts, detaches, landings) join the trace rows and `events` when damage lands (S04*).
- `--sweep` (S03) and `--replay` of bug clips (F07).
- The browser surface (F05b) reuses `jj_sim::observe`'s shapes.
- There is no owner-accepted baseline yet. ACCEPTED becomes a committed trace after the first accepted playtest (§13.4).
