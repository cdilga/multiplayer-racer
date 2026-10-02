# Damage-ready vehicle contract — `jj-vehicle/0.2-draft+destruction` (tool-agnostic)

Written for the Three.js primitive pipeline in this spike, but nothing here assumes how geometry was authored. The Blender comparison
spike should produce the same structure, so the two can be judged on output.

Kit space: metres, +Y up, origin on the ground between the axles. (The procedural code uses +Z forward and +X = car's left; a
GLB bake rotates half a turn to the existing −Z-forward contract space.)

## 1. Four representations, never one surface doing two jobs

| Representation | What it is | Who reads it |
|---|---|---|
| **Intact fast path** | Per LOD, everything an undamaged car shows, merged per material slot (4 meshes + 4 wheels = **8 draws**). Coarse LODs may use a different, cheaper surface (L3 uses the uncut body with no panel shells). | Renderer only, until the first meaningful hit |
| **Damage-ready assembly** | Semantic parts (§2), each a closed object, over a chassis husk with real openings and cavities. Carries the morph channels (§4). | Renderer after the first hit; detached parts |
| **Physics proxies** | Authored cuboids/cylinders per part plus a staged chassis compound (§6). Never derived from render vertices. | Physics |
| **Descriptor / sidecar** | Part ids, pivots, attachment, hinge axes, masses, channel names, collider shapes, anchors, LOD specs. **Identical across LODs** (gate `lod.semantics_identical`). | Gameplay, physics, networking, replay |

At zero damage the swap from intact to assembly must be visually indistinguishable: measured pixel difference L0 ≤ 0.07 %,
L1 ≤ 0.12 %, L2 ≤ 0.21 %, L3 ≤ 0.25 % (`out/sheet_swap.png`).

## 2. Parts

`chassis` (core, never detaches) · `door_L/R` · `door_rear_L/R` · `bonnet` · `boot` · `bumper_front/rear` · `light_head_L/R` ·
`light_brake_L/R` · `mirror_L/R` (children of the front doors) · `glass` (fixed: smashes, never detaches) · `wheel_FL/FR/RL/RR`.
Anchors: `cam_fp cam_tp_target com exhaust_0 lplate_front lplate_rear roof_number susp_XX`.

Each part has `{kind, hp, massKg, joint, detachable, attach, hinge{point, axis, sign, max}, channels[], collider}`. Hinged parts have
their origin on the hinge, and wheels have theirs at the hub. Masses sum to the vehicle mass; the chassis is the remainder.

## 3. Mesh rules for detachable parts

* **Closed shells.** Every door, lid, bumper and lamp has an outer skin, an offset inner skin on the *same grid* (so they deform as a
  pair), and a perimeter rim. Declared visual thickness: doors 20 mm, lids 22 mm, bumpers 40 mm, lamp lenses 22–30 mm. Inner skins
  have their own treatment: door card with inner glass, painted underside with bracing, black plastic.
* **Something intentional behind every panel.** The chassis is cut exactly along each outline. A jamb wall runs from the cut
  edge to a cavity back, and each cavity has contents:

  | Opening | What's behind it |
  |---|---|
  | Door | Sill floor, roof-rail ceiling, far wall, seat, wheel |
  | Bonnet | Engine bay: block, rocker cover, airbox, battery, radiator, strut towers |
  | Boot | Well with spare wheel and box |
  | Bumper | Recess, end panel, crash bar |
  | Lamp | Socket |
  | Wheel | Hub, axle, strut |

  Coarse LODs replace the cut with a dark patch on the panel's own grid, inside its thickness.
* **Layers.** `vis` (intact + assembly), `panel` (cut chassis, jambs, cavity backs, panel outer skins), `occ` (only revealed by damage:
  inner skins, cavity contents, sockets). The intact fast path never draws `occ`.

## 4. Deformation channels

* **Zones** `damage_FL damage_FR damage_RL damage_RR damage_ROOF` ∈ [0,1]. Each is one smooth space-warp applied to *every attached
  part*: chassis, cavities, panels, lamps, glass. Wheel hubs follow the warp (with toe and camber).
* **Panel dents** `dent_<panel>` ∈ [0,1]. One designed dent per panel (door push-in with crease, lid tent, bumper squash and skew),
  applied to that panel and to parts riding on it (mirrors ride the door).
* Designed for silhouette at gameplay distance, not 12 cm dents. Morph targets carry position, normal (transformed by the cofactor
  of the warp's Jacobian, so they're exact) and colour (scuff and darkening).
* **Invariants, all gated:**
  * det(I+∇d) > 0.2 for every channel and for all zones together (measured worst: 0.38). A local bijection can't make nested
    surfaces cross.
  * Shells stay closed at full damage: outer skin stays on the outer side, separation ≥ 0.35× declared thickness.
  * Dents never bury a panel in cavity contents (two-sided parity raycast).
  * Nothing goes below ground.
* Morphs need only be valid for their own LOD. Coarse LODs (no cavity under a panel) scale panel dents to 25 % but keep the full scuff.

## 5. Lifecycle

`fixed → damaged → loose (hinge spring / wheel wobble) → detached`. Not every part uses every state; glass goes `fixed → smashed`.
**Detach** freezes the part's channel influences (it keeps the crush it had) and keeps its world pose. The part becomes a dynamic
body with its authored collider and mass, the car's velocity at the attachment point (v + ω×r) and the hit impulse. A 0.25 s
collision grace stops it fighting its own car. Riders leave with it; chassis mass is reduced by what left.
**Wreck** (chassis hp ≤ 0): drive input is cut and the body stays dynamic for the round with all its damage. The player gets a
fresh car. Debris and wrecks are never deleted, frozen, made static or count-limited. Rapier sleeps and wakes them. Cleanup
happens at round end only.

## 6. Physics proxies

Chassis compound: `col_body`, `col_nose`, `col_tail` and `col_cabin` cuboids, plus one wheel-support ball per attached wheel.
Stage variants shorten the nose/tail box at zone ≥ 0.45 / ≥ 0.85 and lower the cabin box with the roof zone. They're swapped only
when a stage boundary is crossed. Detached parts use their authored cuboid (door: thin box over the outline) or cylinder (wheel).

## 7. LOD

| LOD | Role | Intact tris (target) | Intact draws | Assembly tris / meshes |
|---|---|---|---|---|
| L0 | Hero / close replay | **14,066** (10–15k) | 8 | 20,870 / 40 |
| L1 | Gameplay-near | **4,667** (3–5k) | 8 | 7,383 / 40 |
| L2 | Gameplay-far | **1,788** (1.2–2k) | 8 | 2,292 / 39 |
| L3 | Tiny / pressure | **704** (450–800) | 8 | 1,352 / 39 |

Each rung is ≥ 2× cheaper than the one above (2.7×, 3.0×, 2.5× intact). Selection is
`selectLod(projectedPx, qualityBias, current)`: thresholds 520 / 190 / 70 px of the bounding-sphere diameter, ±15 % hysteresis,
and each +1 bias roughly one rung cheaper. A `QualityGovernor` raises or lowers the scene-wide bias from sustained frame time. It
never touches physics or entity counts. Detached parts and wrecks keep switching LOD as normal. Sleeping wrecks are drawn from a
baked merge of their current deformed state (4 draws instead of ~40). That is render batching only; their physics is unchanged.

## 8. Materials

Four slots: `paint` (tinted per car), `trim` (one atlas, per-vertex roughness/metalness), `glass`, `lamp` (per-vertex emit class ×
per-car uniforms). Part hierarchy and material hierarchy are independent. Swap-in variants: `glassSmashed`, `lampDead`.
