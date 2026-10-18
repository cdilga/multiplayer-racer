Vehicle Model Validation: PASS (with the WARNs below)

Vehicle/part IDs: cruz-missile; core (greenhouse with side glass and frames, painted roof, sill, mirrors, bays), front (nose, bonnet, lamps, grille and badge, intake, fog housings, bent nudge bar with LEDs, pink wedges, splitter, whip aerial), back (boot, tail lamps and wraps, badge, diffuser with fins, reverse-light triangle, exhaust, pink L corners, wing and endplates), door_FL/FR/RL/RR (with handles and pockets), wheel_FL/FR/RL/RR (tyre, rim lip, barrel, spokes, hub); interior blocks engine, cabin, boot
Commits: d322454e (model, atlas, params, bake, frozen colliders) and the evidence commit that ships this file, on v0.2-revamp
Changed files: art/vehicles/cruz-missile/{model.js, atlas.js, params.json, vehicle.json, colliders.json, review.src.json, refs/sheets.json, refs/masks/, cruz-missile.asset.json, cruz-missile.lod{0,1,2}.glb, cruz-missile.atlas.png}; assets/profiles/cruz-missile.json (hashes and rounding only); tools/vehicles/bake.mjs (vehicle.json colliderPoints); tools/vehicles/test/bake.test.mjs (no more comparison with Spike J's bounds and counts)
Requirement source: owner 2026-10-18 on br-bwju.11 (match the contact sheet; more LOD0 triangles allowed), R81, R86, R123; Playtest-1 plan 6.3 hinge lines

Method: lowpoly-model-from-refs. Structure built by hand from numbers measured off refs/lod-plus-1.png (side, front and rear crops at 2x with a metre grid; each view mapped to the model's frame separately, because the sheet's car is lower and longer than the model's); the livery is traced off the sheet (tools hue-classify the pink, lime and white regions of the side and top views, outline and simplify them, and map them into the atlas); then tools/vehicles/fit/opt.mjs on eris, 4 passes, numbers only, wheelR and track pinned (they are the sim's wheels). No new LOD level.

Visual evidence (Playwright Chromium headless on eris, software GL for the fit/viewer/evidence tools, ANGLE/Vulkan on the RTX 2080 Super for the host probe; not a TV or phone):
- reference-lod0/, reference-lod1/, reference-lod2/: sheet.png + score.json (`node tools/vehicles/fit/capture.mjs cruz-missile --out <dir> --lod N --sheet lod1|lowest`; compose.py run on the Mac). before-br-bwju.3/ holds the same for the model before this change (the directory name follows the other cars; these are the P1-V02 numbers)
- ladder-lod0.png, ladder-lod1.png, ladder-lod2.png: sheet crop | before | after for front, front 3/4, side, rear 3/4, rear, top; from ladder-before-raw.png (the committed P1-V02 GLBs) and ladder-after-raw.png (`node tools/vehicles/view/capture.mjs --asset <asset> --out <dir> --sheet ladder`)
- views.png, lods.png, paints.png, colliders.png: `node tools/vehicles/view/capture.mjs --asset /art/vehicles/cruz-missile/cruz-missile.asset.json --out <dir>`
- damage-strip.png, damage-strip-overview.png, paints-strip.png, grid-1.png, grid-4.png, grid-24.png: `node tools/vehicles/evidence/run.mjs cruz-missile --out <dir>`
- host-grid-1.png, host-grid-4.png, host-grid-24.png and render.json: the real host page (`host?synthetic=24&vehicles=mixed&freeze=240&tiles=N&res=1&autores=off`, 1920x1080), every roster car four times; old = the P1-V02 Cruz GLBs routed in, new = the committed ones

Checks run:
- node tools/vehicles/bake.mjs art/vehicles/cruz-missile: 2037 / 895 / 511 tris (asks 2800 / 900 / 600; qualified 3000 / 900 / 600); `--check` byte-reproducible
  - LOD0 per part: front 600, back 373, core 268, door_FL/FR 32, door_RL/RR 26, wheels 170 each
- jj vehicle sync / jj validate: in sync with its sidecar. The profile's hull is unchanged (colliders frozen), wheels and wheel_radius 0.4 unchanged
- node --test tools/vehicles/test/ (eris): 42 passed (bake reproducibility and loader, pivots on hinge lines at every LOD, sidecar pivots, paint key at every roster car, spec twins)
- scenario bank (rch cargo test -p jj-tools --test scenarios, on a clean clone of HEAD plus this change): only off-road-climb fails, as it already did at HEAD. With the hulls taken from the new visuals, flip-recover, air-level, air-pitch-crash and two-wheels-off failed too (their outcomes rest on the exact hull), so the bake now takes the Cruz's collision points from colliders.json, the P1-V02 bake's own per-part colliders
- node tools/vehicles/review/check.mjs and `build.mjs --check`: run by CI on the evidence commit (they need the spikes' evidence tree)

Findings:
- PASS contract + reproducibility (validator clean; origin between the axles; anchors unchanged; mass fractions unchanged)
- PASS budget: LOD0 2037 <= 2800 <= 3000; LOD1 895 <= 900; LOD2 511 <= 600
- PASS silhouette (better than before): weighted IoU LOD0 0.9422 -> 0.9494 (side 0.960 -> 0.969, top 0.950 -> 0.954, front 0.902 -> 0.898, rear 0.920 -> 0.940); LOD1 0.941 -> 0.946; LOD2 0.9327 -> 0.9335. LOD0 is 0.0006 short of the skill's ~0.95
- PASS by-eye cues (ladder-lod0.png, reference-lod0/sheet.png): lamps in brows, grille with badge, bent nudge bar with four LEDs, fog lamps, pink wedges, splitter, coil whip, framed glass and painted pillars, body-colour mirrors, handles, 5-spoke rims, tail lamps, badge, diffuser with fins, triangle and hex exhaust, wing with bolt-covered endplates, the traced lightning livery
- PASS paint key / one material; draws per tile unchanged (44 in the mixed grid)
- PASS damage states (damage-strip.png: parts swing on their hinge lines, dark bays behind missing panels)
- PASS physics fit (colliders.png: one convex hull per part, as it was; the whip, mirrors, glass layers and sill are not collision surfaces and the hull no longer depends on them)
- WARN wheel size: the sheet's wheels are about 0.36 m in radius, the model's 0.4 m (the sim's wheel_radius); not changed here
- WARN front view IoU 0.898: the sheet's nose and fenders are broader than the model's (the optimiser narrowed the nose to fit the side and top views)
- WARN the headlamps and wraps render as a flat white/cream patch (the sheet's lamps are warm, glowing and shaded)
- WARN the scenario bank's off-road-climb already failed at HEAD (not caused by this change)

Remaining blockers: none for the model and the gate. The owner judges recognisability (br-bwju.11's ev:owner item).
