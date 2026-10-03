# Sim learnings (append-only)

## 2026-10-03 · Rapier 0.36's raycast vehicle, measured (P1-S01)

Pinned by `crates/jj-sim/tests/rapier_api.rs` (raw Rapier, flat ground, a 1,200 kg box car facing +z). Spike C saw some of
this through the JS API; these are the Rust 0.36 facts.

- **Order:** `update_vehicle(dt, broad_phase.as_query_pipeline_mut(narrow_phase.query_dispatcher(), &mut bodies,
  &mut colliders, QueryFilter::default().exclude_rigid_body(chassis)))`, then `step`. `PhysicsWorld` bundles the sets and
  pipelines. Set `index_up_axis = 1`, `index_forward_axis = 2` for +y up, +z forward, and axle `(-1, 0, 0)`.
- **`engine_force` is a force:** Rapier integrates it with `dt` (the same speed gain per second at 120 Hz and 60 Hz).
- **`brake` is an impulse per tick**, so its effect scales with the tick rate: 4 N·s on 4 wheels × 120 ticks ÷ 1,200 kg
  = 1.6 m/s lost per second, exactly as measured; half that at 60 Hz. jj-sim converts brake force × dt.
- **Per wheel, `brake` is ignored while that wheel has an engine force.** Braking means zeroing the engine force first.
- **Only a positive `engine_force` wakes a sleeping chassis**: steering, reverse and braking don't.
- **`update_vehicle` pumps velocity into a sleeping chassis:** it keeps applying suspension impulses without waking it, so
  a car asleep at rest reads ~0.5 m/s of velocity it isn't moving with and would jolt on waking. jj-sim's chassis
  `can_sleep(false)`, which also makes the wake rule moot for cars.
- **Suspension stiffness is per kilogram:** Rapier multiplies the spring force by the chassis mass.
- **No remove-wheel API:** disable a wheel by zeroing its `max_suspension_force` and `friction_slip` (its corner drops).
  Changing a wheel's tuning doesn't wake the chassis either.
- **Heightfield:** `ColliderBuilder::heightfield(Array2 rows = z, cols = x, scale)` is centred on its collider.
- **Handedness:** with +y up and cars facing +z, +x is the car's *left*. Spike J's model and the look skill call +x
  "right"; P1-V02's sidecar settles it physically: wheel_FL, door_FL and the whip are on +x.

## 2026-10-03 · Provisional Cruz profile numbers (P1-S01, tuned in P1-S03)

