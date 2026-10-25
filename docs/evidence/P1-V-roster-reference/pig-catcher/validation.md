# Vehicle Model Validation — pig-catcher

Vehicle Model Validation: PASS for the bounded visual refinement; full reference/production qualification is not claimed.

2026-10-25 · br-rgw6 · P1-V-roster-reference.

**Scoped visual-refinement checks: PASS. Full production/reference-parity qualification: not established by this evidence.** This is an owner-review candidate; no new native settle, host-renderer performance or identity-readability claim is made.

Real annular tyres and open spoke interiors at every LOD replace opaque wheel caps. The rider has a tapered LOD0 torso, neck clearance, narrower leg stance, lower and better placed elbows, and a helmet peak even at the smallest tier. A retained beak transition avoids a single unbroken plank. Engine reduction was rejected after broad-form comparison; the enclosing engine volume is retained. Original collision inputs are frozen in colliders.json.

## Provenance and comparison

Baseline revision: `d44c909378f9964d4d3beb56aa3a6d6e6ef1bdf2`. `baseline-model.js`, `baseline-params.json`, `baseline-vehicle.json` and `baseline.asset.json` preserve the before candidate. Final source is `art/vehicles/pig-catcher/model.js` plus `params.json`; `bake.txt` and `reproducibility.txt` identify exported asset hashes. Runtime source is code-built per R81; R86 damage semantics, part IDs, physical dimensions, pivots, masses, anchors and collider contracts are preserved. Requirement references: R81/R86, Playtest-1 §6, master §12.3–12.5, and the current vehicle.json budgets of 2800/900/600.

Frozen diagnostic cameras: perspective for both silhouette and shaded views; horizontal front/rear optical axes at the bounding-box midpoint, 50 m long lens; side/top 10 m. Hero/rear-hero settings are in refs/sheets.json. Generated turnarounds are not calibrated photography and opposing views disagree in some rider/body details. Fit score height normalization and shadow-band exclusion remain the shared fitter convention.

The original rear window started at y820 and cut off half the helmet; the original top window ended at x1600 and cut the right hand guard. The corrected windows restore those original pixels. dark=.65 restores the visible silver forks/silencer against the lighter grey backdrop. Explicit sheet-coordinate exclusions remove only adjacent-view tyre/helmet fragments. Original masks, extraction configuration and original-mask baseline captures are retained. Both final before/after candidates use the identical corrected masks. Reference image pixels and their SHA256 remain unchanged; feature annotations were translated by exact crop offsets, and mask hashes were repinned. This corrects an oracle defect, not the target shape. The RGB crops can still show neighboring fragments because exclusions apply to the mask, not the original image.

| LOD/view | Before | Revised | Change |
|---|---:|---:|---:|
| 0 / weighted | 0.8486 | 0.8504 | +0.0018 |
| 0 / side | 0.8901 | 0.8766 | -0.0135 |
| 0 / top | 0.8447 | 0.8359 | -0.0088 |
| 0 / front | 0.7927 | 0.8254 | +0.0327 |
| 0 / rear | 0.8012 | 0.8343 | +0.0331 |
| 1 / weighted | 0.8455 | 0.8497 | +0.0042 |
| 1 / side | 0.8778 | 0.8629 | -0.0149 |
| 1 / top | 0.8519 | 0.8503 | -0.0016 |
| 1 / front | 0.7931 | 0.8279 | +0.0348 |
| 1 / rear | 0.7987 | 0.8352 | +0.0365 |
| 2 / weighted | 0.8337 | 0.8288 | -0.0049 |
| 2 / side | 0.8596 | 0.8421 | -0.0175 |
| 2 / top | 0.8348 | 0.8325 | -0.0023 |
| 2 / front | 0.7891 | 0.8016 | +0.0125 |
| 2 / rear | 0.8066 | 0.8133 | +0.0067 |


