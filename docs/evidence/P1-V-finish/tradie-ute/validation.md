Vehicle Model Validation: PASS (with the WARNs below)

Vehicle/part IDs: tradie-ute; core (cab with side glass and frames, roof rack, snorkel, mirrors, steps, bays), front (nose, bonnet scoop and vents, shield grille, lamps, bull bar, front flares), back (painted tray, canopy, tray lamps, step bumper, tow bar, rear flares), door_FL/FR/RL/RR, wheel_FL/FR/RL/RR (tyre, alloy rim, 8 spokes, hub); interior blocks engine, cabin, boot
Commits: 48a28076 (model, refs, bake, profile sync) and the evidence commit that ships this file, on v0.2-revamp
Changed files: art/vehicles/tradie-ute/{model.js, atlas.js, params.json, vehicle.json, review.src.json, tradie-ute.asset.json, tradie-ute.lod{0,1,2}.glb, tradie-ute.atlas.png, refs/}; assets/profiles/tradie-ute.json (geometry re-synced); tools/vehicles/view/{view.js, capture.mjs} (--ortho for a long car)
Requirement source: owner 2026-10-18 on br-bwju.11 (match the contact sheet; more LOD0 triangles allowed), br-bwju.8 (keep the canopy, the real roof rack, the dual cab), R81, R86, R123; Playtest-1 plan 6.3 hinge lines

Method: lowpoly-model-from-refs. The Ute had no contact sheet: two Muse Image turnarounds were generated (refs/prompts/, the Cruz's layout as the example, the br-bwju.8 render as the content example; art/ui/frames/ledger.jsonl) and cut into masks (tools/vehicles/fit/extract.mjs). Structure by hand from the sheet (the Lion's construction: flares, framed glass panes, decor parts the bake leaves out of colliders, spoked tyres), then tools/vehicles/fit/opt.mjs on eris, 4 passes, numbers only, wheelR and track pinned (the sim's wheels), then a few profile heights set by hand against the sheet's taller nose and higher sill. No new LOD level.

Visual evidence (Playwright Chromium headless on eris, software GL for the fit/viewer/evidence tools, ANGLE/Vulkan on the RTX 2080 Super for the host probe; not a TV or phone):
- reference-lod0/, reference-lod1/, reference-lod2/: sheet.png + score.json, `node tools/vehicles/fit/capture.mjs tradie-ute --out <dir> --lod N --sheet lod1|lowest` (compose.py run on the Mac: eris has no PIL)
- ladder-lod0.png, ladder-lod1.png, ladder-lod2.png: sheet crop | before | after for front, front 3/4, side, rear 3/4, rear, top; from ladder-before-raw.png (the br-bwju.8 GLBs) and ladder-after-raw.png, `node tools/vehicles/view/capture.mjs --asset <asset> --out <dir> --sheet ladder --paint '#00adc9' --ortho 3.0`
- views.png, lods.png, paints.png, colliders.png: `node tools/vehicles/view/capture.mjs --asset /art/vehicles/tradie-ute/tradie-ute.asset.json --out <dir> --ortho 3.0`
- damage-strip.png, damage-strip-overview.png, paints-strip.png, grid-1.png, grid-4.png, grid-24.png: `node tools/vehicles/evidence/run.mjs tradie-ute --out <dir>`
- host-grid-1.png, host-grid-4.png, host-grid-24.png and render.json: the real host page (`host?synthetic=24&vehicles=mixed&freeze=240&tiles=N&res=1&autores=off`, 1920x1080) at 48a28076, every roster car four times, old = the br-bwju.8 GLBs routed in

Checks run:
- node tools/vehicles/bake.mjs art/vehicles/tradie-ute: 2080 / 878 / 596 tris (asks 2400 / 900 / 600; qualified 3000 / 900 / 600); `--check` byte-reproducible
  - LOD0 per part: front 460, back 396, core 424, door_FL/FR/RL/RR 12 each, wheels 188 each
- jj vehicle sync assets/profiles/tradie-ute.json: in sync with its sidecar. Hull +-1.19 m (mirrors and the other decoration now stay out of it; it was +-1.29 m); wheels (+-0.88 m, 0.43 m) unchanged
- node --test tools/vehicles/test/ (eris scratch copy of the Mac tree): the Ute's pivot, sidecar, load and paint-key tests all pass; the only 4 failures are cruz-missile's, from another session's uncommitted rebuild in that copy
- rch cargo test -p jj-sim --test tradie_ute: 5 passed
- node tools/vehicles/review/check.mjs: every Vehicles-contract item present; review/build.mjs rebuilt the Ute's page from this evidence

Findings:
- PASS contract + reproducibility (origin between the axles; anchors unchanged; part ids and hinge layout unchanged; mass fractions unchanged)
- PASS budget: LOD0 2080 <= 2400 <= 3000; LOD1 878 <= 900; LOD2 596 <= 600
- WARN silhouette: LOD0 weighted IoU 0.8729 -> 0.9024 (side 0.851 -> 0.867, top 0.939 -> 0.965, front 0.833 -> 0.890, rear 0.840 -> 0.884); LOD1 0.8725 -> 0.9018; LOD2 0.8847 -> 0.9162. Short of the skill's ~0.95: the sheet's body is taller and narrower than the sim's 0.43 m wheels on a 0.88 m track allow, and its tyres are bigger than the sim's
- PASS by-eye cues (ladder-lod0.png, reference-lod0/sheet.png): framed side glass, flares, 8-spoke rims, bonnet scoop, shield grille, swept lamps, bull bar with light bar, fog lamps, plate and winch hook, painted tray with tall lamps, step bumper with reversing lamps, canopy hardware, rack, snorkel, mirrors, J-line and shoulder line
- PASS paint key / one material; draws per tile unchanged (44 in the mixed grid)
- PASS damage: intact -> loose -> detached for every part (damage-strip.png); dark bays behind the missing panels
- WARN LOD1 and LOD2 drop the full rack, the snorkel's bends and the scoop's vents to fit their budgets; the grille's slots read as a grey block at those sizes
