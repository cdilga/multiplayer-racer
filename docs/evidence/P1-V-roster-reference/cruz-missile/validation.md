# Vehicle Model Validation — cruz-missile

Vehicle Model Validation: PASS for the bounded visual refinement; full reference/production qualification is not claimed.

2026-10-25 · br-rgw6 · P1-V-roster-reference.

**Scoped visual-refinement checks: PASS. Full production/reference-parity qualification: not established by this evidence.** This is an owner-review candidate; no new native settle, host-renderer performance or identity-readability claim is made.

Narrower greenhouse through measured cabin stations and a tapered nose tip; 12-facet LOD0 tyres retain five-spoke depth. Front lamp wraps now clip onto the actual tub triangles, eliminating diagonal occlusion slits. At LOD1 the spoiler endplates retain both visible faces and their contour; hidden thickness funds the conforming lamps. Physics pivots are stored independently of visual extrema.

## Provenance and comparison

Baseline revision: `d44c909378f9964d4d3beb56aa3a6d6e6ef1bdf2`. `baseline-model.js`, `baseline-params.json`, `baseline-vehicle.json` and `baseline.asset.json` preserve the before candidate. Final source is `art/vehicles/cruz-missile/model.js` plus `params.json`; `bake.txt` and `reproducibility.txt` identify exported asset hashes. Runtime source is code-built per R81; R86 damage semantics, part IDs, physical dimensions, pivots, masses, anchors and collider contracts are preserved. Requirement references: R81/R86, Playtest-1 §6, master §12.3–12.5, and the current vehicle.json budgets of 2800/900/600.

Frozen diagnostic cameras: perspective for both silhouette and shaded views; horizontal front/rear optical axes at the bounding-box midpoint, 50 m long lens; side/top 10 m. Hero/rear-hero settings are in refs/sheets.json. Generated turnarounds are not calibrated photography and opposing views disagree in some rider/body details. Fit score height normalization and shadow-band exclusion remain the shared fitter convention.

Reference sheets and extraction are unchanged. Comparison cameras are frozen for both candidates.

| LOD/view | Before | Revised | Change |
|---|---:|---:|---:|
| 0 / weighted | 0.9545 | 0.9542 | -0.0003 |
| 0 / side | 0.9687 | 0.9659 | -0.0028 |
| 0 / top | 0.9540 | 0.9544 | +0.0004 |
| 0 / front | 0.9227 | 0.9384 | +0.0157 |
| 0 / rear | 0.9494 | 0.9387 | -0.0107 |
| 1 / weighted | 0.9526 | 0.9533 | +0.0007 |
| 1 / side | 0.9692 | 0.9668 | -0.0024 |
| 1 / top | 0.9509 | 0.9520 | +0.0011 |
| 1 / front | 0.9233 | 0.9404 | +0.0171 |
| 1 / rear | 0.9409 | 0.9330 | -0.0079 |
| 2 / weighted | 0.9353 | 0.9359 | +0.0006 |
| 2 / side | 0.9354 | 0.9348 | -0.0006 |
| 2 / top | 0.9430 | 0.9430 | +0.0000 |
| 2 / front | 0.9133 | 0.9285 | +0.0152 |
| 2 / rear | 0.9418 | 0.9318 | -0.0100 |


Front-view cabin widths and nose taper improve; rear-view and small side-view silhouette regressions remain. The weighted score is essentially unchanged at LOD0 and improves slightly at LOD1/2. Lamp attachment is visually continuous after the projection repair; its side/fascia seam remains a visible faceted change in shading.

## Exported budget and physics preservation

