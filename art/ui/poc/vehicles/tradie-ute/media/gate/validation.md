# Tradie Ute — reference shape rework, 2026-10-25

Vehicle Model Validation: PASS for this visual asset refinement. Parent bead `br-rgw6` owns integration, profile hashes, publication and the owner review. This is not a fresh driving, physical-device or GPU performance qualification.

The authoritative material remains `art/vehicles/tradie-ute/refs/measured-reference.json`: the owner's two MQ photos, tape measurements and newer `build_triton()` provenance on eris. Both local photographs were personally inspected, and the remote code was read without editing the remote tree. Generated Muse sheets are not acceptance oracles. R81/R86/R90/R123, master-plan §§12.3–12.5 and the unchanged vehicle contract govern this scope.

The revised source is identified by `shape-check.json` and `measured-check.json`; baked byte hashes are in `bake-check.txt`. The captured previous source, parameters, atlas, LOD0 GLB and sidecar are retained in `baseline/`. No physics or simulation source was changed.

## Observed problem and correction

The previous body had a straight vertical lower flank, a square front end with tiny lamps on its top edge, flat roof shoulders and a rectangular rear glass envelope. Maximum width and tape envelopes passed while those recognizable shapes remained wrong.

The actual lower shell now returns toward the sill and inward below the glass. LOD0 has more transverse body/roof sections, while the coarse tiers preserve the enclosing slopes. Roof crown and rear cab corner transitions have depth. Rear side glass rises and turns into the back pillar. Nose corners sweep behind the centre through intermediate facets; the first attempt's pointed V was caught by looking at the top view and corrected. Swept lamps follow the same deformed skin. The solid bar, canopy, tray and accessory silhouettes stay angular.

Cab glass now follows the exact diagonal of each final substrate facet. A by-eye coarse-tier check exposed a paint patch from the earlier bilinear projection; diagonal clipping/projection removed it. This is the surface-attachment pitfall described by the Hawk skill, applied to this cab rather than copied vehicle dimensions.

| Local source geometry check | Previous LOD0 | Revised LOD0 | LOD1 / LOD2 |
|---|---:|---:|---:|
| Lower flank tuck, half-width at y .80 minus .65 m | 0 mm | 42 mm | 42 / 42 mm |
| Shoulder return, half-width at y .80 minus 1.30 m | 22 mm | 57 mm | 56 / 55 mm |
| Nose corner setback at x .73 m | 0 mm | 123 mm | 124 / 124 mm |
| Nose middle setback at x .45 m | 0 mm | 38 mm | 29 / 29 mm |

`refs/shape-reference.json` records independent photo/source observations, sample positions and interpretation bands. These are conservative shape diagnostics, **not measured body dimensions or a calibrated photographic reconstruction**. The baseline imports successfully and fails all 12 local checks; current geometry passes all 12. `local-shape.png` illustrates the source sections. Existing independent tape envelopes and defect injections also pass at every tier. Whole-view photographic IoU is unavailable: the night views are perspective, occluded and uncalibrated, and they do not show the front.

## Geometry and unchanged contract

Final exported body totals: **1762 / 896 / 600** triangles against unchanged **2400 / 900 / 600** budgets. Before: 1402 / 896 / 586. Every part count is in `bake.log`; interiors are separate from the body budget under the existing contract. Extra LOD0 triangles go to body/roof sections and the nose curvature. At coarse tiers, hidden rack/guard faces and tiny grille/hub detail pay for shape and correctly projected glass.

`frozen-physics.json` proves all eleven LOD0 collider POSITION buffers are byte-identical to the captured baseline. Collision proxies are carried by LOD0; visual coarse files do not duplicate them. The complete sidecar is byte-identical, including all pivots, hinges, mass fractions, anchors and budgets. Wheel locations/radius and handling remain fixed; the visual body intentionally differs from that old collision shell (`final/colliders.png`). The atlas, one material and paint-key implementation are unchanged.

