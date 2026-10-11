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

## Defects found and fixed

The first scratch live-check adapter captured the road before the fixture snapshot reached the renderer on portrait.
Awaiting actual render tick 960 fixed capture timing; all six final live-check images show the roof state. No production
layout was changed for this. Braking at rest originally reversed off the roof; the fixture now uses `noReverse`.

## Remaining defects

No visible defect found in this authored landing. Generated town rooftop approaches and comprehensive reachability
coverage remain unfinished under br-gw74.11; they are not represented as completed by these captures.

## Not covered

Deployed preview, generated town stunts, a connected touchscreen controller, physical phone/Safari and WAN/GPU
performance. One car at browser viewports is the fixture cohort. CI and deployed self-review remain required before close.
