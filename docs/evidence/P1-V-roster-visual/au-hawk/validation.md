Vehicle Model Validation: PASS for the named corrective scope and weighted silhouette target; full production qualification remains unclaimed.

# AU Hawk: shaded roster pass

P1-V-roster-visual, br-8h3u.17, 2026-10-25. Awaiting artistic review. Evidence was captured on the repository Mac with headless Playwright Chromium 151.0.7922.34. Posed renderer states are not a simulation, device or hardware-performance qualification.

The lower undertray is separated from arch-raised side lips, removing the curved radial underside ramps. Raised painted door moulding, tucked flanks and the reference spoiler improve the shaded body. Hawk-style atlas wheels retain broad silver five-spoke faces with sealed inner sidewalls; windscreen/backlight detail uses the existing atlas. Exported triangles are 2096 / 880 / 600 within unchanged 3000 / 900 / 600 budgets. Weighted silhouette scores are 0.9595 / 0.9579 / 0.9510; the LOD2 top view remains 0.9377. Original physical contracts, pivots, colliders, anchors and handling are unchanged. Named corrective checks pass; grille/bumper recess depth and lamp/mirror detail remain coarser than the reference. This is awaiting artistic review, not full production qualification.

| LOD | Exported render triangles | Unchanged budget | Weighted silhouette IoU |
|---|---:|---:|---:|
| 0 | 2096 | 3000 | 0.9595 |
| 1 | 880 | 900 | 0.9579 |
| 2 | 600 | 600 | 0.9510 |

Budget counts exclude interior/debug/collider geometry exactly as the baker does. `triangle-receipt.json` records every part before and after. `physical-contract.json` proves vehicle.json, colliders.json and the asset sidecar unchanged byte for byte; frozen pivots are asserted at all LODs. Canonical references and all prior likeness tolerances are unchanged.

`visual-comparison.png` contains the reference hero plus shaded previous/current body, front and low underside views, with the same world camera and display scale for previous/current. `lod-reference-review.png` contains all three reference/shading/diff sheets and rear heroes. `loader-review.png` contains the actual GLTF loader ladder, paint/view/collider sheets, intact/loose/detached poses, paint strip and 1/4/24-car samples. All were visually inspected. Those cohort sizes are samples, not limits. `self-review.md` records the shaded findings and limitations.

- PASS named underside correction: undertray remains independent of the raised arch cut; actual rejected source fails the transverse-floor check.
- PASS named body correction: raised painted moulding and modest pane-border refinement; reference spoiler restored.
- PASS open/expensive wheel regression corrected: sealed wheel backs and atlas faces use 44 exported triangles per LOD0 wheel; actual old source fails closure/cost checks.
- PASS focused panel suite: 26/26 cases across both sedans; log ../au-hawk/panel-tests.log. Existing sedan likeness suite: 6/6 cases; log ../au-hawk/likeness-tests.log.
- PASS bake reproducibility and original per-tier budgets; final-validation.log records successful bake --check and final capture commands.
- PASS frozen colliders, pivots, handling, anchors, masses, hinge transforms and budget contracts unchanged.
- PASS inspected actual loader paint, damage-pose and grid evidence; glass/lamps/trim retain fixed colours through player paints.
- PASS weighted silhouette target approximately 0.95: all three tiers meet it, as reported above.
- WARN individual views still fall below 0.95: LOD0 front 0.9499 and LOD2 top 0.9377. Weighted overlap does not establish complete shaded likeness.
- WARN grille/front-bumper layered recess depth, lens/reflector detail and mirror shaping remain visibly coarser than the canonical reference. Glass uses opaque painted reflections and seat silhouettes.
- WARN full production qualification is not claimed: these captures pose damage rather than proving dynamic debris or host simulation, and do not establish device readability, GPU performance or owner acceptance. Parent integration owns the combined suite and live host/design-site checks.
