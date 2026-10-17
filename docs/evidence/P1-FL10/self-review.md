# Self-review P1-FL10

Captured by `web/tests/journeys/fl10-hairpin.test.mjs` with `JJ_CAPTURE_DIR` set, in local Playwright Chromium (WebGL2)
at TV size, 1920x1080, on the Mac on 2026-10-17, on a host worker rebuilt with `scripts/build-host-wasm.sh`. Each run is
the committed fixture loaded into the real worker and renderer on `maps/lab/hairpin-cut.json`. The journey asserts the
fixture's progress envelope in Chromium and WebKit.

## Looked at

| File | View, state | What I checked |
|---|---|---|
| `chromium-hairpin-cut-take-mid-chase-1920x1080.jpg` | chase, tick 1200, take run | The Cruz is on the cut: a pale packed-dirt track, graded through the infield between earth banks, running back to the tarmac and its rail ahead. The car is sideways to the camera: it is sliding on the dirt (11° of slip in the run). |
| `chromium-hairpin-cut-take-end-chase-1920x1080.jpg` | chase, end, take run | Back on the tarmac after the merge, upright. |
| `chromium-hairpin-cut-take-end-overview-1920x1080.jpg` | overview, end, take run | The whole oval is framed. The cut is a pale strip across the left hairpin's infield, clearly not the dark tarmac, and reads as a shortcut. Fork chevrons stand at its mouths. |
| `chromium-hairpin-cut-road-mid-chase-1920x1080.jpg` | chase, tick 1200, road run | The Cruz goes round the tarmac hairpin, with chevrons and the rail on the outside. |
| `chromium-hairpin-cut-road-end-overview-1920x1080.jpg` | overview, end, road run | The car is still in the hairpin when the take run's car is already past the merge (the take overview). |

I also looked at the road run's end chase. It shows the tarmac only, the same as the frames above, so it isn't committed.

## Defects found and fixed

1. **The first mid frame was taken too early.** At tick 900 both cars were still on the straight before the split. It's
   now at tick 1200, with the take run on the cut.
2. **The journey's progress check read the wrong distance.** It compared the car's absolute distance along the route
   (329.6 m) with the fixture's progress from the start. It now subtracts the start.

## Remaining defects

- None in what this scene shows.
- **Chase framing on the cut.** At the moment of the frame the chase camera trails a sliding car, so the car sits at the
  frame's edge. It's the chase camera's lag, not this bead's.
- The host's keyboard-players panel covers the top-left of every TV frame (the default host UI).

## Not covered

- **No preview or room.** The scene isn't loaded from the Feel Lab in a running room. That's P1-FL03.1 (br-bbki.19).
- **One engine captured.** Only Chromium is captured; WebKit asserts the outcomes only. That's Playwright WebKit, not
  Safari.
- **Software rendering.** The frames are software WebGL on the Mac.
