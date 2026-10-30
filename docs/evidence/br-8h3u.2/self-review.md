# br-8h3u.2: loop camera, no horizon roll, eases in towards the car

Owner, playtest 3 (2026-10-24): "the camera effect [in loops] is disconcerting and takes me out of the experience. Can we
instead make the camera either stay as is, so that we follow the car properly - or sort of zoom in toward the car?"

Before: up on a loop the chase **cut** to a far side-on shot framing the whole loop, and cut back at the exit.

Now (`web/host/src/camera/rig.ts`, data `assets/profiles/camera.json` `loop`):
- No cut and no roll. Up stays world-up throughout. The chase holds the loop's heading (the car's own heading flips over the top).
- It **eases in** (`easeInS` 0.5 s) to a three-quarter view that rides with the car's place round the helix: 40 degrees
  from side-on on the exit's side, 1.5 radii out, 0.45 of the way up. It aims at the car and narrows its FOV, so once eased in
  the car fills the frame as it would from `zoomM` 7 m (the mid chase frames it from 9.5 m). The aim reaches the car in
  the first quarter of the ease and the zoom follows the square of it, so the car never leaves the frame mid-ease.
- After the exit it **eases back out** (`easeOutS` 0.6 s) to the chase. The loop's centre travels with the car off the
  loop, so the ease never drags the camera back towards it.
- Why not a chase behind the car: a sweep of behind/inside placements against the loop mesh lost or hid the car on
  every one. On this helix (run-out 4 radii) the car runs backwards over the top and rides the deck's forward face on the way
  down.

## Checks

- `web/host/tests/loop-camera.test.mjs` (node, no browser): the test loop at 14, 20 and 26 m/s in wide (16:9), square
  and tall (9:16) tiles, 9 cases: the car's body and a point 1.2 m over it are in the frustum every frame, no loop-mesh
  triangle between camera and car, roll 0, no cuts, zoomed in once eased in (<= 8 m), back to the road framing
  90 m after the exit. 9/9 pass.
- `web/tests/journeys/generated-loop.test.mjs`, on eris at 30568ef5, Chromium with GPU (ANGLE Vulkan), 1366x768, a
  generator-placed loop, checked 20 times a second (`in-frame.json`):

  | tiles | checks | lost | max roll | road zoom | loop zoom (ease > 0.9) | ride end |
  |---|---|---|---|---|---|---|
  | 1 | 70 | 0 | 0 deg | 9.48 m | 8.49 m | easing out |
  | 4 | 70 | 0 | 0 deg | 9.48 m | 8.43 m | easing out |
  | 9 | 70 | 0 | 0 deg | 9.48 m | 8.43 m | easing out |

- `web/tests/journeys/loop-ride.test.mjs` on eris at f3e15f25, Chromium and WebKit: the car at the top is in the tile
  frustum at 1920x1080 and 1366x768, and the run matches native.

## Looked at

- `generated-top-chase-1920x1080.jpg`: generated loop near the crown. The car is upside down, large and centred right of
  the panel, the deck arc and sky show the loop, and the horizon is level.
- `test-loop-top-chase-1366x768.jpg`: the test map's loop at the top, same framing. The car is clear of the deck's barriers.
- `webkit-test-loop-exit-1366x768.jpg`: just past the exit, the chase is easing back in behind the car. The loop is behind it and the
  car is upright and readable.

## Defects found and fixed

- The first try (inside the loop, behind the car) put the camera on top of the car on the way down: 28 of 351 frames lost.
  Replaced by the three-quarter view that rides along.
- Mid-ease the aim held neither shot and tall tiles lost the car. The aim now comes onto the car first and the zoom
  tightens last.
- The ease out was pulled back towards the loop's exit. The centre now travels with the car.

## Remaining defects

- In every test capture the host's Keys & Pads panel covers the left third of the frame. That's the test host's keyboard
  panel, not the camera (and not this bead).
- Zoom in the browser ride peaks at about 8.4 m rather than 7 m: a generated loop at 22 m/s is ridden in about 2.5 s, so the
  w-squared zoom is never fully in. Tunable (`easeInS`, `zoomM`) in `?tune`.

## Not covered

- First person is unchanged (it rides the car body, by design).
- No owner couch verdict yet. That's the next playtest's.
- Not judged on the owner's TV or phones (hardware). SwiftShader isn't run (the GPU lane carries the in-frame rides).
