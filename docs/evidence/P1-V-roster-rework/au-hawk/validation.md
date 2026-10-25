# AU Hawk: rework validation

Vehicle Model Validation: PASS for bounded visual rework and source/bake checks; production hardware qualification remains INCOMPLETE.

Bead `br-rgw6`, 2026-10-25. Fresh working-tree final source/bake; parent integration records the publication commit. Machine: repository Mac, headless Playwright Chromium 151.0.7922.34, software WebGL. Desktop viewer evidence; no real-device or GPU performance qualification is claimed.

Workflow: R81/R86, master plan §§12.3–12.5, game-asset-reference-modelling, lowpoly-model-from-refs and vehicle-model-validation skills. Unchanged references and cameras are the oracle. `baseline-source/` freezes the rejected incoming source/params/atlas; exact source/reference hashes and cameras are in `shape-comparison.json`. The accepted Hawk Dash was not edited.

## Form changes

A smoother arched glasshouse and lower front pane replace the old high, forward side glass. Raised arch cuts now sample the original rounded section at their actual height, removing the old shelves. Nose/tail corners are curved before lamp clipping; the bumper slot and rear lamps are rounded. Side glass clips exactly to substrate triangles; continuous door seams and body-colour moulding replace fragmented marks. LOD0 wheels have a recessed barrel and five spokes; glass is neutral grey. Coarse tiers retain their rear paint-to-glass transition.

## Exported geometry

| LOD | Visible triangles | Budget |
|---|---:|---:|
| 0 | 2308 | 3000 |
| 1 | 900 | 900 |
| 2 | 590 | 600 |

`bake.log` records per-part counts and output hashes. Runtime budget totals exclude interior bays and colliders. Fitter `stats.tris` includes unpruned source geometry/interiors, so it is not the exported budget count. Physics pivots remain separate from the revised visual shell.

## Frozen-camera silhouette results

Perspective, horizontal front/rear optical axis at 50 m, side/top at 10 m; hero azimuth 52°/140°, elevation 0°, distance 11 m, FOV 26°, target height 0.78 m. Generated sheets are not calibrated photographs. Values are incoming → revised.

| LOD | Weighted IoU | Side | Top | Front | Rear |
|---|---:|---:|---:|---:|---:|
| 0 | 0.9612 → 0.9615 | 0.9617 → 0.9559 | 0.9670 → 0.9748 | 0.9518 → 0.9525 | 0.9577 → 0.9590 |
| 1 | 0.9569 → 0.9600 | 0.9614 → 0.9590 | 0.9541 → 0.9653 | 0.9568 → 0.9573 | 0.9507 → 0.9546 |
| 2 | 0.9517 → 0.9542 | 0.9532 → 0.9557 | 0.9426 → 0.9494 | 0.9619 → 0.9575 | 0.9556 → 0.9562 |

The deliberate no-wing base-sedan interpretation still differs from the sheet. LOD0 side silhouette IoU regresses from 0.9617 to 0.9559; LOD2 side-glass overlap regresses from 0.5551 to 0.5365. Thick dark window trim and plain distant rim discs remain stylised.

## Independent local oracle

Every existing contour/width/lamp gate and tolerance is retained. New side-glass polygons were annotated on the unchanged reference crop, not sampled from the candidate. Actual glass triangles are selected by UV and orientation. The same oracle runs on frozen incoming/current source at all tiers:

| LOD | Incoming IoU | Revised IoU | Minimum | Result |
|---|---:|---:|---:|---|
| 0 | 0.6189 | 0.7128 | 0.68 | FAIL → PASS |
| 1 | 0.5992 | 0.6832 | 0.64 | FAIL → PASS |
| 2 | 0.5551 | 0.5365 | 0.50 | PASS → PASS |

Run `node docs/evidence/P1-V-roster-rework/au-hawk/reproduce-shape.mjs` to regenerate the JSON and before/after SVGs. Baseline failures demonstrate rejection of the incoming glass shape. Every final source check passes. A local pass does not cancel aggregate regressions.

## Visual/state review

Viewed original full references, all final sedan fitter sheets, all baked view/paint/LOD/collider sheets and every new loader capture. Large `comparison-{hero,hero_rear,shade_front,shade_rear,shade_side,shade_top}.png` pairs use identical union crop bounds and were regenerated after final corrections.

`baked/{views,paints,lods,colliders}.png` show fresh baked GLBs. Fresh `loader/` has intact/loose/detached side and overview strips, white plus five seat paints, and 1/4/24 viewer tiles. All were opened and inspected: no blank cars, broken media or missing paint keys; fixed-colour lamps/roof/trim remain distinct. These are posed viewer states, not a damage-simulation test or participant cap. Parent integration owns assembled review-page browser and running simulation evidence.

## Checks and limits

- PASS Every baked visible triangle count meets its tier budget.
- PASS Focused likeness suite: 10 tests; frozen attachment-pivot suite: 10 tests.
- PASS `node tools/vehicles/bake.mjs --check art/vehicles/au-hawk`; see `reproducibility.log`.
- PASS Independent shape reproduction: all current tiers pass; incoming failures are retained above.
- PASS Vehicle contract, collider data and baked attachment sidecar have no rework diff; handling, anchors, hinge transforms and budgets remain unchanged. Parent integration runs complete contract/settle proof.
- WARN Measured silhouette regressions and interpretation differences remain as stated above.
- WARN Owner likeness approval, real-device playtests and hardware performance are not claimed.