| Exported part | LOD0 | LOD1 | LOD2 |
|---|---:|---:|---:|
| core | 264 | 200 | 144 |
| front | 608 | 273 | 102 |
| back | 373 | 207 | 137 |
| door_FL | 32 | 12 | 6 |
| door_FR | 32 | 12 | 6 |
| door_RL | 26 | 12 | 6 |
| door_RR | 26 | 12 | 6 |
| wheel_FL | 138 | 42 | 25 |
| wheel_FR | 138 | 42 | 25 |
| wheel_RL | 138 | 42 | 25 |
| wheel_RR | 138 | 42 | 25 |
| interior_engine | 24 | 24 | 24 |
| interior_cabin | 36 | 36 | 36 |
| interior_boot | 32 | 32 | 32 |
| **Intact total** | 1913 | 896 | 507 |


Interior rows are dormant damage interiors and are excluded from the intact total. Source fit counts include these or pre-optimisation hidden faces; shipped counts come from exported GLBs. `export-checks.json` verifies every collider's POSITION float32 array exactly against the pinned baseline GLB, the entire asset sidecar unchanged, finite nonzero exported triangles, one material and all intact budgets. This is physical-equivalence evidence, not a fresh native simulation settle run.

## Checks and visual evidence

- `node tools/vehicles/bake.mjs --check art/vehicles/cruz-missile`: byte-reproducible export; receipt in reproducibility.txt.
- `node docs/evidence/P1-V-roster-reference/cruz-missile/check-export.mjs`: exported budget/mesh/material plus exact collider and sidecar preservation PASS.
- `node docs/evidence/P1-V-roster-reference/cruz-missile/reproduce.mjs`: current source passes all local gates at all LODs; preserved previous source fails each tier; missing and displaced cue defects are rejected. Pig Catcher's separate wheel ray tests require daylight through the bores and reject every capped baseline wheel tier.
- `node tools/vehicles/fit/likeness.mjs cruz-missile --capture docs/evidence/P1-V-roster-reference/cruz-missile/reference-lodN`: source/params/mask-identified contour and feature checks PASS at all tiers; see likeness.json, likeness.svg and likeness.txt in each directory.
- Focused `tools/vehicles/test/pivots.test.mjs` for both cars: 10 tests pass.
- `tools/vehicles/view/capture.mjs` and `tools/vehicles/evidence/run.mjs`: actual GLB via Three GLTFLoader, shared paint-key shader, self-hosted assets, Playwright Chromium 151.0.7922.34 on the Mac using software GL. These are vehicle viewer captures, not a live host qualification. No new material, instancing or batching code was introduced.

Inspected images: all final reference-lod0/1/2 sheets (reference, shaded, diff, heroes); views.png (front, rear, sides, top and both three-quarter views), paints.png and paints-strip.png (bright/dark colours and neutral tyres), lods.png (tier ladder), colliders.png, damage-strip.png and damage-strip-overview.png (intact, posed loose and detached parts), grid-1.png, grid-4.png and grid-24.png (static gameplay-scale preview). Every image was opened and reviewed. No blank panel, missing texture or broken asset found. The viewer does not display runtime roof numbers; smallest-tile number readability is unproven. Damage captures pose the contracted hinges and detached meshes; dynamic persistence/velocity remain the existing runtime's responsibility and are not proven by these stills.

## Remaining qualification

General reference parity, native simulation settle, runtime roof-number readability, N×N draw/performance measurement and live dynamic damage qualification are outside this visual-preservation pass. Existing sound/handling profiles were not altered here. The parent bead owns integration and preview publication.

A small body-colour triangular patch remains at the front side-window corner in grid-1.png. It comes from the older analytic glass-span attachment; exact decal-to-facet projection was repaired for the front lamp wraps only in this pass. It is a known visual limit for subsequent review, not blank/missing geometry.

## Review-page findings

- PASS code-built export, unchanged triangle budgets and reproducible baked bytes.
- PASS current local reference gates at all LODs; old candidates and meaningful injected defects rejected.
- PASS original collision geometry and damage attachments preserved; parent sim.json records fresh native settle/straight replay checks.
- WARN whole-view score tradeoffs and remaining visual/production qualification limits are stated above. Owner review remains pending.
