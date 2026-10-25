# Postie Bike rework — visual self-review

The authoritative Honda primary image `refs/source/cb50-primary.png` governs architecture. Keep the CB50-inspired exposed single-cylinder/diamond frame and **one low right exhaust**. The generated rear sheet invents twin outlets and its left side makes the right pipe too prominent; I did not add a left pipe or distort the bike to fit that contradiction.

The rejected rider used a rectangular hi-vis slab with a sleeve/forearm gap and an exterior flat skin wafer. The vest now has a waist, chest and sloped neck/shoulder sections, continuous tapered arms and reflective graphics attached to the final front/back facets. The face returns into the helmet cheeks; the visor follows a brow arch and lowered chin lip. The saddle has bevelled shoulders, tapered ends and a thicker nose. Tank cream panels taper at their ends. The exposed cylinder/fins have octagonal sections and the right header bends around the casting into the single muffler. LOD0 wheel shoulders and additional thin spokes preserve visible wheel openings. The same rider/engine identity remains at coarse tiers.

Baked triangles: **2669 / 894 / 599**, within **2900 / 900 / 600**; per-part counts are in `bake.txt`.

Same-camera weighted IoU, original → revised: **.8563 → .8501 / .8241 → .8210 / .8049 → .7932**. The LOD0 side/front/rear silhouette scores regress despite better local engine/face form. This is recorded as a real remaining likeness problem. No reference, mask or existing gate was weakened.

Remaining defects: the generated sheet's larger, softer vest/helmet and tank contours are still more convincing than this faceted candidate; pannier and carrier lip corners remain rectangular; coarse helmet/engine/saddle transitions simplify strongly. The visor is represented by an opening/edge, not transparent glass. The open single-sided exhaust architecture takes precedence over invented generated cues. The result does not reach the ~.95 global target and remains a review candidate.

Machine: Apple M1 Pro Mac. Browser: Playwright Chromium 151.0.7922.34; this is a desktop browser capture, not phone hardware or Safari qualification. No shared loader, batching, audio, physics profile, collider, mass, anchor or material/atlas change. Reference sheets, extraction masks, cameras and existing tolerances remain unchanged. `summary.json` pins exact source, reference and GLB hashes and proves `vehicle.json`, `colliders.json` and the sidecar are byte-identical to the original contract.

The actual-loader `current-loader/ladder.png` contains all three LODs in front, front 3/4, side, rear 3/4, rear and top views. `current-loader/hero.png` is the large baked-asset hero. Seven 1000 px diagnostic views are alongside it, including `right.png`; `../pig-catcher/capture-detail.mjs` reproduces these through the existing GLTFLoader and paint-key shader, changing only resolution and requested paint. `compare-{side,front,top}.png` enlarges unchanged reference, original source and revised source without aspect distortion. Raw fitter captures and diffs are in `baseline`, `baseline-lod{1,2}` and `current-lod{0,1,2}`. The saved actual `baseline/model.js` and `baseline/params.json` reproduce the rejected model without editing the shared source.

Validation performed:
- Both `node tools/vehicles/bake.mjs --check art/vehicles/<id>` commands pass byte-for-byte reproduction; see `reproducibility.txt`.
- 23 focused existing likeness, negative-space and frozen-pivot tests pass; see `../pig-catcher/focused-tests.txt`.
- Current source triangles are finite and have nonzero area; baked budgets, one material, part set and original pivots pass at every tier. See `../pig-catcher/geometry-checks.json`.
- New named form checks inspect current triangles and reject the saved actual baseline at every LOD. See `shape-current.json`, `shape-baseline.json` and `shape-gates.md`; parent integrates the exported checks into the standard suite.
- Existing reference-derived camera, contour and feature gates pass. Their success is not complete likeness acceptance.
- Rust contract/load/settle and final live preview integration are parent-level checks for the shared bead. They were not rerun by this helper. Frozen physics data and unchanged attachment tests reduce risk but do not substitute for those gates.

Vehicle Model Validation: FAIL on the global ~0.95 likeness target; technical checks above pass. This is a review candidate and is not an owner acceptance or full production qualification.

## Looked at
- `docs/evidence/P1-V-roster-rework/postie-bike/final-contact.jpg`: fresh six actual-loader damage/paint/grid captures inspected by parent.

## Defects found and fixed
Named source defects and iteration corrections described above.

## Remaining defects
Full likeness target and coarse shape limitations described above; remains owner-review candidate on br-rgw6.

## Not covered
Physical devices and fresh host GPU/dynamic debris qualification. Parent covers contracts, simulation fixtures and deployed review.
