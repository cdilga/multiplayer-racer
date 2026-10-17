Vehicle Model Validation: PASS (with the WARNs below)

Vehicle/part IDs: hawk-dash; core (greenhouse with painted pillars, side glass in three panes with black frames, the striped roof, skirts, mirrors, door seams, bays), front (nose, bulge, louvred vents, headlamps, hexagonal grille, lower intake, LED slots, splitter, stripes, front flares), back (boot, tail lamps, wing on posts with turned-down tips, diffuser with fins, four pipes, stripes, rear flares), door_FL/FR/RL/RR (with handles), wheel_FL/FR/RL/RR (tyre, rim lip, barrel, five spokes, hub); interior blocks engine, cabin, boot
Commits: 8dee3ab7 (structure), f6113c32 (fit), a3481b42 (pinstripe gap), 09a3e725 (flares stop at the cut lines), and the evidence commit that ships this file, on v0.2-revamp
Changed files: art/vehicles/hawk-dash/{model.js, atlas.js, params.json, vehicle.json, review.src.json, hawk-dash.asset.json, hawk-dash.lod{0,1,2}.glb, hawk-dash.atlas.png, hawk-dash.emissive.png}; assets/profiles/hawk-dash.json (geometry re-synced)
Requirement source: owner 2026-10-18 on br-bwju.11 (match the contact sheet; more LOD0 triangles allowed), R81, R86, R123; Playtest-1 plan 6.3 hinge lines

Method: lowpoly-model-from-refs. Structure built by hand from numbers measured off refs/lod-plus-1.png (side, front, rear and top crops at 2x with a 10 cm grid), on the Lion President's construction (painted greenhouse with glass overlays clipped per cabin station, flares, spoked wheels, no-collide decoration). New here: fascia and tail details are polygons measured in the sheet's front and rear views, projected onto the body along the car's axis and cut into cells so they follow the curved nose and tail. Then tools/vehicles/fit/opt.mjs on eris, 4 passes, numbers only, wheelR and track pinned (the sim's wheels); then the tail details rescaled to the fitted tail. Iterated on the Mac with a CPU port of the evaluator. No new LOD level.

Visual evidence (Playwright Chromium headless on eris, software GL for the fit/viewer/evidence tools, the host page for the host probe; not a TV or phone):
- reference-lod0/, reference-lod1/, reference-lod2/: sheet.png + score.json, `node tools/vehicles/fit/capture.mjs hawk-dash --out <dir> --lod N --sheet lod1|lowest` (compose.py run on the Mac: eris has no PIL)
- ladder-lod0.png, ladder-lod1.png, ladder-lod2.png: sheet crop | before | after for front, front 3/4, side, rear 3/4, rear, top; from ladder-before-raw.png (the br-bwju.3 GLBs, still in art/ui/poc/vehicles/hawk-dash/media/model/ at capture time) and ladder-after-raw.png, `node tools/vehicles/view/capture.mjs --asset <asset> --out <dir> --sheet ladder --paint '#2c4fb4'`
- views.png, lods.png, paints.png, colliders.png: `node tools/vehicles/view/capture.mjs --asset /art/vehicles/hawk-dash/hawk-dash.asset.json --out <dir>`
- damage-strip.png, damage-strip-overview.png, paints-strip.png, grid-1.png, grid-4.png, grid-24.png: `node tools/vehicles/evidence/run.mjs hawk-dash --out <dir>`
- host-grid-1.png, host-grid-4.png, host-grid-24.png and render.json: the real host page (`host?synthetic=24&vehicles=mixed&freeze=240&tiles=N&res=1&autores=off`, 1920x1080), every roster car four times, with the old Hawk GLBs routed in for "old"

Checks run:
- node tools/vehicles/bake.mjs art/vehicles/hawk-dash: 2459 / 896 / 596 tris (asks 2800 / 900 / 600; qualified 3000 / 900 / 600); `--check` byte-reproducible on eris at 09a3e725
  - LOD0 per part: front 705, back 722, core 284, door_FL/FR 26, door_RL/RR 14, wheels 167 each
- jj vehicle sync / jj validate assets/profiles/hawk-dash.json: in sync with its sidecar. Hull +-0.995 m wide (was +-1.078 with the mirrors in it), z -2.351..2.29; wheels [+-0.84, 0.4, +-1.42] and wheel_radius 0.4 unchanged
- node --test tools/vehicles/test/ (eris, 09a3e725): 39 passed (pivots on hinge lines at every LOD, sidecar pivots, spec twins). It failed once at a3481b42 (the front flare ran behind the cut line, so LOD0's front pivot sat 9 cm behind LOD2's front edge); fixed in 09a3e725
- node tools/vehicles/review/check.mjs: every Vehicles-contract item present
- rch exec -- cargo test -p jj-procgen --test handling: 11 passed, 1 ignored, including a_car_thrown_about_on_generated_roads_never_dives_or_rolls_over_hawk_dash (RCH on eris, with the Mac's working tree, which held other sessions' uncommitted jj-procgen edits)

Findings:
- PASS contract + reproducibility (validator clean; origin between the axles; anchors unchanged)
- PASS budget: LOD0 2459 <= 2800 <= 3000; LOD1 896 <= 900; LOD2 596 <= 600
- PASS silhouette (held, not raised): weighted IoU LOD0 0.9638 -> 0.9633, LOD1 0.9604 -> 0.9609, LOD2 0.9555 -> 0.9505 (iou.json). Side and rear rise at every LOD (LOD0 side 0.976 -> 0.979, rear 0.968 -> 0.971); front falls (0.948 -> 0.934, the evaluator's 8-degree front camera against the new flat fascia). Above the skill's ~0.95 at every LOD
- PASS by-eye cues (ladder-lod0.png, reference-lod0/sheet.png): painted pillars and black-framed side glass, striped roof, swept wrap-round headlamps, hexagonal grille, lower intake, LED slots, splitter, bulge and louvred vents, flares, dark 5-spoke rims, angular smoked tail lamps, body-colour wing, diffuser with quad pipes, big mirrors, door handles, twin stripes nose to tail, side C graphic
- PASS paint key / one material; draws per tile unchanged (44 in the mixed grid)
- PASS damage states (damage-strip.png: parts swing on their hinge lines, dark bays behind missing panels)
- PASS physics fit (colliders.png: one convex hull per part; mirrors and wing tips are left out of the colliders)
- WARN wheel size: the sheet's wheels are about 0.35 m in radius, the model's 0.40 m (the sim's wheel_radius); not changed here
- WARN the stripes' and C graphic's edges read light grey in the viewer and the host at small sizes (br-vhtm, renderer-wide filtered paint-key edges)

Remaining blockers: none for the model and the gate. The owner judges recognisability (br-bwju.11's ev:owner item).
