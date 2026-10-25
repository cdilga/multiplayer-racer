# Lion President: reference refinement validation

Vehicle Model Validation: PASS for the bounded visual refinement and unchanged-physics proof; full production gate remains INCOMPLETE.

**Bead:** br-rgw6. **Date:** 2026-10-25. **Build:** working-tree model/bake delta over `9388bd30581aca3647ddfa95649d589ef54727b5`; parent integration/publication records the resulting commit. **Machine:** repository Mac, headless Playwright Chromium 151.0.7922.34, software WebGL. No hardware GPU or device performance qualification is claimed.

Requirements: owner R81/R86; master plan §§12.3–12.5; game-asset-reference-modelling, lowpoly-model-from-refs and vehicle-model-validation skills. Scope is source geometry and its evidence, preserving the pre-existing handling and damage contract.

## Candidate and reference decisions

The Lion keeps the yellow corner chevrons/fangs, black and yellow shoulder stripe, rectangular rear lamp band, low red sedan body and large wing. Its previous bonnet crown made a deep V and its front corners were too square. The nose is flatter and broader, with a two-plane corner setback and a centre split so the substrate and graphics share the crease. Extra longitudinal stations control the transition. The arch crown was lowered; the forced wheel-clearance flare now rolls back above 0.72m instead of forcing the wide wheel section up to the shoulder. The unchanged shoulder tolerance passes after that geometry correction. Cabin roof width was reduced. The outer door skin remains constrained to the original hinge plane. Thin flat wheel blades replace costly repeated 3D spoke sides and barrels.

The unchanged per-tier sheets and masks are identified by SHA-256 in `art/vehicles/lion-president/refs/likeness.json`. `baseline-source/` freezes the original model, parameters, contract, sidecar, LOD0 collider-bearing GLB and pivots. The before/after images use the same frozen cameras: perspective projection; front/rear optical axes horizontal at 50m; side/top at 10m; front/rear hero elevation 0°, azimuth 52°/140°, distance 11m, FOV 26°, target height 0.78m. This removes the flattering elevated view from the diagnostic decision.

## Exported geometry

Counts below are the baked/pruned runtime geometry, excluding collider meshes. The fitter reports unpruned source geometry including internal bays, so its count is not the exported budget count.

| LOD | Before | After | Budget | Each wheel before → after |
|---|---:|---:|---:|---:|
| 0 | 2150 | 1813 | 2400 | 170 → 54 |
| 1 | 891 | 897 | 900 | 42 → 30 |
| 2 | 594 | 576 | 600 | 38 → 25 |

Per-part final counts (interior rows are documented separately and excluded from the exported budget total):

| Part | LOD0 | LOD1 | LOD2 |
|---|---:|---:|---:|
| core | 306 | 188 | 144 |
| front | 613 | 278 | 172 |
| back | 598 | 251 | 136 |
| door_FL | 26 | 18 | 6 |
| door_FR | 26 | 18 | 6 |
| door_RL | 14 | 12 | 6 |
| door_RR | 14 | 12 | 6 |
| wheel_FL | 54 | 30 | 25 |
| wheel_FR | 54 | 30 | 25 |
| wheel_RL | 54 | 30 | 25 |
| wheel_RR | 54 | 30 | 25 |
| interior_engine | 24 | 24 | 24 |
| interior_cabin | 36 | 36 | 36 |
| interior_boot | 32 | 32 | 32 |

## Frozen-camera silhouette results

Values are before → after. Whole-car IoU is only one diagnostic: local shapes and graphics can improve while this aggregate falls. Regressions are retained here rather than hidden by the weighted number.

| LOD | Weighted | Side | Top | Front | Rear |
|---|---:|---:|---:|---:|---:|
| 0 | 0.9481 → 0.9478 | 0.9643 → 0.9467 | 0.9280 → 0.9365 | 0.9378 → 0.9562 | 0.9553 → 0.9645 |
| 1 | 0.9452 → 0.9438 | 0.9622 → 0.9414 | 0.9206 → 0.9288 | 0.9388 → 0.9588 | 0.9557 → 0.9651 |
| 2 | 0.9507 → 0.9484 | 0.9637 → 0.9460 | 0.9438 → 0.9500 | 0.9314 → 0.9470 | 0.9496 → 0.9528 |

Lion front, top and rear scores improve at every tier; its side score regresses at every tier and the aggregate remains around/below the nominal 0.95 target. The shorter faceted nose/corner transition and wheel simplification contribute to this tradeoff. The broad face, flatter bonnet and yellow graphic placement make a stronger local recognition candidate, subject to owner review.

## Local reference gates

`checks.json` records source contour tests against reference masks and independently annotated lamp envelopes at each LOD. `after-lodN/likeness.json` and `.svg` record the capture-based checks with reference/camera identity. Width/delta errors are normalised by reference height. End-facing graphic selection excludes side-facing material triangles; the rear-band envelope test fills the deliberate hollow outline. These tests supplement the image review.

