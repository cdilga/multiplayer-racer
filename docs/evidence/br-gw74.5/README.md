# br-gw74.5 (R121): damage is free until a wheel comes off; a lost wheel gets you a new car

## Change
- `loose_wheel_grip_loss` 0.15 → 0 (profile data): loose parts, wheels included, cost no grip, power or steering. Loose
  doors, bonnet and boot never had a performance effect (their hinge springs are visual).
- New `damage.wheel_loss_respawn_s` (2.0 s, the same as the respawn hold): the first detached wheel starts the grace;
  the car drives on, then is wrecked (husk and debris stay dynamic in the world, R86) and respawns fresh at its anchor
  with its race state, exactly as P1-S04c's wreck. Amends P1-S04c's "two wheels = wrecked".

## Tests
- `crates/jj-sim/tests/wreck.rs`
  - `a_car_with_every_part_loose_laps_as_fast_as_an_intact_one`: every part just under its loose threshold, one
    autopilot lap of the greybox on seeds 5 and 6, within 1 % of the intact car, never wrecked.
  - `a_lost_wheel_wrecks_the_car_after_its_grace_and_it_respawns_at_its_anchor` (was the two-wheel test): one wheel
    off, no wreck 2 ticks before the grace ends, a wreck just after; husk where the car was, every part debris, the
    player held at their anchor on a fresh intact car with the same id.
- `scenarios/affordances/two-wheels-off.json` (name kept: the plan's row): one wheel off at 0.5 s; at 2 s the car is
  still moving (10.1 m/s), upright and unwrecked; then one wreck, one husk, a fresh car that drives off its anchor after
  the hold (baselines differ).
- `scenarios/damage/fixtures/detach-energy.json`: ends at tick 500, inside the grace, so the energy ledger checks only
  the detach kicks.
- Host: `a_wreck_leaves_a_husk_and_its_parts_as_pieces_in_the_snapshot_and_a_wrecked_event` waits out the grace.
- All `jj sim` scenarios and the jj-sim, jj-procgen (handling bank), jj-fixture, jj-tools, jj-wasm-host and jj-session
  tests pass.

## Not covered
- A HUD or announcer cue for "wheel gone, new car coming" isn't in this bead's acceptance; the existing Wrecked event
  drives the current wreck cue.
