# Sedan shaded reference review — P1-V-roster-visual

Reviewed on the Mac through headless Playwright Chromium 151.0.7922.34. These are source-model and actual GLTF vehicle-renderer captures; no device or simulation qualification is claimed here. The parent owns the combined vehicle gate.

The canonical reference sheet and all existing likeness annotations/tolerances were retained. The initial AU/Lion silhouette scores were already 0.9615/0.9466 despite visible surface problems. Silhouette overlap is supporting evidence, not the acceptance criterion for this pass.

`visual-comparison.png` shows the unchanged reference hero plus old/new shaded body, front and low underside. Old/new use identical fixed world camera, dimensions and scale, with no per-model normalisation or stretched panels. `capture-review.mjs` in the AU evidence directory reproduces either vehicle. The reference hero retains its aspect ratio; its generated-sheet perspective is not treated as a calibrated blueprint. The fit sheets still use the existing fit-camera framing and are labelled as such.

## Changes seen against the reference

- The reference has a lower-door return/crease. The old broad door lacked that section and additionally clamped its width against a hinge-derived limit. The new section has a measured inward return, an outward broad panel and a separate shoulder rollover, while hinge pivots stay fixed.
- The broad bay liner is inset behind the shoulder. The flare's outer transition is kept outside the underlying body. The headlamp wrap and bumper-corner decoration are clipped onto each real side facet and its exact diagonal, preventing the previous polygon crossing the guard surface.
- Wheels now spend 44 exported triangles per wheel, down from 74, with both sidewalls sealed. Their dark five-spoke face lives in the existing atlas. The windscreen/backlight receive the same zero-extra-geometry treatment as the Hawk.

The final LOD contact-sheet review also caught a U-shaped lower door silhouette when coarse tiers omitted the LOD0 side skirt. A straight two-triangle sill face per side now preserves the reference lower edge at LOD1/2, adding only four triangles per tier; a slice-envelope regression rejects the actual old missing-sill geometry.

## Underside diagnosis and result

Both old shells lofted a central floor point directly to the arch-raised outer lip. This made a radial black ramp rise around each wheel opening, the strange curved lower face reported by the owner. The undertray is now independently lofted at the original floor height, with an inset edge through the wheel openings. The side arch cut stays separate. The low-camera old/new pair was visually inspected: the ramps are gone; the open wheel openings and closed black wheel backs remain readable. No physics shape was changed to hide the problem.

## Checks and evidence

- `tools/vehicles/test/au-lion-panels.test.mjs`: 26 cases pass across both cars and all LODs. It measures transverse underfloor height, wheel edge closure/triangle spend, frozen pivots/contract, AU moulding relief and Lion lower-door return. The actual rejected source must fail the original underside/open-wheel/flat-panel checks. Logs are in the AU evidence directory.
- Existing `likeness.test.mjs` sedan cases: all six LOD cases pass with existing reference files and limits.
- `final-validation.log`: final bake, byte reproducibility (`bake --check`), actual loader and affected LOD1/2 fit captures after the final coarse-sill correction. The LOD0 fit, damage/paints/grid images were captured through `tools/vehicles/evidence/run.mjs` before that correction and remain valid: LOD0 source geometry/atlas and exports are unchanged by the coarse-only sill fix.
- `triangle-receipt.json`: exact per-part raw and optimised counts, before/after. The budget totals exclude `interior_*` exactly as the baker does.
- `physical-contract.json`: before/after SHA-256 proves `colliders.json`, `vehicle.json` and the asset sidecar unchanged byte for byte. Pivots are additionally asserted against frozen `physicsPivots` at every LOD.
- `loader-review.png`: final actual loader views, paints, LOD ladder, colliders, intact/loose/detached damage strips, paint strip and 1/4/24-car renderer samples. These cohort sizes are evidence samples, not gameplay limits.
- `lod-reference-review.png`: final reference/shaded/diff sheets at all three LODs plus each rear hero.

## Remaining visible simplifications

The grille/front bumper still has less layered recess depth than the reference. The lamps remain coarse flat lens shapes without all reflector details, and the mirror heads remain simpler boxes/faceted solids than the reference. The new windshield atlas is opaque stylisation; the seats shown through it are painted shapes. The LODs deliberately simplify small details while retaining the overall body sections and identity. This pass does not claim the models reproduce every reference detail or that a silhouette score proves shaded parity.
