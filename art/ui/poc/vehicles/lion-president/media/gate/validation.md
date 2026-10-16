Vehicle Model Validation: PASS (with the silhouette WARN below)

Vehicle/part IDs: lion-president; core (incl. the black roof, B-pillar strip, skirts, mirrors), front (nose, bonnet nostril scoops, lamps with LED fangs, split lower grille, air curtains), back (boot, full-width tail lamp band, tall wing with endplates, diffuser, quad exhausts), wheels with red calipers (LOD0), door_FL/FR/RL/RR, wheel_FL/FR/RL/RR; interior blocks engine, cabin, boot
Commit: the br-bwju.3 commit on v0.2-revamp (this file ships in it)
Changed files: art/vehicles/lion-president/{model.js, atlas.js, params.json, vehicle.json, review.src.json, refs/, lion-president.asset.json, lion-president.lod{0,1,2}.glb, lion-president.atlas.png, lion-president.emissive.png};
assets/profiles/lion-president.json; assets/audio/engine/{lion-president.json, manifest.json}; web/shared/src/roster.json (row, spec 'aussie-v8');
tools/vehicles/fit/ (the generic fit page, extract, capture, optimiser); tools/vehicles/evidence/ (damage, paints, grid captures for any car);
tools/vehicles/test/spec-twins.test.mjs; tools/vehicles/bake.mjs (cars without the Cruz's bull bar); scripts/ci/checks.sh (every car's bake checked)
Requirement source: R123 (Lion President after the last V8 Commodore; one spec with the Hawk Dash), R81 (code-built from reference sheets, faceted, lean budget), R86 (intact, loose, detached), R138 (arcade framing); Playtest-1 plan 6.3 hinge lines; master plan 12.3-12.5

Method: lowpoly-model-from-refs. Reference sheets generated with Muse Image (art/ui/frames/generate.mjs --prompt
art/vehicles/lion-president/refs/prompts/<sheet>.txt, the Cruz's sheet as the layout example; ledger art/ui/frames/ledger.jsonl; three candidates,
pick 1 kept). The body is the Cruz Missile's lofted construction with its own proportions and details; tools/vehicles/fit/opt.mjs tuned the
numbers (four runs; after the second, two shapes the optimiser bought were put back by hand and opt.mjs gained penalties for them: a glass
top wider than its base and a crown below its shoulder). The body was then raised 6 cm to read as a sedan, not a coupe, and re-fitted; the wing
was set back to 1.42 m by hand after the last run, because the tall wing is the car's signature (it costs 0.007 IoU).

Visual evidence (Playwright Chromium headless, software GL; the bake viewer, tools/vehicles/fit and tools/vehicles/evidence, not the host renderer):
- reference-lod0/sheet.png + score.json: LOD0 against the 'lod + 1' sheet, per view reference | shaded | silhouette diff
- reference-lod2/sheet.png + score.json: LOD2 against the 'lowest' sheet
- views.png, lods.png, paints.png, colliders.png: `node tools/vehicles/view/capture.mjs --asset /art/vehicles/lion-president/lion-president.asset.json --out docs/evidence/br-bwju.3/lion-president`
- damage-strip.png, damage-strip-overview.png, paints-strip.png, grid-1.png, grid-4.png, grid-24.png: `node tools/vehicles/evidence/run.mjs lion-president --out docs/evidence/br-bwju.3/lion-president`

Checks run:
- node tools/vehicles/bake.mjs art/vehicles/lion-president: 1278 / 890 / 526 tris (budgets 1300 / 900 / 600); `--check`: byte-reproducible
  - LOD0 per part: front 302, back 340, core 212, door_FL/FR 24, door_RL/RR 12, wheels 88 each (calipers); LOD1 drops the curtain slats to fit 900
- jj validate art/vehicles/lion-president/lion-president.asset.json: ok (jj.vehicle.v1); mass fractions sum 1.00
- jj vehicle sync / jj validate assets/profiles/lion-president.json: ok, in sync with its sidecar
- node --test tools/vehicles/test/: lion-president pivots on hinge lines at every LOD, the same pivots at every LOD and in the sidecar, defect injection rejected
- node --test tools/vehicles/test/spec-twins.test.mjs: 3 passed (the pair names one spec; identical tuning; a changed value is caught)
- engine sound: assets/audio/engine/lion-president.json passes the synth's validateProfile; `node art/ui/poc/audio/engine/build.mjs --check` up to date
- Rust (CI): jj-sim tests/roster.rs builds and drives every roster car from its own profile, checks the body's mass, and replays a mixed roster bit for bit. jj-wasm-host's mixed-roster hash runs too. These run in CI on the commit, not locally: the shared tree holds another worker's uncommitted profile-schema change (R136 handling), so a local build would test their schema, not HEAD's.

Findings:
- PASS contract + reproducibility (validator clean, origin between the axles, anchors cam_fp, cam_tp_target, com, roof_number, lplate_front, lplate_rear; no badges, logos or real names)
- PASS budget; WARN silhouette: weighted IoU 0.935 for LOD0 against 'lod + 1' (side 0.949, top 0.922, front 0.921, rear 0.938) and 0.941 for LOD2 against 'lowest', short of the ~0.95 target. The reference's lower front is boxier and wider than the shared lofted body allows, and the wing is kept high for identity
- PASS by-eye cues: black roof, bonnet nostrils, fang lamps, split lower grille, tall wing, full-width tail lamp, quad exhausts and the shoulder pinstripe read in views.png and grid-1.png; at grid-24 it reads apart from the Hawk Dash (wing, black roof, tail band against twin stripes)
- PASS paint key / one material (the Cruz's atlas layout and material; draws per tile are the Cruz's 11 parts, one InstancedMesh per part type)
- PASS damage states (each part turns about its hinge line to its limit; detached parts lie as separate bodies; dark bays and interior blocks behind missing panels)
- PASS physics fit (convex collider per part from the bake, colliders.png; profile geometry synced from the sidecar; rear drive, 1700 kg, the Hawk Dash's tuning exactly)
- WARN identity at the smallest tile: legible in grid-24.png; the pinstripe reads light (cream) through the paint key's filtered edges (br-vhtm, renderer-wide). The roof number isn't drawn by this viewer.
- WARN detail: the calipers read as small red squares on the rim disc; LOD2's flat scoop decals are partly clipped by the faceted bonnet

Remaining blockers:
- none for the model and gate. br-vhtm (paint-key fringes) is a renderer-wide follow-up.
