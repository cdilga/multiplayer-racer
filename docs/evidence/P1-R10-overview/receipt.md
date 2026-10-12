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

CI run 3596 passed every lane except browser slot 3: this journey's Chromium test
timed out at its unchanged 300 s bound; WebKit passed in 75.20 s. The fixture was
paused but its background render loop continued drawing the entire course, in
addition to each explicit paint drawing three duplicate frames. The journey now
stops the background loop before loading each fixture and draws the requested
viewport when its snapshot is ready. All five viewports, three families, resize,
full-screen captures and same-scene chase/overview checks remain in place.
The software Chromium rerun passes in 49.51 s (`software-fixed.txt`). This is a
test execution repair; the renderer and haze implementation are unchanged.
CI receipt: http://192.168.11.12:3001/cdilga/multiplayer-racer/actions/runs/3596

### Final page-lifetime regression, 2026-10-12

Each generated course now owns a separate browser page. Closing the prior page before opening the next avoids WebKit attributing intentionally aborted old-document audio preload requests to the next course. Error assertions remain active throughout each live page. The renderer stays held and paints a single snapshot-ready frame for each viewport.

`JJ_SERVER_BIN=/tmp/jj-macos-server-w01 JJ_BIN=/tmp/jj-v15-presets-native node --test web/tests/journeys/course-overview.test.mjs`: Chromium (software GL) 36.84 s and Playwright WebKit 15.98 s, 2/2 pass. Full log: `isolated-pages.txt`. Includes all three original course families, five viewport sizes, transposed resize, and chase/overview haze restoration. Deployed recapture remains pending the containing green CI preview.
