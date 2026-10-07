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

## Remaining defects

- The captures are taken the moment the stage ends, so the damage itself is hard to see: after a stage the chase
  cameras show the cars from behind at a few metres, and a loose door or a missing bumper isn't legible in any of the four
  stills. The numbers prove it; the pictures don't show it. A follow-up capture of the involved car's tile a second after the
  hit (or the orbit camera, as P1-S04b's captures use) would.
- Stage 1's top row is mid-layout (the two top tiles differ in height by a few pixels): the grid was still animating after
  the joins. A short wait before the first capture would fix it.
- Host overlays (the Keys & pads panel, the join QR and pill, the welcome banner) cover parts of tiles. They belong to the
  host UI beads (P1-R04/R07), not to G05.

## Not covered

- Phones: JN4 drives synthetic controllers through the test surface, so no phone page is in these captures.
- Resize and full screen: not exercised; only 1280x720.
- The first-person camera mode.
