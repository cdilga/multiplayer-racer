# Wheel rigging (glTF / Three.js)

Validated 2026-06-28 against three.js docs, the glTF 2.0 spec, and community threads.

## The pivot hierarchy (order is load-bearing)
```
chassisGroup
  └ suspensionGroup   // position.y  ← suspension travel
     └ steerGroup     // rotation.y  ← steering (front wheels only)
        └ rollGroup   // rotation.x  ← wheel spin (axle = local X)
           └ wheelMesh // geometry centered on the spin axis
```
- Rotations are about a node's **local origin**, never the visual mesh center.
- **Steer must be a PARENT of roll.** If roll parents steer, steering tilts the spin axis → wobble.

## The metric that actually matters
For wheel **spin** (rotation about the axle X), what matters is the geometry's offset
**perpendicular to the spin axis** = `√(centerY² + centerZ²)`. A wheel can sit offset *along* its
axle (X) and still spin perfectly true. Do **not** gate on raw 3D offset — that produces false
positives. `scripts/inspect-wheel-pivots.mjs` computes the correct metric.

## Recenter strategies (in order of preference)
1. **Author-time (best):** in a DCC tool, set each wheel's origin to the hub and align the spin
   axis to a clean local axis before glTF export. Requires Blender/Maya/etc.
2. **Runtime, ancestor-aware:** `new THREE.Box3().setFromObject(mesh).getCenter(v)` → position a
   pivot group at `v`, offset the mesh by `-v`.
3. **Runtime, geometry-only:** `BufferGeometry.center()` on a **clone** of shared geometry (note:
   `center()` ignores transformed ancestors).

## Failure modes to flag, not paper over
- **Fused wheels** (e.g. both rear wheels in one mesh) → cannot rig per-wheel; needs author-time split.
- **Wheels pivoted at world origin** with large geometry offsets → orbit "on a stick"; author-time fix.
- Observed in practice: cohesive low-poly kits (Kenney-style) usually ship per-wheel meshes centered
  on the spin plane (rig directly); some single-export packs (certain Quaternius Poly-Pizza ids)
  fuse/mis-pivot wheels (need a fix).

## Sources
- https://threejs.org/docs/#api/en/core/BufferGeometry.center
- https://discourse.threejs.org/t/centering-a-gltf-geometry/6841
- https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html  (node transform M = T·R·S)
