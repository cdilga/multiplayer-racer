Vehicle Model Validation: PASS (with the WARNs below)

Vehicle/part IDs: lion-president; core (greenhouse with side glass and frames, black roof, shark fin, skirts, mirrors, calipers, bays), front (nose, bonnet scoops, lamps, grille, lower bumper and intakes, splitter, aerial, front flares), back (boot, tail-lamp bar, wing on swan-neck posts, diffuser, pipes, rear flares), door_FL/FR/RL/RR (with handles), wheel_FL/FR/RL/RR (tyre, rim, spokes, hub); interior blocks engine, cabin, boot
Commits: b57b9c9a (structure), 54a30978 (fit and bake), and the evidence commit that ships this file, on v0.2-revamp
Changed files: art/vehicles/lion-president/{model.js, atlas.js, params.json, vehicle.json, review.src.json, lion-president.asset.json, lion-president.lod{0,1,2}.glb, lion-president.atlas.png, lion-president.emissive.png}; assets/profiles/lion-president.json (geometry re-synced); crates/jj-contracts/src/vehicle.rs and art/contracts/vehicle.schema.json (LOD0 qualified budget 1300 -> 3000); tools/vehicles/bake.mjs (noCollide decoration); tools/vehicles/fit/opt.mjs (--out, pinned); tools/vehicles/view/{view.js, capture.mjs} (ladder sheet)
Requirement source: owner 2026-10-18 on br-bwju.11 (match the contact sheet; more LOD0 triangles allowed), R81, R86, R123; Playtest-1 plan 6.3 hinge lines

Method: lowpoly-model-from-refs. Structure built by hand from numbers measured off refs/lod-plus-1.png (side, front and rear crops at 2x with a 10 cm scale); then tools/vehicles/fit/opt.mjs on eris, 4 passes, numbers only, wheelR and track pinned (they are the sim's wheels); then the fascia details measured again. No new LOD level.

Visual evidence (Playwright Chromium headless on eris, software GL for the fit/viewer/evidence tools, ANGLE/Vulkan on the RTX 2080 Super for the host probe; not a TV or phone):
- reference-lod0/, reference-lod1/, reference-lod2/: sheet.png + score.json, `node tools/vehicles/fit/capture.mjs lion-president --out <dir> --lod N --sheet lod1|lowest` (compose.py run on the Mac: eris has no PIL)
- ladder-lod0.png, ladder-lod1.png, ladder-lod2.png: sheet crop | before | after for front, front 3/4, side, rear 3/4, rear, top; from ladder-before-raw.png (the br-bwju.3 GLBs, still in art/ui/poc/vehicles/lion-president/media/model/ at capture time) and ladder-after-raw.png, `node tools/vehicles/view/capture.mjs --asset <asset> --out <dir> --sheet ladder --paint '#d8231c'`
- views.png, lods.png, paints.png, colliders.png: `node tools/vehicles/view/capture.mjs --asset /art/vehicles/lion-president/lion-president.asset.json --out <dir>`
- damage-strip.png, damage-strip-overview.png, paints-strip.png, grid-1.png, grid-4.png, grid-24.png: `node tools/vehicles/evidence/run.mjs lion-president --out <dir>`
- host-grid-1.png, host-grid-4.png, host-grid-24.png and render.json: the real host page (`host?synthetic=24&vehicles=mixed&freeze=240&tiles=N&res=1&autores=off`, 1920x1080), every roster car four times

Checks run:
- node tools/vehicles/bake.mjs art/vehicles/lion-president: 2162 / 892 / 594 tris (asks 2400 / 900 / 600; qualified 3000 / 900 / 600); `--check` byte-reproducible
  - LOD0 per part: front 516, back 580, core 306, door_FL/FR 26, door_RL/RR 14, wheels 170 each
- jj vehicle sync / jj validate assets/profiles/lion-president.json: in sync with its sidecar. Hull now +-0.99 m wide (flares), was +-0.975; wheels and wheel_radius 0.43 unchanged
- node --test tools/vehicles/test/ (eris, b57b9c9a): 39 passed (pivots on hinge lines at every LOD, sidecar pivots, spec twins)
- node tools/vehicles/review/check.mjs: every Vehicles-contract item present
- rch cargo test -p jj-contracts: passed. jj-sim roster and jj-procgen handling tests: CI (the RCH worker's cargo registry cache was broken during this session)

Findings:
- PASS contract + reproducibility (validator clean with the 3000 LOD0 budget; origin between the axles; anchors unchanged)
- PASS budget: LOD0 2162 <= 2400 <= 3000; LOD1 892 <= 900; LOD2 594 <= 600
- PASS silhouette (better than before): LOD0 weighted IoU 0.9349 -> 0.9452 (side 0.949 -> 0.964, top 0.922 -> 0.928, front 0.921 -> 0.921, rear 0.938 -> 0.953); LOD1 0.933 -> 0.941; LOD2 0.941 -> 0.946. Short of the skill's ~0.95 at LOD0 by 0.005, mostly the top view (the sim's 0.43 m wheels on a 0.84 m track sit wider than the sheet's narrow body)
- PASS by-eye cues (ladder-lod0.png, reference-lod0/sheet.png): every cue in the owner's list is present: tall cabin with pillars and window frames, 5-spoke rims with red calipers, flared arches, large fanged lamps, barred grille, slatted intakes with 4 LEDs, black splitter, raised scoops, aerial, swoosh, swan-neck wing, full-width tail bar, black diffuser with quad pipes, mirrors
- PASS paint key / one material; draws per tile unchanged (44 in the mixed grid)
- PASS damage states (damage-strip.png: parts swing on their hinge lines, dark bays behind missing panels)
- PASS physics fit (colliders.png: one convex hull per part; the aerial, fin, calipers and mirrors are left out of the colliders)
- WARN wheel size: the sheet's wheels are about 0.34 m in radius, the model's 0.43 m (the sim's wheel_radius, shared feel with the Hawk); not changed here
- WARN the swoosh's pinstripes read cream through the paint key's filtered edges (br-vhtm, renderer-wide)

Remaining blockers: none for the model and the gate. The owner judges recognisability (br-bwju.11's ev:owner item).
