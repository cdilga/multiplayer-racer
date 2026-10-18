Vehicle Model Validation: PASS for the model, contract and gate (standard budgets 3000 / 900 / 600); the automated AU-Falcon recognition item (recognition.md) is NOT met and goes to the owner's verdict

Vehicle/part IDs: au-hawk; core (cab with side glass in black frames, painted roof, black mirrors, door seams, bays), front (round nose and domed bonnet, two swept teardrop headlamps with tails over the guards, oval fish-mouth grille with one body-colour bar and a plain blank oval badge, round fog lamps, bumper slot), back (domed boot, rounded corner tail lamps with white reverse lamps, plain oval boot badge, bumper line), door_FL/FR/RL/RR (door handles), wheel_FL/FR/RL/RR (tyre, five-spoke silver rim, hub); interior blocks engine, cabin, boot
Commits: round 1 348caa83, 738e26ba, edab31c6; round 2 f99ac37c, bd5b41dd, 550340cf; round 3 d87401d5 and 54581228 (raised LODs, measured), and the commit that ships this file (reverted to 900 / 600, override removed, fixes kept), on v0.2-revamp
Changed files (round 2): art/vehicles/au-hawk/{model.js, atlas.js, params.json, vehicle.json, review.src.json, au-hawk.asset.json, au-hawk.lod{0,1,2}.glb, au-hawk.atlas.png, au-hawk.emissive.png, refs/ (new sheets, masks, prompts/round2/, sheets.json)}; assets/profiles/au-hawk.json (geometry and source only); tools/vehicles/recognition/view.js (fitted framing); art/ui/frames/ledger.jsonl; art/ui/brand/renders/picker/au-hawk.png; art/ui/poc/vehicles/au-hawk/ and roster.json (review page)
Requirement source: owner 2026-10-18 on br-bwju.12 (instant AU recognition at all LODs and reasonable angles, bubbly, headlights and body shape); R81 (code-built, no real branding), R86 (damage), R123; Playtest-1 plan 6.3 hinge lines

Method: lowpoly-model-from-refs. New reference sheets: a literal series-1 AU generated in a chain (calibration photo, low-poly redraw with the base AU face, turnaround, rear and front fixes, lowest tier) and checked with the recognition prompt before modelling (recognition.md, step 1). The model keeps the lofted tub + greenhouse but its ring now has a tumblehome (the flank swells to full width at the belly line and tucks in above and below; LOD0/LOD1) and a domed deck point (LOD0/LOD1). Lamps, grille, bar, badges, fog lamps and tail lamps are decals ray-cast onto the tub along the sheet's view axis, so the teardrops wrap round the corners. No wing (the base AU has none; the sheet's read as a WRX's and as a ute's tailgate). The body is measured off the sheet at 5.45 mm per pixel so the wheelbase stays the sim's 2.84 m, then tools/vehicles/fit/opt.mjs (3 passes on eris, numbers only); the rear deck, tail and greenhouse glass were then set by hand for recognition.

Visual evidence (Playwright Chromium headless on eris, software GL; chase through ANGLE/Vulkan on the RTX 2080 Super; not a TV or phone):
- reference-lod0/, reference-lod1/, reference-lod2/: sheet.png + score.json, `node tools/vehicles/fit/capture.mjs au-hawk --out <dir> --lod N --sheet lod1|lowest` (compose.py on the Mac)
- views.png, lods.png, paints.png, colliders.png: `node tools/vehicles/view/capture.mjs --asset /art/vehicles/au-hawk/au-hawk.asset.json --out <dir> --paint '#f06a1a' --ortho 3.0`
- damage-strip.png, damage-strip-overview.png, paints-strip.png, grid-1.png, grid-4.png, grid-24.png: `node tools/vehicles/evidence/run.mjs au-hawk --out <dir>`
- recognition/ (21), chase/ (4), control-hawk-dash/ (25), recognition-answers-*.tsv, recognition.md
- side-by-side-*.png, au-vs-hawk-dash.png: the AU against the roster (`render.mjs` for every car, the same orange)

Checks run (eris, a `git archive` tree of d87401d5 plus its LFS files, overlaid with this commit's art/vehicles/au-hawk, crates/jj-contracts, art/contracts and tools/vehicles; /tmp/auhawk4):
- node tools/vehicles/bake.mjs art/vehicles/au-hawk: 2906 / 896 / 600 tris (asks 3000 / 900 / 600); `--check`: the committed files are exactly what the model script bakes
- jj validate: au-hawk ok [2906, 896, 600]; every other roster sidecar ok
- cargo test -p jj-contracts: 5 + 5 passed (the override, its fixtures and test removed)
- round 3 host cost (render.json, tools/vehicles/evidence/host-cost.mjs): the raised LODs cost +7.1 % triangles at 24 tiles; reverted
- jj vehicle sync assets/profiles/au-hawk.json: geometry synced; `jj validate`: in sync with its sidecar. Hull +-1.021 m, y 0.20..1.64, z -2.622..2.404; wheels [+-0.84, 0.365, +-1.42], wheel_radius 0.365 (unchanged); tuning section unchanged
- node --test tools/vehicles/test/: 47 passed, 0 failed (after the LOD2 flank fix; it failed once on door_FL's LOD2 pivot)
- node tools/vehicles/review/check.mjs: every Vehicles-contract item present
- cargo test -p jj-sim --test roster --test arcade --test fun: 1 + 1 + 5 passed
- cargo test -p jj-procgen --test handling: 12 passed, 1 ignored (every roster car on generated roads, the AU included)
- cargo test -p jj-tools --test scenarios: 1 passed (every scenario envelope, the AU's roster fixtures included)
- cargo test -p jj-wasm-host --features testing a_mixed_roster: passed with the new profile (no re-bless needed)
- cargo test -p jj-sim --test feel --test duels: passed (after 78211e29 moved the per-car comparisons to scenarios/handling/)
  (Rust ran with cargo on eris rather than through rch: the Mac's tree holds other sessions' uncommitted crate edits, and the profile sync has to write a file back)

Findings:
- PASS contract + reproducibility (validator clean; origin between the axles; part ids and hinges as before; anchors moved to the new body: roof number on the crown at y 1.65, plates at the new nose and tail)
- PASS budget: LOD0 2906 <= 3000; LOD1 896 <= 900; LOD2 600 <= 600
- PASS silhouette: weighted IoU LOD0 0.9600, LOD1 0.9538, LOD2 0.9533 (front views 0.90-0.92: the sheet's front view is drawn wider than its plan view)
- PASS by-eye cues (views.png, lods.png, reference sheets): teardrop lamps, oval grille with bar and blank badge, fog lamps at LOD0/1, corner tail lamps with reverse lamps, boot badge, black mirrors, silver rims; LOD2 keeps both lamps, the grille, the bar, both badges and the tail lamps
- PASS paint key / one material; draws per tile unchanged
- PASS damage states; PASS physics fit (one convex hull per part, mirrors excluded)
- FAIL (automated) recognition (recognition.md): this bake, 3 calls per image: LOD0 6/15, LOD1 3/15, LOD2 1/15 on the bar views, chase 0/12; the same images ranged 33/45 to 12/45 between windows. The control (Hawk Dash) is named a Falcon 0/25. The owner judges recognisability (owner checklist, "AU Hawk")

Remaining blockers: the owner's verdict on recognisability (ev:owner).
