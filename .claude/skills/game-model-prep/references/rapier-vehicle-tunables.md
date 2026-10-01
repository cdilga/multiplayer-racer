# Ray-cast vehicle tunables (Rapier `DynamicRayCastVehicleController`)

Validated 2026-06-28 against the Rapier JS docs, the three.js rapier vehicle example, and the
rapier.js CHANGELOG. All per-wheel setters are `(wheelIndex, value)`, index in `addWheel` order.

## Setup
```
const vc = world.createVehicleController(chassisRigidBody);
vc.addWheel(chassisConnectionCs, directionCs /* {0,-1,0} */, axleCs /* {-1,0,0} */, restLength, radius);
```

## Per-wheel tunables, arcade ranges, effect
| Lever | API | Arcade range | Effect |
|---|---|---|---|
| Drive | `setWheelEngineForce(i, N)` | scaled by mass; negative = reverse | top speed / accel |
| Brake | `setWheelBrake(i, v)` | ~0–1 (very sensitive) | stopping power |
| Steer | `setWheelSteering(i, radians)` | ±π/4, lerped | turn rate |
| Susp. stiffness | `setWheelSuspensionStiffness(i, v)` | 15–40 (~24) | how hard it holds ride height |
| Susp. compression | `setWheelSuspensionCompression(i, v)` | ~0.5–4 | damping while compressing |
| Susp. relaxation | `setWheelSuspensionRelaxation(i, v)` | ~0.5–4, keep ≥ compression | stop bounce/overshoot |
| Max travel | `setWheelMaxSuspensionTravel(i, v)` | 0.1–0.5 m | suspension range |
| Rest length | `setWheelSuspensionRestLength(i, v)` | 0.2–0.8 | natural ride height |
| Long. grip | `setWheelFrictionSlip(i, v)` | 500–1000+ (Bullet-style large numbers) | forward/brake grip |
| **Side grip** | `setWheelSideFrictionStiffness(i, v)` | 0.5–1.0 (drift 0.3–0.7); default 1.0 | **lateral grip / drift — the oversteer knob** |
| Max susp. force | `setWheelMaxSuspensionForce(i, v)` | 6k–100k by mass | supports heavy cars |

## Hard rules / gotchas
- **Order of ops:** set controls → `vc.updateVehicle(dt)` → `world.step()`. Always.
- Steering is in **radians**.
- `frictionSlip` uses large Bullet-style magnitudes; "realistic" ~1 gives almost no grip.
- **`setWheelSideFrictionStiffness` is the right way to let a car slide along a wall while keeping
  forward drive.** Reducing `frictionSlip` for wall-slide also kills longitudinal grip (a common
  but blunt workaround). Side-friction is the precise tool. (Changelog typo lists
  "siteFrictionStiffness" — the real method is `setWheelSideFrictionStiffness`, present v0.11.2+.)
- Don't combine with manual `addForceAtPoint` suspension — pick one.
- The official three.js example only sets stiffness/restLength/frictionSlip/radius; compression,
  relaxation, and side-friction are yours to tune.

## Center of mass
- Explicit CoM only "sticks" if not diluted by geometric-center mass. Two clean routes:
  - set the chassis **collider's** mass properties explicitly: `colliderDesc.setMassProperties(mass,
    {x,y,z}, inertia, quat)` — this overrides the density-derived mass; OR
  - zero the collider density and use `RigidBodyDesc.setAdditionalMassProperties(mass, com, inertia,
    frame)` on the body (`setAdditionalMass(m)` alone does NOT move the CoM).
- `mass = 0` means *infinite* — always pass a positive mass.
- Lower CoM ⇒ fewer rollovers; forward CoM ⇒ understeer (stable); rearward ⇒ oversteer (loose).

## Sources
- https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html
- https://github.com/mrdoob/three.js/blob/dev/examples/physics_rapier_vehicle_controller.html
- https://rapier.rs/docs/user_guides/javascript/rigid_body_mass_properties/
- https://github.com/dimforge/rapier.js/blob/master/CHANGELOG.md
