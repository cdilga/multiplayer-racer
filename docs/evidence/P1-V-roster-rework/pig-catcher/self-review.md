# Pig Catcher rework — visual self-review

The rejected source had a full-height cuboid engine, a ball/wafer helmet, long forward-leaning shirt, rectangular hand guards and a solid rope puck. I compared its unchanged sheet at full size before editing and retained original captures and source.

The engine is now a rounded lower casting plus a narrower cylinder and curved right header, with real daylight around the frame. The rider has a nearly upright shirt with a sloping shoulder/neck transition, bent knees, raised boots on the visible pegs and tapered forearms. The helmet has a faceted dome, brow/peak, wraparound goggle surround and tapered chin; the lower shell joins the neck. Hand guards have chamfered contours at every tier. The rope has an actual annular opening; the tank is narrower, shroud ends higher, and the forward-raked numberplate and tapered mudguard cross-section follow the reference more closely. Original physical pivots are explicitly frozen in params; generated pivots no longer drift with surface edits.

Baked triangles: **2607 / 883 / 600**, within **2800 / 900 / 600**. Repeated spokes and concealed coarse end faces fund the rider/engine curves; per-part counts are in `bake.txt`.

Same-camera weighted IoU, original → revised: **.8504 → .8552 / .8497 → .8360 / .8288 → .8026**. At LOD0, front improves .8254→.8642 and rear .8343→.8715; side .8766→.8682 and top .8359→.8253 regress. The new frame/engine/rider geometry changes the outer profile as well as internal gaps; these regressions remain visible and are not dismissed as a metric artifact.

Remaining defects: coarse engine and human contours are still substantially simplified; the shroud/tank transition is more planar than the generated sheet; the MX peak/jaw and shirt folds remain stylized; thin spokes differ from the denser reference. Top-view rider/seat/luggage proportions and coarse side silhouette still need further refinement to meet the ~.95 target. No claim of Hawk-level owner acceptance is made.

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
- `docs/evidence/P1-V-roster-rework/pig-catcher/final-contact.jpg`: fresh six actual-loader damage/paint/grid captures inspected by parent.

## Defects found and fixed
Named source defects and iteration corrections described above.

## Remaining defects
Full likeness target and coarse shape limitations described above; remains owner-review candidate on br-rgw6.

## Not covered
Physical devices and fresh host GPU/dynamic debris qualification. Parent covers contracts, simulation fixtures and deployed review.
