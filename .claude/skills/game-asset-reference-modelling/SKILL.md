---
name: game-asset-reference-modelling
description: Build or refine a game asset against visual references within its rendering budget. Use for reference likeness, silhouette and curvature corrections, geometry allocation, and measurable shape regression checks across LODs.
---

# Game Asset Reference Modelling

Turn reference observations into geometry changes and repeatable checks. Apply this to props,
buildings, characters, terrain pieces and vehicles using the asset's existing authoring pipeline.
The reusable method is camera alignment → measured form → targeted geometry → local tests →
review in the target renderer. Hawk Dash is a worked example, not a template for every asset.

## Establish the comparison

For a likeness or roster refinement, read [shaded comparison](references/shaded-comparison.md). This is the acceptance loop for the 25 October owner-requested rework: shaded form and internal landmarks must be compared directly; an enclosing-outline pass alone does not establish likeness.

- Identify the authoritative references, asset source, export path and current baseline. Preserve
  the reference and baseline so improvements can be compared under identical conditions.
- Read the asset's contract: units, axes, dimensions, budget per LOD, materials, rig/pose,
  interaction and collision constraints. Preserve physics, joints and anchors during visual-only
  work unless the task also calls for changing them. No universal triangle or material count applies.
- Describe mismatches as observable features: “base too narrow,” “shoulder widens too high,”
  “opening too rectangular,” or “corner stays straight too long.” Rank by recognition and gameplay
  visibility. More detail is not itself a correction.

## Resolve cameras before changing form

Match reference orientation, pose, projection, framing and optical axis. For perspective, also
consider distance and field of view: matching image size alone does not match perspective.
Use consistent diagnostic views; keep presentation cameras separate.

The silhouette mask and shaded comparison must use the same camera. Freeze the comparison setup
for before/after captures. If it changes, recapture both candidates and label the change; old
scores are no longer directly comparable. Do not distort geometry to compensate for a camera
error. Generated sheets may be internally inconsistent: document the chosen interpretation rather
than claiming exact camera calibration. Midpoint cameras and long lenses were appropriate for
Hawk's end views, not universal settings for characters, buildings or other references.

## Fit the volume and transitions

Fix the enclosing form before surface detail. Inspect opposing views and sections as well as a
three-quarter view. Maximum dimensions can be correct while most of the asset remains too narrow.

Measure width at several heights or longitudinal sections, the change between sections, where
widening begins, corner taper and negative spaces. For organic assets, use a meaningful local axis
and consistent pose. Examples of useful observations:

| Asset | Sections and transitions worth checking |
|---|---|
| Prop | Base, neck, bevel, opening and handle gap |
| Building | Footprint, wall slope, roof spring, eaves and arch opening |
| Character | Torso/limb sections, joint transitions and pose silhouette |
| Terrain piece | Ridge profile, slope breaks, overhang and traversable gap |
| Vehicle | Lower stance, shoulder, cabin taper and end curvature |

Correct the surface that generates the wrong shape. Adding boxes or trim to a wrong substrate
usually hides one view's error and damages another. When clipping a profile or lifting an edge
around a cutout, evaluate the original profile at the new height; otherwise its widest point can
move upward with the cut. Check cross-sections for unintended vertical walls and abrupt bulges.

## Allocate geometry by visible benefit

Audit exported triangles by part and repeated feature, at every relevant LOD. Repetition can
consume the budget unnoticed: wheels, bolts, roof tiles, foliage clusters or repeated trim.
Simplify expensive repetition where shading or texture preserves the intended result. Retain
depth where silhouette, parallax, deformation, interaction or an opening requires it.

Spend the recovered budget on the most recognizable form errors. Place stations/edge loops where
curvature or slope changes, not uniformly by habit. Low-poly faceting should express the curve's
direction. Inspect the smallest expected gameplay size before buying detail that disappears.
Measure the actual exported result; source primitive counts can miss duplicated or baked geometry.

## Attach details to the finished surface

