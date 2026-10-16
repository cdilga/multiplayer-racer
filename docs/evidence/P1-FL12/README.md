# P1-FL12 (br-bbki.12): the off-road climb; the Tradie Ute climbs off the road (R133)

The owner couldn't climb the terrain off the road's edges in the Ute. R133, as amended, says it should have climbed even
with rear-wheel drive: more force, not AWD. Measurement says the real cause was neither drive nor force. It was the Ute's
nose.

## What stopped it

- **Generated verges are steep.** I sampled six mixed maps (seeds 1–6, generator 23) beside the road. 21–61% of verges
  are flat or low. The banks rise at 40–65° from a rounded foot, about 6 m past the road's edge. 23–57% are 2 m+ walls
  steeper than 40°.
- **The Ute stalled at the foot of anything past 35°.** The probe: a bank beside the greybox's far straight at 2.5 m
  terrain spacing, its foot rounded like a generated verge's. The car starts at rest 2 m short of the foot and holds full
  throttle. The Cruz, Hawk and Lion climbed 45° from rest. The Ute gained 0.6–0.7 m at 40°, 45° and 50°.
- **The cause is the bull bar and its winch hook.** They hang 0.29 m up and 1.33 m ahead of the front axle; the other
  cars' noses are about 0.9 m ahead.
  - Rapier's raycast wheels have no leading edge to climb with, so the bar met the bank first.
  - The front wheels unloaded, and the car pinned its nose into the bank: rear tyres at full drive, the body's friction
    holding it.
  - Lifting the nose's underside alone (in a probe) let it climb 45° from rest. 40 kN of force alone climbed a sharp 35°
    foot but still stuck at 45°. AWD is already in effect: on the arcade controller every wheel drives (R138).

## The change (Ute only)

### The first attempt rolled the Ute (f53c4026)

The first fix trimmed the chassis colliders' underside ahead of the front axle to a 25° approach angle (`approach_deg`).
It climbed, but it turned the nose into a ramp at any speed.
- **R122 failed:** on eris and CI 5450, the generated-road bank went from 0 to 8 roll-overs in turns, plus straight
  runs off the road that ended on the roof (upY down to −0.877). A Ute running into a verge bank at 25–35 m/s rode up
  it and rolled.
- **Isolated with `JJ_TUNE` on eris:** with `approach_deg=0` every one of those throws stayed upright (min upY ≥ 0.937).
  The off-track grip only worsened one.
- **No angle served both:** ≤ 20° kept R122's failing throws upright but stalled on the real lab bank; ≥ 22° rolled.

### What ships: the nose climbs at a crawl (`crate::climb`)

The collider keeps its baked shape. A Rapier contact hook (`modify_solver_contacts`) acts only while all three hold:
- the car is below `nose_climb.below_mps` (9 m/s);
- the throttle is on;
- a body contact with the ground sits ahead of the front axle on a bank face (normal y between the wall limit 0.34 and
  0.95).

Then that contact becomes a belt running up the face at `belt_mps` (8 m/s), the solver's conveyor tangent velocity, with
a tyre's `grip` (2.0) instead of the body's 0.6. The bull bar rolls up the face the way a tyre's leading edge would,
until the front wheels reach it and drive. At speed nothing changes, so R122's throws are as they were before FL12. The
belt's work is authorised in the energy ledger: the car's energy gain that step, never negative.

- `tuning.nose_climb` `{ below_mps 9, belt_mps 8, grip 2.0 }`; absent on every other car.
- `surfaces.off_track` 0.45 → 0.75: the off-roader's all-terrain tyres. Every other car keeps 0.45.
- The head-on test (`tradie_ute.rs`) is unchanged: the hook only acts on ground contacts.

## The climb bank (`crates/jj-sim/tests/climb.rs`)

`the_ute_climbs_off_road_banks_from_rest_and_out_climbs_the_road_cars`. Each car starts at rest 2 m from the foot and
holds full throttle; the figure is seconds to stand 10 m up the bank.

| Grade | Cruz | Hawk | Lion | Ute before | **Ute now** |
|---|---|---|---|---|---|
| 40° | 3.09 s | 3.06 s | 3.07 s | stalls (0.7 m) | **2.88 s** |
| 45° | 3.56 s | 3.75 s | 3.50 s | stalls (0.6 m) | **3.24 s** |
| 50° | 5.00 s | stalls | 5.55 s | stalls (0.6 m) | **4.08 s** |