| Check | LOD0 | LOD1 | LOD2 |
|---|---:|---:|---:|
| front shoulder to flank transition | error 0.0067; limit 0.060; PASS | error 0.0267; limit 0.070; PASS | error 0.0731; limit 0.080; PASS |
| front lower stance width | error 0.0733; limit 0.085; PASS | error 0.0200; limit 0.085; PASS | error 0.0565; limit 0.090; PASS |
| rear lower stance width | error 0.0542; limit 0.065; PASS | error 0.0136; limit 0.075; PASS | error 0.0746; limit 0.090; PASS |
| plan nose taper at three sections | error 0.0508; limit 0.070; PASS | error 0.0508; limit 0.075; PASS | error 0.0447; limit 0.080; PASS |
| Lion yellow corner chevrons and fangs | IoU 0.3473; limit 0.250; PASS | IoU 0.3899; limit 0.220; PASS | IoU 0.3372; limit 0.150; PASS |
| Lion full width rear lamp band | IoU 0.4974; limit 0.450; PASS | IoU 0.7491; limit 0.400; PASS | IoU 0.6908; limit 0.300; PASS |

A missing-front-lamp defect is injected independently at each LOD by replacing the feature UVs. Every injected defect fails the feature gate; the rejection is a meaningful visual defect, not an import failure. All current source gates pass. The focused sedan likeness and pivot suite passes 20/20 (`../lion-president/focused-tests.log`).

## Contract and reproducibility

`node docs/evidence/P1-V-roster-reference/lion-president/reproduce.mjs` passes (`checks.log`). It checks every original exported collider triangle, all pivots, anchors, part definitions (including masses/hinges), part IDs and LOD budgets for exact equality with the baseline. It rebakes and compares every output byte, then runs all LOD source gates and the defect sensitivity checks. Original raw collider point data is frozen in `colliders.json`; visual retopology therefore cannot silently change handling or hinge geometry. No profile dynamics or runtime renderer/material code was changed by this refinement. Parent integration owns profile hash sync and the native/shared contract checks.

## Loader and state review

Every listed PNG was opened and inspected, including the before/after sheets at every LOD and both horizontal heroes. `loader/views.png` covers front/rear/left/right/top and both three-quarter views; `paints.png` covers cyan/red/yellow/blue/dark/white with neutral tyres; `lods.png` shows all tiers; `colliders.png` overlays the preserved original proxies. `paints-strip.png` covers white plus five player colours. `damage-strip.png` and `damage-strip-overview.png` show intact, loose hinge poses, detached front/door/back/wheel, combined missing parts and a stripped shell. Dark internal bays remain visible beneath missing parts. These are deterministic viewer poses, not newly measured dynamic debris behaviour.

`grid-1.png`, `grid-4.png` and `grid-24.png` show the baked car and shared parts renderer at 1080p in different paints and LODs. They are viewer grids, not the host game: they contain no HUD, track or roof-number rendering. They prove visual loading and colour/silhouette continuity, not number readability, draw-cost qualification, input/networking behaviour or frame-rate acceptance.

## Remaining limitations

The generated front wants a broad fascia while the plan view pinches the nose more strongly. Front lamp identity governs this candidate. The fixture records a 0.07 plan-width uncertainty (59 pixels on the 847-pixel crop); source contour projection retains thin geometry removed by the mask opening, so the lower-front stance limit is 0.085. This uncertainty is explicit, not evidence of a perfect match. LOD2 wheel blades and guards are coarse and the side silhouette loses score. The dark glasshouse and rear wing remain stylised rather than a literal surface reconstruction.

Full production acceptance is not asserted here: no fresh native load/settle/recovery scenario, dynamic loose/detached simulation, roof-number smallest-tile proof, host gameplay capture, 24×24 draw benchmark or hardware/device performance run was made by this helper. Those are parent integration or existing gate evidence, and must be named explicitly if used. Original collider equality is strong regression evidence, but does not replace native settle evidence. Engine audio was untouched. The owner decides whether the visual candidate is recognisable.

## Reproduction

```sh
node tools/vehicles/bake.mjs art/vehicles/lion-president
node docs/evidence/P1-V-roster-reference/lion-president/reproduce.mjs
node tools/vehicles/fit/capture.mjs lion-president --lod 0 --sheet lod1 --out docs/evidence/P1-V-roster-reference/lion-president/after-lod0
node tools/vehicles/fit/capture.mjs lion-president --lod 1 --sheet lod1 --out docs/evidence/P1-V-roster-reference/lion-president/after-lod1
node tools/vehicles/fit/capture.mjs lion-president --lod 2 --sheet lowest --out docs/evidence/P1-V-roster-reference/lion-president/after-lod2
node tools/vehicles/view/capture.mjs --asset /art/vehicles/lion-president/lion-president.asset.json --out docs/evidence/P1-V-roster-reference/lion-president/loader --ortho 3.0
node tools/vehicles/evidence/run.mjs lion-president --out docs/evidence/P1-V-roster-reference/lion-president/loader
node --test --test-name-pattern='au-hawk|lion-president' tools/vehicles/test/likeness.test.mjs tools/vehicles/test/pivots.test.mjs
```

For each capture run `tools/vehicles/fit/likeness.mjs lion-president --capture <capture-directory>`. Baseline captures use the frozen `baseline-source/model.js` and `params.json` overrides; never overwrite the live source to reproduce an earlier candidate.

## Review-page findings

- PASS code-built export, unchanged triangle budgets and reproducible baked bytes.
- PASS current local reference gates at all LODs; old candidates and meaningful injected defects rejected.
- PASS original collision geometry and damage attachments preserved; parent sim.json records fresh native settle/straight replay checks.
- WARN whole-view score tradeoffs and remaining visual/production qualification limits are stated above. Owner review remains pending.
