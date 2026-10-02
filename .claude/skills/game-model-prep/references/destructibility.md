# Destructible vehicle debris (Three.js + Rapier)

Validated 2026-06-28 against the Rapier rigid-body guide and three.js fracture examples.

## Pattern A — pre-authored detachable parts (recommended for vehicles)
Model panels/bumper/doors/wheels separately (many CC0 car kits ship a `debris-*` set). On death:
1. Reparent each declared part to the scene, **keeping its world transform**.
2. Create a dynamic body + cheap collider at that transform:
   `RigidBodyDesc.dynamic().setTranslation(...).setRotation(...).setCanSleep(true).setCcdEnabled(small&&fast)`
   then `ColliderDesc.cuboid(...)` or `.convexHull(Float32Array)`.
3. **Transfer the vehicle's velocity** (`setLinvel`) + an explosion kick (`applyImpulse` /
   `applyTorqueImpulse`) — or parts "pop" and drop straight down.

## Lifecycle (project policy decides; read the adapter)
Default, and the **only** option for Joystick Jammers (owner rulings R58/R66): spawn → simulate
→ bodies auto-sleep when settled (nearly free) → wake on contact → still present and dynamic at
round end. No TTL, fade-out, count cap, FIFO recycling, static conversion or merging.

Only where a project's policy explicitly allows expiry: after a TTL fade `material.opacity`
(needs `transparent:true`) → `world.removeRigidBody(body)` (auto-removes its colliders) → return
mesh + slot to a pool. Never import that pattern into JJ.

## Performance
- Sleeping is the main win: a settled pile costs almost nothing until something hits it.
- **Reuse allocation slots** to avoid physics-WASM alloc/GC churn (reuse is not removal).
- Prefer cuboid/ball/convexHull over trimesh colliders.
- CCD only on small/fast fragments (tunneling vs cost).
- `InstancedMesh`/`BatchedMesh` to cut draw calls (note: per-instance opacity isn't supported on a
  shared material — fade via scale or a custom shader for instanced debris).

## Gotchas
- `removeRigidBody` invalidates the handle — null your refs; **never revive a removed WASM object**.
  Pool the *slot/data* and recreate the desc on reuse.
- Hook destruction on the engine's "destroyed" event so it fires in **all** game modes; despawn
  behavior can differ per mode (respawn vs eliminate) but debris is the same.

## Pattern B — runtime fracture (future / non-authored objects)
three.js `ConvexObjectBreaker` (`three/addons/misc/ConvexObjectBreaker.js`,
`subdivideByImpact(mesh, point, normal, …)`) generates fragments; feed them to convexHull colliders.
The fragment-gen half is engine-agnostic; ignore the Ammo-specific demo glue.

## Sources
- https://rapier.rs/docs/user_guides/javascript/rigid_bodies/
- https://threejs.org/examples/physics_ammo_break.html
- https://threejs.org/docs/pages/ConvexObjectBreaker.html