Envelopes:
- The Ute stands 10 m up 40°, 45° and 50° within 6 s, and stays on its wheels (up ≥ 0.5).
- No road car gets 10 m up sooner.
- A 65° wall stays a wall: from a 15 m run-up no car gets 10 m up it or rises more than 6 m. Momentum lifts the Ute's
  nose about 4 m up the face; the others stop at its foot.

Measured on the Mac (aarch64, native release build, `cargo test`), shared tree on 2026-10-17.

## The off-road climb lab scene (AC1, AC2)

`assets/lab/scenes.json` `off-road-climb` (R131) is an outback-dirt oval, seed 1, with 260 m straights and 40 m bends,
and no set pieces. Its verges rise off the road into banks and rock faces. `jj_procgen::lab` builds it through the
real generator. The map is `maps/lab/off-road-climb.json`, and each run's fixture is `scenarios/lab/<run>.json`, run by
the scenario bank. A verge run picks the first route point beside a verge that matches (sampled every metre, the slope
over each 2 m), and starts the car at rest 2 m inside the road's edge, facing square off the road. Its `riseM` becomes
a height envelope row. A fixture's new `vehicle` names the roster car that drives it: `jj sim` loads that profile, and
the host's test load spawns that roster index.

| Run | Car | Verge | Envelope | Measured |
|---|---|---|---|---|
| `off-road-climb` | Ute | 40–50°, 6 m+ | 5 m or more above the road, up ≥ 0.5, no wreck | **6.9 m up**, on the plateau |
| `off-road-climb-cruz` | Cruz | the same bank | under 4 m above the road, no wreck | 2.8 m (stalls on the face) |
| `off-road-wall` | Ute | 62°+, 4 m+ | at most 6 m above the road, no wreck | 0.8 m (its nose against the face) |
| `off-road-climb-lap` | Ute | autopilot from the start | a full lap (771 m), no wreck or recovery | 771 m in 97.4 s |

The Ute without the climbing nose fails `off-road-climb` at 0.8 m, even on the 0.75 grip: it sits at the bank's foot.
With a 6 m/s gate it reached the bank at 10.5 m/s across the shoulder with the hook off, and wedged 2.2 m up. The
gate is 9 m/s. Hawk and Lion stall at 0.6 and 0.7 m. The scene's purpose is that the climb is the Ute's.

**Which verges are climbable.** A bank of up to about 50° is climbable by the Ute. Past about 55°, no tyre holds: the
Ute's off-track friction is 1.9 × 0.75 = 1.43, and tan 55° is 1.43. A first try at 38–55° picked a bank whose top step
was 58°, and no car climbed it. The climbable class is 40–50°. Steeper faces read as walls, and the wall run stays below
6 m.

**In the browser** (AC3): `web/tests/journeys/fl12-climb.test.mjs` passes 2/2 locally, in Playwright Chromium and
WebKit, on a rebuilt host worker. It runs the climb, the Cruz and the wall fixtures in the real worker and renderer, and
each ends inside its height envelope with the run's vehicle drawn. The TV captures and their review are in
`self-review.md`.

**From the Feel Lab:** the scene is in the Feel Lab's scene data, so it loads like the canyon leap (FL09). Loading a
scene into a running room is the scene picker, P1-FL03.1 (br-bbki.19, open).

## Fixtures re-baselined (one line each)

- `scenarios/roster/mixed-host.json` hash `f83b8fc3…` → `e8b9dd78…`: the Ute's off-track grip and its climbing nose
  (no contact in that run climbs, so it's the grip).
- `scenarios/assist/over-driven.json` `offMinOffRoadM` 7.0 → 6.5: the raw Ute's spin now stops at the road's edge
  (6.8 m, 180°) on its grippier off-track tyres (docs/evidence/P1-FL06/).

## Known gaps

- **The fixture bike.** `bike_generated_road_speed_lock_bank` is red on a guard rail at seed 3 point 120 (upY 0.454).
  That's the fixture bike, with a third of the roster bikes' balance torque; the roster bikes pass. It isn't this
  bead's.

- **Hanging on a wall.** Between about 55° and 70°, every car's drive fades out (`DRIVABLE_NORMAL_Y` 0.57 to
  `WALL_NORMAL_Y` 0.34, br-gw74.13). A car at full throttle can hang nose-up on a 60–65° face until the player backs off.
  This was already true of every car at 60°.
