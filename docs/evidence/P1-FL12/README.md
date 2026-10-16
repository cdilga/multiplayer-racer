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

## The change (data, Ute only)

- **`tuning.approach_deg` 25** (new profile field; 0, the default, keeps a proxy as baked).
  - When the sim builds the chassis colliders, each non-wheel part's points ahead of the front axle are held above a
    line rising at this angle from the front tyres' contact patch (`VehicleProfile::collider_points`).
  - The wheels and detached debris keep their proxies, and the rendered model is unchanged.
- **`surfaces.off_track` 0.45 → 0.75**: the off-roader's all-terrain tyres; every other car keeps 0.45.

Why 25°, not the real Triton's 31°: at 31° the whole bull bar became a 0.8 m wedge, and in the head-on test
(`tradie_ute.rs`) the Ute rode up onto the Cruz instead of shoving it back (Cruz +0.08 m/s). At 25° the head-on is as
before: the Ute rolls on at 1.25 m/s and the Cruz is shoved back at −1.30 m/s. The Ute's front loses 21% of its health,
the Cruz's 66%.

| Approach | Head-on: Cruz after 0.5 s | Ute's front lost / Cruz's | 50° from rest: 10 m up |
|---|---|---|---|
| 18° | −1.88 m/s | 32% / 100% | stalls |
| 20° | −1.87 m/s | 32% / 100% | 5.1 s (Cruz 5.0 s) |
| 22° | −1.77 m/s | 33% / 100% | 4.3 s |
| **25°** | **−1.30 m/s** | **21% / 66%** | **3.8 s** |
| 31° | +0.08 m/s (rides up) | 22% / 69% | 3.5 s |

## The climb bank (`crates/jj-sim/tests/climb.rs`)

`the_ute_climbs_off_road_banks_from_rest_and_out_climbs_the_road_cars`. Each car starts at rest 2 m from the foot and
holds full throttle; the figure is seconds to stand 10 m up the bank.

| Grade | Cruz | Hawk | Lion | Ute before | **Ute now** |
|---|---|---|---|---|---|
| 40° | 3.09 s | 3.06 s | 3.07 s | stalls (0.7 m) | **2.91 s** |
| 45° | 3.56 s | 3.75 s | 3.50 s | stalls (0.6 m) | **3.11 s** |
| 50° | 5.00 s | stalls | 5.55 s | stalls (0.6 m) | **3.79 s** |

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
| `off-road-climb` | Ute | 40–50°, 6 m+ | 5 m or more above the road, up ≥ 0.5, no wreck | **7.7 m up**, on the plateau |
| `off-road-climb-cruz` | Cruz | the same bank | under 4 m above the road, no wreck | 2.8 m (stalls on the face) |
| `off-road-wall` | Ute | 62°+, 4 m+ | at most 6 m above the road, no wreck | 0.0 m (stops at the face) |
| `off-road-climb-lap` | Ute | autopilot from the start | a full lap (771 m), no wreck or recovery | 771 m in 97.4 s |

The old Ute, with `--set approach_deg=0 --set surfaces.off_track=0.45`, fails `off-road-climb` at 0.9 m: it sits at the
bank's foot. Hawk and Lion stall at 0.6 and 0.7 m. The scene's purpose is that the climb is the Ute's.

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

- `scenarios/roster/mixed-host.json` hash `f83b8fc3…` → `39feddc7…`: the Ute's profile changed (approach, off-track
  grip). The values reverted give the old hash.
- `scenarios/assist/over-driven.json` `offMinOffRoadM` 7.0 → 6.5: the raw Ute's spin now stops at the road's edge
  (6.8 m, 180°) on its grippier off-track tyres (docs/evidence/P1-FL06/).

## Known gaps

- **Hanging on a wall.** Between about 55° and 70°, every car's drive fades out (`DRIVABLE_NORMAL_Y` 0.57 to
  `WALL_NORMAL_Y` 0.34, br-gw74.13). A car at full throttle can hang nose-up on a 60–65° face until the player backs off.
  This was already true of every car at 60°.
