Vehicle Model Validation: PASS (with the silhouette WARN below; the sim run follows with the roster row)

Vehicle/part IDs: postie-bike; core (step-through frame, leg shield, floor boards, body, seat, engine, exhaust, handlebars and mirrors), front (fork, headlamp, front mudguard, the carrier and its mail tub), back (rear rack, the two postal-red panniers and their parcels, tail lamp, rear mudguard), rider (open-face helmet, hi-vis vest, blue shirt, shorts, boots), wheel_F, wheel_R
Commit: the br-bwju.5 commit on v0.2-revamp (this file ships in it)
Changed files: art/vehicles/postie-bike/{model.js, atlas.js, params.json, vehicle.json, review.src.json, refs/, the bake}; art/vehicles/_kit/ (the bike kit and
swatch atlas); crates/jj-contracts (the bike part set: BIKE_PARTS, part_set, the two-wheel axle rule, PhysicsGeometry wheels as a list);
art/contracts/vehicle.schema.json; tools/vehicles/{bake.mjs, contract-fixtures.mjs, fit/, evidence/, test/pivots.test.mjs};
web/host/src/render/vehicles/vehicles.ts (a bike's wheels keep their own types and aren't mirrored); assets/profiles/postie-bike.json;
assets/audio/engine/postie-bike.json
Requirement source: R123 (Postie Bike: the Australia Post step-through look, generic, no branding; the rider part of the model), R81 (code-built, faceted, lean budget), R86 (intact, loose, detached), R121 (a crash throws the rider);
br-bwju.4's two-wheel sim (its part layout is the contract's bike part set); Playtest-1 plan 6.2-6.3

Method: lowpoly-model-from-refs with the bike kit. Reference sheets from Muse Image (art/ui/frames/generate.mjs --prompt
art/vehicles/postie-bike/refs/prompts/<sheet>.txt, the Cruz's sheet as the layout example; three candidates, one kept). Bike masks: the
segmentation also keeps pale pixels (segment.bright), a 2 px opening (thin forks survive) and components above 3% of the largest
(refs/sheets.json), the same rules on both sides. tools/vehicles/fit/opt.mjs's bike mode tuned every numeric leaf; structure by hand.

Visual evidence (Playwright Chromium headless, software GL; the bake viewer, tools/vehicles/fit and tools/vehicles/evidence):
- reference-lod0/sheet.png + score.json, reference-lod2/sheet.png + score.json
- views.png, lods.png, paints.png, colliders.png: `node tools/vehicles/view/capture.mjs --asset /art/vehicles/postie-bike/postie-bike.asset.json --out docs/evidence/br-bwju.5/postie-bike`
- damage-strip.png, damage-strip-overview.png, paints-strip.png, grid-1.png, grid-4.png, grid-24.png: `node tools/vehicles/evidence/run.mjs postie-bike --out docs/evidence/br-bwju.5/postie-bike`

Checks run:
- node tools/vehicles/bake.mjs art/vehicles/postie-bike: 1180 / 882 / 568 tris (budgets 1300 / 900 / 600); `--check`: byte-reproducible
  - LOD0 per part: core 244, front 232, back 156, rider 268, wheel_F 140, wheel_R 140
- jj validate art/vehicles/postie-bike/postie-bike.asset.json (jj-tools built with the bike contract): ok (jj.vehicle.v1, the bike part set); mass fractions sum 1.00
- rch exec -- cargo test -p jj-contracts: the hand-made bike passes; the bike part set, centreline wheels and the sim's part order
  (physics_geometry); broken bikes (off-centre axles, a car door on a bike) fail with their named rules; the car fixtures unchanged
- node --test tools/vehicles/test/: postie-bike pivots on their hinge lines at every LOD (front and back edges, the rider at the hip),
  the same pivots at every LOD and in the sidecar, defect injection rejected
- engine sound: assets/audio/engine/postie-bike.json passes the synth's validateProfile; build.mjs --check up to date
- profile: assets/profiles/postie-bike.json geometry synced from the sidecar (jj vehicle sync: the bike part order, two wheels), tuning from
  the two-wheel sim fixture (br-bwju.4) with its balance and levelling gains rescaled to this body's inertia envelope
  (1.40 x 1.79 x 2.90 m, 200 kg) at the fixture's response frequencies, forces scaled by mass
- NOT run: the roster's sim tests with this bike (R122 handling bank, fun launch/speed, mixed roster). The profile is not a roster
  row yet: the shared tree holds the R136 handling schema change uncommitted, so a local sim build tests that schema, not HEAD's.
  The roster row and those tests follow when it lands (this bead stays open until then).

Findings:
- PASS contract + reproducibility (validator clean on the bike part set, origin on the ground between the axles, wheels on the centreline, anchors cam_fp, cam_tp_target, com, roof_number (the rider's back), lplate_front, lplate_rear; no badges, logos or real names)
- PASS budget
- WARN silhouette: weighted IoU 0.813 for LOD0 against 'lod + 1' (side 0.829, top 0.900, front 0.701, rear 0.706); 0.674 for LOD2 against 'lowest' (side 0.534: that sheet's spoked wheels aren't filled in its mask, so the model's solid octagons count as extra). A bike's thin parts (forks, frame, arms) score lower than a car body; the cues read by eye
- PASS by-eye cues: leg shield, front carrier with the mail tub, the two postal-red panniers stacked with parcels, round mirrors, the hi-vis rider in a white helmet; at grid-24 it reads as a postie in every seat colour (the panniers and vest keep their colours)
- PASS paint key / one material (a flat swatch atlas; draws per tile are the bike's 6 parts, one InstancedMesh per part type; the renderer now keeps a bike's two wheels as their own types)
- PASS damage states (front and back hang about their hinge lines, the rider pitches off about the hip and is thrown when detached, a wheel comes off; no interior bays: a bike has no panels to open)
- PASS physics fit (a convex proxy per part from the bake, colliders.png; the profile's geometry synced from the sidecar)
- WARN detail: the leg shield reads as a thin raked plank from the side; the exhaust sits low like a skid; LOD2 drops the exhaust and grips to keep a parcel a side

Remaining blockers:
- the roster row and the sim tests (R122 handling bank, fun, mixed roster) with this profile, after the R136 handling schema lands
