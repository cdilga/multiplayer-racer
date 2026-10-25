Vehicle Model Validation: PASS for the owner panel-repair scope

Cruz Missile; beads br-8h3u.16 / br-8h3u.17. Requirements: R81/R86/R90, vehicle contract §6, owner observations of flat doors, floating flat bumper and curved underside. Source, atlas, params and three bakes changed; physics declarations, sidecar, collider points, anchors and handling remain unchanged. See parent `frozen-invariants.json` for hashes/base commit.

Reference/previous/current evidence: `visual-comparison.png` preserves one world camera per view and one display scale for both candidates. Reference aspect is preserved and marked uncalibrated. `after-lod{0,1,2}/sheet.png` compares shaded forms plus masks; `likeness.json` records all annotated checks PASS without changing references/tolerances. Source-form and hinge gates also pass. LOD0 weighted mask IoU 0.9470 (previous0.9511), LOD1 0.9477, LOD2 0.9306. Approximate whole-outline targets are supporting evidence; the named panel defects are verified separately by geometry and shaded inspection.

| LOD | Intact triangles | Budget | core | front | back | each front door | each rear door | each wheel |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
|0|2052|2800|290|851|599|38|30|44|
|1|897|900|160|329|272|6|6|28|
|2|590|600|152|130|172|6|6|28|

Interior engine/cabin/boot retain24/36/32 separately. Hawk-style outer-face atlas and closed inner caps save96 LOD0 triangles versus stacked wheels; body sections and independent wells spend that geometry on visible form. Shared optimiser remains unchanged and checks winding/hidden triangles. Model reproducibility passes `bake --check`; `target/debug/jj validate` reports valid `jj.vehicle.v1` with2052/897/590. Twelve focused cases reject actual previous flat waist/floor and missing coarse brackets. Final combined roster suite is in the parent receipt.

PASS: contract/reproducibility; qualified budgets/finite mesh; paint-key single material and neutral tyres; intact/loose/detached review poses and dark bays; exact frozen physics contracts; identity/colour visible at small tiles. Loader/rendering code and draw batching are unchanged, so no new instancing benchmark is claimed. Engine profiles are unchanged.

See `self-review.md` for remaining visual approximations and evidence limits. No blocking defect remains in this repair scope; full-reference artistic acceptance remains the owner's verdict.

- PASS source contract, deterministic bake, exact frozen physics and qualified triangle budgets.
- PASS named door, floor, bar mounting and wheel closure regressions at every LOD.
- PASS shaded previous/reference/current and baked paint/damage/grid evidence inspected.
- WARN full generated-reference likeness is approximate; whole-view IoU and unmeasured runtime limits remain disclosed above.
