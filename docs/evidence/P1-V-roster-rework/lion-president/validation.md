# Lion President: rework validation

Vehicle Model Validation: PASS for bounded visual rework and source/bake checks; production hardware qualification remains INCOMPLETE.

Bead `br-rgw6`, 2026-10-25. Fresh working-tree final source/bake; parent integration records the publication commit. Machine: repository Mac, headless Playwright Chromium 151.0.7922.34, software WebGL. Desktop viewer evidence; no real-device or GPU performance qualification is claimed.

Workflow: R81/R86, master plan §§12.3–12.5, game-asset-reference-modelling, lowpoly-model-from-refs and vehicle-model-validation skills. Unchanged references and cameras are the oracle. `baseline-source/` freezes the rejected incoming source/params/atlas; exact source/reference hashes and cameras are in `shape-comparison.json`. The accepted Hawk Dash was not edited.

## Form changes

A new mid-flank crease and upper shoulder roll replace the broad flat side; raised arch cuts sample the original section at their actual height. Reshaped cabin stations, lower rear belt and independently annotated pane boundaries correct the high, forward glass. Window overlays clip to actual substrate triangles. The fascia bends through four broad close-view planes, with graphics sharing that transform. LOD0 wheels gain a shallow dish, lip and broader spokes. Coarse wing endplates remain explicit thin planes with crossed supports; coarse spokes are symmetric. Rear-glass foot stations follow deck height at their own x/z, including the bowed centre, closing the visible foot gap.

## Exported geometry

| LOD | Visible triangles | Budget |
|---|---:|---:|
| 0 | 2296 | 2400 |
| 1 | 900 | 900 |
| 2 | 592 | 600 |

`bake.log` records per-part counts and output hashes. Runtime budget totals exclude interior bays and colliders. Fitter `stats.tris` includes unpruned source geometry/interiors, so it is not the exported budget count. Physics pivots remain separate from the revised visual shell.

## Frozen-camera silhouette results

Perspective, horizontal front/rear optical axis at 50 m, side/top at 10 m; hero azimuth 52°/140°, elevation 0°, distance 11 m, FOV 26°, target height 0.78 m. Generated sheets are not calibrated photographs. Values are incoming → revised.

| LOD | Weighted IoU | Side | Top | Front | Rear |
|---|---:|---:|---:|---:|---:|
| 0 | 0.9478 → 0.9466 | 0.9467 → 0.9524 | 0.9365 → 0.9244 | 0.9562 → 0.9568 | 0.9645 → 0.9653 |
| 1 | 0.9438 → 0.9402 | 0.9414 → 0.9330 | 0.9288 → 0.9351 | 0.9588 → 0.9552 | 0.9651 → 0.9550 |
| 2 | 0.9484 → 0.9444 | 0.9460 → 0.9352 | 0.9500 → 0.9519 | 0.9470 → 0.9467 | 0.9528 → 0.9518 |

Weighted silhouette overlap regresses at every tier. LOD0 top IoU falls from 0.9365 to 0.9244, while side improves from 0.9467 to 0.9524. LOD1 side/rear and LOD2 side also regress. The LOD1 side-glass gate passes narrowly, 0.5066 against 0.5000. Coarse wing planes, tyre proportions and high spoiler retain the stylised reference interpretation.

## Independent local oracle

Every existing contour/width/lamp gate and tolerance is retained. New side-glass polygons were annotated on the unchanged reference crop, not sampled from the candidate. Actual glass triangles are selected by UV and orientation. The same oracle runs on frozen incoming/current source at all tiers:

| LOD | Incoming IoU | Revised IoU | Minimum | Result |
|---|---:|---:|---:|---|
| 0 | 0.3644 | 0.6892 | 0.60 | FAIL → PASS |
| 1 | 0.3206 | 0.5066 | 0.50 | FAIL → PASS |
| 2 | 0.3729 | 0.4661 | 0.40 | FAIL → PASS |

Run `node docs/evidence/P1-V-roster-rework/lion-president/reproduce-shape.mjs` to regenerate the JSON and before/after SVGs. Baseline failures demonstrate rejection of the incoming glass shape. Every final source check passes. A local pass does not cancel aggregate regressions.

## Visual/state review

Viewed original full references, all final sedan fitter sheets, all baked view/paint/LOD/collider sheets and every new loader capture. Large `comparison-{hero,hero_rear,shade_front,shade_rear,shade_side,shade_top}.png` pairs use identical union crop bounds and were regenerated after final corrections.

`baked/{views,paints,lods,colliders}.png` show fresh baked GLBs. Fresh `loader/` has intact/loose/detached side and overview strips, white plus five seat paints, and 1/4/24 viewer tiles. All were opened and inspected: no blank cars, broken media or missing paint keys; fixed-colour lamps/roof/trim remain distinct. These are posed viewer states, not a damage-simulation test or participant cap. Parent integration owns assembled review-page browser and running simulation evidence.

## Checks and limits

- PASS Every baked visible triangle count meets its tier budget.
- PASS Focused likeness suite: 10 tests; frozen attachment-pivot suite: 10 tests.
- PASS `node tools/vehicles/bake.mjs --check art/vehicles/lion-president`; see `reproducibility.log`.
- PASS Independent shape reproduction: all current tiers pass; incoming failures are retained above.
- PASS Vehicle contract, collider data and baked attachment sidecar have no rework diff; handling, anchors, hinge transforms and budgets remain unchanged. Parent integration runs complete contract/settle proof.
- WARN Measured silhouette regressions and interpretation differences remain as stated above.
- WARN Owner likeness approval, real-device playtests and hardware performance are not claimed.
