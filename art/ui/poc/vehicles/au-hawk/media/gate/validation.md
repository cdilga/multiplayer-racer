Vehicle Model Validation: PASS for the model, contract and gate; the AU-Falcon recognition item (recognition.md) is NOT met

Vehicle/part IDs: au-hawk; core (cab with side glass in black frames, painted roof, mirrors, door seams, bays), front (nose, bonnet dome, two lamp pods with a big and a small round lamp each, slatted grille, lower intake, bumper-end indicators, front flares), back (boot, wrap-around tail lamps with a chrome bar between them, lip spoiler, plate panel, rear bumper panel, two tail pipes, rear flares), door_FL/FR/RL/RR, wheel_FL/FR/RL/RR (tyre, five-spoke silver rim, hub); interior blocks engine, cabin, boot
Commits: 348caa83 (first build), 738e26ba (pods, optimiser, rebake) and the commit that ships this file, on v0.2-revamp
Changed files: art/vehicles/au-hawk/{model.js, atlas.js, params.json, vehicle.json, review.src.json, au-hawk.asset.json, au-hawk.lod{0,1,2}.glb, au-hawk.atlas.png, au-hawk.emissive.png, refs/}; assets/profiles/au-hawk.json (new; the Hawk Dash's tuning, geometry synced to this sidecar); web/shared/src/roster.json (one row); crates/jj-procgen/tests/handling.rs and tools/vehicles/test/paint-key.test.mjs (the car joins the lists); tools/vehicles/recognition/ (new); web/host/src/main.ts and render/synthetic.ts (`?vehicles=<id>`); art/ui/brand/renders/picker/au-hawk.png; art/ui/poc/vehicles/au-hawk/ (review page)
Requirement source: owner 2026-10-18 on br-bwju.12; R81 (code-built), R86 (damage), R123 (roster vehicles are rows); Playtest-1 plan 6.3 hinge lines

Method: lowpoly-model-from-refs. Reference sheets: Muse Image turnarounds (refs/prompts/, art/ui/frames/ledger.jsonl), the Hawk Dash's sheet as the layout example. Four rounds of sheets were generated and tried against a vision model before building (a first caricature, a lamp-pod caricature, and two faithful redraws; the last is the one built to). The model is the Hawk Dash's construction (two lofted shells, painted pillars, framed glass, flares, spoked wheels, no-collide decoration) with an AU face: lamp pods built as half-ellipsoids carrying lamp caps, a slatted grille, indicator rectangles, a bonnet dome, a lip spoiler, a chrome tail bar, no livery. tools/vehicles/fit/opt.mjs ran 3 passes on eris (numbers only), then the cabin base widths were clamped inside the shoulder, the bay walls moved inward, and the pods and spoiler were set by hand. The sim's wheel is 0.365 m (the Hawk's was 0.40) so the body reads taller and more sedan-like.

Visual evidence (Playwright Chromium headless on eris, software GL for the fit/viewer/evidence/recognition tools, ANGLE/Vulkan on the RTX 2080 Super for the chase captures; not a TV or phone):
- reference-lod0/, reference-lod1/, reference-lod2/: sheet.png + score.json, `node tools/vehicles/fit/capture.mjs au-hawk --out <dir> --lod N --sheet lod1|lowest` (compose.py run on the Mac: eris has no PIL)
- views.png, lods.png, paints.png, colliders.png: `node tools/vehicles/view/capture.mjs --asset /art/vehicles/au-hawk/au-hawk.asset.json --out <dir> --paint '#f06a1a' --ortho 3.0`
- damage-strip.png, damage-strip-overview.png, paints-strip.png, grid-1.png, grid-4.png, grid-24.png: `node tools/vehicles/evidence/run.mjs au-hawk --out <dir>`
- recognition/ (21 renders), chase/ (4 in-game chase views), control-hawk-dash/, recognition.md: the recognition test
- side-by-side-front34.png, side-by-side-front.png, side-by-side-side.png, side-by-side-rear34.png, au-vs-hawk-dash.png: the AU against every roster car and against the Hawk Dash

Checks run:
- node tools/vehicles/bake.mjs art/vehicles/au-hawk: 2612 / 876 / 574 tris (asks 3000 / 900 / 600); `--check` byte-reproducible on eris
  - LOD0 per part: front 934, back 666, core 264, door_FL/FR 26, door_RL/RR 14, wheels 167 each
- jj vehicle sync assets/profiles/au-hawk.json: in sync with its sidecar. Hull +-1.002 m wide, z -2.36..2.384 (the pods stand 8 cm proud of the bumper); wheels [+-0.84, 0.365, +-1.42], wheel_radius 0.365
- node --test tools/vehicles/test/ (eris scratch copy of the Mac tree): 47 passed, 0 failed (pivots on hinge lines at every LOD, sidecar, load, paint-key, spec twins). It failed once, at the first build: the bonnet dome ran 2 cm behind the front cut line, so LOD0's front pivot sat behind LOD2's front edge; the dome now stops at the cut
- node tools/vehicles/review/check.mjs: every Vehicles-contract item present
- rch exec -- cargo test -p jj-sim --test roster: passes with seven cars (see the commit message for the run)
- rch exec -- cargo test -p jj-procgen --test handling -- au_hawk the_r122_bank: see the commit message for the run

Findings:
- PASS contract + reproducibility (validator clean; origin between the axles; part ids and hinge layout as the Hawk Dash; mass fractions unchanged; anchors moved to this body: roof number on the roof crown, plates under the grille and on the boot)
- PASS budget: LOD0 2612 <= 3000; LOD1 876 <= 900; LOD2 574 <= 600
- PASS silhouette: weighted IoU LOD0 0.9489 (side 0.956, top 0.943, front 0.925, rear 0.967), LOD1 0.9468, LOD2 0.9450 against refs/lod-plus-1.png and refs/lowest-lod.png; at the skill's ~0.95 target. The front view's 0.925 is the pods standing out of the bumper plane
- PASS by-eye cues (views.png, reference-lod0/sheet.png, picker render art/ui/brand/renders/picker/au-hawk.png): lamp pods with a big and a small round lamp, slatted grille, lower intake, bumper-end indicators, body-colour mirrors, five-spoke silver rims, wrap tail lamps, chrome bar, lip spoiler
- PASS paint key / one material (paints.png: body, pods, bumpers, mirrors and spoiler take every paint; glass, lamps, rims and tyres keep their colour); draws per tile unchanged
- PASS damage states (damage-strip.png: every part swings on its hinge line, dark bays behind missing panels)
- PASS physics fit (colliders.png: one convex hull per part; the mirrors are decoration and stay out of the hulls)
- WARN recognition (recognition.md): the unprompted vision model names it an Australian sedan (a Commodore) in 13 of 25 renders and an AU Falcon in 0 of 25. The control (Hawk Dash) passes. Open for the owner; see recognition.md for what was tried and the options
- WARN the body is flat-sided at LOD0: the sheet's rounded flanks are approximated by the shoulder roll-in (the sheet's body is bubbly, the model's doors are slabs)
- WARN LOD2 drops the pods' second lamp, the grille slats, the indicators and the chrome bar to fit 600; the grille reads as a dark block
- WARN the engine sound profile (assets/audio/engine/au-hawk.json) is part 2 of br-bwju.12 (generated on eris, R89); until then the host falls back to the default voice

Remaining blockers: the 90 % recognition item (recognition.md); the burnout and doughnut tuning and the sound (part 2).
