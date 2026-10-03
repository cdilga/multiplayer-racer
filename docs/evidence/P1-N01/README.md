# P1-N01 evidence: `jj-types` + `jj-protocol` v1

`test-output.txt`: `RCH_REQUIRE_REMOTE=1 rch exec -- cargo test --locked --no-fail-fast -p jj-types -p jj-protocol` on the
RCH worker eris (Arch x86_64, rustc 1.99.0), 2026-10-03: 15 + 10 tests pass. The same commit also passes
`cargo clippy --all-targets -p jj-types -p jj-protocol -- -D warnings` (eris), `cargo check --target wasm32-unknown-unknown
-p jj-protocol -p jj-types` (eris) and `scripts/ci/deny.sh` (Mac: advisories, bans, licences, sources ok). CI on Gitea runs
the workspace lanes on the commit.

| Acceptance | Test |
|---|---|
| Golden byte vectors for every message; the test fails if any encoding changes | `tests::goldens_match_the_committed_bytes` (60 files in `crates/jj-protocol/goldens/`: state 4, cmd 22, abi 18, signal 16; fails on a changed, missing or orphaned golden) and `tests::every_variant_has_a_golden` (every `ControllerCmd`, `HostCmd`, `MainToSim`, `SimToMain`, `UiCommand` and `SimEvent` variant) |
| Round-trip properties for every message type; fuzzed decoders never panic | `tests::every_message_round_trips` (2,000 generated cases per run, every message type incl. the 14 signalling bodies), `tests::decoders_never_panic_on_any_bytes`, `tests::decoders_never_panic_on_damaged_goldens` (truncated or byte-flipped goldens), `tests::decoders_reject_wrong_versions_and_trailing_bytes` |
| Neutral, full-range and threshold values survive quantisation | `axis::tests::neutral_and_full_range_are_exact`, `axis::tests::thresholds_survive_quantisation` (0.08 … 0.9, both signs, ±2 LSB), properties `round_trip_error_is_half_a_step`, `quantisation_is_monotonic`, `any_threshold_agrees_with_the_float_comparison_off_its_step` |
| Every record survives splitting by the byte target and by >255 sources | `tests::splitting_by_the_byte_target` (200 records → 76 + 76 + 48 at the 1,000-byte target), `tests::splitting_more_than_255_sources` (600 → 255 + 255 + 90; an unsplit batch refuses to encode rather than truncate), property `every_record_survives_splitting` (0–2,000 records, any target, any rotation: each record exactly once, in rotated order) |
| The Ping/Pong offset estimator recovers a known offset within its stated uncertainty | `clock::tests::recovers_a_known_offset_within_its_uncertainty`, `one_way_samples_bound_the_offset_too`, `the_window_lets_old_tight_samples_go`, properties `the_true_offset_is_always_inside_the_bound` and `one_way_bound_holds_for_any_delay_inside_the_round_trip` |

Design notes the bead left open, decided here:

- **Byte order:** little-endian for the state channel's fixed fields.
- **Lossless codec:** axes are carried as sent, `−32768` included; `jj_types::axis::sanitise_axis` is the reader's job, so
  goldens and round trips stay exact.
- **Thresholds compare in quantised units** (`AxisThreshold`): a float round trip can land half a step under a threshold
  (0.15 → 4915 → 0.149998), so controller and host compare integers and always decide alike.
- **The host's clock offset:** the plan has the host keep the estimate, but only the pinging controller sees a full
  Ping→Pong round trip. The estimator takes either a round trip (`add_round_trip`) or a one-way stamp plus a known RTT
  (`add_one_way`; the host has WebRTC's `currentRoundTripTime`), and both give the same ±RTT/2 bound. N06 picks the feed.
- **`SignalMessage.gen`** is `generation` in Rust (`gen` is reserved in edition 2024) and still `gen` on the wire.
- **Room codes:** `RoomCode::parse` enforces the plan's alphabet. The U02/U03 mocks show `ROO7`, which contains `O` and so
  can never be a real code (noted for the design review).
