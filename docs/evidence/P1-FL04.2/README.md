# P1-FL04.2 · Arcade handling, the shipped default (br-bbki.21, R136, R138)

Machine: the Mac (macOS 27.0.1) and the RCH workers, `rustc 1.99.0`, release builds. Native deterministic Rapier sim
at 120 Hz. These are sim numbers, not a player's verdict. The owner judges the feel at the couch (R136); that verdict is
recorded under "Owner verdict" once it exists.

## What changed

An authored **arcade car controller** (`crates/jj-sim/src/vehicle/arcade.rs`) replaces Rapier's tyre side forces on
every roster car (`tuning.arcade` in `assets/profiles/*.json`). Rapier keeps the suspension, drive and braking along the
wheels, collisions, jumps, carnage and debris (R138). Each tick after `update_vehicle`, on the wheels:

- **Goes where you point it.** The stick asks for a yaw rate: the kinematic turn of the profile's lock, the lock easing
  off with speed (`steer_falloff_mps`), capped at `turn_g` of lateral acceleration and `yaw_max_deg_s`. A yaw
  controller meets it with time constant `turn_in_s`. There is no tyre slip curve, so nothing ploughs, and full stick
  gives the full arcade turn at any speed.
- **Grip holds the rear axle on its line** (`grip_g`, at the centre of mass: no roll, no dive, R122). A gripping car
  pivots about its rear wheels, as a real one does. `carry` hands most of the speed a turn scrubs back along the nose
  (big readable speed).
- **Grip that lets go on purpose.** On a rear-driven car, a throttle punch with steer under `punch_max_mps` breaks the
  rear (`punch_slide`). The stick then sets the drift angle (`slide_angle_deg`): centred straightens it, against it
  catches it. Throttle past `slide_hold_throttle` holds a power slide; otherwise grip returns over `slide_recover_s`.
  The Cruz is front-driven, so `punch_slide` is 0: it pulls straight.
- **Drivetrain is character, not traction** (R138). Every wheel drives on the arcade controller, so the FWD Cruz
  launches as hard as the RWD cars. The difference shows in how the car slides: a RWD tail versus an eager FWD nose
  (`lift_tuck`, `power_push`).
- **Forgiving.** A stalled car pushed against a wall, a car or debris pivots and drives off (`pivot_mps`). Far past the
  slide angle (a hit, a sideways landing) the controller lets go to `let_go_authority`, so wrecks still spin. Roll rate
  is damped on the wheels (`roll_damping`). Surfaces still matter: the turn scales with √grip, and line-holding with
  R124's side stiffness.
- The autopilot and the assists steer through the car's real speed-eased lock (`VehicleProfile::steer_lock`). Their
  pure-pursuit stick then turns the curvature they ask for (before, they under-commanded at speed by up to 3x).
