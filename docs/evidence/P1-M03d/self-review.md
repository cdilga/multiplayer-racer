# Self-review P1-M03d

## Looked at
- `profile-greybox-seed2.png`: centerline height along a Greybox lap (seed 2) with each placed feature's envelope shaded
  (jump orange, crest blue, creek dip teal; the lap has no whoops). Vertical scale is exaggerated about 100x, so a 0.4 m
  ramp reads as a tall column of dots. Checked: features sit on straight, plain stretches, none overlaps another, the
  creek dip is a hollow, the crest a hump, each jump is a ramp rise followed by the drop and a flat landing.
- `jump-scenarios.txt`: the real-sim jump table (below).
- `chromium-air-1920x1080.jpg` (2026-10-17, from `web/tests/journeys/generated-jump.test.mjs`, P1-PT-launch): the boosted
  Cruz over a generated jump in a rocks canyon from the TV chase camera. The journey asserts all four tyres are clear of
  the ground at that tick; from the chase camera the gap itself is hard to read.
- `chromium-side-air-1366x768.jpg`: the same flight from the side, nose up off the ramp; the tyres' gap against the
  terrain behind is still subtle in the frame (the assertion is the evidence, the picture shows the attitude).

## Defects found and fixed
- First envelope check measured the landing over the wrong index range (it included the end of the whole piece plus the
  lip's drop) and flagged a 9 % "landing grade"; the landing is now measured from 6 m past the ramp's end.
- Crests drawn with a random height could exceed the vertical-curvature limit on short lengths; the height is now capped
  by `0.0004 * L^2`.

## Remaining defects
- The ramps are 4 m wide, a coarse 1.6 cells on a 2.5 m grid, so their sides are tapered, not crisp (grid limit; the
  same follow-up as the road ribbon).
- A car in the air reads poorly from the chase camera (no ground shadow or gap cue); big-air cameras are br-l4v5.

## Not covered
- The owner has flown the generated jumps on the preview (playtest 2026-10-17); the in-flight control they asked for is
  br-bbki.24. The native jump bank (`crates/jj-procgen/tests/jumps.rs`, ten seeds of every placing biome at 15, 22, 26
  and 30 m/s and boosted) is the acceptance; the captures are one generated jump.
- No phone/TV/full-screen/resize matrix: nothing in this bead has a UI.
