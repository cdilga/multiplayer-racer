# Postie Bike reference rebuild — 2026-10-25

Vehicle Model Validation: PASS for the reference-architecture rebuild and unchanged contract. The strict ~.95 silhouette qualification remains unmet; this is a review candidate, not full production or owner-playtest qualification.

Vehicle/parts: `postie-bike`; `core`, `front`, `back`, `rider`, `wheel_F`, `wheel_R`. Working-tree candidate over original contract baseline `d44c9093`, identified by source and baked SHA256 values in `source-checks.json`. Parent bead: `br-rgw6`. No Asyar work.

Requirements: R81/R86/R90, existing `jj.vehicle.v1` bike contract and qualified 2900/900/600 triangle budgets; lowpoly-model-from-refs and vehicle-model-validation skills. Physics, anchors, pivots and handling are frozen for this visual change.

## Reference and result

`art/vehicles/postie-bike/refs/provenance.json` records the primary real Honda CB50 architecture image, generated tier sheets, prompts, hashes and their limitations. The model uses a long tank, exposed vertical engine, open diamond frame, narrow spoked wheels and a single right exhaust in place of the old broad scooter-like floor/shield and twin pipes. Mail panniers, front basket/parcels and orange-vest rider preserve the fictional delivery identity. No real badge ships.

The primary real image governs architecture. Generated rear sheets invent twin pipe ends and the large hero is almost side-on; these are disclosed reference inconsistencies, not details to copy. Wheel centres and collision scale retain the game contract rather than pretending to be calibrated real-bike dimensions.

The supplied same-camera fit captures improve LOD0 weighted IoU from **.8164 to .8563**; revised LOD1 is **.8241**, LOD2 **.8049**. None reaches .95. Broad rider/mailbox silhouette and coarse simplification remain approximate. The fit tool reports raw source triangles (2464/894/614); the bake optimiser drops 177/17/21 unseen triangles and the actual exported counts below are the contract budget measurement.

| Part | LOD0 | LOD1 | LOD2 |
|---|---:|---:|---:|
| core | 732 | 303 | 175 |
| front | 407 | 138 | 78 |
| back | 424 | 102 | 94 |
| rider | 380 | 166 | 102 |
| wheel_F | 172 | 84 | 72 |
| wheel_R | 172 | 84 | 72 |
| **Total / budget** | **2287 / 2900** | **877 / 900** | **593 / 600** |

## Checks and reproducibility

- `node tools/vehicles/bake.mjs --check art/vehicles/postie-bike`: PASS, current bytes reproduce and exported budgets pass (`bake-check.log`).
- `target/debug/jj validate art/vehicles/postie-bike/postie-bike.asset.json`: PASS, no waivers (`contract-check.log`).
- `node docs/evidence/P1-V-roster-reference/postie-bike/reproduce.mjs`: PASS (`reproduce.log`, `source-checks.json`). Entire original sidecar deep-equals the current sidecar, including anchors/hinges/pivots/mass fractions/budgets. All six original collider POSITION buffer hashes and vertex counts match the original LFS asset. `baseline-source/contract-physics.json` includes the original commit/LFS oid and extracted contract/hash oracle, so the check does not need an old LFS download.
- Current source at all three LODs passes the unchanged local contour/feature fixture and open-wheel/frame samples. The independently loaded pre-rebuild source in `baseline-source/` fails the same fixture at every LOD. Missing and displaced named cues are rejected at each LOD. These targeted checks prove the stated cues, not complete likeness.
- Actual baked GLTFLoader meshes: 8 interspoke angles × 3 radii × both wheel sides × two wheels × three LODs = **288 probes**. No probe hits the wheel mesh. Whole-bike clear rays are 20–21/24 at the front and 17–19/24 at the rear; remaining hits are fork/frame/back structure. Four LOD0 side-view aperture pixels equal the empty backdrop exactly, RGB 201/201/203. The pale areas initially resembling filled disks are background through the wheel, not opaque wheel faces. Results are recorded in `source-checks.json`.
- `node --test tools/vehicles/test/pivots.test.mjs`: PASS, 37 tests. The bike's front/back attachment test compares source and sidecar exactly with original `d44c9093` pivot/hinge/mass/collider data rather than forcing frozen gameplay hinges onto the new visible edges. Defects reject centre/wrong-edge pivots, 1 mm drift on each axis, changed hinge axis and sidecar-only drift. This preserves the original physical attachment; it does not claim that the revised visible skins end exactly at that old pivot.
- Actual-loader captures: `tools/vehicles/view/capture.mjs` with asset `/art/vehicles/postie-bike/postie-bike.asset.json`, `--ortho 2.0`, plus `--sheet ladder`; `tools/vehicles/evidence/run.mjs postie-bike`. Playwright Chromium **151.0.7922.34**, Mac software rendering, standalone baked-asset review viewer. Every generated image was opened and inspected.

- PASS byte-reproducible export, existing triangle budgets and native contract validator.
- PASS original collider bytes and complete original sidecar retained.
- PASS local feature/negative-space checks; previous candidate and injected missing/displaced cues fail.
- PASS actual-loader multi-view, colours, all-tier apertures and posed damage review.
- FAIL strict ~.95 silhouette qualification; current fit scores are .8563/.8241/.8049. Owner likeness judgment remains pending.

## Visual evidence and scope limits

`views.png` covers front, rear, left, right, top and both 3/4 views. `ladder.png` covers six views per LOD; `lods.png` compares side and 3/4 at all tiers. `paints.png` and `paints-strip.png` show bright player colours with neutral tyres, panniers, rider and engine. `damage-strip.png` / `damage-strip-overview.png` show intact, loose and each part detached, including the rider and both wheels. `grid-1.png`, `grid-4.png`, `grid-24.png` show the baked bike at tile scales. `colliders.png` displays the original proxies intentionally unchanged beneath the new visual form.

LOD1/2 simplify hands and omit mirrors; the cheapest rider/helmet is deliberately angular. Fine engine/spoke detail becomes small at 24 tiles, while mailboxes, vest and bike silhouette remain recognizable. This viewer does not draw the gameplay roof-number/identity overlay, so these grids do not prove number legibility. No material/batching/loader code changed; no new draw-cost benchmark is claimed.

Damage images are static poses, not proof of dynamic debris lifetime, velocity inheritance or driving recovery. The parent owns running host/scenario evidence, profile hash synchronization, engine-profile checks and publication. `settle.json` is a scenario fixture, not by itself a passing run receipt; the parent's roster-level `sim.json` records native load/settle and straight-run results, including the bike's two-wheel contact requirement. This helper receipt makes no new hardware device, sound or network claim. Remaining qualification blockers are the explicit silhouette target and parent integration/owner playtest acceptance.
