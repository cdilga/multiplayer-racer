# Self-review P1-M03d

## Looked at
- `profile-greybox-seed2.png`: centerline height along a Greybox lap (seed 2) with each placed feature's envelope shaded
  (jump orange, crest blue, creek dip teal; the lap has no whoops). Vertical scale is exaggerated about 100x, so a 0.4 m
  ramp reads as a tall column of dots. Checked: features sit on straight, plain stretches, none overlaps another, the
  creek dip is a hollow, the crest a hump, each jump is a ramp rise followed by the drop and a flat landing.
- `jump-scenarios.txt`: the real-sim jump table (below).

## Defects found and fixed
- First envelope check measured the landing over the wrong index range (it included the end of the whole piece plus the
  lip's drop) and flagged a 9 % "landing grade"; the landing is now measured from 6 m past the ramp's end.
- Crests drawn with a random height could exceed the vertical-curvature limit on short lengths; the height is now capped
  by `0.0004 * L^2`.

## Remaining defects
- The ramps are 4 m wide, a coarse 1.6 cells on a 2.5 m grid, so their sides are tapered, not crisp (grid limit; the
  same follow-up as the road ribbon).
- No in-game host render of a jump (see Not covered).

## Not covered
- No capture of the running host (web/ is outside this bead's paths); the scenarios run the real sim (Rapier heightfield,
  the Cruz) headless, so the felt jump in the host render and camera isn't looked at. The profile image is a plot, not
  the game's render.
- No phone/TV/full-screen/resize matrix: nothing in this bead has a UI.
