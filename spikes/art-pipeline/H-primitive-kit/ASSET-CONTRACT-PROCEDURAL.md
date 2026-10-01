# Procedural vehicle profile — `jj-vehicle/0.1-draft+procedural`

The same contract as `spikes/art-pipeline/G-cruze-v2/ASSET-CONTRACT.md` (nodes, `jj_*` extras, semantic materials, colliders,
anchors, sidecar), for vehicles that are **defined in code** and baked to GLB by `tools/bake.mjs`. A game consumes the GLB + sidecar
only; it does not know or care that code produced them. Every rule below is enforced by `tools/validate_asset.mjs` and proven
by `tools/selftest.mjs` (25 injected defects).

## Files (`asset/cruze/`)

| File | What |
|---|---|
| `cruze.lod0.glb` | hero / close-up, optional richer variant |
| `cruze.lod1.glb` | **baseline close gameplay mesh** (always loaded; physics colliders are authored against it) |
| `cruze.lod2.glb`, `cruze.lod3.glb` | medium / distant |
| `cruze.asset.json` | sidecar: parts, joints, mass, colliders, wheels, suspension, anchors, materials, LOD budgets, deformation and identity notes |
| `bake-report.json` | triangles / primitives / materials / bytes / build ms per LOD |

Space and units are identical to the Blender contract: glTF +Y up, **forward = −Z**, right = +X, metres, origin on the ground midway
between the axles, lowest tyre point at y = 0.

## Nodes (identical names in every LOD)

`chassis` (root visual node) → `bonnet` `boot` `door_L` `door_R` `door_rear_L` `door_rear_R` `bumper_front` `bumper_rear` `glass`
`light_head_L/R` `light_brake_L/R` `mirror_L/R` (children of the front doors) `spoiler` (optional) `wheel_FL/FR/RL/RR` `susp_FL/FR/RL/RR`;
anchors `cam_fp cam_tp_target com exhaust_0 lplate_front lplate_rear roof_number`; colliders `col_chassis col_cabin col_<panel>
col_wheel_XX` (no material; children of their part; `extras.jj_collider = {shape, part}`).

* Hinged parts have their origin **on the hinge line** (a bbox face); wheels at the hub; suspension at the top mount.
* Every detachable part is one self-contained node (its own meshes, collider and mass) so the game can re-parent it and hand it to the
  physics engine with its current pose and dents.

## Where this profile differs from the Blender profile (all by design, all validated)

| Blender profile | Procedural profile | Rule |
|---|---|---|
| dents = authored morph targets `<part>_dent` | **runtime vertex dents** from hit records `{part,pos,dir,radius,depth,severity}`; `jj_dent` lists `<part>_dent` names but `jj_dent_mode = runtime-vertex`; no morph data | `dent.resolution` (mesh dense enough to dent) |
| `jj_paint` carries a baked mask texture, UV0/UV1 | **vertex colours (`COLOR_0`) carry baked dirt/AO; the game tints `jj_paint`**. No UVs except the trim atlas | `vertex_colours`, `uv.policy` |
| textures 1024²/512²/256² per LOD | one **256×128 trim atlas** (grille honeycomb + slats), shared by all LODs | `budget.textures` |
| single node per wheel | `wheel_XX` (steer) → child `wheel_XX_spin` (spin) [+ `wheel_XX_hub`]; `jj_spin_node` names it | `rig.wheels` |
| — | hinge/spin **sign conventions are tested**: positive rotation about `jj_axis` opens doors outward / lifts lids; positive `jj_axis_spin` rolls forward | `rig.hinge_direction` |
| triangle counts are hypotheses | **hard budgets** in `tools/budgets.json` | `budget.*` |

## Semantic materials

`jj_paint` (tint × COLOR_0), `jj_accent`, `jj_tyre`, `jj_wheel` (alloy), `jj_metal`, `jj_metal_chrome`, `jj_glass`, `jj_plastic`,
`jj_plastic_gloss`, `jj_plastic_trim` (the atlas), `jj_underside`, and emissive `jj_headlight` / `jj_brakelight` / `jj_indicator`
(non-zero `emissiveFactor`; the runtime scales `emissiveIntensity`). Each carries `extras.jj_semantic`.

## Node extras

`jj_part jj_kind jj_joint(fixed|hinge|spin|compound|suspension) jj_mass_fraction jj_attach jj_detachable jj_hp jj_collider jj_dent
jj_dent_mode jj_axis jj_range_deg jj_open_sign jj_axis_spin jj_spin_node jj_axis_steer jj_range_steer_deg jj_driven`. Mass fractions sum to
1.0 ± 1e-3 (chassis is the remainder); detached masses are realistic (door ≈ 22 kg, wheel+tyre ≈ 29 kg).

## Budgets (enforced, `tools/budgets.json`)

| LOD | role | triangles | primitives | bytes | mean paint edge (dentability) |
|---|---|---|---|---|---|
| 0 | hero | ≤ 22 000 | ≤ 96 | ≤ 1.0 MB | ≤ 0.16 m |
| 1 | gameplay (baseline) | ≤ 4 800 | ≤ 68 | ≤ 360 KB | ≤ 0.30 m |
| 2 | medium | ≤ 2 200 | ≤ 56 | ≤ 240 KB | ≤ 0.50 m |
| 3 | distant | ≤ 1 150 | ≤ 52 | ≤ 190 KB | ≤ 0.80 m |

Also: ≤ 1 embedded texture ≤ 256×128; ≤ 14 materials; no part > 32 % of triangles (chassis ≤ 50 %); each LOD ≥ 1.8× cheaper than the one
above; overall bounds within 6 cm across LODs; silhouette IoU vs LOD0 ≥ 0.96/0.93/0.90 (LOD1/2/3). These are asset budgets — never player
caps — and should be re-derived from the host frame budget once G-PERF exists.

## Runtime handle (`kit/rig.js`, contract-only)

`createVehicleRig(scene, sidecar)` → `setPaint` `setLights({head,brake,indicator})` `setSteer` `setWheelSpin` `setSuspension`
`openPanel(id,0..1)` `dent(id, worldPoint, worldDir, {severity})` `detach(id)` (returns node, mass, collider vertices for the physics side)
`reset()`; `bakeIntactTemplate(scene)` (merge to ~18 draws/car until the first hit) and `pickLod(projectedPx, current)` with hysteresis.

## Recognition invariants (`recog/spec.js`, measured from the reference orthographics)

Roofline (long shallow screen, roof peak behind the wheelbase centre, long rear slope), six-light greenhouse (front door / rear door /
quarter), swept parallelogram headlamp with projector + amber indicator, slatted bar over a chrome-framed hex grille, honeycomb lower
intake, wide shallow fog recesses, wrap tail lamps with a lighter reverse section, five-spoke alloys, wheel radius 1.05–1.5× the real one
(chunky, not silly). Gates: `recog.roofline`, `recog.glass`, `recog.lamps`, `recog.grille`, `recog.proportions`, `silhouette.reference`.

## Running the gates

```
node tools/check_asset.mjs --bake --selftest     # rebuild GLBs, validate, physics, GLB render gates, determinism, 25-defect selftest (~35 s)
node tools/check_asset.mjs --fast                # validator + physics only, no browser (< 1 s)
```
