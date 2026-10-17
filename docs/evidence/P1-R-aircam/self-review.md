# br-l4v5 (P1-R-aircam): the race camera keeps the car in frame through big air and loops

R125 asked for an air camera: past 0.25 s in the air, the chase stops pitching with the car, pulls back and rises, and
eases back after landing. In a loop the horizon turns with the road. The rig already does most of it its own way
(`web/host/src/camera/rig.ts`):
- In the air the chase never pitches or rolls with the car. It holds its height (`rig.airHold`, br-gw74.13.1.1), so the
  car climbs in frame and the road falls away.
- On a loop it cuts to a side-on loop shot that frames the whole loop and pans with the car, and cuts back to the chase
  at the exit. That replaces "the horizon turns with the loop": a chase behind the car would end up under the deck.
- A respawn cuts.

This bead adds the per-frame check the acceptance asks for. `web/tests/journeys/lib/in-frame.mjs` `inFrameRide` steps a
fixture and, at each check, paints a frame and asks every tile's camera whether the car (its body and a point 1.2 m over
it) is inside the frustum. `generated-jump` (a generated road-wide jump: run-up, flight, landing) and `generated-loop`
(a generated loop: run-in, over the top, out) ride their fixtures at 1, 4 and 9 tiles (every tile following the car,
1366x768).

Result on eris at 4b5f9c7f, Chromium, GPU (ANGLE Vulkan; they run on the gpu runner in CI):
- **Jump:** 42 checks at each tile count (12 a second over 3.5 s), 0 lost.
- **Loop:** 70 checks at each tile count (20 a second), 0 lost.
- On SwiftShader at 61d15753 the same rides lost nothing either (70 checks each); they were only too slow for a CPU slot.

## Looked at

- `top-chase-1366x768.jpg`: the loop shot at the top. The car is upside down at the crown, the whole loop is in frame,
  and the horizon is level.
- `chromium-air-1366x768.jpg`: the chase mid-air over the jump. The car is above the road at the frame's centre, the
  road falls away, and the camera holds level.

## Defects found and fixed

- None in the cameras. The checks themselves were too slow for SwiftShader slots (up to 20 software frames per check);
  they now paint at most 3 frames a check and run on the gpu runner.

## Remaining defects

- In the loop shot, a tall dead tree in the foreground crosses the left of the frame. It covers neither the car nor the
  loop.
- R125's literal numbers (pull back 20 %, rise 1.5 m, 0.4 s ease back) aren't the rig's: it holds height instead, which
  the owner's br-gw74.13.1.1 pass chose. The numbers in assets/profiles/camera.json are tunable in ?tune.

## Not covered

- A real GPU TV at 4K; WebKit's in-frame ride (the check is Chromium only).
