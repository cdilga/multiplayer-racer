# P1-S05: race rules and recovery

Date 2026-10-03, GentlePike. Bead `br-p1-s05-s4b`. Closes on green Gitea CI (`ev:ci`).

`crates/jj-sim/src/race/` holds the rules as pure logic over each car's state after a tick. `Sim` applies the
effects, so the rules are testable without physics and every outcome replays:

- **Respawn.** Teleport to the anchor and hold the controls for 2 s.
- **Ghost.** A finished car's collider only touches the world, and its wheel rays ignore racers.
- **Flip-assist torque.** Applied as an impulse once per tick.

New journaled commands: `StartRace { laps }`, `Recover { car }`, and `PlaceCar` gains a roll. `jj sim` fixtures can
use `race`, `recover` and `pose.rollDeg`. Observations carry each car's race state. Signatures have `gatesPassed`,
`lapsCompleted`, `legalProgressM`, `wrecks`, `recoveries` and `finished`. Trace rows list race events.

| Rule (plan §7.4–§7.5) | Implementation |
|---|---|
| Gates in order | Only the next expected gate counts: forward through its line, within the road's half-width + 2 m. Placements and respawns never cross. The first finish crossing is the start; each later one completes a lap. |
| Legal progress | Route distance at the last gate, plus a projection onto the route between that gate and the next only (clamped), never the nearest point of the whole spline. |
| Anchor | The last gate passed, on the centerline facing along the route (the spawn pose before any gate). |
| Flip assist | Up·Y < 0.2 and < 2 m/s for 1 s starts a PD self-righting torque. Not righted 3 s later means wrecked. |
| Recover | After 1 s under 3 m/s, or inverted. Respawns at the anchor with a 2 s hold. |
| Out of bounds | Below the kill height or outside the map bounds: wrecked, then respawned at the anchor. |
| Race end | `laps` (default 3). The first finisher opens a 30 s window. Deadline `max(180 s, 2 × laps × refLap)` after the start. Finished cars are ghosts. Standings: finished by finish tick, then by legal progress. |

## Acceptance → tests

| AC | Test |
|---|---|
| OOB always recovers (0.1's oob-recovery spec, re-expressed) | `tests/race.rs::out_of_bounds_always_recovers`: six throws in a row (past each edge, under the kill plane, flung off at 40 m/s); each is respawned at the anchor, upright on four wheels, in bounds, with no progress gained. Also the `oob-recover` row. |
| A flip from 12 inverted poses rights itself or is wrecked within 4 s of coming to rest | `a_flip_from_12_inverted_poses_rights_itself_or_is_wrecked_within_4_s_of_rest` (each pose in its own sim). The table below is the same poses side by side through `jj sim --trace`. |
| A shortcut across the infield doesn't count progress | `a_shortcut_across_the_infield_doesnt_count_progress`. After the start line, the car drives from x = 110 up the infield, across the back straight between later gates, to z > 40: `gatesPassed` stays 1 and legal progress stays inside the first 40 m stretch. A nearest-point projection would have credited about 100 m more. |
| The first finisher opens the 30 s window; an all-stuck race ends at `max(180 s, 2 × laps × refLap)` | `the_first_finisher_opens_the_30_s_window` (the race ends at finish + 3,600 ticks, reason `Window`; standings finisher first); `an_all_stuck_race_ends_at_the_deadline` (3 laps → 240 s on the greybox's 40 s refLap; 1 lap → the 180 s floor) |
| The §7.3a `flip-recover` and `oob-recover` rows pass | `scenarios/affordances/{flip-recover,oob-recover}.json` in the bank (`crates/jj-tools/tests/scenarios.rs`); output in `scenarios.txt` |

Also: `finished_cars_are_ghosts_to_racers` (a racer dropped onto a parked finished car falls through it to the road),
`recover_needs_a_slow_or_inverted_car_and_holds_it_for_2_s`, and
`a_race_with_commands_replays_to_the_same_hash` (start, a placement and a Recover replay to the same hash and the
same race events).

## The 12 inverted poses (`jj sim --trace`, 50 m apart on the greybox; ticks at 120 Hz)

| roll° | yaw° | came to rest (tick) | assist started | resolved | from rest |
|---|---|---|---|---|---|
| 180 | 0 | 56 | 175 | righted at 309 | 2.11 s |
| 170 | 0 | 60 | 179 | righted at 313 | 2.11 s |
| -170 | 0 | 60 | 179 | righted at 313 | 2.11 s |
| 150 | 0 | 75 | 194 | righted at 327 | 2.10 s |
| -150 | 0 | 74 | 193 | righted at 326 | 2.10 s |
| 135 | 0 | 95 | 214 | righted at 348 | 2.11 s |
| -135 | 0 | 95 | 214 | righted at 347 | 2.10 s |
| 90 | 0 | 40 | 159 | righted at 286 | 2.05 s |
| -90 | 0 | 40 | 159 | righted at 287 | 2.06 s |
| 180 | 90 | 56 | 175 | righted at 308 | 2.10 s |
| 180 | 45 | 56 | 175 | righted at 307 | 2.09 s |
| 120 | -30 | 148 | 267 | righted at 400 | 2.10 s |

All twelve are righted by the assist (none needed the wreck path), each about 1.1 s after it starts. The wreck path is
covered by the rule's timer and by `oob-recover`.

## Runs

```
$ rch exec -- cargo clippy --locked --all-targets --no-deps -p jj-sim -p jj-tools -- -D warnings   exit 0
$ rch exec -- cargo test --locked -p jj-sim -p jj-tools                                             all pass (race: 8)
$ rch exec -- cargo check --locked --target wasm32-unknown-unknown -p jj-wasm-host -p jj-sim        exit 0
$ jj sim scenarios/affordances/flip-recover.json scenarios/affordances/oob-recover.json             pass (scenarios.txt)
```

## Known gaps (other beads)

- A clear respawn pose against other cars, and spawn protection: the placement service (S06). Respawns land on the
  anchor as is.
- Finished cars coasting on autopilot: S07. They're ghosted now, but keep their controller's inputs.
- Wreck husks and debris: S04c. Until then a wreck respawns like Recover.
- The flip-assist gains are provisional, tuned in S03 with the rest of the feel bank.
