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
