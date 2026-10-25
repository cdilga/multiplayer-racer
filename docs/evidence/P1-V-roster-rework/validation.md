# Roster reference rework — P1-V / br-rgw6

2026-10-25. NobleMoose integrated three smaller helpers and personally reviewed the large comparisons, requested corrections, then checked the baked outputs. Hawk Dash remains untouched. All six other roster assets received actual shape changes; this is an owner review candidate, not a universal likeness or production-hardware PASS.

| Vehicle | Exported LOD0 / 1 / 2 tris | Unchanged budgets |
|---|---:|---:|
| au-hawk | 2308 / 900 / 590 | 3000 / 900 / 600 |
| cruz-missile | 2052 / 891 / 576 | 2800 / 900 / 600 |
| lion-president | 2296 / 900 / 592 | 2400 / 900 / 600 |
| pig-catcher | 2607 / 883 / 600 | 2800 / 900 / 600 |
| postie-bike | 2669 / 894 / 599 | 2900 / 900 / 600 |
| tradie-ute | 1762 / 896 / 600 | 2400 / 900 / 600 |

Cruz gained length around fixed axles, curved front sections, upright lamps, bonnet crown, rolled flanks and projected graphics; wheel repetition was reduced. AU Hawk and Lion President gained measured cabin/glass and shoulder changes, rounded end facets, continuous seams, corrected coarse roof/glass transitions and wheel dish. Tradie gained lower tuck, roof/cab sections, rounded end corners and facet-clipped glass using real owner evidence. Pig gained a more upright rider, shaped MX helmet, rounded engine case and open-frame cues. Postie retains the CB50 reference choice and gains tank, cylinder/header, saddle, helmet and rider shaping. Primary Honda reference governs a single right exhaust despite contradictory generated views.

The shared skill now documents how the earlier weak pass happened: aggregate silhouette scores hid internal proportions and wrong feature planes. The normal suite now measures actual geometry, not only enclosing masks, and proves the real previous sources fail the named Cruz/ute/bike form checks. Sedan side-glass annotations supplement existing local gates. Reference hashes, unchanged tolerances and baseline sources are retained.

Technical verification: 107/107 normal vehicle tests; six byte-reproducible bakes and native contracts; all 18 triangle budgets; complete original sidecar bytes and every original LOD0 collider POSITION buffer identical to ad35536b. Six native settle plus six straight-line fixtures pass and replay deterministically. Six profiles were synchronized to new asset hashes without tuning changes. 13/13 review tests and generated-page contract/build checks pass. Per-car reports give exact checks and part allocation logs.

Actual POC controls: all six cars in Chromium desktop and WebKit touch emulation, all three LODs, two bright paints, loose/detached/intact states; 12 combinations and 96 inspected stage captures. No page errors, bad image loads or horizontal overflow. Browser versions/viewports are in local-interactions/checks.json. Shared rendering/material/batching code is unchanged, so no fresh GPU cost claim is made.

Layout matrix: index and Cruz detail, 375x667, 412x915, 915x412, 1366x768 and 1920x1080 before/after resize via live-check. The tool exits 1 on text partially intersecting the ordinary vertical scroll viewport. Captures show these are scrolling-page boundaries, with no horizontal overflow or broken canvas/image. This warning is disclosed, not reported as a green live-check. Full-page contacts plus readable top crops were inspected.

Limitations: named local features improve while several whole-view scores regress. Cruz LOD2 and both bikes remain below the ~.95 broad likeness target. President top/aggregate and AU coarse glazing also remain weaker. Ute front is an interpretation because real photos are dark rear obliques. The generated sheets are inconsistent and cameras uncalibrated. Do not claim every view is now better. Damage screenshots pose states in the real asset loader; they are not a fresh dynamic-debris qualification. Physical phones/TVs, host-specific number rendering and new GPU performance qualification were not run. Existing engine/audio issues remain outside this visual-only refinement. Publication verification is recorded separately in deployment.json after Actions publishes the candidate.

Publication timing: an early byte/probe check encountered the previous deployed build while Actions9298 was still running. deployment-prepublish.json records25/74 matches; it is not the final verification.

Final public verification: commit56252cf5, Actions9298;141/141 generated per-car payloads and shared viewer files match local SHA256, including every comparison, GLB/atlas, damage/paint/grid image and gate report. All12 deployed Chromium/WebKit vehicle combinations pass all controls and image/error/overflow checks;96 live stage captures inspected in six contacts. live-check captures initially outran asynchronous model/image loading on the WAN; after-resize views show completion. The dedicated ready-layout probe waits for all images and model controls before repeating the viewport matrix, avoiding a false green from premature screenshots.

Ready-state layout result:10 page/viewport combinations and20 before/after resize captures pass all-image readiness and horizontal-overflow assertions. Nonfatal GLB net::ERR_ABORTED browser events are recorded explicitly after the model loaded successfully; cause not established, no page errors or failing HTTP responses. The separate live control probe successfully loads all18 model LODs in both browsers. The generic live-check itself remains a warning/failure and is not claimed green.
