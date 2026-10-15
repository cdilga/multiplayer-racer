# P1-FL04 · Arcade handling (br-bbki.4, R128)

Machine: the Mac (macOS 27.0.1), `rustc 1.99.0`, release builds, base commit b0a94e76 plus this change. Native sim
only (no browser); the numbers are the deterministic Rapier sim at 120 Hz.

## What changed

- `crates/jj-sim/src/vehicle/handling.rs`: a per-axle lateral-grip layer applied after Rapier's `update_vehicle` when
  a profile's `tuning.handling` is set (Rapier's own side friction is then off). Slip-angle curve with a peak and a
  fall-off, per-axle grip, a friction circle shared with drive/brake, arcade weight transfer (grip shift from
  throttle/brake, no body pitch), steer-to-peak (the stick sets the front tyres' slip against the front axle's travel),
  and a yaw-rate helper that adds rotation toward the stick up to what the grip can turn (μg/v), never against it.
- `assets/profiles/handling-presets.json`: the presets as data: **kart**, **rally**, **hooligan**.
- The shipped Cruz and Ute profiles are unchanged (no `handling`): which preset becomes the default is the owner's
  Feel Lab call (R131, FL03 picks presets per car). A preset switches live through `Sim::set_tuning[_for]`.

## Why the car understeered (measured, not guessed)

Rapier's side friction is a damper: each tick a wheel pushes back 20 % of the sideways velocity at its contact
(`resolve_single_unilateral`, `contact_damping = 0.2`). It never peaks, so the Cruz settles at ~14° slip, far short
of its `friction_slip` 2 grip: on the skidpad at a held 30 m/s and full lock it turns at **28.1 deg/s**
(full throttle from 30 m/s: 21 deg/s peak while it *speeds up* to 38.5 m/s mid-corner).

## AC1 · Handling bank per preset and drivetrain

`cargo test --release -p jj-sim --test handling` on `maps/test/skidpad.json` (flat 1 km tarmac,
`tools/maps/skidpad.py`). Table: `handling-bank.txt` (human) and `handling-bank.json` (all numbers). Columns: steady
yaw at a held 10/20/30 m/s full lock; lift-off yaw gain; power (floored vs held at the 15 m/s limit): rear slip, yaw,
sideslip; recovery time after centring from a 25 m/s full-lock throw; lowest up-y.

Asserted envelopes: every preset turns harder than before at 20 and 30 m/s and holds its speed; lift-off adds
> 8 deg/s; recovery < 0.6 s upright; floored RWD rear slip > floored FWD on every preset (power oversteer); floored FWD
turns slower than RWD on Rally and Hooligan (push), within 5 % on Kart (planted by design).

## AC2 · Understeer fixed

Kart (RWD Cruz) at a held 30 m/s, full lock: **61.4 deg/s** against **28.1 deg/s** before, **2.19x** (asserted ≥ 2x
against the before-run in the same harness).

## AC3 · R122 bank for every roster vehicle

`cargo test --release -p jj-procgen --test handling` (generated roads, seeds 1-6, 15/25/35 m/s, straight / hold /
flick; and the flat speed × lock bank), Cruz Missile and Tradie Ute:

| Run | Generated roads | Flat bank |
|---|---|---|
| as shipped (no preset) | pass | pass (worst roll 1.2°) |
| `JJ_HANDLING=kart` | pass: 0 dives, 0 roll-overs | pass (worst roll 1.6°) |
| `JJ_HANDLING=rally` | pass: 0 dives, 0 roll-overs | pass (worst roll 1.5°) |
| `JJ_HANDLING=hooligan` | pass: 0 dives, 0 roll-overs | pass (worst roll 1.3°) |

Two changes to get there, both stated:
- The layer's side forces act at the centre of mass's height. With `roll_influence`'s lever, ~3x the old cornering
  force rolled the Cruz 18° onto its sill.
- The flat bank now runs every vehicle on `scenarios/bikes/flat-strips.json`: the same four grounds cell for cell
  as `maps/test/surface-strips.json`, without its kerbs, barriers and buildings (the bike already used it). With the
  sharper turn the Cruz reached the building at x=140,z=-25 within the run: an obstacle hit, not a turn. The
  generated-road half keeps every obstacle.
- Hooligan's rear grip went 1.3 → 1.4 after the Cruz, held at full lock at 35 m/s on seed 2, spun slowly and tripped on
  the terrain's relief (traced per tick: no object there, 37° rear slip, launched by the ground).

## AC4 · Presets selectable live; autopilot laps

- `a_preset_switches_mid_run`: one car on the skidpad takes kart → rally → hooligan between ticks and keeps driving
  upright. The lab UI that picks them is FL03 (br-bbki.3).
- `the_autopilot_finishes_three_laps_on_every_preset`: greybox, seed 5, three laps unaided (0 wrecks, 0 recoveries):
  kart 140.1 s, rally 140.4 s, hooligan 140.3 s.

## Known gaps

- Not yet felt by a player: these are sim numbers. The owner judges the presets in the Feel Lab (FL03, FL08-FL12).
- Assists on the new handling are FL06; removing the drift input is FL05.
