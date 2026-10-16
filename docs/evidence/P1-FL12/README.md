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

## Fixtures re-baselined (one line each)

- `scenarios/roster/mixed-host.json` hash `f83b8fc3…` → `39feddc7…`: the Ute's profile changed (approach, off-track
  grip). The values reverted give the old hash.
- `scenarios/assist/over-driven.json` `offMinOffRoadM` 7.0 → 6.5: the raw Ute's spin now stops at the road's edge
  (6.8 m, 180°) on its grippier off-track tyres (docs/evidence/P1-FL06/).

## Known gaps

- **Hanging on a wall.** Between about 55° and 70°, every car's drive fades out (`DRIVABLE_NORMAL_Y` 0.57 to
  `WALL_NORMAL_Y` 0.34, br-gw74.13). A car at full throttle can hang nose-up on a 60–65° face until the player backs off.
  This was already true of every car at 60°.