`VehicleProfile::provisional_cruz()` (Spike J's dimensions): from rest, full throttle reaches ~10 m/s in 2 s and ~23 m/s
in 6 s on the greybox straight (7 kN rear drive, 0.15 linear damping, so ~39 m/s terminal), dead straight, upright; at
rest it settles at 0.82 m chassis height with ~0.03 m/s of residual suspension motion. These are scenario envelopes,
not feel targets.

## 2026-10-03 · Race rules and recovery (P1-S05)

- **Ghosts need explicit groups everywhere.** A Rapier collider's default `InteractionGroups` is ALL/ALL, and ALL
  includes every bit, so a default-group prop still collides with a ghost whose filter is only WORLD. Terrain and
  dressing are WORLD, props PROP, cars CAR, and finished cars GHOST with filter WORLD. Wheel rays need groups too
  (`QueryFilter::groups`), or a racer's suspension stands on a ghost.
- **Maths that decides state goes through `libm`.** f32 `hypot`/`acos` are the platform's libm, so native and WASM
  could disagree on a gate crossing. The race module uses `libm::hypotf`/`acosf`. `route_spawn` and
  `CarState::heading` still use the std versions (S01); move them when a cross-target replay test needs it.
- **Coasting takes a long time to stop.** With 0.15 linear damping a car rolling at 15 m/s is still doing about
  8 m/s 4 s later, so a "stopped for 1 s" Recover test has to brake first.
- **Flip assist numbers.** A PD torque about `up × Y` (9 kN·m/rad, 3 kN·m·s/rad, capped at 30 kN·m, applied as an
  impulse once per tick) rights the 1,200 kg cuboid chassis from every one of the 12 bank poses about 1.1 s after the
  assist starts (2.1 s after rest), well inside the 4 s rule. When a car is exactly upside down, `up × Y` vanishes, so
  it rolls about its forward axis instead.

## 2026-10-03 · Placement and spawn protection (P1-S06)

- **Protection deadlocks unless it's ordered.** Two protected cars that overlap each other would both wait forever if
  each counted the other as blocking. A protected car ignores higher-id protected cars, so the lower id turns solid
  first and the other waits for it to move.
- **Assert on the transition, not the state.** Solid cars that drive into each other touch, and with a clearance
  margin their footprints overlap. The invariant is that protection never ends overlapping, so check the cars whose
  protection ended this tick.
- **Overflow staggering needs a non-repeating sequence.** A fixed step modulo the row gap came back to within 0.75 m of
  the slot after six layers. Roberts' R2 sequence, offset 1–7 m behind the slot, never lands on player 1's spawn.
- Host test surface (P1-F05b): a seated car follows its seat, so scripted `inputs` spans only drive unseated cars. The
  host applies the fixture's inputs first and then the seats' controls, and a silent seat reads neutral. Drive a seated
  car through its fake controller (`__jjTest.drive` + `untilFact`, which re-sends the stick every 6 ticks, the way a
  phone would; one sample goes stale after 250 ms of sim time).
- An open-ended run (the live host) has no last tick, so `jj-fixture`'s end-of-run checks never evaluate on their own.
  The surface's `outcome` calls `Harness::check_now` first.

## 2026-10-03 · The Cruz Missile from its sidecar (P1-S03a)

- **Body frame = vehicle space.** The chassis body's origin is the sidecar's (on the ground between the axles), so a
  renderer puts the GLB at the body pose with no offset. Every spawn `lift` is now a real drop: 0.1 m
  (`SPAWN_LIFT_M`, also the respawn lift and fixtures' default). A fixture or test that spawned at 0.6 m (the old
  box-centre frame's ride height) now drops 0.6 m and spends ~40 ticks in the air before the engine can act.
- **Rest at the design pose.** Wheel hard points sit `suspension_rest − static sag` above the pivots, with sag
  g / (4 × stiffness), since Rapier's spring force is stiffness × compression × chassis mass. The car rests with its
  origin ~0 m off the road.
- **Hull:** the chassis is the convex hull of the *intact body's* proxies (core, front, back, doors). The core proxy
  alone is just the cabin (z −1.64…0.92). Mass properties come from the profile's mass and the sidecar's `com` anchor,
  with box inertia from the hull's bounds. The bubbly sides roll a car off its flank and back onto its wheels; only a
  roof landing stays inverted.
- **Body roll needs `roll_influence`.** Rapier's raycast vehicle moves each side impulse (1 − 0.1) of its height up
  toward the centre of mass before applying it. That `roll_influence` is private and fixed at Bullet's 0.1, so roll is cut
  by 90 % (0.5° in a hard turn). The sim applies (up · h · (r − 0.1)) × J per wheel after `update_vehicle`, exactly what a
  public `roll_influence` of r would do. It's a profile number, not a fudge factor.
- **The profile is compiled in** (`include_str!`), so `jj sim` and the host see edits to
  `assets/profiles/cruz-missile.json` only after a rebuild. Tune with `--set`/`--sweep` first, then write the file.
- **DRIVE y is one stick.** Throttle drives; brake, or a negative throttle (the stick pulled down, as mash baselines
  throw it), brakes. Below `reverse_below_mps` it reverses, and throttle while rolling backwards brakes first. Holding the
  brake after stopping therefore reverses, so a scripted stop releases once stopped.
- **Air control** is DRIVE in the air: holding the throttle over a jump pitches the nose down, so the torques must stay
  mild (900 N·m pitch, 1,500 N·m roll). Levelling a 25° tilt takes steering into it and then back out to stop the roll.
- **Grip limits cornering, not straight-line speed.** With `friction_slip` 2.0 the tyres don't break traction under full
  engine or brake force on any surface. Surfaces show in turns: at 15 m/s on full lock for 1 s, heading change is 57° on
  tarmac, 50° on rock, 44° on dirt and 38° on gravel. The authority sweep shows lock only matters at low speed: at 15 and
  30 m/s, heading change in 0.5 s is grip-bound (about 24° and 14°) whatever the lock.

## 2026-10-03 · Drift and boost (P1-S03b)

- **The ACTION stick is in `DriveInput`** (`drift`, `boost`, journaled) from jj-input's held sectors (`SourceSemantics`),
  and it passes through the autopilot: an idle player's is neutral, and a bot's or a scenario's rides on the
  autopilot's line. Only DRIVE moving hands control back.
- **Handbrake drift** sets the rear tyres' friction slip × 0.35 at once and recovers linearly over 0.4 s. An open-loop
  drift has to be a flick (about 0.5 s) with counter-steer. Holding it for 0.75 s at 0.8 lock spins the car through
  180°. At 18 m/s the car takes about 1 s after the release to grip again, however long the counter-steer.
- **Boost-forever only lost once holding it had a structural cost.** The meter (drain 0.35/s, refill 0.12/s) makes
  boost a trickle. Trickling it out (hold forever) is as good as saving it unless spending at the wrong moment costs
  something. Three things together make the timed line win, and every 2-car autopilot run agrees:
  1. Boost overrides braking.
  2. A burst needs 0.25 of meter to start.
  3. An emptied meter re-arms only on release, so holding forever gives one burst.

  Before the re-arm rule, holding boost forever won by 9–16 m in 20 s, because the low-skill autopilot corners far
  under the grip limit. The engine power limit (`max_engine_power_w`) made no difference, so it's at 0 (off) and kept
  for tuning.
- **Baselines got two kinds** for the §7.3a claims: `no-action` (the same inputs without drift or boost) and
  `boost-forever` (boost held throughout, for every car). `differ` entries can require the deliberate run to be
  *higher* (`more`) and can name which baselines they judge (`against`). A claim like "faster with boost" then binds
  exactly those baselines, and mash is judged on something else.
- **Route `progressM` rewards cutting the infield.** It measures the nearest point along the route, so an open-loop
  car that leaves the road can gain tens of metres. Gate-based `legalProgressM` stays 0 for a car that starts mid-lap.
  Check `maxRouteOffsetM` before trusting progress, or use the autopilot for the line.

## 2026-10-03 · The wheelie (P1-S03c)

- **One detector, three callers.** jj-input's `WheelieDetector` finds the gesture: past −0.85 to preload, then up
  past −0.3 within 250 ms. Holding the preload past 1.2 s cancels it.
  - A controller sends the release as `ControllerCmd::Action`. The host applies each action id once, since it can
    arrive twice on the reliable channel.
  - The host's own `SourceState` detects host pads' and keys' releases.
  - Fixtures with raw `stick` spans run the same `SourceState` per car.

  The sim never sees the stick, only `Sim::wheelie(car, preload_ms)`, which is journaled (`Setup::Wheelie`) and
  replays.
- **`DriveInput::from_semantics`** holds the one sign convention between jj-input (steer −1 left .. +1 right) and the
  sim (positive steer turns left). The host and fixtures both call it.
- **Lift is an impulse at the front axle.** 1,500 N·s at full preload gives ≈9° nose-up and 0.5–0.6 s with the front
  wheels off the ground, about 0.44 m of front lift. That hops a 12 cm kerb, and the car lands on four wheels.
  2,500 N·s stood the car up at 21° for a second. Lift scales with preload up to 0.4 s, so a 0.15 s release only
  squats the nose up 1.7°.
- **Steering while the front is up** needs no extra rule: raycast wheels in the air have no grip, so the car can't
  turn until they're down.

## ACTION utilities (P1-S08)

- **Utilities ride the wheelie's path.** jj-input's sector machine fires `UtilityForward` / `UtilityRear` on a
  deliberate entry (neutral re-arm, hysteresis; a pointer cancel neutralises without firing). The host applies a
  controller's `Action` once per id, detects host pads itself, and fixtures with `stick`/`action` spans run the same
  source machine. The sim sees only `Sim::utility(car, kind)`, journaled (`Setup::Utility`), so it replays.
- **Cooldowns live in the sim, in ticks** (`utility_ready` in `ActionState`): a deliberate re-entry inside the
  cooldown reaches the sim and is refused there, so the journal shows the attempt.
- **Spawn protection ghosts props.** A protected car (the first 1.5 s after a spawn, and until it's clear of debris)
  collides only with the world, so it drives straight through a cone. A duel that needs contact waits out the
  protection, then places its cars (`place` doesn't re-protect).
- **A cone's cost is its mass.** A 4.5 kg cone cost a 20 m/s follower 0.08 m; 8 kg costs about 0.3 m with a visible
  jolt and never wrecks. That's the TUNE lever, not a scripted slowdown.
