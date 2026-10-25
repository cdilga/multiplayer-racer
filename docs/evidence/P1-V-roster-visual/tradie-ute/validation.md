# Tradie Ute shaded visual pass — 2026-10-25

Vehicle Model Validation: PASS for this visual-only refinement; root owns roster integration,
profile hashes, review build and publication. This is not a new driving or GPU qualification.

The authoritative reference remains `art/vehicles/tradie-ute/refs/measured-reference.json`:
owner night photographs and tape measurements supersede the old generated sheet. Both photographs
were inspected. No photographic IoU is claimed: neither rear-oblique photograph is calibrated,
and neither shows the front. R81/R86/R90 and the unchanged vehicle contract govern this pass.

## Observed defects and corrections

The previous lower-body ring joined a low centreline floor to the raised outer wheel-arch lip.
Across consecutive longitudinal sections this formed a broad curved membrane under the vehicle.
The revised shell has a separate straight central undertray, narrow outboard arch returns and
dark inboard well walls. An initial opening exposed bright opposite-side slivers; inspection of
the negative-elevation shaded capture caught that, and the dark walls remove it. The floor no
longer climbs with the arch. This is checked at every LOD against the preserved actual previous
source, which fails the new gate at all three tiers.

Direct internal-feature comparison also caught the rear lamp triplets reversed: white was
outboard. They now match the owner photograph: amber outside, red centre, white inside.
Per-LOD UV/geometry checks verify the order. The already refined convex doors, shoulder return,
inset glass and crowned roof are retained rather than flattened while fixing the underside.
Their independent section gates still pass: lower tuck ~42 mm, shoulder return 55–57 mm,
nose corner setback 123–124 mm and intermediate setback 29–38 mm.

Hawk's useful optimisation principles remain in place: flat rim/barrel/spoke treatments rather
than deep repeated spoke solids; hidden-face bake pruning; geometry retained for tyre volume,
visible mirror depth, cab curvature and separate damage panels. This pass removes the inboard
attachment faces of coarse mirrors, which are buried in the cab. The negative-elevation ladder
also exposed pre-existing open inner tyre faces at LOD1/2. LOD1's redundant second dark barrel
disc now funds closed inner sidewalls with unchanged spoke and wheel counts. LOD2's mirrors taper
to a closed attachment point, and a tiny alloy glint replaces the large rim decal, funding all
six-sided tyre caps. Tyre volume matters more than an unseen duplicate disc or tiny rim decoration.

## Export and invariant contract

Final body triangles are **1770 / 895 / 599**, within unchanged **2400 / 900 / 600** budgets.
Previous counts were 1762 / 896 / 600. All part counts and baked hashes are in `bake-check.txt`.
Interiors retain their existing separate contract treatment.

`frozen-physics.json` verifies all eleven collider POSITION buffers against the earlier preserved
baseline and the entire sidecar byte-for-byte: pivots, hinges, masses, anchors and budgets remain
unchanged. Parameters and atlas source are unchanged. The old colliders intentionally differ
from the photo-led visual cab/tray; `final/colliders.png` shows this honestly. No simulation,
handling, sound, material, batching or loader code changed.

## Reproducible checks

Run `node docs/evidence/P1-V-roster-visual/tradie-ute/check-all.mjs` for fresh receipts:

- `shape-check.json`: all independent cab/nose section checks pass at every LOD.
- `measured-check.json`: owner-tape tray/canopy envelopes, neutral lid, tapered roof and correct
  accessory sides pass; raised-canopy, wide-tray and wide-roof defect injections are detected.
- `frozen-physics.json`: eleven collider buffers and complete sidecar are unchanged.
- `contract-check.txt`: native `target/debug/jj validate` passes `jj.vehicle.v1`, no waivers.
- `bake-check.txt`: byte-exact reproducibility and all budgets pass.
- `panels-test.txt`: ten tests pass: separate floor, closed inner tyre sidewalls and photo lamp
  order at all tiers; actual previous radial membrane and missing coarse caps are rejected.

The five matching `tradie-ute` tests in `tools/vehicles/test/pivots.test.mjs` also pass, including
frozen attachment equality and moved-pivot defect rejection. The shared `reference-form.test.mjs`
plus the initial panel tests passed 18 tests during this pass; shared roster integration belongs
to the parent because other helpers are editing other cars concurrently.

## Visual evidence inspected

`capture-local.mjs` captures previous/current source shading through identical diagnostic cameras:
1200×700, front az52/elev10, rear az140/elev14, underside az52/elev−24; distance11m, fov26°.
The preserved model/params/atlas are routed into a private HTTP response without changing the
shared vehicle source. Every image pair keeps the same camera, size, crop and aspect ratio.
`compose.py` preserves aspect ratio in the boards. It never independently stretches dimensions.

- `reference-previous-current.png`: actual owner photo, previous and current neutral rear views.
- `regional-comparison.png`: enlarged photo/candidate cab surfaces and corrected rear lamp order.
- `underside-comparison.png`: previous/current negative-elevation views at all three LODs.
- `front-comparison.png`, `rear-comparison.png`: unchanged comparison cameras across all tiers.
- `final/ladder.png`: baked GLTFLoader six-view ladder across all LODs.
- `final/paints-strip.png`: neutral plus five bright paints; tyres/canopy/trim remain neutral.
- `final/damage-strip.png`, `final/damage-strip-overview.png`: intact, loose and individual/combined
  part loss with dark bays and frozen articulation. These are viewer poses, not dynamic sim proof.
- `final/grid-1.png`, `final/grid-4.png`, `final/grid-24.png`: gameplay-sized viewer identity/LOD views.
- `final/colliders.png`: unchanged collision geometry over the revised visual model.

All captures use Playwright Chromium 151.0.7922.34 on the Mac, software-rendered review viewers.
Every final capture and comparison board was opened and inspected. The photo camera differs
from the diagnostic camera; no matching absolute scale or calibrated reconstruction is asserted.
Tape dimensions independently constrain the tray/canopy. Exact front styling and cab curvature
remain an evidence-backed low-poly interpretation. The reference's polished silver reflections,
fine checker-plate pattern and wheel details exceed this game's faceted material treatment.
Coarsest wheels retain six tread segments and closed caps but use a small triangular alloy glint;
mirrors keep their outer face and depth with a tapered mount. These are deliberate gameplay-scale
simplifications, shown in the all-LOD and small-grid captures.

No new engine-sound, instancing, roof-number or settle claim is made. Those systems are unchanged.
The root must rebuild/deploy the review page with this evidence and integrate the roster pass.

- PASS owner photo and independent tape measurements retain the actual ute shape at every LOD.
- PASS radial floor removed, dark inner wells and closed wheels inspected from below; rear lamp order corrected.
- PASS qualified budgets, deterministic bakes, unchanged physics/sidecar/profile contract.
- WARN owner photos are uncalibrated; no new host performance or handling qualification is claimed.
