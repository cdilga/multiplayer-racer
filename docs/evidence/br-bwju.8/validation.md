Vehicle Model Validation: PASS

Vehicle/part IDs: tradie-ute; core (cab, roof rack, snorkel, mirrors, steps), front (bonnet, grille, bull bar), back (tray, canopy,
tray lamps, tow bar), door_FL/FR/RL/RR, wheel_FL/FR/RL/RR; interior blocks engine, cabin, boot
Commit: the br-bwju.8 commit on v0.2-revamp (WhiteStream, 2026-10-16)
Changed files: art/vehicles/tradie-ute/{model.js, atlas.js, params.json, review.src.json, tradie-ute.asset.json, tradie-ute.lod{0,1,2}.glb,
tradie-ute.atlas.png, tradie-ute.emissive.png}; art/ui/poc/vehicles/tradie-ute/; docs/evidence/br-bwju.8/
Requirement source: br-bwju.8 (owner review 2026-10-11: "keep the rear canopy and the actual roof rack, and dual cab ... a little too
generic"); R123 (roster: the owner's Triton), R81 (code-built, faceted, lean budget), R86 (intact, loose, detached), R108 (identity
paint); Playtest-1 plan 6.3 hinge lines

Reference: the owner's 7 photos (eris ~/Work/dev/morayfield-house-3d/twin/site/sources/owner-inbox-2026-10-10/triton-reference.zip,
kept private: number plate and house) and the owner's Triton mesh (morayfield-house-3d fixtures/landscape-viewer/0.9.11/vehicles/
triton.ca0ed0aadd.glb). The side photo's outline is hand-traced into tools/evidence.js (PHOTO_SIDE).

Visual evidence (Playwright Chromium headless, software GL; the bake viewer and docs/evidence/br-bwju.8/tools, not the host renderer):
- views.png, lods.png, paints.png, colliders.png: `node tools/vehicles/view/capture.mjs --asset /art/vehicles/tradie-ute/tradie-ute.asset.json --out docs/evidence/br-bwju.8`
- reference-photo/sheet.png + score.json: LOD0 side against the owner's side photo outline (IoU 0.717)
- reference-lod0/sheet.png + score.json: LOD0 against the Triton mesh, four views (side 0.738, top 0.804, front 0.742, rear 0.742; weighted 0.759)
- damage-strip.png, damage-strip-overview.png: ten states (intact; doors loose; front+back loose; camber; front, door, back (tray and canopy), wheel detached; stripped shell)
- paints-strip.png: white plus five player colours; grid-1/4/24.png: 1, 4 and 24 tiles (LOD0/1/2 mixed)
- all by `node docs/evidence/br-bwju.8/tools/run.mjs --triton <triton.glb>`

Checks run:
- node tools/vehicles/bake.mjs art/vehicles/tradie-ute: 1250 / 828 / 592 tris (budgets 1300 / 900 / 600); `--check`: byte-reproducible
  LOD0 by part: core 368, front 310, back 256, doors 12 each, wheels 67 each, interiors 24 / 36 / 44
- target/release/jj validate art/vehicles/tradie-ute/tradie-ute.asset.json: ok (jj.vehicle.v1, triangles per LOD [1250, 828, 592])
- node --test tools/vehicles/test/: every tradie-ute test passes (pivots on hinge lines at LOD0/1/2, the same pivots at every LOD and in
  the sidecar, defect injection). The two failures in the run are postie-bike's, another session's car mid-build (no sidecar yet).
- node tools/vehicles/review/build.mjs, then check.mjs: the review page rebuilt from these files

Findings:
- PASS contract + reproducibility: the validator is clean, the bake is byte-reproducible, the part set is unchanged and identical at every LOD,
  and the mass fractions and anchors are unchanged.
- PASS budget + silhouette, with the by-eye cue pass below.
  - The budgets hold at every LOD.
  - IoU is 0.717 against the photo outline and 0.759 against the mesh. That is below the skill's ~0.95, on purpose: R123's roster cars
    are caricatures, wider and lower than the real car, and the photo has perspective.
  - The cues, each named with where it is: the canopy (back: black flat-top box over the full tray, wider than the cab, two lower doors
    with a seam and two round locks a side); the flat tray and the checker-plate under-tray boxes (the back's flanks in the atlas); the
    platform rack (core: rails, end slats, feet, wind deflector, rolled awning on the left); the dual cab (four doors); the MQ front
    (front: tall trapezoid grille with six vertical chrome slats, chrome "dynamic shield" sweeps under swept headlights, on a tall
    blunt nose); a solid black bull bar with hoop, light bar, fog lamps, plate and a yellow winch hook; the snorkel on the driver's
    (right) A-pillar; a lift (body 8 cm higher over the wheels); black wheels with a silver lip; combination tray lamps.
- PASS paint key / one material / draws per tile: there is still one atlas material, and two swatches were added (canopy, awning).
  The part types haven't changed, so the draws per tile haven't either.
- PASS damage states: front, back (now tray and canopy), the doors and the wheels each loosen and detach about their hinges, and
  dark bays show where parts are missing.
- PASS physics fit: `jj vehicle sync assets/profiles/tradie-ute.json` after PeachSpire's FL04.2 schema commit (27859cc5).
  - Only `geometry` and `source` changed; `tuning` is byte-equal. The hull gains the canopy, and its bottom rises 0.275 to 0.335.
  - Mass, the mass split and the origin are unchanged. `jj validate` says the profile is in sync with its sidecar.
  - `rch exec -- cargo test -p jj-sim --test tradie_ute`: 5 passed. It settles at the design ride height, beats the Cruz head-on
    with less bull-bar damage, laps the greybox under autopilot with no wreck, and responds to throttle.
  - `--test arcade --test roster`: 1 + 5 passed.
  - `cargo test -p jj-procgen --test jumps` fails 6, but on map checks that never involve a car, such as "a corner inside the jump
    approach is rejected" and lip heights. The working tree has another session's uncommitted `assets/profiles/generator.json` and
    `set-pieces.json`. That is not this bead's.
  - The old R122 bank target `handling_ute` no longer exists after FL04.2.
- PASS identity at the smallest tile:
  - The first rebuild made the car read as a black box from the chase cam, because the canopy hid the seat colour.
  - The canopy's lid now carries the seat colour; its sides and rear stay black like the owner's.
  - In grid-24.png every car's colour reads from behind and above.

Remaining blockers:
- none (AC4, the owner's look on the review page, is ev:owner)
