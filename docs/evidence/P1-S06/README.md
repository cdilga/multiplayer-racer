# P1-S06: placement service and drop-in

Date 2026-10-03, GentlePike. Bead `br-p1-s06-dg4`. Closes on green Gitea CI (`ev:ci`).

One placement service serves start grids, respawns and drop-in, for any number of cars, with no cap, queue or refusal
(`crates/jj-sim/src/placement/`, wired into `Sim`):

- **Start grid.** `Sim::spawn_grid(n)` fills the map's start corridor: rows `rowSpacing` apart back along the route
  from the finish line, columns across its width, following the route through bends. Once the corridor is full,
  further cars go into it anyway. Each overflow layer follows Roberts' R2 low-discrepancy sequence, 1–7 m behind its
  slot and up to 1.2 m to the side, so no two poses coincide and none lands on player 1's spawn. `grid_pose(k)` is
  defined for every `k`.
- **Spawn protection (1.5 s).** Every spawn, respawn and drop-in starts protected.
  - Protected cars are ghosted against cars and debris, and so are their wheel rays. Terrain and barriers stay solid.
  - Protection ends only when the car overlaps no solid car and no debris. A protected car overlapping a lower-id
    protected car waits for it, so overlaps always resolve.
  - Protected cars take input from the first tick.
- **Pose search.** Respawns and drop-ins try the target pose, then steps back along it (6 m, up to 10) and ±3.5 m to the
  side. If nothing is clear, the car takes the target anyway under protection: immediately controllable, never
  refused.
- **Respawns** (S05's Recover, flip and out-of-bounds wrecks) now go through the pose search near the seat's own
  anchor, then protection.
- **Drop-in (R63, a journaled command).**
  - The target is where the last still-racing car was 3 s ago, from a 10 Hz history of its legal progress. It's at
    least 12 m behind that car, so a stopped last racer still leaves a gap.
  - The newcomer gets the gate state at that point, its anchor and a `late` mark.
  - Before the race has that much history, it takes the next grid slot.
- **Debris for scenarios.** `Sim::spawn_debris` (journaled) adds dynamic debris bodies, which stay for the round (R58).
- **`jj sim` fixtures.** They gain `grid`, `dropIn` and `debris`. Observations carry `late`, `protected` and debris
  footprints.

## Acceptance → tests (`cargo test -p jj-sim --test placement`)

| AC | Test |
|---|---|
| Start grids of 1, 24, 40 and 99 cars place without overlap | `start_grids_of_1_24_40_and_99_place_without_overlap` (1 and 24 on the greybox's 60 m corridor, 40 and 99 on the greybox with the corridor stretched to 110 and 264 m; pairwise footprints, with a 0.15 m margin, never overlap; all turn solid and settle on four wheels). Capture: `grid-99-long-corridor.svg` |
| A mid-race join lands ~3 s behind the last racer with its lap/gate state, marked late | `a_mid_race_join_lands_about_3_s_behind_the_last_racer_with_its_gate_state` (within 1 m of the last racer's progress 3 s earlier and ≥ 12 m behind it now; gate state for that progress; late, protected, not held, drives off; a stopped last racer still leaves the gap). Bank: `scenarios/placement-drop-in.json`. Capture: `drop-in.svg` (#3, the joiner, at 15 m and gate 1, where #2 was 3 s earlier; #2 now at 48 m and gate 2) |
| A crowded tail (20 cars + debris within 30 m) still yields a controllable protected car within 3 s; protection never ends overlapping | `a_crowded_tail_still_yields_a_controllable_protected_car_within_3_s` (20 parked racers and 8 debris bodies; the joiner is protected from its first tick and has moved 2 m well inside 3 s; at every tick, any car whose protection ended overlaps no solid car or debris). Captures: `crowded-tail-t901.svg`, `crowded-tail-t1080.svg` |
| A 99-car grid on a corridor sized for 24 places everyone at once under protection | `a_99_car_grid_on_a_24_car_corridor_places_everyone_at_once_under_protection` (99 cars exist and take input at tick 0; poses never coincide; the corridor's 24 turn solid; every car still protected is blocked by something; as the front drives off, more turn solid without overlapping). Bank: `scenarios/placement-grid-99.json` (car 98 settles on its wheels). Captures: `grid-99-short-corridor-t0.svg`, `-t240.svg` |
| 0.1's spawn-cap regression, re-expressed in Rust | `the_0_1_spawn_cap_never_returns` (0.1's `spawn-cap-regression.test.js`: 16 authored spawns, modulo-wrapped. Here 1,000 grid poses are each > 1 m from player 1's; the first 200 are pairwise distinct; 200 cars spawn and none is dropped) |

Also: `respawns_go_through_the_placement_service` (a car whose anchor is occupied respawns at a clear pose, protected,
then turns solid) and `drop_ins_and_debris_replay_to_the_same_hash`.

## Captures (top-down, from `jj sim` snapshots)

| File | Scene |
|---|---|
| `grid-99-long-corridor.svg` | 99 cars on a 264 m corridor: no overlap |
| `grid-99-short-corridor-t0.svg`, `-t240.svg` | 99 cars on the 24-car corridor: all protected at tick 0; at 2 s the corridor's 24 are solid and the overlapping overflow is still protected |
| `drop-in.svg` | the late joiner ~3 s of route behind the last racer, legal progress and gates labelled |
| `crowded-tail-t901.svg`, `crowded-tail-t1080.svg` | the joiner found a clear pose among the debris, protected, then drives off solid |

`runs.json` has each scene's outcome: all pass, replays match, car counts, and how many are protected at the end
(0 for the long corridor, 72 for the short one).

## Runs

```
$ rch exec -- cargo clippy --locked --all-targets --no-deps -p jj-sim -p jj-tools -- -D warnings   exit 0
$ rch exec -- cargo test --locked -p jj-sim -p jj-tools                     all pass (placement 7, race 9, bank 6 scenarios)
$ rch exec -- cargo check --locked --target wasm32-unknown-unknown -p jj-wasm-host -p jj-sim        exit 0
```

## Known gaps (other beads)

- The browser drop-in journey (G02) and the seat-to-car glue (G01): the host calls `drop_in` when a seat joins
  mid-round and binds the car to it.
- Reconnect is a seat-level concern: the car and its anchor stay put.
- Wreck husks (S04c). Overlap uses footprints on the ground, so a car in the air over another counts as overlapping
  (conservative: it stays protected a little longer).
