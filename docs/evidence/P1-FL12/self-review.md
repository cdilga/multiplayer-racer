# Self-review P1-FL12

Captured by `web/tests/journeys/fl12-climb.test.mjs` with `JJ_CAPTURE_DIR` set, in local Playwright Chromium (WebGL2) at
TV size, 1920x1080, on the Mac on 2026-10-17. The host worker was rebuilt with `scripts/build-host-wasm.sh`. Each run is
the committed fixture (`scenarios/lab/off-road-*.json`) loaded into the real worker and renderer on
`maps/lab/off-road-climb.json`. The journey asserts the same height envelope as the native run, in Chromium and WebKit.

## Looked at

| File | View, state | What I checked |
|---|---|---|
| `chromium-off-road-climb-mid-chase-1920x1080.jpg` | chase, 3 s in | The Ute is drawn as the Ute (tray, canopy, roof rack), square off the road, on the bank's face and climbing; wheels on the ground. |
| `chromium-off-road-climb-end-chase-1920x1080.jpg` | chase, 10 s | The Ute is over the bank's lip, on the plateau 7.7 m above the road, upright. |
| `chromium-off-road-climb-end-overview-1920x1080.jpg` | overview, 10 s | The whole oval is framed. The car and its "#0 Player 0" plate sit on the bank above the road's inner edge, off the road where the climb ends. |
| `chromium-off-road-climb-cruz-end-chase-1920x1080.jpg` | chase, 10 s | The Cruz on the same bank, stalled low on the face (2.8 m above the road), upright, still pointing up it. |
| `chromium-off-road-wall-end-chase-1920x1080.jpg` | chase, 8 s | The rock face (darker rock surface) fills the view ahead. The Ute stops at its foot, nose up against it, rear wheels down, no wreck. |
| `chromium-off-road-wall-end-overview-1920x1080.jpg` | overview, 8 s | The Ute is at the foot of the face on the inner bend's bank. |

I also looked at the Cruz's overview and the wall's 3 s chase. Their content matches the frames above, so they aren't
committed.

## Defects found and fixed

1. **The TV drew a Cruz for the Ute run.**
   - **Cause:** the fixture's profile was passed to the host as a lone "simulation-fixture" vehicle (roster index 0), and
     the renderer draws index 0 as the Cruz.
   - **Fix:** the host's test load keeps the roster when a fixture names a `vehicle`, and spawns the fixture's cars as
     that roster index (`Harness::new_as`).
   - **Check:** the journey now asserts the TV draws the run's vehicle.
2. **The first mid-climb frame showed only the car's shadow and headlight glints.**
   - **Cause:** the Ute's model was still loading; the test steps faster than a player joins.
   - **Fix:** the journey waits for the run's vehicle model to load before it drives, and takes the mid frame at 3 s,
     with the car on the face.

## Remaining defects

- None in what this scene shows.
- The host's keyboard-players panel covers the top-left of every TV frame. It's the default host UI, and the same in
  every lab capture.

## Not covered

- **No preview or room.** The scene isn't loaded from the Feel Lab in a running room, or through the preview URL. The
  in-room scene picker is P1-FL03.1 (br-bbki.19, open). These frames are the scene in the real worker and renderer
  through the test surface.
- **One engine captured.** Only Chromium is captured; the WebKit run asserts the outcomes without captures. WebKit is
  Playwright WebKit, not Safari.
- **Software rendering.** All frames are software WebGL on the Mac, not the owner's TV or GPU.
