# Self-review · P1-PT-rooftop

## Looked at

Each image was opened individually. Checked visible roof/wheel alignment, intact car, corrugations, shadows,
canvas coverage and host controls. The keyboard drawer scrolls within its bounded panel on phones.

- `browser/chromium-roof-412x915.jpg`: portrait phone, landed/parked car and gable contact.
- `browser/chromium-roof-915x412.jpg`: landscape phone, roof/car in frame and scrollable drawer.
- `browser/chromium-roof-375x667.jpg`: small phone, visible car/roof and no canvas blanking.
- `browser/chromium-roof-1366x768.jpg`: laptop, chimney/roof/car relationship.
- `browser/chromium-roof-1920x1080.jpg`: TV, complete gable detail and car contact.
- `browser/chromium-fullscreen-roof-1920x1080.jpg`: actual fullscreen, same roof/car geometry.
- `browser/webkit-roof-412x915.jpg`: WebKit portrait, same roof/car alignment.
- `browser/webkit-roof-915x412.jpg`: WebKit landscape, roof/car in frame.
- `browser/webkit-roof-375x667.jpg`: WebKit small phone, car/roof and drawer scroll region.
- `browser/webkit-roof-1366x768.jpg`: WebKit laptop, visible corrugations/chimney/contact.
- `browser/webkit-roof-1920x1080.jpg`: WebKit TV, matching intact car/roof.
- `browser/webkit-fullscreen-roof-1920x1080.jpg`: WebKit fullscreen, no resize-only repair.
- `live-check/roof-412x915.jpg`: portrait, stable roof state before resize and welcome caption.
- `live-check/roof-412x915-after-resize.jpg`: portrait after resize, same roof contact.
- `live-check/roof-915x412.jpg`: landscape, parked car and caption fit.
- `live-check/roof-915x412-after-resize.jpg`: landscape after resize, same scene/control placement.
- `live-check/roof-1920x1080.jpg`: TV, parked car/roof and caption.
- `live-check/roof-1920x1080-after-resize.jpg`: TV after resize, unchanged scene.

Also opened individually all 18 final generated-map captures in `generated/`:
Chromium and WebKit each at 412x915, 915x412, 375x667, 1366x768 and 1920x1080,
plus each fullscreen 1920x1080 capture; `generated/live-check` at 412x915, 915x412
and 1920x1080 before/after resize. Each shows the parked intact car following the
roof's pitch, corrugated roof/ridge/chimney, a clear surrounding lot and no blank canvas.
The drawer has its bounded scroll region on small screens. The generated Town road and
unchanged scenery remain visible beside the lot in wider captures.

## Defects found and fixed

The first scratch live-check adapter captured the road before the fixture snapshot reached the renderer on portrait.
Awaiting actual render tick 960 fixed capture timing; all six final live-check images show the roof state. No production
layout was changed for this. Braking at rest originally reversed off the roof; the fixture now uses `noReverse`.
The generated map takes longer to load, so live-check's initial 800ms wait again captured
spawn before the stepped state. Added optional `--ready <CSS selector>` and set the scratch
adapter's marker only after tick 960 is painted. Repeated the full six-image matrix; every
final image shows the roof before and after resize. Earlier images are excluded from evidence.

## Remaining defects

No visible defect found in the judged authored/generated landings. Native ten-seed fixtures
check every generated lot's reachability/landing and the moved-target defect. Containing green
CI and deployed review remain outstanding; br-gw74.11 stays open.

## Not covered

A connected touchscreen controller, physical phone/Safari and WAN/GPU
performance. One car at browser viewports is the fixture cohort. CI is green on run 5620; the deployed review is below.

## Deployed preview check (2026-10-17, AmberSpring)

`JJ_PREVIEW_URL=https://jammers-preview.dilger.dev/p/v02-dd7f30b2/ node --test web/tests/journeys/rooftop.test.mjs`: 2/2
pass on the deployed preview (generator 26), Playwright Chromium and WebKit on the Mac, native/WASM parity included. Looked
at every frame in `deployed/` (375x667, 412x915, 915x412, 1366x768, 1920x1080, fullscreen): the car sits square on the
corrugated roof, wheels on the sheet, no clipping into the gable; the road and the house read clearly behind it.

