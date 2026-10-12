# P1-M06 · Bounded dirt-readability setup

2026-10-11, CyanBridge. CI3354 browser7 cancelled the two-viewport dirt readability
test after its original 180 s deadline. `/tmp/jj-ci3354-browser7.log`:

```text
the graded dirt road is clearly distinguishable from the red-earth ground
at 1080p and in a small tile: test timed out after 180000ms
```

Stage instrumentation on the unchanged local pixel path shows it booting,
committing the map, then stepping the autopilot through the course to the dirt
midpoint in each viewport. The full original run passes locally in **129.88 s**,
`/tmp/jj-readability-reproduce.log`. This is not a local reproduction of the CI
timeout; it identifies the repeated setup trip's cost. No contrast failure was
reported by the failing CI run.

The pixel test now reads the actual generated dirt segment and route, journals a
`place` at its midpoint with the route's heading/height, steps 120 real suspension
ticks, verifies the car is still on that segment, then resumes ordinary rendering
to settle the chase camera. A whole positioning trip is unnecessary to ask whether
the visible dirt road differs from its ground. Autopilot lap qualification remains
in its scenario/journey banks.

Both original viewports, edge-line sampling, sample-count checks and **Delta E >=
25** remain unchanged. The 180 s test deadline was not increased. The map, vehicle,
physics, camera and road/ground pixels are real; no canvas or color is substituted.

Mac M1 Pro, macOS 27.0.1, Node 26.10.0, Playwright Chromium 151.0.7922.34,
software GL: **1/1 passes, 35.66 s**, `/tmp/jj-readability-placed.log`.
Both 1920×1080 and 640×360 measure **Delta E 40.9**, road `[234,186,129]`,
ground `[172,82,45]`; 68/69 road samples and 24 ground samples.
`readability.json` is the raw receipt. I looked at both captures: the cream-edged
dirt road is clear against red earth in the full frame and small tile.

Green CI containing this repair is required before closing.
