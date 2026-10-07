# P1-G05 visual self-review

Run: JN4 on eris at 945743e (Chromium 151, headless, linux/x64, `JJ_CHROMIUM_GPU=1`), journey passed. Captures in
`captures/`, numbers in `browser-run.json`, the clip in `crashes.jjclip` (native replay hash equals the browser's:
`adf99d93...`, tick 1582).

## Looked at

- `stage-1-side-swipe.png`, `stage-2-t-bone.png`, `stage-3-head-on.png`, `drove-away.png`: the four-tile host view at 1280x720
  right after each stage and after the drive-away. Every tile draws its own chase camera on its own car. Stage 1: the blue
  and red cars door to door in the top tiles. Stage 2: the orange car is square on the blue car's side in the top right
  tile. Stage 3: the cars are apart again and the tiles show the road, the idle cars and the buildings. Drive-away: all four
  cars moving, none stuck; the top right car has run up to a building and the camera sits close behind it.

## Defects found and fixed

- None fixed in this pass; the journey passed first time. (Its numbers: side swipe `door_FL`/`door_RR` loose, T-bone
  `door_RR` detached and car 2's `front` loose, head-on car 2's `front` detached and car 3's loose; every tile of the
  involved cars sees a piece of debris; nobody stuck, moved 80, 33, 8 and 43 m; no pause reason at any step; the debris
  moved 23 m when a car drove into it and none was removed.)

## Second pass (commit 11479814)

- Stage 1 and 2 captures retaken with `&camdist=near` and a wait for the tile grid to settle. **Grid defect fixed**: all four tiles are
  now the same size in `stage-1-side-swipe.png` and `stage-2-t-bone.png`.
- **Camera defect not fixed**: the near setting frames the cars as before (a few metres behind, roof and tail), so a loose
  door or a missing bumper still isn't legible in the stills. It is the host's default distance setting, which the tile
  chase cameras don't seem to take in this page; a real fix is an orbit or side-on shot of the involved car
  (`?tiles=<n>&orbit=…` as P1-S04b's captures use) a moment after the hit.
- That run failed an assertion (not the captures): "head-on: car 2's detached front is drawn 0.99 m from its core", the
  renderer a frame short of drawing the part off the car. The journey now polls up to 10 s for the renderer to catch up
  before asserting (`jn4-crashes.test.mjs`); needs a commit and one more eris run. Stage 3 and drove-away captures are from the
  first (passing) run.

## Remaining defects

- The damage itself isn't legible in the stills (above). The numbers in `browser-run.json` prove it; the pictures don't.
- Host overlays (the Keys & pads panel, the join QR and pill, the welcome banner) cover parts of tiles. They belong to the
  host UI beads (P1-R04/R07), not to G05.

## Not covered

- Phones: JN4 drives synthetic controllers through the test surface, so no phone page is in these captures.
- Resize and full screen: not exercised; only 1280x720.
- The first-person camera mode.
