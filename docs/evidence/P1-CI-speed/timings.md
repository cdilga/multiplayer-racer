# br-15gd (P1-CI-speed): where CI time goes, and what moved it

## Before (CI run 5598, commit 3ca8683d, 2026-10-17)

Rust tests ran at opt-level 0 (deps included). The slowest tests, all `jj-procgen` seed banks driving Rapier, wall time on
the rust-test shards:

| s | test |
|---|---|
| 593 | bank::the_autopilot_laps_a_sample_of_every_mix_and_length_class |
| 572 | handling::a_car_thrown_about_…_tradie_ute (and 500-545 s for each of the other five vehicles) |
| 557 | crossings::bots_lap_both_levels_without_recovery_and_replay_exactly |
| 542 | crossings::generated_crossing_bank_validates_without_flattening_or_discarding_the_family |
| 502 | jumps::players_at_full_throttle_land_every_jump_line_and_road_wide |
| 461 | presets::each_preset_autopilot_laps_each_biome_across_seeds_and_replays |
| 401-412 | stations, playtest, setpieces (x2), jumps, relief |

25 tests over 230 s; the browser lanes add ~7400 slot-seconds (`scripts/ci/durations.json`, clips.test.mjs 703 s).

## Change 1: optimised test builds (`.cargo/config.toml`)

`[profile.dev] opt-level = 1`, `[profile.dev.package."*"] opt-level = 3`. Debug assertions and overflow checks stay on.

Measured on rch, the same test, same commit:

| build | `cargo test -p jj-procgen --test handling hawk_dash` |
|---|---|
| opt-level 0 (before) | 707.35 s |
| deps 3, ours 1 (after) | 39.70 s (60 s wall incl. the incremental rebuild) |

18x on the test itself. `cargo test -p jj-sim -p jj-map` at the new profile: every binary passes (replay bit-for-bit
tests included), slowest binary 34.9 s.

## Next

Per-lane before/after from the first CI run with change 1; then the browser lanes (step the sim instead of waiting real
time, shard by `durations.json`).
