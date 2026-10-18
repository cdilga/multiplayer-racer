# AU Hawk: tuning and engine voice (br-bwju.12, part 2)

Owner: "The tuning should mean it does better burnouts and doughnuts than the other cars and be a bit slower. The sound gen
should kinda be similar to the AU too." The AU Falcon: a big rear-drive sedan, 4.0 L inline six, lazy torque, easy to light up
the rears.

Everything here is data: the profile's `tuning` section (`assets/profiles/au-hawk.json`), the engine voice
(`assets/audio/engine/au-hawk.json`) and versioned scenario fixtures (`scenarios/handling/roster-*.json`). No Rust changed.

## How the arcade controller makes a burnout (read first)

`crates/jj-sim/src/vehicle/arcade.rs` has no tyre or wheelspin model (R138): every wheel drives, and "the drive type shows in
how the car slides". A **power slide** starts on a *throttle punch* (stick from under `punch_from` to over `punch_to` within
`punch_window_s`) with at least `punch_steer` of lock, and only while the speed is inside `punch_min_mps..=punch_max_mps`
(and `punch_slide > 0`: rear-driven cars). It lasts while the throttle stays past `slide_hold_throttle` with lock on. While
it lasts, grip falls to `slide_grip`, the stick sets the drift angle (full lock holds `slide_angle_deg`), and grip comes back
over `slide_recover_s`.

- **Brake plus throttle together (a standing burnout) cannot be asked.** The drive stick is one axis (up drives, down brakes),
  and in `vehicle::wheel_commands` brake overrides drive. There is also no wheelspin model for it to feed. So the burnout is
  what the controls support: the rear-led power slide launch from a standstill, tail hanging out (fixture
  `roster-burnout-*`). A straight, no-lock burnout is not representable.
- The Hawk Dash (and its twin the Lion President) can only start a slide above 2 m/s, so from a standstill it normally gets none
  and, when it does, it runs away at full throttle on a ~85 m circle.

## What changed in the AU Hawk's `tuning` (was: a copy of the Hawk Dash's)

| Field | Before (Hawk Dash) | AU Hawk | Why |
|---|---|---|---|
| `max_engine_power_w` | 760000 | **530000** | lower top speed: sqrt(P / (m x damping)) = 47.2 m/s (Cruz 50.6, Hawk Dash 56.5) |
| `max_engine_force` | 20000 | **19000** | lazy, strong low-end pull (power-limited above ~28 m/s) |
| `arcade.punch_min_mps` | 2.0 | **0.0** | the rears let go from a standstill (burnout on the spot) |
| `arcade.punch_max_mps` | 12.0 | **25.0** | a punch lights the tail at far higher speeds too |
| `arcade.punch_steer` | 0.35 | **0.25** | a small lock is enough |
| `arcade.slide_angle_deg` | 40 | **72.0** | tail hangs right out at full lock |
| `arcade.slide_grip` | 0.30 | **0.45** | the sliding car still pulls round: a tight circle, not a runaway |
| `arcade.slide_hold_throttle` | 0.6 | **0.4** | the slide holds on a half-open throttle |
| `arcade.slide_recover_s` | 0.55 | **0.9** | grip returns slowly: it stays loose |

Everything else is unchanged (`drive` stays `Rear`, mass 1700 kg, `carry` 0.9, turn and grip numbers). `carry` 0.6 was tried and
made the doughnuts slightly tighter but pushed the R122 bank over its 5 mm dive tolerance (seed 3 point 200 at 25 m/s, clearance
-0.007 m), and 0.9 already gives the tight circle, so it stays at 0.9.

## The fixtures (`cargo test -p jj-tools --test scenarios` runs them; 28 files in `scenarios/handling/`)

One fixture per roster vehicle (`"vehicle": id`), same map (`maps/test/skidpad.json`, flat tarmac), same inputs, so the table is
like for like. Each fixture asserts its own car's envelope; the AU Hawk's lower bounds sit above every other car's upper bound.