- Profiles: the **Cruz is front-wheel drive** (was `Rear`, wrongly). Ute, Hawk Dash and Lion President are rear-drive
  (the V8 twins share one identical block). Body friction is unchanged. The perfect-start bonus went 0.5 → 1.0 (R127:
  "hits harder"; every-wheel drive also helped a mashed start, which took away the perfect start's margin).

FL04's handling layer and its Kart/Rally/Hooligan presets (`vehicle/handling.rs`, `handling-presets.json`,
`tuning.handling`, FL04's bank `tests/handling.rs`) are deleted (R136 rejected them; no legacy, after FL04 closed). The
Feel Lab keeps its trade-off sliders and A/B slots, now over the shipped controller: Turn-in (`arcade.turn_g`,
`yaw_max_deg_s`, `turn_in_s`), Grip ↔ slide (`arcade.grip_g`, `slide_grip`, `slide_angle_deg`), Power, Air, Launch,
Boost.

## AC2 · the feel bank (`crates/jj-sim/tests/arcade.rs`, `arcade-bank.json`)

`cargo test --release -p jj-sim --test arcade` on `maps/test/skidpad.json`:

| | before (Cruz, Rapier, RWD) | Cruz Missile (FWD) | Tradie Ute (RWD) |
|---|---|---|---|
| steady full lock at 10 / 20 / 30 m/s, deg/s | 79.4 / 42.3 / 28.1 | 75.9 / **91.4** / **63.5** | 64.8 / 65.2 / 43.4 |
| turn-in peak in 0.5 s at 20 / 30 m/s, deg/s | 41.6 / 28.2 | **91.1 / 63.5** (2.19x / 2.25x) | 64.3 / 42.9 |
| throttle punch at 6 m/s, full lock: rear slip | 1.3° | 1.5° (FWD pulls straight) | **34.5°** |
| … heading turned in that second | 57.6° | 69.9° | 106.9° |
| … caught (angle < 5°, yaw < 15 deg/s) after easing off | 0.07 s | 0.12 s | **0.45 s** |
| lift-off yaw gain mid-corner, deg/s | +17.8 | +16.5 | +8.4 |
| recovery after a 25 m/s full-lock throw | 0.05 s | 0.18 s | 0.28 s |
| lowest up-y | 1.00 | 1.00 | 1.00 |

Asserted: the Cruz is FWD and the Ute RWD; the Cruz turns in at least 2x as hard as before at 20 and 30 m/s, both
steady and at peak; the Ute's punch puts the rear past 25° and turns the car more than 60°, caught within 1 s; the Cruz
punch stays under 15° of rear slip; held speeds within 1.5 m/s; lift-off adds yaw; recovery under 0.5 s, upright.

## AC3 · the banks, re-measured (each move and its reason)

`cargo test --release -p jj-sim` (all 30 test binaries green), `-p jj-fixture`, `-p jj-tools`, `-p jj-input`,
`-p jj-protocol`, `-p jj-wasm-host`, and `-p jj-procgen --test handling --test landforms`.

Learners (R125 scripted novice, `scenarios/assist/novice-laps.json`, unchanged fixture), six seeds:

| Level | before (2026-10-11 / after the fun pass) | now |
|---|---|---|
| Off | 0/6, 88 crashes | 5/6 laps, 71 crashes |
| Some | 6/6, 18 crashes / 6/6, 4 crashes | **6/6, 0 crashes**, 68.1 s |
| Lots | 6/6, 0 crashes, 74.8 s | **6/6, 0 crashes**, 67.9 s |

Flip: Lots rights a car in 85 ticks; Off waits 374.

Fixtures moved, each with its reason (also in the fixture's own `what`):

- `scenarios/affordances/turn-around.json`: re-scripted. The car pivots about its rear axle at a crawl, so the old legs
  (sized for the old understeer) over-rotated it. Shorter legs, the last one per car. Envelopes unchanged.
- `scenarios/affordances/rejoin-route.json`: shorter line-up legs (70/70/65 ticks, were 120): the car turns at the asked
  rate. Envelopes unchanged.
- `scenarios/affordances/loose-wheel-drive.json`: 0.6 lock, was full. Full lock carried the left car onto the verge,
  whose grip (not its wheel) cost it 10°. Envelopes unchanged; the two cars are now within 4°.
- `scenarios/affordances/authority.json`: the 15 m/s car turns 39° in 0.5 s (was about 30): envelope 30-48 (was
  15-35). Turning harder at speed is FL04.2's point.
- `scenarios/affordances/boost-line.json`: the grid car laps cleanly at up to 51 m/s through the S-bend: 359 m, envelope
  335-380 (was 240-280). The kerb car is unchanged at 307 m.
- `scenarios/feel/surface-corner.json`, `surface-deltas.json`: re-baselined to the new numbers. The order is unchanged:
  looser ground slides more, turns less and holds less speed. The off-track car starts 4 m further in (it reached the
  map's out-of-bounds edge).
- `scenarios/feel/idle-settle.json`: turn roll 0.32° (min 0.2, was 0.5): grip acts at the centre of mass, and roll rate
  is damped on the wheels (R122).
- `scenarios/feel/wheelie-at-speed-refused.json`: 20 % steer (was 28 %) and 300 ticks: a fixed steer at full throttle
  for 6 s reached the roadside and wrecked, long after the snap the fixture tests. The plain car's body pitch envelope is
  0-5° (was 0-3; 3.1° measured, no front air time).
- `scenarios/damage/control-after-t-bone.json`: "stopped spinning" is read 85 ticks after the hit, before the steer
  starts. A full-lock steer at this speed turns about 90 deg/s by design.
- `scenarios/rails/corners.json`: the 25 m/s corner steers -8500 (was -5898), and the low-speed turn's throttle is 4000
  (was 5000, to stay under its 5 m/s cap). `crates/jj-sim/tests/rails.rs`: on a rigid rail the arcade car no longer
  spins out, so that comparison now asserts it gets out facing along the road (no rail still fails).
- `crates/jj-sim/tests/placement.rs`: the drop-in test's racers run 3.5 s at gentler throttles. At the old ones,
  every-wheel drive took all three to the hairpin wall first.
- `scenarios/items/sanga-debris-attribution.json`: the buffed car pushes at 0.6 stick. At full throttle it hit the other
  car alongside the prop, so the hit was the car's.
- `scenarios/duels/orderings/air-control-duel.json`: two beats carry a stated `gap`. A forgiving landing no longer makes
  an over-corrected tipped landing slower. R129's landing tiers are P1-FL07 (br-bbki.7), which closes the gap.
- `assets/profiles/tradie-ute.json`: `roll_damping` 30 (was 8). On generated seed 4, point 520, the R122 bank's
  35 m/s flick runs the rebuilt Ute 8 m off the centreline into the guard rails. The rail took 14 m/s in a tick and the
  rebound rolled the car (upY 0.295). The Cruz, Hawk and Lion hit the same rails and stayed upright. One-throw variants
  on eris: the bank hand-over off and `body_friction` 0.05 change nothing; `roll_damping` 30 gives upY 0.994. The full
  bank for the Ute: 585 runs, 0 dives, 0 roll-overs (at 20: 1 dive). The other cars keep 8: at 30 the Lion rolls once.
  `scenarios/roster/mixed-host.json` is re-blessed (the Ute is seat 1): f83b8fc3….

## Known gaps

- Not yet felt by a player. The punch, slide angle, turn rate and caps are profile data, tunable in `?tune`.
- The bikes keep Rapier's side friction (no `arcade` block): they are their own thing.

## Owner verdict

Pending the couch test. The preview to judge is **`preview/v02-64d40dd7`**: the arcade controller is the default for every
car, along with FL05, FL06, FL07 and FL12's Ute climb (ee5f1619).

Don't use `v02-22502cef`. It has the arcade controller too, but its Ute can ride up a verge bank at speed and roll
(f53c4026, replaced by ee5f1619).
