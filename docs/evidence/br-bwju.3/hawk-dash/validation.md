Vehicle Model Validation: PASS

Vehicle/part IDs: hawk-dash; core, front (nose, bonnet with bulge and vents, grille, lamps), back (boot, tail lamps, ducktail, diffuser, quad exhausts), door_FL/FR/RL/RR, wheel_FL/FR/RL/RR; interior blocks engine, cabin, boot
Commit: the br-bwju.3 commit on v0.2-revamp (this file ships in it)
Changed files: art/vehicles/hawk-dash/{model.js, atlas.js, params.json, vehicle.json, review.src.json, refs/, hawk-dash.asset.json, hawk-dash.lod{0,1,2}.glb, hawk-dash.atlas.png, hawk-dash.emissive.png};
assets/profiles/hawk-dash.json; assets/audio/engine/{hawk-dash.json, manifest.json}; web/shared/src/roster.json (row, spec 'aussie-v8');
tools/vehicles/fit/ (the generic fit page, extract, capture, optimiser); tools/vehicles/evidence/ (damage, paints, grid captures for any car);
tools/vehicles/test/spec-twins.test.mjs; tools/vehicles/bake.mjs (cars without the Cruz's bull bar); scripts/ci/checks.sh (every car's bake checked)
Requirement source: R123 (Hawk Dash after the Falcon Sprint; one spec with the Lion President), R81 (code-built from reference sheets, faceted, lean budget), R86 (intact, loose, detached), R138 (arcade framing); Playtest-1 plan 6.3 hinge lines; master plan 12.3-12.5

Method: lowpoly-model-from-refs. Reference sheets generated with Muse Image (art/ui/frames/generate.mjs --prompt
art/vehicles/hawk-dash/refs/prompts/<sheet>.txt, the Cruz's sheet as the layout example; ledger art/ui/frames/ledger.jsonl; three candidates,
pick 3 kept). The body is the Cruz Missile's lofted construction with its own proportions and details; tools/vehicles/fit/opt.mjs tuned the
numbers (5 passes, the smoothness and pull-to-start penalties on), structure fixed by hand between runs.

Visual evidence (Playwright Chromium headless, software GL; the bake viewer, tools/vehicles/fit and tools/vehicles/evidence, not the host renderer):
- reference-lod0/sheet.png + score.json: LOD0 against the 'lod + 1' sheet, per view reference | shaded | silhouette diff
- reference-lod2/sheet.png + score.json: LOD2 against the 'lowest' sheet
- views.png, lods.png, paints.png, colliders.png: `node tools/vehicles/view/capture.mjs --asset /art/vehicles/hawk-dash/hawk-dash.asset.json --out docs/evidence/br-bwju.3/hawk-dash`
- damage-strip.png, damage-strip-overview.png, paints-strip.png, grid-1.png, grid-4.png, grid-24.png: `node tools/vehicles/evidence/run.mjs hawk-dash --out docs/evidence/br-bwju.3/hawk-dash`

Checks run:
- node tools/vehicles/bake.mjs art/vehicles/hawk-dash: 1140 / 872 / 512 tris (budgets 1300 / 900 / 600); `--check`: byte-reproducible
  - LOD0 per part: front 260, back 320, core 184, door_FL/FR 24, door_RL/RR 12, wheels 76 each
- jj validate art/vehicles/hawk-dash/hawk-dash.asset.json: ok (jj.vehicle.v1); mass fractions sum 1.00
- jj vehicle sync / jj validate assets/profiles/hawk-dash.json: ok, in sync with its sidecar
- node --test tools/vehicles/test/: hawk-dash pivots on hinge lines at every LOD, the same pivots at every LOD and in the sidecar, defect injection rejected
- node --test tools/vehicles/test/spec-twins.test.mjs: 3 passed (the pair names one spec; identical tuning; a changed value is caught)
- engine sound: assets/audio/engine/hawk-dash.json passes the synth's validateProfile; `node art/ui/poc/audio/engine/build.mjs --check` up to date
- Rust (CI): jj-sim tests/roster.rs builds and drives every roster car from its own profile, checks the body's mass, and replays a mixed roster bit for bit. jj-wasm-host's mixed-roster hash runs too. These run in CI on the commit, not locally: the shared tree holds another worker's uncommitted profile-schema change (R136 handling), so a local build would test their schema, not HEAD's.

Findings:
- PASS contract + reproducibility (validator clean, origin between the axles, anchors cam_fp, cam_tp_target, com, roof_number, lplate_front, lplate_rear; no badges, logos or real names)
- PASS budget; silhouette: weighted IoU 0.964 for LOD0 against 'lod + 1' (side 0.976, top 0.953, front 0.948, rear 0.968) and 0.956 for LOD2 against 'lowest'
- PASS by-eye cues: bonnet bulge and vents, hexagonal grille, swept lamps, corner lamp slots, wrap-around tails, quad exhausts, ducktail, twin stripes and the side C stripe all read in views.png and grid-1.png
- PASS paint key / one material (the Cruz's atlas layout and material; draws per tile are the Cruz's 11 parts, one InstancedMesh per part type)
- PASS damage states (each part turns about its hinge line to its limit; detached parts lie as separate bodies; dark bays and interior blocks behind missing panels)
- PASS physics fit (convex collider per part from the bake, colliders.png; profile geometry synced from the sidecar; rear drive, 1700 kg)
- WARN identity at the smallest tile: legible as a striped sedan in grid-24.png, but the stripes read light grey there, not black, because of the paint key's filtered edges (br-vhtm, renderer-wide). The roof number isn't drawn by this viewer.

Remaining blockers:
- none for the model and gate. br-vhtm (paint-key fringes) is a renderer-wide follow-up.
