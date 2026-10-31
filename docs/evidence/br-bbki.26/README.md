# br-bbki.26: handling pass (owner 2026-10-30/31)

Owner direction: (1) turning in the air is too aggressive, (2) high-speed steering should be more forceful and easier,
(3) two-wheel-drive cars still understeer and cannot drift into a corner. All numbers are on the shipped default
(`assets/profiles/*.json`), measured by `crates/jj-sim/tests/handling_bbki26.rs` on the flat skidpad
(`JJ_EVIDENCE_DIR=… cargo test --release -p jj-sim --test handling_bbki26`). Raw tables: `before/` (turn-in only; the
entry slide did not exist) and `after/` (`handling-bbki26.json`, `air-bbki26.json`, `arcade-bank.json`).

## What changed

Code (`crates/jj-sim/src/vehicle/arcade.rs`): a **corner-entry slide** for every arcade car, whatever it drives. A
lift-off (throttle from >= `entry_lift_from` to < `entry_lift_to` within `entry_window_s`) or a brake >= `entry_brake`,
with >= `entry_steer` of stick at >= `entry_min_mps`, sets the slide. While the stick stays past 0.2 (and is not against
the slide) it holds at `entry_angle_deg` x stick with `entry_grip` of the grip left, closing on the angle at
`entry_hold_per_s`. Centring or countersteering catches it (existing catch rules), as does dropping under
`entry_exit_mps`. State: `since_high`, `entry`. The existing throttle-punch power slide is untouched. Every number is
in the `arcade` block of each car (all new fields are required keys: cruz-missile, tradie-ute, hawk-dash,
lion-president, au-hawk). The two bikes (pig-catcher, postie-bike) are on Rapier's tyres, not the arcade controller, and
are unchanged.

Data:

| field | cruz | ute | hawk-dash / lion / au-hawk |
|---|---|---|---|
| turn_g (before -> after) | 3.8 -> 5.4 | 2.7 -> 3.1 | 3.3 -> 5.2 |
| yaw_max_deg_s | 100 -> 130 | 88 -> 100 | 95 -> 125 |
| grip_g | 4.2 -> 6.2 | 3.1 -> 3.5 | 3.7 -> 6.0 |
| turn_in_s | 0.08 -> 0.06 | 0.14 -> 0.095 | 0.10 -> 0.06 |
| steer_falloff_mps (tuning) | 18 -> 24 | 22 -> 28 | 20 -> 26 |
| slide_grip | 0.35 (same) | 0.3 -> 0.27 (keeps the absolute slide grip) | 0.3 (same) |
| entry_* | slide 1, steer 0.6, min 12 m/s, exit 8 m/s, brake 0.25, lift 0.3 -> 0.15 in 0.5 s, grip 0.9 (ute 0.7), angle 36 deg, hold 9/s | same | same |

