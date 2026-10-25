Vehicle Model Validation: FAIL on the global approximately 0.95 weighted likeness target; named corrective geometry checks, budgets and reproducible bakes PASS.

# Lion President: shaded roster pass

P1-V-roster-visual, br-8h3u.17, 2026-10-25. Awaiting artistic review. Evidence was captured on the repository Mac with headless Playwright Chromium 151.0.7922.34. Posed renderer states are not a simulation, device or hardware-performance qualification.

The undertray no longer fans up to the wheel arches. A lower-door return, separate shoulder rollover and inset bay liner restore panel volume; lamp and bumper-corner graphics clip to the real side facets. Coarse tiers retain a straight connected lower sill. Hawk-style atlas wheels have sealed inner sidewalls, and glass detail adds no geometry or material. Exported triangles are 2321 / 892 / 564 within unchanged 2400 / 900 / 600 budgets. Named corrective checks pass, while weighted silhouette scores 0.9461 / 0.9400 / 0.9443 remain below the approximately 0.95 target. Physical contracts, pivots, colliders, anchors and handling are unchanged. Fascia recess depth and lamp/mirror detail remain coarser than the reference; this is an awaiting-review candidate with the global likeness target unmet.

| LOD | Exported render triangles | Unchanged budget | Weighted silhouette IoU |
|---|---:|---:|---:|
| 0 | 2321 | 2400 | 0.9461 |
| 1 | 892 | 900 | 0.9400 |
| 2 | 564 | 600 | 0.9443 |

Budget counts exclude interior/debug/collider geometry exactly as the baker does. `triangle-receipt.json` records every part before and after. `physical-contract.json` proves vehicle.json, colliders.json and the asset sidecar unchanged byte for byte; frozen pivots are asserted at all LODs. Canonical references and all prior likeness tolerances are unchanged.

`visual-comparison.png` contains the reference hero plus shaded previous/current body, front and low underside views, with the same world camera and display scale for previous/current. `lod-reference-review.png` contains all three reference/shading/diff sheets and rear heroes. `loader-review.png` contains the actual GLTF loader ladder, paint/view/collider sheets, intact/loose/detached poses, paint strip and 1/4/24-car samples. All were visually inspected. Those cohort sizes are samples, not limits. `self-review.md` records the shaded findings and limitations.

- PASS named underside correction: undertray remains independent of the raised arch cut; actual rejected source fails the transverse-floor check.
- PASS named body correction: lower-door return, inset bay liner, facet-clipped lamp/bumper graphics and straight connected coarse-tier sill.
- PASS open/expensive wheel regression corrected: sealed wheel backs and atlas faces use 44 exported triangles per LOD0 wheel; actual old source fails closure/cost checks.
- PASS focused panel suite: 26/26 cases across both sedans; log ../au-hawk/panel-tests.log. Existing sedan likeness suite: 6/6 cases; log ../au-hawk/likeness-tests.log.
- PASS bake reproducibility and original per-tier budgets; final-validation.log records successful bake --check and final capture commands.
- PASS frozen colliders, pivots, handling, anchors, masses, hinge transforms and budget contracts unchanged.
- PASS inspected actual loader paint, damage-pose and grid evidence; glass/lamps/trim retain fixed colours through player paints.
- FAIL global approximately 0.95 weighted silhouette target: all three tiers remain below it. LOD0 top 0.9245, LOD1 side/top 0.9317/0.9360 and LOD2 side/front 0.9336/0.9466 remain weak regions. Named corrective passes do not override this failure.
- WARN grille/front-bumper layered recess depth, lens/reflector detail and mirror shaping remain visibly coarser than the canonical reference. Glass uses opaque painted reflections and seat silhouettes.
- WARN full production qualification is not claimed: these captures pose damage rather than proving dynamic debris or host simulation, and do not establish device readability, GPU performance or owner acceptance. Parent integration owns the combined suite and live host/design-site checks.
