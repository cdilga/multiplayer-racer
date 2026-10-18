Vehicle Model Validation: PASS (with the WARNs below)

Vehicle/part IDs: pig-catcher (bike part set); core (frame, engine and clutch covers, lofted tank and radiator shrouds, seat, rear side panels, swingarm, chain, shock, silvered silencer, pegs, bars, grips and hand guards), front (forks and gaiters, beaked mudguard and stays, number-plate shroud with headlamp, crash bar, two octagon spotlights), back (rear mudguard, tail lamp, rack, rope coil, hessian sack), rider (MX helmet with peak, goggles and chin bar; shirt, jeans, boots with soles, gloves), wheel_F, wheel_R (knobbly tyre, rim ring, wire spokes, hub; brake disc front, sprocket rear)
Commits: 3f1d0400 (model, bake, profile sync, opt.mjs honouring pinned) and the evidence commit that ships this file, on v0.2-revamp
Changed files: art/vehicles/pig-catcher/{model.js, atlas.js, params.json, vehicle.json, review.src.json, pig-catcher.asset.json, pig-catcher.lod{0,1,2}.glb, pig-catcher.atlas.png}; art/vehicles/_kit/bike.js (additive: Soup.decor and noCollide, so the bake keeps decoration out of colliders); assets/profiles/pig-catcher.json (geometry re-synced); tools/vehicles/fit/opt.mjs (bikes honour params.json `pinned`); tools/vehicles/view/{view.js, capture.mjs} (--zoom for a small subject)
Requirement source: owner 2026-10-18 on br-bwju.11 (match the contact sheet; more LOD0 triangles allowed), R81, R86, R123; Playtest-1 plan 6.3 (bike part set)

Method: lowpoly-model-from-refs against refs/lod-plus-1.png and refs/lowest-lod.png (existing sheets, masks unchanged). model.js rewritten on the bike kit with lofted bodies (tank, seat, side panels, mudguards), plates (shrouds, number plate), decor ranges, and LOD gates (detail 2/1/0); tools/vehicles/fit/opt.mjs on eris, 4+3+3+2 passes between hand fixes, numbers only, hubs, tyre width and fork pinned. No new LOD level.

Visual evidence (Playwright Chromium headless on eris, software GL for fit/viewer/evidence, ANGLE/Vulkan for the host probe; not a TV or phone):
- reference-lod0/, reference-lod1/, reference-lod2/: sheet.png + score.json (`node tools/vehicles/fit/capture.mjs pig-catcher --out <dir> --lod N --sheet lod1|lowest`)
- ladder-lod0.png, ladder-lod1.png, ladder-lod2.png: sheet crop | before (br-bwju.5 bake) | after, six views (`view/capture.mjs --sheet ladder --paint '#f4c418' --ortho 1.7 --zoom 0.55`)
- views.png, lods.png, paints.png, colliders.png; damage-strip.png, damage-strip-overview.png, paints-strip.png, grid-1/4/24.png (`evidence/run.mjs pig-catcher`)
- host-grid-1/4/24.png and render.json: the real host page (synthetic mixed grid, 1920x1080) at 3f1d0400, old = the br-bwju.5 GLBs routed in

Checks run:
- node tools/vehicles/bake.mjs art/vehicles/pig-catcher: 2736 / 884 / 588 tris (asks 2800 / 900 / 600; qualified 3000 / 900 / 600); two bakes identical to the committed files
  - LOD0 per part: core 604, front 356, back 340, rider 352, wheel_F 552, wheel_R 532
- jj vehicle sync assets/profiles/pig-catcher.json: synced; hand guards, spokes, lamp lenses stay out of the colliders
- node --test tools/vehicles/test/ (eris scratch copy): all pig-catcher tests pass (pivots at every LOD after fixing two: the front clamp and the rack legs no longer set LOD-dependent hinge edges); the one failure is postie-bike's, from another session's uncommitted edit in that copy
- rch cargo test -p jj-sim --test bikes --test roster: 4 and 5 passed; -p jj-procgen --test handling pig_catcher: 1 passed

Findings:
- PASS contract + reproducibility (origin between the axles; anchors, part ids, hinges, mass fractions unchanged)
- PASS budget: LOD0 2736 <= 2800 <= 3000; LOD1 884 <= 900; LOD2 588 <= 600
- WARN silhouette: LOD0 weighted IoU 0.8432 -> 0.8371 (side 0.906 -> 0.894, top 0.831 -> 0.827, front 0.805 -> 0.777, rear 0.739 -> 0.765); LOD1 0.8375 -> 0.8261; LOD2 0.8270 -> 0.7985. Below the skill's ~0.95, and slightly below the old bake: the sheet's detail (spokes, lugs, lamps, guards, rope) is not silhouette, and a bike's thin parts (guards, crash bar, spokes, lug dashes) cost pixels wherever they sit a centimetre off
- PASS by-eye cues (ladder-lod0.png): lofted tank and shrouds, two octagon spotlights and headlamp on a crash bar, hand guards, beaked mudguard, spoked rims on knobbly tyres, brake disc and sprocket, silvered silencer, rack with rope coil and sack, boots with soles, helmet peak and goggles
- PASS paint key / one material; draws per tile unchanged (44 in the mixed grid)
- PASS damage: intact -> loose -> detached for front, back, rider, wheels (damage-strip.png)
- WARN LOD1 and LOD2 drop spokes, lugs, the rim ring and the gaiters; LOD2's wheels are octagon discs with a flat grey face
