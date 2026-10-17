# br-bbki.25 (P1-FL07c): landing and colliding relaunched the car

Owner playtest 2026-10-17: "there were some issues when landing and colliding which kinda re launched the car into the
air in a strange way".

## Reproduced: a guard rail acted as a ramp

`crates/jj-sim/tests/rails.rs` `a_car_driven_or_landed_into_a_rail_is_turned_not_thrown_into_the_air`: a Cruz meets the
rail yard's W-beam (0.8 m high) half a metre from its face, 100 contacts: on its wheels or still in the air at a landing's
height and sink rate (0, 0.2, 0.45, 0.8 m up; 0 to -4 m/s), 12 to 40 m/s, 10 to 75 degrees.

Before: 24 of 100 threw the car: climbing at up to 13.7 m/s (0.45 m up, 40 m/s, 60 degrees) and rising up to 4.8 m, in the
air for nearly 2 s. The worst were a car still at landing height meeting the beam, so its sloped underside and nose met the
beam's top edge: exactly "landing and colliding".

## Cause, by experiment

| Experiment | Result |
|---|---|
| Ground-level approach (no landing) vs a 1.5 m drop | Ground-level hits launch just as hard: it isn't the landing judge or the righting. |
| A crash landing alone (canyon leap, throttle pinned through the flight, `landing_collision.rs`) | Righted on its wheels within 0.5 s, no climb after touchdown: not the crash self-righting torque. |
| Wheel rays ignore a rail that contains a wheel's hard point | Bit-identical results: not the "ray starts inside a solid" case. |
| Wheel rays ignore rails entirely | Same launches: not the suspension finding the beam's top. |
| The rail's spring | Its prismatic joint slides only across the road; it can't push up. |
| Rail contacts' normals laid flat for side hits | 24 throws become 0. **This is the cause.** |

The rigid beam is a box with rounded edges. A car's convex hull is wedge-shaped (bumper low, bonnet sloping up). Met at an
angle, especially from the air, the contact on the beam's top edge or the hull's sloped nose has a normal that tips upward,
and the solver lifts the car over the rail: a ramp. A real W-beam deforms around the car and redirects it.

## Fix

`crate::climb::Hooks::rail_side_hit` (the sim's contact hook, which the nose climb already uses): a contact between a guard
rail and anything else whose normal's |y| is below `sideNormalMaxY` (0.95, `assets/physics/guard-rail.json`, validated) is
a side hit, and its normal is laid flat: the beam pushes across, never up. A car resting on the beam's top (a near-vertical
normal) keeps the solid top. No velocity is clamped; the contact model changes. Rail colliders carry
`ActiveHooks::MODIFY_SOLVER_CONTACTS`, and the sim steps with the hooks whenever the map has rails.

After: 0 of 100 throw the car (worst climb 3.0 m/s, the extreme 0.8 m up, sinking 4 m/s, 40 m/s nearly head-on; bound
3.5 m/s and 1 m of rise). The worst case before replays bit for bit from its journal (same test).

## Still passing

- Rails: passive spring creates no energy, bolted neighbours, the speed/angle contact sweep, the compliant corner.
- jj-sim (37 test binaries incl. air landing tiers, takedowns, duels, feel), jj-wasm-host, jj-fixture: all pass (RCH).
- `crates/jj-procgen/tests/landing_collision.rs`: landing into a parked car (no relaunch) and a crash landing righted
  without relaunch (throttle or brake held through the flight).

## Not covered

- Rails are the only sprung world piece; static world boxes (walls, kerbs) weren't swept here.
- Clipping the beam's top while flying over it can still tip a car: that contact is the beam's top, kept solid.
