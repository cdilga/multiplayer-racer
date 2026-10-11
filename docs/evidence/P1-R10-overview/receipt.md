# P1-R10-overview · br-a92v

2026-10-12, CyanBridge. Reproduced with the actual generated v15 seed0 Town course and zero-car host fixture:
road/terrain vanished beyond the fixed620m fog, while ink posts remained. Original defect images are committed
in P1-M-presets/local-frames/fog-defect-*.jpg. No counts or geometry were hidden to repair this.

The overview supplies the farthest framed ground depth (camera distance + far edge projection + lowest height
projection). The existing look places haze beyond that depth, keeping its accepted460m transition width.
Each chase, first-person, mirror and replay render supplies no overview override, restoring160–620m.
The look and material colours are unchanged.

`course-overview.test.mjs` uses the real server, current native generator and WASM worker with a set/step fixture.
The capture run passed Chromium (native GPU launch mode)149.05s and WebKit20.85s (see capture-journey.txt), producing42 images: three Town
families; twisty at412x915,915x412,375x667,1366x768,1920x1080; each before/fullscreen/resize. Every image was
visually inspected as recorded in self-review.md. A final focused rerun checks actual scene haze through
explicit overview → car-following grid → overview on the same scene.

TypeScript and live-check pass (five viewports plus full-screen/resize, ten images). The final same-scene
switch journey passes2/2: Chromium135.13s, WebKit16.85s (`switch-journey.txt`). This focused rerun adds the
same-scene transition check; it does not replace the42 visually inspected capture images.
Containing CI and deployed recapture are pending.
