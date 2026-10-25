# Roster corrective visual pass — 25 October 2026

## Looked at

Delegation: NavyCat handled Cruz and shared integration/skills. The vehicle lead delegated AU/Lion and Tradie to disjoint helpers and handled both bikes. Parent reviewed actual shaded evidence, requested fixes to tank clipping, engine/rider masses, knee continuity and coarse wheel/helmet allocation, and reviewed the resulting captures again. Hawk Dash was the unchanged benchmark.

Images reviewed: `au-hawk/visual-comparison.png`, `au-hawk/lod-reference-review.png`, `au-hawk/loader-review.png`, `lion-president/visual-comparison.png`, `lion-president/lod-reference-review.png`, `lion-president/loader-review.png`, `tradie-ute/reference-previous-current.png`, `tradie-ute/underside-comparison.png`, `tradie-ute/regional-comparison.png`, `tradie-ute/comparison-contact.png`, `tradie-ute/final-contact.png`, `postie-bike/visual-comparison.png`, `postie-bike/regional-comparison.png`, `postie-bike/comparison-contact.png`, `postie-bike/final-contact.png`, `postie-bike/switch-size/switch-review.png`, `pig-catcher/visual-comparison.png`, `pig-catcher/regional-comparison.png`, `pig-catcher/comparison-contact.png`, `pig-catcher/final-contact.png`, `pig-catcher/switch-size/switch-review.png`. Cruz's separate receipt lists its source and loader views.

Local review pages use the actual baked GLBs. Phone412×915 and TV1920×1080, before/after fullscreen-style resize, were captured with `art/ui/lib/live-check.mjs`; top-page contacts are `live-local/contact-412x915.png` and `live-local/contact-1920x1080.png`. The individual full-page images remain alongside them. Captures are this repository Mac, Playwright Chromium151.0.7922.34/software rendering, samples1/4/24 in the model viewer. They are not physical phones or a new GPU benchmark.

## Defects found and fixed

The curved bottom face was an actual arch-to-floor fan, not a mask artifact. Cruz/AU/Lion/Tradie now separate level floors and inner wheel wells from arch lips. Dark wells and closed wheel backs fix the follow-on underside gaps. Door waist/shoulder returns, connected coarse sills, Cruz bar bends/mounts and splitter depth, AU moulding/spoiler, Lion side graphics, and Tradie photographed lamp ordering were inspected in shaded views. Bikes now have conforming tank/plastics, smaller shaped engine masses, joined neck/knees, visible raised spots, and lean open spokes. At100px, the coarse tyre silhouette and Postie dome still looked too angular;12-station outer tyres and an8-around/4-ring dome were funded by hidden/duplicated detail savings, without increasing budgets.

The review site now shows shaded previous/reference/current boards directly. The modelling skills require these comparisons and per-defect decisions as well as outline scores. A verifier incorrectly classified text crossing the viewport bottom on a naturally scrolling page as clipped. Its correction retains horizontal, fixed-page and fixed-ancestor clipping checks; four browser fixtures prove that distinction (`scroll-verifier.txt`).

## Remaining defects

Global artistic qualification is not claimed. Lion weighted silhouette0.9461/0.9400/0.9443 and both bikes' roughly0.85→0.79 tier scores remain below the skill's approximately0.95 target. Their reports retain FAIL for that target, although the named corrective forms, unchanged physics, budgets and reproducible bakes pass. The parent did not change reference masks, score tolerances or budgets. Generated sheets are uncalibrated, and fascia recess/lamp/mirror details, helmets, castings and parcels still have visible simplifications. These are awaiting-review models, not owner likeness acceptance.

## Not covered

New driving/handling, physical-device rendering, real-host N×N performance, dynamic debris lifetime and full roster production qualification. All24 vehicle/profile/sidecar/collider files and all39 Hawk Dash files are unchanged against the recorded base, including LFS content hashes. Existing172 vehicle tests, all six native contracts and per-vehicle reproducibility pass; physics was preserved rather than retuned. Model-viewer damage poses do not prove simulation lifetime. The voice/trailer sessions resume from this reviewed corrective pass and must rebuild/capture the actual host using these assets, including all seven vehicles and a feature-to-shot record.