- PASS byte-reproducible export, native contract, all three triangle budgets and original collider/sidecar invariance.
- PASS independent measured and local form checks at all tiers; actual rejected body fails all 12 local form checks.
- WARN exact front likeness is uncertain because owner photos are dark rear obliques.

## Exact checks

- `node art/vehicles/tradie-ute/refs/check-shape.mjs`: PASS at LOD0/1/2 (`shape-check.json`). Running with `--source docs/evidence/P1-V-roster-rework/tradie-ute/baseline` rejects the real previous candidate at all three tiers (`before-shape-check.json`).
- `node art/vehicles/tradie-ute/refs/check-measured.mjs`: PASS tape envelopes, black lid, roof taper and accessory sides; its canopy-height/tray-width/cab-width defect injections are detected at every tier (`measured-check.json`).
- `node tools/vehicles/bake.mjs --check art/vehicles/tradie-ute`: PASS, byte-exact reproducibility (`bake-check.txt`).
- `target/debug/jj validate art/vehicles/tradie-ute/tradie-ute.asset.json`: PASS `jj.vehicle.v1`, exported geometry and all budgets, no waivers (`contract-check.txt`).
- `node docs/evidence/P1-V-roster-rework/tradie-ute/check-frozen.mjs`: PASS collider bytes and complete sidecar invariance (`frozen-physics.json`).
- `node --test --test-name-pattern='tradie-ute' tools/vehicles/test/pivots.test.mjs`: PASS, all five matching tests, including every LOD and defect rejection (`ute-pivots-test.txt`). The broad test run during concurrent work failed on Cruz visual-edge expectations; it is retained as `pivots-test.txt`, not reported as green. Parent owns shared test integration.
- `node tools/vehicles/view/capture.mjs --asset /art/vehicles/tradie-ute/tradie-ute.asset.json --out docs/evidence/P1-V-roster-rework/tradie-ute/final --sheet ladder --ortho 3.2`, repeated with `--sheet colliders`: PASS, actual baked GLTFLoader and paint-key renderer.
- `node tools/vehicles/evidence/run.mjs tradie-ute --out docs/evidence/P1-V-roster-rework/tradie-ute/final`: PASS six posed damage/paint/grid captures.
- `node docs/evidence/P1-V-roster-rework/tradie-ute/capture-owner-angle.mjs`: PASS previous/revised neutral-paint left rear closeups through the same loader. Camera identity and browser are recorded in `owner-angle-camera.json`. This changes only a private HTTP presentation response, not shared viewer code.

All final captures use Playwright Chromium **151.0.7922.34** on the Mac, software-rendered review viewers. Every final screenshot and composite was opened and inspected. The evidence viewer poses damage; it does not prove gameplay dynamics or debris lifetime. Existing engine sound, batching and gameplay code are unchanged, so no new engine/draw-cost claim is made.

## Review evidence and limits

- `before/ladder.png` and `final/ladder.png`: identical comparison cameras for six views at all three tiers.
- `comparison.png`: previous/revised LOD0 view crops.
- `owner-reference-comparison.png`: actual night photo alongside previous/revised neutral-paint **left rear closeups**. Models share a camera; the photo camera was not recovered. Closeups concentrate on the cab/tray region and intentionally clip extremities.
- `final/paints-strip.png`: white plus five bright paint colours; tyres, canopy, lamps and accessories remain neutral.
- `final/damage-strip.png`, `final/damage-strip-overview.png`: intact, loose, individual part loss and stripped shell with the original articulation.
- `final/grid-1.png`, `final/grid-4.png`, `final/grid-24.png`: LODs and coloured identity at viewer tile scales. These do not prove host roof-number rendering.

Remaining uncertainty is concentrated in front styling and exact cab curvature: the two local photographs are dark rear obliques, and the newer source calls its styling representative. The front is an evidence-backed faceted interpretation, not a scan. Published wheelbase/tyre dimensions differ from frozen game wheels by design. Parent integration and owner likeness judgment remain outstanding for the overall bead.
