Vehicle Model Validation: PASS

Vehicle/part IDs: cruz-missile; core, front, back, door_FL/FR/RL/RR, wheel_FL/FR/RL/RR; interior blocks engine, cabin, boot
Commit: the P1-V03 commits on v0.2-revamp (ffc454e hinge lines; the interior-blocks commit that carries this report)
Changed files: art/vehicles/cruz-missile/{model.js, vehicle.json, cruz-missile.asset.json, cruz-missile.lod{0,1,2}.glb, README.md};
tools/vehicles/{bake.mjs, compare-bakes.mjs, contract-fixtures.mjs, test/bake.test.mjs}; crates/jj-contracts (interiors in
jj.vehicle.v1, `interior` rule, fixtures); art/contracts/vehicle.schema.json; web/host/src/render/vehicles/vehicles.ts (interior
blocks drawn when exposed); web/host/src/render/synthetic.ts (the damage strip)
Requirement source: R81, R86, R58/R66 (owner direction); Playtest-1 plan §6.3 (damage model); bead br-p1-v03-0rz

Visual evidence (Playwright Chromium headless, software GL; the real host renderer for the strip and grids):
- damage-strip.jpg: ten cars side-on, one state each: intact; door_FL loose 60° and door_RL loose 45° (swung about the front
  edge); front loose 25° and back loose 25° (hanging about the top edge, the engine/boot block showing); wheel_FL ±6° camber;
  front, door_FL and wheel_FL detached (lying flat or upside down, in the owner's paint); a stripped shell (dark bays, the
  cabin block). `host/?synthetic=10&damage=strip&freeze=10&tiles=10&orbit=-110,…`
- damage-strip-overview.jpg: the same row from the overview camera.
- views.jpg (front/side/rear/top/3/4), paints.jpg (default + five player colours: tyres stay dark, glass/lamps/livery keep
  colour), lods.jpg (LOD0/1/2), colliders.jpg (per-part convex hulls; the core hull is the rounded cabin, not a box):
  `node tools/vehicles/view/capture.mjs --out docs/evidence/P1-V03`.
- grid-1.jpg, grid-4.jpg, grid-24.jpg: own car in its tile at 1, 4 and 24 tiles (TV 1080p; at 24 tiles each car ~100 px).

Checks run:
- node tools/vehicles/bake.mjs --check: the committed files are exactly what the model script bakes (reproducible)
- jj validate art/vehicles/cruz-missile/cruz-missile.asset.json: ok (jj.vehicle.v1, triangles per LOD [1264, 890, 594])
- cargo test -p jj-contracts: 3 passed (valid toy with an interior block passes; every broken fixture fails with its rule,
  including the two new `interior` cases)
- node --test tools/vehicles/test/: 5 passed (three.js load, contract nodes incl. interiors, Spike J's bounds, pivots = sidecar)
- node tools/vehicles/compare-bakes.mjs ffc454e~1: every part's world-space vertices within 6.85e-8 m of the pre-V03 bake
  at all three LODs, so the silhouette (IoU 0.947 weighted against refs/lod-plus-1.png, V02) is unchanged
- cargo test -p jj-sim --test feel (S03 feel bank on the production sidecar): 1 passed. RCH fell back to the Mac (eris
  offline, devbox no slots): a single-crate local build.
- node --test web/host/tests/vehicles.test.mjs: shared buffers across LOD tiles, loose/detached parts, interior blocks drawn
  only for exposed cars ({engine: 1, cabin: 2, boot: 0}), growth to 130 cars with constant draws
- N×N bench (P1-R02, docs/evidence/P1-R02/bench.md): 216 draws for 24 cars × 24 tiles; interior blocks add no draw while no
  part is exposed (hidden, count 0)

Findings:
- PASS contract + reproducibility (validator clean, byte-reproducible bake, schema and fixtures updated)
- PASS budget + silhouette (1264/890/594 ≤ 1300/900/600; interiors 24/36/32 tris each ≤ 80, drawn only when exposed;
  shape unchanged, IoU 0.947)
- PASS paint key / one material / draws per tile (one atlas material incl. interiors; 216 draws at 24×24)
- PASS damage states (each part intact → loose about its §6.3 hinge line → detached; dark bays and interior blocks behind
  missing panels; debris persists as the sim publishes it)
- PASS physics fit (mass fractions sum to 1; origin on the ground between the axles; core proxy rounded; feel bank passes)
- PASS identity/readability at the smallest tile (24-tile capture; paint key under six colours)

Remaining blockers:
- none for P1-V03's scope. Damage physics (hinge springs, detach bodies) is P1-S04; the sim doesn't publish part records yet,
  so the strip is driven by the synthetic source.
