---
name: lowpoly-model-from-refs
description: Model and refine faceted game vehicles from reference sheets in three.js, comparing shaded forms, internal proportions and surface depth as well as silhouettes. Use for roster vehicle shape, likeness and LOD work.
---

# Low-poly model from refs

Reference implementation: `spikes/art-pipeline/J-cruze-lowpoly/` (copy it; only `model.js` and the view weights are per-model).

## 1. Generate refs (image gen)
One sheet per detail level, same layout every time: **hero 3/4 front (top-left, large) · top view (right column, nose down) · bottom row front · side (nose left) · rear**.
Plain light-grey studio background, soft shadow, no text/logos/badges. Then one damage-concept sheet.

> Low-poly game asset turnaround sheet, 16:9, light grey seamless background. Same car in every view: large 3/4 front hero top-left, top-down plan view on the
> right (nose at bottom), bottom row front, left side (nose left), rear. *<subject + livery: e.g. bubbly cyan Cruze sedan, magenta/lime/white lightning-bolt
> livery, black nudge bar with 4 cyan LED blocks, UHF whip on the nudge bar, raked wing>*. **<LOD line>**. Flat-shaded facets, clean studio light,
> no text, no logos, no badges, no plates.

LOD lines (generate all four, keep the car identical):
- max: `high-poly, smooth curvature, detailed 8-spoke rims` (style target only; don't build this)
- lod+2: `mid-poly, visible facets, 5-spoke rims`
- lod+1: `low-poly, chunky facets, simple 5-spoke rims` ← build target for LOD0
- lowest: `very low poly, ~300 triangles, octagon wheels, lights as flat decals` ← LOD2

Damage sheet: `same car, stages intact → loose hanging panels → front detached → doors and a wheel off → shell; detached parts row: front, doors, back, wheel`. Jammers damage follows R86: no dents.

## 2. Loop
1. Establish the immutable reference, current source/bake and comparison cameras. For existing assets use `tools/vehicles/fit/capture.mjs <car> --lod 0 --out <dir>` and source overrides for the previous candidate. Never overwrite shared sources to reproduce a baseline. Read [shaded comparison](../game-asset-reference-modelling/references/shaded-comparison.md) before a likeness pass.
2. Inspect large **shaded reference | previous model | revised model** comparisons from front, side, rear, top and reference hero views. Preserve aspect ratio and a shared alignment; record uncertain reference cameras. Silhouette overlap is a separate diagnostic. A high IoU cannot approve flat doors, a ramp-shaped fascia, wrong glass, floating trim or an arched sill.
3. List named differences before editing: length versus wheelbase, width at lower/middle/shoulder sections, cabin/window envelope, panel roll, bumper depth/corner wrap, attachment gaps and underside/sill contour. Measure the relevant reference sections and landmarks. Prioritise enclosing volume and transitions over extra detail.
4. Build the corrected generating surfaces in `model.js` and parameter data. Spend vertices where slope changes. Clip arches against the **original** height-dependent width profile. Inspect side sections and a low camera: arch cuts must not pull the whole lower body upward. Attach livery, lamps, handles and bar mounts to the final actual facets, sharing their triangle diagonals.
5. Allocate geometry like the accepted Hawk Dash: audit repeated wheels, hidden faces and redundant thickness; preserve visible depth/negative spaces and use savings on body curvature. Run the existing bake optimiser; do not remove a visible underside or flatten a useful curve just to hit a count. Preserve frozen colliders, pivots and anchors for visual-only changes.
6. Capture again under the same cameras. Inspect full shaded views and enlarged crops of every named defect. Repeat at each LOD; coarse tiers must retain meaningful transitions and connected graphics. Add focused local regression checks from reference observations, proving the actual previous bad geometry or an injected plausible defect fails.
7. Run silhouette scoring/optimisation as supporting evidence (target weighted IoU ≈ 0.95), with roughness regularisation. Investigate score/visual disagreements. Approval requires a written per-defect visual verdict on the current shaded bake, the vehicle-validation gates and refreshed review-page evidence. Do not mark a visible mismatch accepted merely because tests pass.

For delegated passes, give each helper disjoint vehicle files, unchanged references and the actual owner defects. Require early large comparison images and diagnosis; the integrating agent opens them, sends corrections and inspects final images before accepting the handoff. Hawk Dash is the owner-approved benchmark; leave it unchanged during the 25 October roster rework.

## 3. Rules
- Budgets: ≤ 1.3k / 0.9k / 0.6k tris (LOD0/1/2). One material, one code-drawn atlas, paint key (pure-white paint is tinted per player).
- Parts: `core, front, back, door_FL/FR/RL/RR, wheel_*`; states intact → loose → detached; dark bays in core. Motorbikes use their active contract part set.
- Render one InstancedMesh per part type across all cars (draws per tile constant in N). Re-run `node bench.mjs` for 24×24 numbers.
- Pixels can't judge interior detail and the refs have perspective: never accept a higher score bought with zig-zag curves.
- Budgets and cohort bench sizes above are historical starting points, not player limits. Read the asset's qualified `vehicle.json` budgets; report actual exported per-part/per-LOD totals, including optimisation savings.
