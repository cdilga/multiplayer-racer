# Sedan shaded reference review — P1-V-roster-visual

Reviewed on the Mac through headless Playwright Chromium 151.0.7922.34. These are source-model and actual GLTF vehicle-renderer captures; no device or simulation qualification is claimed here. The parent owns the combined vehicle gate.

The canonical reference sheet and all existing likeness annotations/tolerances were retained. The initial AU/Lion silhouette scores were already 0.9615/0.9466 despite visible surface problems. Silhouette overlap is supporting evidence, not the acceptance criterion for this pass.

`visual-comparison.png` shows the unchanged reference hero plus old/new shaded body, front and low underside. Old/new use identical fixed world camera, dimensions and scale, with no per-model normalisation or stretched panels. `capture-review.mjs` in the AU evidence directory reproduces either vehicle. The reference hero retains its aspect ratio; its generated-sheet perspective is not treated as a calibrated blueprint. The fit sheets still use the existing fit-camera framing and are labelled as such.

## Changes seen against the reference

- The broad lower door now tucks under a raised painted rub strip; the old nearly invisible painted stripe did not reproduce the reference moulding. The rub strip has top, proud face and foot facets.
- The short painted rear spoiler and posts follow the canonical sheet. The coarse tiers retain the blade silhouette. Side pane borders were only modestly thinned; a larger expansion failed the independent pane-annotation gate and was reduced without changing that gate.
- The original wheel geometry spent 125 exported triangles per wheel on open backs, barrels and spoke solids. The new wheel spends 44 on tread, an atlas face and a sealed inner sidewall. The atlas preserves this car's broad silver five-spoke rim rather than copying the Hawk's dark thin spokes unchanged.
- The windscreen/backlight now carry rubber surrounds, reflections and seat silhouettes in the existing atlas. No extra material or draw is added.

## Underside diagnosis and result

Both old shells lofted a central floor point directly to the arch-raised outer lip. This made a radial black ramp rise around each wheel opening, the strange curved lower face reported by the owner. The undertray is now independently lofted at the original floor height, with an inset edge through the wheel openings. The side arch cut stays separate. The low-camera old/new pair was visually inspected: the ramps are gone; the open wheel openings and closed black wheel backs remain readable. No physics shape was changed to hide the problem.

## Checks and evidence

- `tools/vehicles/test/au-lion-panels.test.mjs`: 26 cases pass across both cars and all LODs. It measures transverse underfloor height, wheel edge closure/triangle spend, frozen pivots/contract, AU moulding relief and Lion lower-door return. The actual rejected source must fail the original underside/open-wheel/flat-panel checks. Logs are in the AU evidence directory.
- Existing `likeness.test.mjs` sedan cases: all six LOD cases pass with existing reference files and limits.
- `final-validation.log`: bake, byte reproducibility (`bake --check`), actual loader, damage/paints/grid captures and three fit LOD captures.
- `triangle-receipt.json`: exact per-part raw and optimised counts, before/after. The budget totals exclude `interior_*` exactly as the baker does.
- `physical-contract.json`: before/after SHA-256 proves `colliders.json`, `vehicle.json` and the asset sidecar unchanged byte for byte. Pivots are additionally asserted against frozen `physicsPivots` at every LOD.
- `loader-review.png`: final actual loader views, paints, LOD ladder, colliders, intact/loose/detached damage strips, paint strip and 1/4/24-car renderer samples. These cohort sizes are evidence samples, not gameplay limits.
- `lod-reference-review.png`: final reference/shaded/diff sheets at all three LODs plus each rear hero.

## Remaining visible simplifications

The grille/front bumper still has less layered recess depth than the reference. The lamps remain coarse flat lens shapes without all reflector details, and the mirror heads remain simpler boxes/faceted solids than the reference. The new windshield atlas is opaque stylisation; the seats shown through it are painted shapes. The LODs deliberately simplify small details while retaining the overall body sections and identity. This pass does not claim the models reproduce every reference detail or that a silhouette score proves shaded parity.
