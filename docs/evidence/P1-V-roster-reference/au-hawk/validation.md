# AU Hawk: reference refinement validation

Vehicle Model Validation: PASS for the bounded visual refinement and unchanged-physics proof; full production gate remains INCOMPLETE.

**Bead:** br-rgw6. **Date:** 2026-10-25. **Build:** working-tree model/bake delta over `9388bd30581aca3647ddfa95649d589ef54727b5`; parent integration/publication records the resulting commit. **Machine:** repository Mac, headless Playwright Chromium 151.0.7922.34, software WebGL. No hardware GPU or device performance qualification is claimed.

Requirements: owner R81/R86; master plan §§12.3–12.5; game-asset-reference-modelling, lowpoly-model-from-refs and vehicle-model-validation skills. Scope is source geometry and its evidence, preserving the pre-existing handling and damage contract.

## Candidate and reference decisions

The AU keeps the long rounded sedan, tall glasshouse, swept teardrop headlamps and oval grille. The most useful fixes were the disconnected lamp/decal facets, the flank roll at raised arch crowns, and the lower bumper substrate. Decals now clip to actual body triangles rather than an independent grid. The nose underside was lowered to support the slot and fog lamps at LOD0/1. The cabin dimensions were retained after an unhelpful roof experiment. LOD1 uses an extra arch station to avoid a triangular crown. Five thin silver spokes replace the repeated thick wheel geometry at LOD0/1; LOD2 uses the simple silver discs in its lowest-tier sheet.

The unchanged per-tier sheets and masks are identified by SHA-256 in `art/vehicles/au-hawk/refs/likeness.json`. `baseline-source/` freezes the original model, parameters, contract, sidecar, LOD0 collider-bearing GLB and pivots. The before/after images use the same frozen cameras: perspective projection; front/rear optical axes horizontal at 50m; side/top at 10m; front/rear hero elevation 0°, azimuth 52°/140°, distance 11m, FOV 26°, target height 0.78m. This removes the flattering elevated view from the diagnostic decision.

## Exported geometry

Counts below are the baked/pruned runtime geometry, excluding collider meshes. The fitter reports unpruned source geometry including internal bays, so its count is not the exported budget count.

| LOD | Before | After | Budget | Each wheel before → after |
|---|---:|---:|---:|---:|
| 0 | 2906 | 2104 | 3000 | 167 → 50 |
| 1 | 896 | 874 | 900 | 30 → 30 |
| 2 | 600 | 600 | 600 | 38 → 28 |

Per-part final counts (interior rows are documented separately and excluded from the exported budget total):

| Part | LOD0 | LOD1 | LOD2 |
|---|---:|---:|---:|
| core | 664 | 188 | 156 |
| front | 600 | 290 | 176 |
| back | 536 | 228 | 132 |
| door_FL | 34 | 16 | 6 |
| door_FR | 34 | 16 | 6 |
| door_RL | 18 | 8 | 6 |
| door_RR | 18 | 8 | 6 |
| wheel_FL | 50 | 30 | 28 |
| wheel_FR | 50 | 30 | 28 |
| wheel_RL | 50 | 30 | 28 |
| wheel_RR | 50 | 30 | 28 |
| interior_engine | 24 | 24 | 24 |
| interior_cabin | 36 | 36 | 36 |
| interior_boot | 24 | 24 | 24 |

## Frozen-camera silhouette results

Values are before → after. Whole-car IoU is only one diagnostic: local shapes and graphics can improve while this aggregate falls. Regressions are retained here rather than hidden by the weighted number.

| LOD | Weighted | Side | Top | Front | Rear |
|---|---:|---:|---:|---:|---:|
| 0 | 0.9652 → 0.9612 | 0.9630 → 0.9617 | 0.9756 → 0.9670 | 0.9512 → 0.9518 | 0.9640 → 0.9577 |
| 1 | 0.9614 → 0.9569 | 0.9597 → 0.9614 | 0.9672 → 0.9541 | 0.9568 → 0.9568 | 0.9586 → 0.9507 |
| 2 | 0.9595 → 0.9517 | 0.9521 → 0.9532 | 0.9719 → 0.9426 | 0.9569 → 0.9619 | 0.9573 → 0.9556 |

AU front and medium/distant side measures hold or improve, but top/rear and weighted scores regress. The distant top silhouette is the largest regression, associated with simplified wheels and the revised guard/plan contour. The candidate is retained for coherent lamps, visible bumper slot and leaner wheel construction; this is not a claim of universal silhouette improvement.

## Local reference gates

`checks.json` records source contour tests against reference masks and independently annotated lamp envelopes at each LOD. `after-lodN/likeness.json` and `.svg` record the capture-based checks with reference/camera identity. Width/delta errors are normalised by reference height. End-facing graphic selection excludes side-facing material triangles; the rear-band envelope test fills the deliberate hollow outline. These tests supplement the image review.

