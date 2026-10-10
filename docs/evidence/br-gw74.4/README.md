# br-gw74.4 (R120): drift at full side lock, countersteer, the drift-exit boost — progress

## In
- **Entry** (`assets/profiles/input.json`): a drift needs the left stick at 70° off vertical and 0.9 deflection (was 35°
  and 0.6), releasing below 58° or 0.75. jj-input tests rewritten to the new numbers, plus
  `r120_a_natural_lean_at_full_throttle_never_drifts_and_full_side_lock_does` (0-60° at full throttle never drifts).
- **Drift-exit boost** (`crates/jj-sim/src/vehicle`): a held drift (the rear sliding at least `drift_exit_min_slip_deg`
  4° at speed) banks time; letting the handbrake go after `drift_exit_min_s` 0.25 s fires a boost of
  `drift_exit_boost_per_s` 0.5 s per second held, up to `drift_exit_boost_max_s` 1.2 s. It is boost (same drive, flame
  and sound) but free: it never drains the meter. Unit test `letting_go_of_a_held_drift_fires_a_free_exit_boost`.
- **Countersteer**: the right stick's steering; `crates/jj-sim/tests/drift_r120.rs` drives a 90° turn from 20 m/s on
  a flat tarmac lot with a player-like heading-seeking steer: the drift makes the corner and fires its exit boost;
  full lock with the handbrake and no countersteer spins (129°, 7 m along vs grip's 55 m).
- Tutorial and TV prompt copy: "all the way to the side, steer against the slide, then let go".

## Tuned (br-gw74.4.1)
`crates/jj-sim/tests/drift_r120.rs`, a 90° turn from 20 m/s on the flat tarmac lot, 4 s in, metres along the new heading:
**grip 53.7, drift 59.7 (+6.0), no countersteer 8.1 (127°, spins)**. The test asserts drift >= grip + 3 m, the exit boost
fired, and the spin. Before: grip 55.4, drift 19.2.

Root causes found, not just numbers:
- **The exit boost was wasted.** It fired the instant the handbrake let go, while the rear was still sliding sideways;
  Rapier's friction circle gives all the tyre's grip to the side force, so the extra drive did nothing (a boost gain of
  3.0 changed the result by 0.1 m). Now the banked boost waits (`exit_boost_wait`) until the drift blend is back under
  half and the rear slips under `drift_exit_min_slip_deg`, then burns for its full time.
- **The test driver spun the car out.** It steered on heading error alone and let go of the handbrake at 25° from the new
  heading, with the nose still swinging at about 130°/s: a spin and a recovery, not a drift. It now eases the steer by
  the yaw rate (`YAW_DAMP` 0.4) and looks ahead at the yaw rate when releasing (`RELEASE_LEAD_S` 0.2), as a player does.

Profile values (`assets/profiles/cruz-missile.json`):

| key | old | new |
|---|---|---|
| `drift_rear_grip` | 0.31 | 0.37 |
| `drift_recovery_s` | 0.4 | 0.15 |
| `drift_exit_boost_per_s` | 0.5 | 2.0 |
| `drift_exit_boost_max_s` | 1.2 | 3.0 |
| `drift_exit_boost_gain` (new; the exit burst's extra drive, 0 = the meter boost's `boost_engine_gain` 0.6) | - | 2.5 |

0.37 is the loosest rear that keeps the feel bank's `drift-entry-exit` envelope (max rear slip 25 to 60°; 0.38 gives
23.9°, 0.40 gives 21.5°). Entering a drift at 0.45 or more made the corner but gave no real slide.

Countersteer fixture (AC3), `holding_countersteer_keeps_the_yaw_rate_bounded_through_a_three_second_drift`: a 3 s
handbrake drift from 20 m/s with the driver holding 1.0 rad/s of yaw by countersteer: max yaw 1.68 rad/s, rear slip
57°, nose within 41° of travel, 9.7 m/s left. The same drift with the wheel held at lock: 2.80 rad/s, 122° (a spin),
2.0 m/s.

Envelopes changed: `scenarios/duels/orderings/drift-straight-penalty.json`, `plain` beats `drift-*` by 0.005 s (was
0.016 s). The straight drift is still strictly slower (short 8 ms, long 17 ms at 150 m), but the drift now holds the
slide through that wiggle script instead of spinning out of it (the old drift-short was a DNF), so the penalty is
smaller. No other duel or feel envelope moved; `drift-corner-duel` and `drift-boost-chain` orderings hold as they were.

## Bank format and what's left
`drift_r120.rs` is a closed-loop Rust test (the driver reads the car's heading and yaw), not a scenario-bank fixture:
the bank (`scenarios/**/*.json`, run by `tests/duels.rs` and `tests/feel.rs`) replays open-loop per-tick inputs with
progress gates and ordering files, which can't steer a corner by heading. `drift-corner-duel` is the bank's corner
(scripted hairpin: well vs plain vs exit-boost). The test is deterministic (libm, fixed ticks). A banked open-loop
R120 corner could be recorded from `drift_r120.rs`'s inputs; not done.
- The cue's visual self-review and the owner's couch verdict on the drift (G-FEEL) are open.