Front/rear whole-view silhouettes improve at every tier. LOD0/1 weighted scores improve; LOD2 weighted score regresses by 0.0049, with side/top losses. The bike remains visibly approximate: plastics, engine and low-tier limbs are blockier than the sheet, and the rack/rope/sack differ in detail. It does not meet the general ~0.95 reference-parity target. Open spokes are a real geometry improvement that filled silhouette IoU cannot measure.

## Exported budget and physics preservation

| Exported part | LOD0 | LOD1 | LOD2 |
|---|---:|---:|---:|
| core | 546 | 239 | 180 |
| front | 323 | 167 | 98 |
| back | 305 | 132 | 74 |
| rider | 344 | 208 | 124 |
| wheel_F | 508 | 76 | 60 |
| wheel_R | 488 | 76 | 60 |
| **Intact total** | 2514 | 898 | 596 |


Interior rows are dormant damage interiors and are excluded from the intact total. Source fit counts include these or pre-optimisation hidden faces; shipped counts come from exported GLBs. `export-checks.json` verifies every collider's POSITION float32 array exactly against the pinned baseline GLB, the entire asset sidecar unchanged, finite nonzero exported triangles, one material and all intact budgets. This is physical-equivalence evidence, not a fresh native simulation settle run.

## Checks and visual evidence

- `node tools/vehicles/bake.mjs --check art/vehicles/pig-catcher`: byte-reproducible export; receipt in reproducibility.txt.
- `node docs/evidence/P1-V-roster-reference/pig-catcher/check-export.mjs`: exported budget/mesh/material plus exact collider and sidecar preservation PASS.
- `node docs/evidence/P1-V-roster-reference/pig-catcher/reproduce.mjs`: current source passes all local gates at all LODs; preserved previous source fails each tier; missing and displaced cue defects are rejected. Pig Catcher's separate wheel ray tests require daylight through the bores and reject every capped baseline wheel tier.
- `node tools/vehicles/fit/likeness.mjs pig-catcher --capture docs/evidence/P1-V-roster-reference/pig-catcher/reference-lodN`: source/params/mask-identified contour and feature checks PASS at all tiers; see likeness.json, likeness.svg and likeness.txt in each directory.
- Focused `tools/vehicles/test/pivots.test.mjs` for both cars: 10 tests pass.
- `tools/vehicles/view/capture.mjs` and `tools/vehicles/evidence/run.mjs`: actual GLB via Three GLTFLoader, shared paint-key shader, self-hosted assets, Playwright Chromium 151.0.7922.34 on the Mac using software GL. These are vehicle viewer captures, not a live host qualification. No new material, instancing or batching code was introduced.

Inspected images: all final reference-lod0/1/2 sheets (reference, shaded, diff, heroes); views.png (front, rear, sides, top and both three-quarter views), paints.png and paints-strip.png (bright/dark colours and neutral tyres), lods.png (tier ladder), colliders.png, damage-strip.png and damage-strip-overview.png (intact, posed loose and detached parts), grid-1.png, grid-4.png and grid-24.png (static gameplay-scale preview). Every image was opened and reviewed. No blank panel, missing texture or broken asset found. The viewer does not display runtime roof numbers; smallest-tile number readability is unproven. Damage captures pose the contracted hinges and detached meshes; dynamic persistence/velocity remain the existing runtime's responsibility and are not proven by these stills.

## Remaining qualification

General reference parity, native simulation settle, runtime roof-number readability, N×N draw/performance measurement and live dynamic damage qualification are outside this visual-preservation pass. Existing sound/handling profiles were not altered here. The parent bead owns integration and preview publication.

## Review-page findings

- PASS code-built export, unchanged triangle budgets and reproducible baked bytes.
- PASS current local reference gates at all LODs; old candidates and meaningful injected defects rejected.
- PASS original collision geometry and damage attachments preserved; parent sim.json records fresh native settle/straight replay checks.
- WARN whole-view score tradeoffs and remaining visual/production qualification limits are stated above. Owner review remains pending.
