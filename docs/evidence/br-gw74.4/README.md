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

## Not yet (br-gw74.4.1)
- A drifted corner beating grip: at 20 m/s the drift scrubs more speed than its exit boost returns (grip 55 m, drift
  19 m along the new heading 4 s in at rear grip 0.31; 38 m at 0.5; 48 m at 0.55). A tuning job for the couch with the
  tuning menu, measured by drift_r120.rs.
- The countersteer-held 3 s yaw bound and the cue's visual self-review.
