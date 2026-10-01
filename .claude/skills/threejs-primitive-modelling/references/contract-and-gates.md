# Contract profile and the gate suite

Everything below lives in `assets/tools/` (canonical: `spikes/art-pipeline/H-primitive-kit/tools/`). Adapt the constants at the top of
`validate_asset.mjs` (part names, semantics, tolerances) and `budgets.json` to your project's contract; the rule *structure* is reusable.

## Export (`kit/contract.js` + `tools/bake.mjs`)
* Convert kit space to the game's space (here: rotate π about Y so forward = −Z) by baking into vertices and positions — not by rotating a root node.
* The **part node is the mesh** (one primitive per material via `mergeGeometries(..., true)` and a material array). Textured decoration goes to a
  `<part>_trim` child node (`jj_part_of`, no mass). Mirrors are children of the front doors; colliders are children of their part.
* Hinged parts: origin on the hinge line. Wheels: hub. Suspension: top mount. Front wheels: `wheel_XX_steer` (steer) → `wheel_XX` (spin mesh); brake hardware is a
  non-spinning sibling `wheel_XX_hub` (empty group at lower LODs so node names match).
* Semantic materials `jj_<semantic>[_variant]` with `extras.jj_semantic`; emissive lamps need a non-zero `emissiveFactor`.
* Colliders: box (panels), convex hull (bumpers, chassis, cabin — sparse point sets via per-bin outermost points → `ConvexGeometry`), cylinder (wheels); strip their
  material in the GLB JSON afterwards. Sidecar keys: `wheels.wheel_FL`, `suspension.wheel_FL` (with `hub_node`).
* GLTFExporter writes `matrix` nodes, not TRS; multi-primitive meshes share vertex buffers (read per-primitive index ranges, edit each accessor once).

## Rule families in `validate_asset.mjs` (id → what it catches)
`nodes.*`, `space.origin/forward`, `pivots.wheels/hinges/suspension`, `extras.parts/trims`, `mass.sum`, `colliders.present/no_material/shape/fit/underbody`,
`materials.semantic/emissive`, `anchors`, `sidecar.agreement`, `budget.triangles/draws/bytes/textures/parts`, procedural: `vertex_colours`, `uv.policy`,
`dent.resolution`, `rig.hinge_direction` (a positive rotation opens doors outward / lifts lids / rolls wheels forward), `rig.wheels`, `rig.detach`,
recognition: `recog.roofline/glass/lamps/grille/proportions`; cross-LOD: `lod.nodes_same/pivots_same/silhouette/reduction`.

## Other gates
* `tools/physics/gates.mjs` — Rapier headless, 120 Hz, vendored vehicle setup: load (mass sum, hull builds, **static stability factor ≥ 1.2**), settle, throttle, brake,
  turn, rollover scan, detach door/wheel (with damping + grace period), determinism (hashed trajectory), underbody-gap sanity.
* `tools/render_gates.mjs` — loads the **GLBs** via GLTFLoader: LOD-vs-LOD silhouette IoU, silhouette vs the real reference, rig smoke (`kit/rig.js`), 24-car grid perf.
* `replay_test` — same hit list on two instances → identical vertex hash; template geometry untouched (copy-on-write).
* `tools/selftest.mjs` — inject 26 defects (pivot off, centred hinge, missing collider, mass drift, forward flipped, no vertex colours, collider with material, coarse
  mesh as baseline, hinge sign, sidecar drift, non-semantic material, lamps not emissive, missing extras, roof anchor low, lifted wheels, cabin as a box, over budget,
  lamp moved, roof chopped, radius lie, non-detachable door, floating chassis hull, extra texture, missing steer ref, missing trim node) and assert each trips its rule;
  the untouched asset is the control. **A new rule is not done until it has a defect that trips it.**
* `tools/check_asset.mjs [--bake] [--selftest] [--fast]` — one CI entry point (~35 s full, < 1 s fast).

## Cross-checking against an existing validator
Run it on the baked asset. Expect it to fail only the rules your profile replaces on purpose, and document each. For the Cruze: `uv.present`, `uv.overlap`,
`morphs.present`, `materials.paint_mask`. Its other complaints found three real export bugs (mesh not on the part node; missing trim slots; LOD node names).
Vendor any physics setup you reuse as a dated snapshot with a header; the source may be mid-iteration.

## Numbers to reuse as starting budgets (small sedan)
Triangles 22 k / 4.8 k / 2.2 k / 1.15 k (tiers 0–3); primitives ≤ 96/68/56/52; bytes ≤ 1 MB/360/240/190 KB; ≤ 1 texture ≤ 256×128; ≤ 14 materials; no part > 32 % of
triangles (chassis ≤ 50 %); each tier ≥ 1.8× cheaper; bounds within 6 cm; silhouette IoU vs LOD0 ≥ 0.96/0.93/0.90; 24 cars at 4K < 33 ms and < 1000 draws.
