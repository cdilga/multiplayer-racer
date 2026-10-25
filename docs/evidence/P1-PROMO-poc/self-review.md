# Persistent POC picture draft

P1-PROMO-poc / br-r1ma.2. Owner explicitly requested preservation and POC publication of the previously linked MP4. This publishes that exact picture draft, with narration pending, separately from the final voiced trailer.

## Looked at

Local POC index in Playwright Chromium151.0.7922.34 and WebKit26.5 on the repository Mac, viewport412×915 and1920×1080. These are browser emulations, not physical-device tests.

Inspected `local/layout-contact.jpg`, containing `local/poc_g_promo_412x915.png`, `local/poc_g_promo_412x915_after-resize.png`, `local/poc_g_promo_1920x1080.png` and `local/poc_g_promo_1920x1080_after-resize.png`. The new section follows the existing POC typography, colours, borders, metadata and navigation.

Inspected `local/playback-contact.jpg`: `local/Chromium-412-poster.png`, `local/Chromium-1920-poster.png`, `local/WebKit-412-poster.png`, `local/WebKit-1920-poster.png`, plus `local/Chromium-412-seek.png`, `local/Chromium-1920-seek.png`, `local/WebKit-412-seek.png` and `local/WebKit-1920-seek.png`. Video is visible and framed correctly, the pending-narration explanation and download are readable, and seeking reaches the actual45s derby frame. Native WebKit control overlays are expected browser UI.

Repeated the same layout/resize and four browser playback cases on the public POC after deploy9571 succeeded for d7256441779c36a912828716bb503c5ef79af0d7. Inspected `deployed/layout-contact.jpg` and `deployed/playback-contact.jpg`, containing the same twelve screenshot names under `deployed/`. Public player and download are visible and legible; seeking displays the correct frame. `live-deployed.txt` and `deployed/playback.json` pass. An actual click of Download yielded the complete26,456,576-byte MP4 with the original SHA256; HTTP200/video/mp4 and byte-range support are recorded in `deployed/download.json`.

Watch: https://jammers-preview.dilger.dev/poc/#g-promo

MP4: https://jammers-preview.dilger.dev/poc/promo/bring-everyone-picture-f2d4e0c3.mp4

## Defects found and fixed

The only prior copy was under `/tmp`. Exact SHA256 f2d4e0c3cd07704ce35992ef612395cefc588e7ea041a889d8f35decc9fde7fc is now preserved as `art/ui/poc/promo/bring-everyone-picture-f2d4e0c3.mp4`, with poster and provenance. Both binary assets use the existing Git LFS rules, and the POC deployment already fetches/publishes this tree.

Added a Trailer draft section and jump link, manual native controls, inline phone playback, poster, `preload="none"`, explanatory label and direct MP4 download. No video request before interaction in any of the four browser cases. The local POC server previously lacked MP4 MIME and byte-range support: playback started but seeking stalled. It now serves video/mp4, complete HEAD metadata, valid inclusive/open-ended/suffix206 ranges and416 for unsatisfiable/unsupported ranges. Real playback and seek pass in all four cases (`local/playback.json`, `playback-local.txt`, `local/ranges.json`). Phone/TV before-and-after-resize layout checks pass (`live-local.txt`).

## Remaining defects

This is the59.8s picture draft: music and editorial vehicle effects are present, Australian Maya1 narration is pending. It is not the final voiced trailer. No remaining persistence, POC layout, playback or download defect was found in the exercised cases.

## Not covered

Physical iPhone/Safari qualification, final voice QA, final mix/caption timing or new gameplay/performance validation. The MP4 bytes are unchanged from the reviewed staged-gameplay draft; its capture/vehicle provenance remains under `docs/evidence/P1-V-roster-visual/promo-handoff/`.
