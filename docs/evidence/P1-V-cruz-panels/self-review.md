# Visual self-review — Cruz Missile, 25 October 2026

## Looked at

 authoritative shaded sheet; immutable previous contact and hero; final LOD0/1/2 reference sheets, front/side/rear/top and hero; fixed-world-camera body/front/side/underside previous/current board; baked loader ladder, collider overlay, six paints, intact/loose/detached damage strips and 1/4/24 tile grids. Images: `visual-comparison.png`, `after-lod0/sheet.png`, `after-lod1/sheet.png`, `after-lod2/sheet.png`, `final/ladder.png`, `final/colliders.png`, `final/paints-strip.png`, `final/damage-strip.png`, `final/damage-strip-overview.png`, `final/grid-1.png`, `final/grid-4.png`, `final/grid-24.png`. Captured on this Mac with Playwright Chromium 151.0.7922.34/software GL. Local review-page phone/TV captures are recorded in the parent roster receipt.

## Defects found and fixed

 the straight sloping door section lacked a full waist and tucked sill; nudge rails were flat and the coarse bar had no actual curved-fascia mount. Rails now bend, brackets cross the actual surface, fog graphics follow it and splitter has thickness. Arch lips had been stretched to the centre-floor, making radial curved fans. A level floor, narrower at wheels, plus dark inner wells replaces them. The first floor fix exposed gaps from below; the final floor expands back to the sill between arches. The lowest-tier bent LED strip initially clipped into the nose; splitting its centre and correcting its projection fixed that. Closed wheel faces keep detached wheels opaque; atlas detail replaces overlapping spoke/barrel caps.

## Remaining defects

 the generated reference has softer lighting, deeper-looking small lamp housings and more glass detail; coarse tiers deliberately merge accessories and use simpler arch polygons. These are recorded approximations, not an assertion of exact likeness or owner acceptance. Whole-view weighted IoU changes from 0.9511 to 0.9470 at LOD0; that small loss is not hidden by the stronger local shape checks.

## Not covered

 physical-device/GPU performance or new handling qualification. Physics sidecar, colliders, vehicle declarations and handling profile are byte-identical, so this change does not introduce a new handling model. Tile images use the actual vehicle loader/review renderer, not a driving session; the trailer session recaptures the real host after this handoff.