- `roster-doughnut-<car>`: from rest, closed throttle for 0.5 s (the car settles), then full left lock and full throttle for 8 s.
- `roster-doughnut-roll-<car>`: the same from a 6 m/s roll, so the Hawk Dash gets its slide too (the fair test against the
  next-best sliding car).
- `roster-burnout-<car>`: from rest, throttle punched with half lock for 3 s. `travel` (and `maxRadiusM`) shows how far the car
  walks from the spot.
- `roster-straight-<car>`: from rest, full throttle for 10 s down the skidpad.

### Doughnut from rest (8 s, full lock, full throttle)

| Car | peak yaw rate deg/s | max slip deg | slide time s | end speed m/s | furthest from start m |
|---|---|---|---|---|---|
| **AU Hawk** | **299** | **78.5** | **8.0** | **17.9** | **11.8** |
| Hawk Dash | 183 | 65.9 | 7.8 | 41.9 | 86.8 |
| Lion President | 185 | 65.5 | 7.8 | 42.0 | 87.0 |
| Tradie Ute | 161 | 60.1 | 7.8 | 37.2 | 81.3 |
| Cruz Missile | 84 | 65.5 | 0 | 46.6 | 81.7 |
| Postie Bike | 106 | 19.3 | 0 | 24.4 | 31.6 |
| Pig Catcher | 106 | 16.0 | 0 | 27.7 | 40.1 |

(Others' circles are 80+ m wide: they are not doughnuts, they are runaway arcs. The AU Hawk stays in an ~11 m circle.)

### Doughnut from a 6 m/s roll

| Car | peak yaw deg/s | max slip deg | end speed m/s | furthest from start m |
|---|---|---|---|---|
| **AU Hawk** | **250** | **80.7** | **17.1** | **11.2** |
| Hawk Dash | 155 | 46.7 | 43.2 | 93.1 |
| Lion President | 157 | 46.7 | 43.2 | 93.3 |
| Tradie Ute | 137 | 44.6 | 38.0 | 84.9 |
| Cruz Missile | 84 | 22.7 | 47.2 | 86.2 |
| Postie Bike | 103 | 19.9 | 24.6 | 34.1 |
| Pig Catcher | 102 | 15.9 | 28.0 | 43.4 |

### Burnout (from rest, punch with half lock, 3 s)

| Car | peak yaw deg/s | max slip deg | slide time s | travel from the spot m |
|---|---|---|---|---|
| **AU Hawk** | **185** | **86.4** | 3.0 | **24.5** |
| Lion President | 136 | 69.1 | 2.8 | 37.6 |
| Hawk Dash | 134 | 76.2 | 2.8 | 37.6 |
| Tradie Ute | 118 | 67.4 | 2.8 | 38.4 |
| Cruz Missile | 53 | 78.5 | 0 | 39.6 |
| Postie Bike | 72 | 12.9 | 0 | 31.9 |
| Pig Catcher | 75 | 6.8 | 0 | 33.3 |

Honest note: on max slip alone the Cruz (78.5, no power slide at all) and Hawk Dash (76.2)
are not far behind the AU Hawk's 86.4; the burnout is clearly the AU Hawk's on yaw rate (+36% over the next car) and on staying
near the spot (24 m vs 32-40 m). The slip bound in the fixture is 82 for the AU Hawk and 80 for the rest.

### Straight line (full throttle from rest, 10 s) and lap pace

| Car | speed at 10 s m/s | flat-road top speed m/s (profile) | good-driver lap, seeds 4 / 5 / 8 s | autopilot lap s |
|---|---|---|---|---|
| Hawk Dash / Lion President | 53.0 | 56.5 | 66.8 / 59.5 / 57.3 | 62.3 / 57.1 / 53.9 |
| Cruz Missile | 48.1 | 50.6 | 65.1 / 58.6 / 56.3 | 61.5 / 56.4 / 53.8 |
| **AU Hawk** | **44.8** | **47.2** | **67.8 / 60.7 / 58.9** | **64.0 / 59.5 / 56.9** |
| Tradie Ute | 45.8 | 47.1 | 70.4 / 63.9 / 61.6 | 67.1 / 62.7 / 58.7 |
| Postie Bike / Pig Catcher | 43.3 / 48.1 | - | - | - |

The AU Hawk's top speed is 6.7% under the Cruz and 16% under the Hawk Dash; its good-driver lap is 3.6-4.6% slower than the Cruz and
1.5-2.8% slower than the Hawk Dash (a corner-heavy track dilutes the straight-line gap), and the autopilot ratio stays 0.94-0.98.
`cargo test -p jj-procgen --test bot_pace` (limit 1.15) passes: AU Hawk 0.94 / 0.98 / 0.97.

## Checks run (eris, scratch clone of HEAD 28bfd20c plus these files)

- `jj sim scenarios/handling/roster-*.json`: all 28 pass, replays match.
- `cargo test -p jj-procgen --test handling -- au_hawk` (the R122 thrown-about bank): passes (it failed at `carry` 0.6, see above).
- `cargo test -p jj-procgen --test bot_pace`: passes.
- `cargo test -p jj-wasm-host --features testing a_mixed_roster`: passes **without a re-bless**: the mixed-roster hash covers the
  first two roster vehicles (Cruz, Tradie Ute), so the AU Hawk's profile change does not reach it.
- The full scenario bank in the scratch clone passes except `off-road-climb` (a Tradie Ute lab scene on a procgen lab map, height
  38.2 vs 40.9 minimum); that fixture does not use the AU Hawk and the lab generator has another agent's uncommitted edits in
  the working tree, so it is theirs to settle.

## Engine voice (`assets/audio/engine/au-hawk.json`)

Engine voices are not rendered audio: each is a versioned data profile (`jj-engine-profile`, validator in
`web/shared/audio/engine-synth/profile.ts`) that the host's procedural synth (`web/host/src/audio/engine.ts`) plays live, one
voice per car, picked by the car's roster vehicle id (a car with no profile used the Cruz Missile's). So there is nothing to
generate on eris (the eris audio pipeline in `jammers-audio` is for the announcer voice and music), no samples, no vocals, and no
LFS objects to commit. The new profile was derived from the Hawk Dash's (same structure and layers) and rewritten as an
inline-six with a lazy four-speed automatic:

- 6 cylinders (firing note at rpm/60 x 3: 33 Hz at the 650 rpm idle, about 175-210 Hz on the pull); idle 650, redline 5200,
  limiter 5500.
- Smooth, slightly hollow note: harmonics weighted to the 3rd to 4th (warm, not the V8's 6th to 7th bark), lope depth 0.12
  (V8: 0.65) so no burble, bright layer capped at 0.6 (V8: 0.85), body filter 350-3000 Hz.
- Intake 0.3 (an inline-six's induction growl), exhaust chop depth 0.35 (V8: 0.95), pops down from 0.7 to 0.12 and 1-3 per burst.
- Lazy auto: ratios 2.74 / 1.54 / 1.0 / 0.71, final drive 4.2, shifts at 4300 rpm, 0.3 s shifts with a shallower, slower dip,
  slow rev rise and fall, launch converter flare at 2400 rpm, soft-settling start.
- Tyre squeal bed at level 1.0 (the burnouts and doughnuts are the car's thing).

Checks (eris): `node art/ui/poc/audio/engine/check.mjs --quick` check P7 (every manifest profile passes the validator and the
JSON Schema) lists `au-hawk.json` and passes; `build.mjs --check` (gallery copies current) passes; a Node run of the drivetrain
over a full-throttle pull to 47 m/s gives gears 1-4 at 13 / 24 / 36 m/s with the engine between 3200 and 4300 rpm (the Hawk Dash
sits at 4400 to 5500, the Cruz at 4500 to 6000): lower and calmer. Not done: I could not listen to it, and `check.mjs`'s
Chromium page checks (it timed out opening the page on the loaded eris) and its check M5 (a squeal-gain monotonicity check
on the Cruz profile, independent of this file) did not pass in the scratch run; the voice also is not yet confirmed in a real
browser host run.
