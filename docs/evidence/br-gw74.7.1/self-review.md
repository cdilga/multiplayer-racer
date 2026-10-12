# Self-review br-gw74.7.1

## Looked at

All 32 Chromium/WebKit images in [the shared generated-jump review](../P1-PT-launch/self-review.md): phone portrait/landscape, small phone, laptop, TV, fullscreen, resize and clear side photos. Original chase images individually opened; final equivalent recaptures inspected in labelled contact sheets and both side photos individually opened. Representative [TV mid-air capture](../P1-PT-launch/chromium-air-1920x1080.jpg). MacBookPro18,3 / M1 Pro, local Rust server, one frame-stepped boosted Cruz, no connected phone; generator 13, source 0c2ac3d4 plus this patch.

## Defects found and fixed

Physical landing ended before the flight; receiving table, smooth foot transition and terrain-following subdivision now cover it. Stale renderer geometry now matches the actual collision triangle positions. Mid-distance/full-resolution captures keep the complete car in frame; real captions finish naturally before capture. Full details and per-image judgments are in the shared review.

## Remaining defects

No jump geometry or fullscreen/resize defect seen in the local matrix. Deployed validation is pending, so the bead remains open. Later big-air/loop cameras are br-l4v5.

## Not covered

Physical phones, Safari, owner playtest and deployed bundle. Screenshots show one generated regression jump; the native bank covers 94 jumps in ten seeds of every placing biome, with 15/22/26/30 m/s approaches and the real boost action.
