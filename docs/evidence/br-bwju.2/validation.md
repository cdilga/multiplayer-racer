Vehicle Model Validation: PASS

Vehicle/part IDs: tradie-ute; core, front (bonnet, grille, bull bar), back (tray, tailgate, tow bar), door_FL/FR/RL/RR, wheel_FL/FR/RL/RR; interior blocks engine, cabin, boot
Commit: uncommitted working tree on v0.2-revamp (br-bwju.2 helper run; the committing session fills this in)
Changed files: art/vehicles/tradie-ute/{model.js, atlas.js, params.json, vehicle.json, tradie-ute.asset.json, tradie-ute.lod{0,1,2}.glb, tradie-ute.atlas.png, tradie-ute.emissive.png};
assets/profiles/tradie-ute.json; assets/audio/engine/{tradie-ute.json, manifest.json}; crates/jj-sim/src/profile.rs (`TRADIE_UTE_JSON`, `VehicleProfile::tradie_ute()`);
crates/jj-sim/tests/tradie_ute.rs; crates/jj-procgen/tests/handling_ute.rs; docs/evidence/br-bwju.2/
Requirement source: R123 (roster; Tradie Ute from the owner's Triton), R81 (code-built, faceted, lean budget), R86 (intact, loose, detached), R122 (handling bank); Playtest-1 plan 6.3 hinge lines

Method note: R123 allows importing the owner's mesh; the bead notes preferred porting the build script's Triton geometry into the
code-built pipeline (clean part splits, R81's method). The proportions come from home-digital-twin
studies/landscape/catalog/vehicles/build_vehicles.py (dual cab, 3.0 m wheelbase, 0.8 m tyres, tray behind the cab, TJM bull bar,
snorkel on the driver's A-pillar, roof rack, side steps), scaled into a caricature that sits beside the Cruz.

Visual evidence (Playwright Chromium headless, software GL; the bake viewer and docs/evidence/br-bwju.2/tools, not the host renderer):
- views.png, lods.png, paints.png, colliders.png: `node tools/vehicles/view/capture.mjs --asset /art/vehicles/tradie-ute/tradie-ute.asset.json --out docs/evidence/br-bwju.2`
- reference-lod0/sheet.png + score.json: silhouettes of the owner's Triton mesh against LOD0, four views, bounding-box normalised
- damage-strip.png, damage-strip-overview.png: ten states (intact; doors loose; front+back loose; wheel camber; front, door, tray (back), wheel detached; stripped shell)
- paints-strip.png: default white + five player colours; grid-1/4/24.png: tiles at 1, 4 and 24 (LOD0/1/2 mixed)
- all by `node docs/evidence/br-bwju.2/tools/run.mjs --triton <triton.glb>`

Checks run:
- node tools/vehicles/bake.mjs art/vehicles/tradie-ute: 1216 / 870 / 594 tris (budgets 1300 / 900 / 600); `--check`: byte-reproducible
- jj validate art/vehicles/tradie-ute/tradie-ute.asset.json: ok (jj.vehicle.v1); jj validate assets/profiles/tradie-ute.json: ok, in sync
- node --test tools/vehicles/test/: 16 passed (pivots on hinge lines at every LOD for both roster cars, defect injection)
- rch exec -- cargo test -p jj-sim --test tradie_ute: 4 passed (profile heavier and torquier, settles upright at rest, three autopilot laps of the greybox with no wrecks: ute 155 s vs Cruz 151 s, throttle response)
- cargo test -p jj-procgen --test handling_ute (the R122 bank, 6 seeds x biomes, 15/25/35 m/s, held lock and flick, plus flat-ground sweep): 2 passed, no dives, no roll-overs

Findings:
- PASS contract + reproducibility (validator clean, mass fractions sum 1.00, origin between the axles, anchors present, no badges or real names)
- PASS budget; silhouette: weighted IoU 0.757 against the owner's Triton mesh (side 0.757, top 0.798, front 0.716, rear 0.716). The model omits the canopy and the roof bag the Triton carries and is a wider, caricatured stance, so this is a recognisability check, not a fit target
- PASS paint key / one material (the Cruz's atlas layout and material; draw cost per tile is the Cruz's 11 parts)
- PASS damage states (each part rotates about its hinge line to its limit; detached parts lie as separate bodies; dark bays and interior blocks behind missing panels)
- PASS physics fit (convex colliders per part from the bake, profile geometry synced from the sidecar, settles with no NaN)
- WARN identity/readability at the smallest tile: legible in grid-24.png (roof stripes, tray, bull bar); the roof number is not drawn by this viewer, so number legibility is untested
- WARN engine sound: assets/audio/engine/tradie-ute.json derived from the Cruz profile (diesel-ish retune); `art/ui/poc/audio/engine/check.mjs` result is in the self-review

Remaining blockers:
- none for the model and gate. The game cannot yet choose or render a second vehicle (see self-review.md, "Roster plumbing").
