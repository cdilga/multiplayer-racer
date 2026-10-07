# Self-review P1-M05 (Rocks / Olgas), second pass

Captured with `JJ_HEADLESS=1 node web/host/tests/biome-capture.mjs rocks` (headless Chromium, software GL; `res=1&autores=off`;
HUD, join pill and chips hidden for the shot only; seed 2; autopilot cars stepped to a named point). Reference:
`art/references/australia/generated/biome-rocks.png`.

## Looked at
- `domes-tv-1080p.jpg` (1920x1080, point 162): graded-dirt road bending between tall banded red rock domes; the nearest dome on
  the left fills a third of the frame. The domes are now round at the top (twelve stacked bands following a hemisphere's
  profile, cycling reds); the far domes still have a slightly pointed crown. Rail and posts on the left, spinifex, small green
  bushes with pink flowers, a dark shadow patch.
- `domes-tiles-1080p.jpg` (four tiles): three cars bunched and stacked on each other (they start together), the domes
  behind them; the fourth tile has a lone car with the road ahead.
- `domes-laptop-1366.jpg`: same scene at 1366x768; nothing clipped (not re-viewed individually; same frames as the tiles).
- `jump-tv-1080p.jpg` (the reviewer's "debug pad" question): the car approaches a ramp. Two stone walls (red-brown, 0.55 m
  high, side faces darker) stand either side of the road and three white lines are painted across the ramp, all following the
  ground. It no longer looks like a yellow/black pad; it reads as a marked ramp between stone walls. The ramp itself is only a
  shallow rise, and the steep-descent warning sign is not in this frame (it is in `../P1-M08b/lap-1-town-tv-1080p.jpg`, which
  shows the same kind of ramp ahead with the yellow descent sign and a brown "BIG RED ROCK" sign).
- `plot-rocks.png`, `validator-rocks.txt`: regenerated, ten seeds validate (23 jumps, 17 crests across them).

## Fixed this round
- Marker pads replaced by ground-following painted lines and stone ramp walls (renderer, `map.ts` `features()`); creek dips are
  a brown wash. Domes are rounder.

## Remaining defects
- The ramp's rise is the core's heightfield; the stone walls are a dressing, there's no rock-ramp mesh.
- Far domes still end in a faint point; no domes on the skyline beyond the near cluster.
- Cars bunch and stack on the autopilot run.
- Headless software-GL capture, not a GPU capture.

## Not covered
- Phones, WebKit, full-screen toggle, a fresh-eyes review of this pass.
