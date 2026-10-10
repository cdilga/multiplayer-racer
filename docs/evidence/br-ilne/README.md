# br-ilne (R125): respawn placement

## Change (crates/jj-sim)
- **Anchors** (`race::Course::new`): a gate's anchor is the nearest route point at or behind it inside a recovery span
  (`route.recovery`: the map leaves jump flights and landings out, and later hazards such as loops and bridge ramps
  will cut their own) with `ANCHOR_CLEAR_M` = 15 m of span ahead. Before this, anchors were the gate's point whatever
  lay there, and recovery spans weren't read at all.
- **Hold** `RESPAWN_HOLD_TICKS` 2 s → 1 s (R125 supersedes R20's 2 s standing hold).
- **Rolling start**: when the hold ends the race emits `Effect::Roll`; the car is given `RESPAWN_ROLL_FRACTION` (0.6) of
  the autopilot's planned speed there (`autopilot::Path::planned_speed`, the curvature within its braking horizon)
  along its heading, through `teleport` so the energy ledger books it as setup, and its spawn protection (ghosted, no
  car contact) starts again: `PROTECT_TICKS` = 1.5 s.
- Placement of simultaneous respawns stays the placement service's clear-pose search (a lane over, or 6 m steps along).
- One path: every respawn kind (Recover, out of bounds, stuck flip, wheel loss; a missed jump is one of those) goes
  through `Race::respawn` → `Effect::Respawn` → hold → `Effect::Roll`.

## Tests
- `crates/jj-procgen/tests/respawn.rs` (generated seeds, every biome with their jumps and crests):
  - `every_anchor_is_on_the_road_before_any_hazard_and_faces_along_it` (seeds 1-8, every gate): on the centreline,
    within 5° of the route tangent, 15 m of recovery span ahead, never ahead of its gate.
  - `a_respawn_holds_then_rolls_off_and_two_at_once_never_overlap` (seeds 1, 4, 7): two cars thrown out of bounds on
    the same tick respawn apart (a lane over), held upright at rest, then roll off within the planned band, protected.
- `crates/jj-sim/tests/race.rs`, `wreck.rs`: the hold freezes controls, then the car rolls off; out-of-bounds checks the
  anchor during the hold and that the rolled-off car stays in bounds.
- Scenarios `oob-recover` (at the anchor at tick 200, during the hold; rolled off by the end) and `two-wheels-off`.
- All crate tests and `jj sim` scenarios pass; clippy clean.

## Not covered
- Feel of the 1 s hold and the 60 % roll: the couch test (both are constants here, ready to move into profile data if
  the owner wants them in the tuning menu).