| Check | LOD0 | LOD1 | LOD2 |
|---|---:|---:|---:|
| front shoulder to flank transition | error 0.0196; limit 0.060; PASS | error 0.0327; limit 0.070; PASS | error 0.0260; limit 0.080; PASS |
| front lower stance width | error 0.0196; limit 0.065; PASS | error 0.0196; limit 0.075; PASS | error 0.0130; limit 0.090; PASS |
| rear lower stance width | error 0.0129; limit 0.065; PASS | error 0.0161; limit 0.075; PASS | error 0.0354; limit 0.090; PASS |
| plan nose taper at three sections | error 0.0086; limit 0.050; PASS | error 0.0208; limit 0.055; PASS | error 0.0234; limit 0.060; PASS |
| AU swept teardrop headlamps | IoU 0.7067; limit 0.450; PASS | IoU 0.7061; limit 0.350; PASS | IoU 0.7054; limit 0.280; PASS |
| AU rounded corner rear lamps | IoU 0.5962; limit 0.400; PASS | IoU 0.5835; limit 0.320; PASS | IoU 0.5856; limit 0.250; PASS |

A missing-front-lamp defect is injected independently at each LOD by replacing the feature UVs. Every injected defect fails the feature gate; the rejection is a meaningful visual defect, not an import failure. All current source gates pass. The focused sedan likeness and pivot suite passes 20/20 (`../lion-president/focused-tests.log`).

## Contract and reproducibility

`node docs/evidence/P1-V-roster-reference/au-hawk/reproduce.mjs` passes (`checks.log`). It checks every original exported collider triangle, all pivots, anchors, part definitions (including masses/hinges), part IDs and LOD budgets for exact equality with the baseline. It rebakes and compares every output byte, then runs all LOD source gates and the defect sensitivity checks. Original raw collider point data is frozen in `colliders.json`; visual retopology therefore cannot silently change handling or hinge geometry. No profile dynamics or runtime renderer/material code was changed by this refinement. Parent integration owns profile hash sync and the native/shared contract checks.

## Loader and state review

Every listed PNG was opened and inspected, including the before/after sheets at every LOD and both horizontal heroes. `loader/views.png` covers front/rear/left/right/top and both three-quarter views; `paints.png` covers cyan/red/yellow/blue/dark/white with neutral tyres; `lods.png` shows all tiers; `colliders.png` overlays the preserved original proxies. `paints-strip.png` covers white plus five player colours. `damage-strip.png` and `damage-strip-overview.png` show intact, loose hinge poses, detached front/door/back/wheel, combined missing parts and a stripped shell. Dark internal bays remain visible beneath missing parts. These are deterministic viewer poses, not newly measured dynamic debris behaviour.

`grid-1.png`, `grid-4.png` and `grid-24.png` show the baked car and shared parts renderer at 1080p in different paints and LODs. They are viewer grids, not the host game: they contain no HUD, track or roof-number rendering. They prove visual loading and colour/silhouette continuity, not number readability, draw-cost qualification, input/networking behaviour or frame-rate acceptance.

## Remaining limitations

The generated reference includes a wing. The established deliberate base-sedan no-wing interpretation is retained, so this is not a literal match to that accessory. LOD2 loses the fog/slot detail and has deliberately coarse guards and disc wheels. The small blank rear badge remains partly occluded at some coarse views. At LOD2, tiny body-colour pixels can appear in the glass region in the tilted grid view; this is visible in grid-4/grid-24 and has not been claimed fixed. The roof/window treatment remains more angular than the sheet.

Full production acceptance is not asserted here: no fresh native load/settle/recovery scenario, dynamic loose/detached simulation, roof-number smallest-tile proof, host gameplay capture, 24×24 draw benchmark or hardware/device performance run was made by this helper. Those are parent integration or existing gate evidence, and must be named explicitly if used. Original collider equality is strong regression evidence, but does not replace native settle evidence. Engine audio was untouched. The owner decides whether the visual candidate is recognisable.

## Reproduction

```sh
node tools/vehicles/bake.mjs art/vehicles/au-hawk
node docs/evidence/P1-V-roster-reference/au-hawk/reproduce.mjs
node tools/vehicles/fit/capture.mjs au-hawk --lod 0 --sheet lod1 --out docs/evidence/P1-V-roster-reference/au-hawk/after-lod0
node tools/vehicles/fit/capture.mjs au-hawk --lod 1 --sheet lod1 --out docs/evidence/P1-V-roster-reference/au-hawk/after-lod1
node tools/vehicles/fit/capture.mjs au-hawk --lod 2 --sheet lowest --out docs/evidence/P1-V-roster-reference/au-hawk/after-lod2
node tools/vehicles/view/capture.mjs --asset /art/vehicles/au-hawk/au-hawk.asset.json --out docs/evidence/P1-V-roster-reference/au-hawk/loader --ortho 3.0
node tools/vehicles/evidence/run.mjs au-hawk --out docs/evidence/P1-V-roster-reference/au-hawk/loader
node --test --test-name-pattern='au-hawk|lion-president' tools/vehicles/test/likeness.test.mjs tools/vehicles/test/pivots.test.mjs
```

For each capture run `tools/vehicles/fit/likeness.mjs au-hawk --capture <capture-directory>`. Baseline captures use the frozen `baseline-source/model.js` and `params.json` overrides; never overwrite the live source to reproduce an earlier candidate.

## Review-page findings

- PASS code-built export, unchanged triangle budgets and reproducible baked bytes.
- PASS current local reference gates at all LODs; old candidates and meaningful injected defects rejected.
- PASS original collision geometry and damage attachments preserved; parent sim.json records fresh native settle/straight replay checks.
- WARN whole-view score tradeoffs and remaining visual/production qualification limits are stated above. Owner review remains pending.
