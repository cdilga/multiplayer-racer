Vehicle Model Validation: PASS (with the WARNs below)

Vehicle/part IDs: postie-bike; core (leg shield, floor and pads, body, seat, engine, twin mufflers, shocks, head tube, bars, mirrors), front (fork, headlamp, front mudguard, wire carrier with mail tub and parcels), back (rear grab rail, two open panniers with parcels, tail block with lamp and plate bracket, rear mudguard), rider, wheel_F, wheel_R
Commits: 843f7d32 (model, atlas, params, bake, frozen colliders, evaluator changes) and the evidence commit that ships this file, on v0.2-revamp
Changed files: art/vehicles/postie-bike/{model.js, atlas.js, params.json, vehicle.json, colliders.json, review.src.json, refs/sheets.json, refs/masks/, postie-bike.asset.json, postie-bike.lod{0,1,2}.glb, postie-bike.atlas.png}; assets/profiles/postie-bike.json (hashes and rounding only); tools/vehicles/fit/extract.mjs (sheets.json `patch`), tools/vehicles/fit/app.js (sheets.json `camD`, `tilt`)
Requirement source: owner 2026-10-18 on br-bwju.11 (match the contact sheet; more LOD0 triangles allowed), R81, R86, R121, R123; Playtest-1 plan 6.3 hinge lines

Method: lowpoly-model-from-refs. Structure built by hand from numbers measured off refs/lod-plus-1.png (side, front, rear and plan crops with a pixel grid; each view mapped to the model's frame separately); then tools/vehicles/fit/opt.mjs on eris, 4 passes, wheels pinned, followed by hand corrections where the optimiser bent the look (muffler height, rail width, lamp size, mirror spread; the carrier kept deep). No new LOD level.

Evaluator changes (both before and after numbers use them): the helmet is white on a grey backdrop and the segmenter dropped its top, so the mask extractor takes elliptical patches (sheets.json `patch`); the sheet is a level, far render, so refs/sheets.json sets camD 30 and tilt 0 instead of the Cruz-calibrated 10 m and 8 degree look-down (the same model scored front 0.70 and rear 0.77 under the old camera and 0.84 and 0.83 under the new).

Visual evidence (Playwright Chromium headless on eris, software GL for the fit/viewer/evidence tools, ANGLE/Vulkan on the RTX 2080 Super for the host probe; not a TV or phone):
- reference-lod0/, reference-lod1/, reference-lod2/: sheet.png + score.json (`node tools/vehicles/fit/capture.mjs postie-bike --out <dir> --lod N --sheet lod1|lowest`; compose.py run on the Mac). before-br-bwju.5/ holds the same for the br-bwju.5 bake under the same evaluator
- ladder-lod0.png, ladder-lod1.png, ladder-lod2.png: sheet crop | before | after for front, front 3/4, side, rear 3/4, rear, top; from ladder-before-raw.png and ladder-after-raw.png (`node tools/vehicles/view/capture.mjs --asset <asset> --out <dir> --sheet ladder --ortho 1.9`)
- views.png, lods.png, paints.png, colliders.png: `node tools/vehicles/view/capture.mjs --asset /art/vehicles/postie-bike/postie-bike.asset.json --out <dir> --ortho 1.9`
- damage-strip.png, damage-strip-overview.png, paints-strip.png, grid-1.png, grid-4.png, grid-24.png: `node tools/vehicles/evidence/run.mjs postie-bike --out <dir>`
- host-grid-1.png, host-grid-4.png, host-grid-24.png and render.json: the real host page (`host?synthetic=24&vehicles=mixed&freeze=240&tiles=N&res=1&autores=off`, 1920x1080; tile 1 follows a Postie, the four-tile capture follows four), every roster car four times; old = the br-bwju.5 Postie GLBs routed in, new = the committed ones

Checks run:
- node tools/vehicles/bake.mjs art/vehicles/postie-bike: 2782 / 894 / 586 tris (asks 2900 / 900 / 600; qualified 3000 / 900 / 600); `--check` byte-reproducible
  - LOD0 per part: core 578, front 472, back 488, rider 420, wheel_F 412, wheel_R 412
- jj vehicle sync: the profile is in sync with its sidecar. The hull is unchanged (colliders frozen); only hashes and 4th-decimal rounding differ
- node --test tools/vehicles/test/ (eris): 42 passed (pivots on hinge lines at every LOD for front and back, rider pivot at the hip, sidecar pivots, paint key, spec twins)
- scenario bank (rch cargo test -p jj-tools --test scenarios, on a clean clone of HEAD plus this change's profile and sidecar): only off-road-climb fails, as it already did at HEAD. rch cargo test -p jj-sim --test roster --test bikes: 4 and 5 passed
- tools/vehicles/review/check.mjs and `build.mjs --check`: run by CI on the evidence commit

Findings:
- PASS contract + reproducibility (origin between the axles; anchors unchanged; mass fractions unchanged; part set core, front, back, rider, wheel_F, wheel_R at every LOD)
- PASS budget: LOD0 2782 <= 2900 <= 3000; LOD1 894 <= 900; LOD2 586 <= 600
- WARN silhouette: weighted IoU LOD0 0.7999 -> 0.8579 (side 0.757 -> 0.850, top 0.887 -> 0.846, front 0.793 -> 0.868, rear 0.747 -> 0.893); LOD1 0.7502 -> 0.8441; LOD2 0.685 -> 0.7827. Below the skill's ~0.95: thin parts (wire basket, rail, mirror stalks, spokes) vanish from the masks, the sheet's panniers and bars are wider than the sim's bike, and the top view got worse (0.887 -> 0.846) because the sheet's plan is perspective-stretched
- PASS by-eye cues (ladder-lod0.png, reference-lod0/sheet.png): step-through shield and floor wedge, spoked lugged wheels, headlamp, swept bars with mirrors, twin mufflers, wire carrier with mail tub and parcels, open panniers with parcels, rear rail, tail lamp, hi-vis rider with helmet and visor
- PASS paint key / one material; draws per tile unchanged (44 in the mixed grid); the shield, floor, body, mudguards and tail block tint, the panniers, vest and parcels keep their colours
- PASS damage states (damage-strip.png: front, back and the rider swing about their hinge lines, wheels detach, the rider is thrown; no see-through holes)
- PASS physics fit (colliders.png: one convex hull per part, as it was; the new panniers, bars, mirrors and helmet are not collision surfaces)
- WARN wheel size: the sheet's tyres are about 0.37 m in radius, the model's 0.4 m and 0.36 m (the sim's)
- WARN the optimiser narrowed the plan (top view IoU fell) to fit side and rear; the rail and mirrors sit narrower than the sheet's

Remaining blockers: none for the model and the gate. The owner judges recognisability (br-bwju.11's ev:owner item).