`assets/profiles/air.json` (one set for every car): `yawRateDps` 90 -> 50, `pitchRateDps` 100 -> 75, `responseS`
0.08 -> 0.14. (Pitch stays at 75 because `air::tests::the_shipped_profile_is_valid_and_corrects_30_degrees_within_0_4_s`
pins 30 deg in 0.4 s; yaw, the owner's main complaint, drops 44 %.)

## Numbers

Full steer from straight, yaw rate 0.3 s later (deg/s) at 20 / 30 / 35 m/s (before -> after):

| car | 20 | 30 | 35 |
|---|---|---|---|
| cruz-missile (FWD) | 89.7 -> 119.0 | 62.7 -> 91.0 | 53.4 -> 77.6 |
| tradie-ute (RWD) | 60.1 -> 75.1 | 40.0 -> 50.2 | 34.2 -> 42.9 |
| hawk-dash | 79.6 -> 113.6 | 53.3 -> 88.6 | 45.6 -> 75.9 |
| lion-president | 79.6 -> 115.2 | 53.3 -> 88.6 | 45.6 -> 75.9 |
| au-hawk | 79.5 -> 113.2 | 53.1 -> 88.3 | 45.3 -> 75.4 |

Before, the car reached only 93 % (cruz) down to 83 % (ute) of the rate the stick asks within 0.3 s; after, every car is
within 10 % of `Arcade::grip_yaw` x load shift (the test asserts it at 20 and 30 m/s). Cruz turn-in at 30 m/s is +45 %,
the hawks +66 %, the ute +25 %. The ute got the smallest lift because a bigger one breaks
`scenarios/assist/over-driven.json` (its power slide under the Some assist, see below); revisit with that fixture.

Corner entry at 25 m/s, full steer held, lift-off (brake pulse 0.6 for 0.5 s in brackets), after only (before: no car
ever reached 20 deg):

| car | to 20 deg (s) | holds (deg) | caught < 5 deg after countersteer pulse (s) |
|---|---|---|---|
| cruz-missile | 0.46 (0.50) | 20.5-27.1 (18.4-24.4) | 0.17 (0.14) |
| tradie-ute | 0.41 (0.42) | 20.6-31.7 (20.3-30.2) | 0.26 (0.23) |
| hawk-dash | 0.51 (0.58) | 20.0-26.9 (18.9-24.0) | 0.19 (0.16) |
| lion-president | 0.51 (0.57) | 20.2-27.1 (19.2-24.3) | 0.19 (0.17) |
| au-hawk | 0.52 (0.58) | 20.5-26.9 (18.8-24.0) | 0.28 (0.28) |

"Hold" is the body slip (heading vs travel) from reaching 20 deg until 1.8 s of held steer. "Countersteer" is full
opposite lock for 0.2 s then centred (a held full countersteer is a new turn the other way, whose pivot slip stays
about 10 deg by itself). The lowest up-y over every run is 0.9996 (R122: no dives or roll-overs).

Air (thrown up from 30 m, stick neutral 0.4 s then held, peak body rate within 0.6 s), every car: yaw 84.6 -> 44.6
deg/s (cruz; the other cars within 0.5), pitch 94.0 -> 66.9 deg/s (the 0.6 s window is shorter than the ramp to 75).

## Tests

New: `crates/jj-sim/tests/handling_bbki26.rs`
(`full_steer_turns_the_car_promptly_and_a_lift_or_brake_sets_a_held_catchable_entry_slide`,
`air_control_turns_the_car_in_flight_gently`).

Re-baselined (more steering authority is the point; each moved the way the change predicts):
- `scenarios/feel/surface-corner.json`: tarmac heading change 104 -> 134 deg, slip 5.7 -> 9.6, dirt 70 -> 100, gravel
  59 -> 86; bands now +-3 % of the new values. Off-track car starts at z -24 (was -34): turning harder it left the map
  and respawned inside the run (speed 0).
- `scenarios/feel/surface-deltas.json`: heading changes 85/80/70/63 -> 98/93/82/76 (same ordering, dirt still turns less).
- `scenarios/affordances/authority.json`: 30 m/s car heading change in 0.5 s now 25 deg (max 22 -> 29); the 30 m/s
  authority being higher is the point of the pass.
- `scenarios/affordances/rejoin-route.json`: route offset after the fixed rejoin script 5.65 m (max 5 -> 6.5): the
  scripted legs were timed for the old understeering car (the road is 7 m half-width, so it is still back on it).
- `scenarios/affordances/boost-line.json`: grid car's progress 557 m (band 475-525 -> 507-582): the autopilot, with the
  entry slide, keeps more speed through the bends.

## Left unmet / for the coordinator

`assist` tests I may not edit (files outside my allowed list) still fail, both fragile rather than a feel regression:
- `assists_never_fight_a_full_lock_input` (tests/assist.rs:243): the slide catch in `src/assist.rs` blends the steer
  toward `-(drift / fullDeg)` even when the player is already countersteering harder (e.g. lock -1 with drift +9.9 gives
  -0.967). Suggested fix: apply the catch only when the player's steer is less counter than the catch's. Triggers now
  because stronger turning produces more transient drift readings after wall hits.
- `a_scripted_novice_laps_with_lots_and_some_and_crashes_more_with_off`: Off crashes 39 vs the fixture's
  `offMinCrashesOverSome` 40 (Some 0, Lots 0, all six finish; novice with Some/Lots is caught, 0 crashes). Suggested:
  `scenarios/assist/novice-laps.json` `offMinCrashesOverSome` 40 -> 35.
The bikes' (Rapier) steering falloff was not changed. The ute's high-speed lift is modest (+25 %) because of
`scenarios/assist/over-driven.json` (its Some-level slip max rises past 45 with a stronger ute). The preview publish
and TV self-review captures in the bead's last acceptance line are not part of this helper's work.

## Fix forward after CI 11651 (2026-10-31)

- **AU Hawk:** `turn_g` 5.2 -> 4.6, `steer_falloff_mps` 26 -> 22. At 5.2 its body touched the road holding a
  25 m/s turn (R122 bank `a_car_thrown_about_on_generated_roads_never_dives_or_rolls_over_au_hawk`: 3 dives, clearance
  -5 to -9 mm on seeds 3/5/6). 4.6/22 gives 0 dives over 549 runs. It is still +39 % over the AU Hawk's old 3.3.
- **Air pitch restored:** `pitchRateDps` 75 -> 100 and `responseS` 0.14 -> 0.08. The owner asked about *turning*
  in the air, so only yaw stays reduced (90 -> 50 deg/s). At 75 deg/s a pinned stick could no longer over-rotate a
  leap into a bad landing (`skill_jump.rs`: Ok where Bad was asked), and the stick must still decide the landing.
