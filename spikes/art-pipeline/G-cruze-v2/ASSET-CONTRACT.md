# Cruz Missile v2: exported asset conventions (draft for V2-61 `vehicle.schema.json`)

This is the concrete shape of what `finish_asset.py` exports. It follows plan §12.3–§12.4, §8.1–§8.2
and §5.1. Anything marked **proposal** is a gap in the current contract text that this asset fills and
V2-61 should ratify or reject.

## Files

Output directory: `art/vehicles/cruz-missile/`

| File | What |
|---|---|
| `cruz_missile.lod0.glb` | Hero/close-up detail (optional richer variant) |
| `cruz_missile.lod1.glb` | **Baseline** close gameplay mesh (always loaded) |
| `cruz_missile.lod2.glb` | Medium/distant views |
| `cruz_missile.asset.json` | Sidecar: contract version, parts, joints, mass, colliders, anchors, suspension, LOD budgets, textures |
| `cruz_missile.source.blend` | Polished Blender source (LOD0 with everything) |
| `mask.lod{0,1,2}.png` | The RGBA mask, also embedded in each GLB |
| `previews/` | Evidence captures |

## Space and units

- glTF space: **+Y up, forward = -Z**, right = +X, metres. The Blender source uses +Z up, +Y forward;
  the exporter converts `(x, y, z)_blender -> (x, z, -y)_gltf`.
- The origin is on the ground plane, midway between the axles on the centreline. The lowest tyre
  point sits at y = 0 (±1 cm).
- Every position and axis in the sidecar and node extras is in **glTF space**.

## Nodes (stable semantic IDs, identical in every LOD)

- The root visual node is `chassis`. Parts are its descendants:
  - `bonnet`, `boot`, `door_L`, `door_R`, `door_rear_L`, `door_rear_R`
  - `bumper_front`, `bumper_rear`, `glass`
  - `light_head_L`, `light_head_R`, `light_brake_L`, `light_brake_R`
  - `mirror_L`, `mirror_R` (children of the front doors)
  - `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR`
  - `susp_FL`, `susp_FR`, `susp_RL`, `susp_RR`
- Decoration sub-meshes belong to a part: `bumper_front_trim` (child of `bumper_front`) and
  `boot_trim` (child of `boot`). They have `jj_part_of` and no mass of their own.
- Anchors are empty nodes, children of `chassis`:
  - `cam_fp`, `cam_tp_target`, `com`, `exhaust_0`
  - `lplate_front`, `lplate_rear`
  - `roof_number` (its local +Y is the roof normal)
- Colliders are mesh nodes named `col_<part>`, parented to their part:
  - `col_chassis` (convex hull of the lower body) and `col_cabin` (convex hull of the cabin), both on `chassis`
  - a box for each flat detachable panel: `col_bonnet`, `col_boot`, `col_door_*`; convex hulls for the rounded `col_bumper_*`
  - a cylinder for each wheel: `col_wheel_*`
  - Colliders have **no material** and carry `extras.jj_collider = {shape, part}`. The game never renders them.
- Hinged parts have their node origin on the hinge line. Wheels have theirs at the hub.

### Node extras (`jj_*`)

| Key | On | Meaning |
|---|---|---|
| `jj_part` | every part node | stable semantic ID (= node name) |
| `jj_part_of` | trims | the owning part |
| `jj_mass_fraction` | every part | fraction of `physics.mass_kg`; sums to 1.0 over parts (±1e-3) |
| `jj_joint` | parts | `fixed` \| `hinge` \| `spin` \| `compound` (steer+spin) \| `suspension` |
| `jj_axis`, `jj_range_deg` | hinge, spin, suspension | unit axis in the node's local glTF space; range in degrees (metres for suspension) |
| `jj_axis_steer`, `jj_range_steer_deg`, `jj_axis_spin` | compound | front wheels |
| `jj_attach` | parts | parent part ID |
| `jj_collider` | parts with a proxy | collider node name |
| `jj_dent` | dentable parts | morph-target names (list) |
| `jj_detachable` | parts | bool |

## Materials (semantic)

- Material names are `jj_<semantic>` or `jj_<semantic>_<variant>`. `extras.jj_semantic` is one of
  `paint, tyre, wheel, glass, plastic, metal, headlight, brakelight, interior, decal, underside`.
- **Proposal:** two extra semantics, `indicator` (amber emissive corner lights, a Cruze identity cue)
  and `accent` (non-paint coloured hardware such as the yellow springs).
- Lights (`headlight`, `brakelight`, `indicator`) have a non-zero `emissiveFactor`. There are no
  punctual lights, cameras or animations in the file.
- `jj_paint` has the **mask** as its `baseColorTexture` on UV0. The runtime JJ paint shader reads
  the mask; the base colour is never shown raw.

## Textures

- One RGBA mask per LOD: **R** paint region, **G** pattern (twin racing stripes over the bonnet, roof
  and boot), **B** dirt/damage (from baked AO), **A** emissive regions.
- UV0 is one non-overlapping atlas across every visual mesh of the LOD, with consistent texel density.
  UV1 is a copy of UV0 for bakes. Tools read UVs in glTF convention (top-left origin).
- Sizes: LOD0 1024², LOD1 512², LOD2 256².

## Deformation

- Dentable parts carry morph targets named `<part>_dent` (panels). The chassis carries
  `chassis_dent_FL`, `chassis_dent_FR`, `chassis_dent_RL`, `chassis_dent_RR` and `chassis_dent_roof`.
  Each is localised (radial falloff) and pushes inward along the surface normal.
- Dentable: `chassis`, `bonnet`, `boot`, the four doors, `bumper_front`, `bumper_rear`. Dent names
  are identical in every LOD.

## Sidecar `cruz_missile.asset.json` (top-level keys)

- `contract`, `asset_id`, `archetype`, `display_name`, `inspired_by`
- `space`, `units`, `origin`, `bounds` (glTF-space AABB of the visual meshes, LOD1)
- `lods[]`: `{lod, file, triangles, materials, draw_calls, mask_px, role}`, where triangles are counted
  from the file's own accessors by the exporter
- `parts{}`: per ID `{node, mass_fraction, joint…, collider, dents[], detachable, attach}`
- `wheels{}`: per ID `{hub, radius, width, steer, driven}`
- `suspension{}`: per wheel `{top_mount, hub, rest_length, travel}`
- `physics`: `{mass_kg, com, profile}`
- `anchors{}`: name → position
- `materials{}`: name → semantic
- `textures.mask`: `{channels: {r,g,b,a}, per_lod_px}`
- `identity`: `{roof_number_anchor, roof_number_size_m, paint_semantic: "paint", pattern_channel: "g"}`