Deform the substrate before projecting graphics or attaching surface features. Independently
warping a triangulated surface and clipped graphics can put them on different planes even when
they share a mathematical curve. Share triangle diagonals, or reproject onto the actual final
facets. Limit projection hits to the intended part/region so nearby geometry cannot steal them.

Keep layer offsets coherent and check occlusion from both sides of a sloping panel. A correctly
placed feature can disappear behind another surface. At coarse LODs simplify graphics and trim
while keeping them continuous, visible and inside the intended contour; flat overlays can square
off a rounded silhouette.

## Turn the observed errors into local gates

Read [local shape tests](references/local-shape-tests.md) when implementing or extending checks.
Derive expectations from unchanged references, not the revised model's parameters. Use whole-view
silhouette IoU alongside local section widths, width changes, taper, openings and internal feature
landmarks/envelopes. A high average score can hide the most recognizable mistake.

Check current geometry or current rendered pixels, with explicit source, LOD, state/pose and camera
identity. Set tolerances from reference uncertainty, resolution, faceting and intended style.
Prove the previous bad candidate or a meaningful injected defect fails, then check the correction
across relevant LODs. Geometry projection cannot prove visibility, shading or material correctness;
retain renderer review. Add only the tooling needed for the asset and observed failure.

## Close the loop in the real pipeline

### Avoid the weak-pass trap

A technically valid export and an almost unchanged aggregate score are not evidence that a
reference refinement succeeded. The roster pass following Hawk demonstrated this: models passed
broad contour gates while retaining short proportions, sloped-away lamps, upright slabs and
incorrect window envelopes. Treat the owner's named visual defects as the work's acceptance
questions. Record each defect in a large reference/previous/current comparison, correct its
generating surface, then show what changed in that region. A finer helmet, window or bevel does
not excuse a still-wrong torso, cabin or enclosing volume.

Check internal proportions independently of the enclosing mask. Useful examples are body length
relative to axle spacing, opening dimensions relative to a wall, or head/torso proportions.
Normalization preserves aspect but can still hide absolute scale, landmark placement and the
effect of thin protrusions on the bounding box. Inspect any score/section disagreement rather
than tuning to whichever report passes. Surface-normal or depth-section checks can expose a
feature flattened onto the wrong plane even when its projected envelope overlaps the reference.

If helpers do the modelling, give them the actual defect, authoritative views and unchanged
constraints, and require an early visual diagnosis and large comparison images. The integrating
agent looks at those images and sends specific corrections before accepting their work. Inspect
coarse tiers separately: removing a station can erase a semantic transition such as painted roof
to rear glass, while removing hidden thickness can preserve the same silhouette cheaply.

Use diagnostic cameras to judge shape and a separately justified reference hero camera to judge
recognition. Copying another asset's hero azimuth can change front/side balance enough to mislead
the comparison. When changing that convention, recapture both candidates. Finally, publish the
new evidence with the new assets; stale comparison sheets make a correct deployment unreviewable.

Export and load through the actual target renderer. Review relevant LODs, poses/states, material
variants and gameplay scales. Capture reference/previous/revised/difference views and enlarge the
regions that motivated the work. Look at every capture; inspect details that numeric masks miss.

Record budget totals, local checks, whole-view changes, camera conventions and remaining errors.
Report regressions as well as gains. Verify reproducible export and the contract requirements
affected by the change. Publish a review candidate when authorized by the task, following the
project's preview workflow; record which build/assets were inspected.

## Repository routing

For roster vehicles, also use [lowpoly-model-from-refs](../lowpoly-model-from-refs/SKILL.md), the
canonical R81 authoring method, and [vehicle-model-validation](../vehicle-model-validation/SKILL.md)
for acceptance. Their vehicle contracts do not become requirements for unrelated assets.

Read the [Hawk case study](references/hawk-case-study.md) for concrete source paths, tools, measured
results and pitfalls from the accepted result. Reuse its math and comparison approach for other
assets; adapt the asset adapter and reference annotations instead of assuming its vehicle CLI
imports arbitrary models.
