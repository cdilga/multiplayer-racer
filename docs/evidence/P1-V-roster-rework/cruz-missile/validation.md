# Cruz Missile reference rework
Vehicle Model Validation: FAIL — coarse likeness target outstanding; technical export checks pass

2026-10-25, br-rgw6 / P1-V roster refinement. R81/R86/R90 and the unchanged per-vehicle contract apply. This is a visual review candidate, not owner acceptance or a new driving/performance qualification.

The actual body is longer around the original fixed axles, has a broad rounded front with progressively swept corners, transverse bonnet crown, inward upper flank return, upright lamps, and graphics clipped to final skin facets. Dark interior bays now sit inside the sloping doors. Rear cap, lamps and diffuser follow the curved substrate. Repeated wheel detail was reduced to fund the enclosing shape; LOD0 wheel geometry totals 272 triangles. The exported intact totals are 2052 / 891 / 576 against unchanged budgets 2800 / 900 / 600.

- PASS contract, byte-reproducible bake and all three budgets (`final-contract.txt`, `final-bake-check.txt`).
- PASS complete original sidecar and collider POSITION buffers remain byte-identical to ad35536b; parent `../exports.json` records hashes. Handling, hubs, anchors, hinges and mass fractions remain unchanged.
- PASS independent body-to-axle proportion, intermediate/corner nose depth, lamp-plane slope and flank return checks at every tier. Actual rejected baseline fails all four named defects at each tier (`before-form.json`, `after-form.json`). Normal suite includes both real baseline and injected defects.
- PASS existing mesh, material, paint and attachment checks; parent vehicle-tests.txt records full result. No shared renderer/batching change or fresh GPU draw-cost claim.
- PASS native settle and straight-line handling fixtures, deterministic replay (`../sim.json`).
- WARN silhouette weighted before→after: .9542→.9511 / .9533→.9505 / .9359→.9301. Front improves but rear/side and coarse scores regress. The ~.95 broad likeness gate is not met at LOD2. Named local gains do not erase this limitation.

Front lamp envelope IoU is about .72 at LOD0, versus about .53 previously. Hero camera is now az34/elev2/dist9/fov26/targetY.78; both candidates were recaptured. Horizontal 50m end diagnostics and 10m side/top were retained. These are generated-sheet conventions, not recovered photographic calibration (`camera-correction.json`).

Final ladder, collider overlay, damage, paints and 1/4/24 tile captures use the baked GLTFLoader and shared paint-key viewer on Mac Playwright Chromium. All were personally inspected. Damage is posed for review; gameplay debris dynamics are covered by unchanged simulation, not proven by screenshots. Identity in the 24-tile viewer is visible; this is not a fresh host roof-number test.

Remaining: coarse wheel arches/lamps and rear shaping remain visibly simplified; inconsistent generated wing views require an interpretation. Coarse silhouette falls below the full likeness target. Existing unrelated engine/audio gate issues are outside this visual refinement. Awaiting owner review on /poc/.
