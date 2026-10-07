# P1-G01 JN2 visual self-review

Journey: `web/tests/journeys/jn2-lap.test.mjs` (passed, 166 s) on the Mac, SwiftShader (software WebGL), Playwright
Chromium, TV 1280x720, one synthetic controller (Davo, seat #1), room `?room&test=live&laps=2`, clock held and stepped
after the Countdown. Captures in `docs/evidence/P1-G01/jn2/`.

## Looked at

- `tv-lap1-start.png`: the car on the grid at the chequered finish line between the two banner pillars; HUD "#1 Davo",
  "1st  Lap 1/2", boost bar. No gate or checkpoint graphic apart from the line itself.
- `tv-shortcut.png`: the seat car after the shortcut car drove 900 ticks past gates that weren't its next (the shortcut
  car is off camera: tiles follow seats only). HUD still "Lap 1/2"; guard rails and chevron posts, no checkpoint marker.
- `tv-lap1-midway.png`: gate 8 of the lap in the red-rock canyon with a start ramp; "Lap 1/2"; nothing hoop- or
  flag-shaped across the road.
- `tv-lap2-hud.png`: just after the lap closed: HUD reads "Lap 2/2"; the car is on the straight past the line.

## Defects seen (not fixed: outside this bead's files)

- The "Join at 127.0.0.1:...:RABY" chip floats over the sky at mid-right of the tile in the race (also in the force-start
  capture); it reads as clutter during play.
- The "Keys & pads" pill and the frame-budget chip overlap along the bottom edge (chip text is clipped under the pill).
- The shortcut car isn't visible in any tile, so the capture can't show it; the assertions carry that proof (it moved
  more than 40 m, `gatesPassed` 0, `progressM` 0).

## Asserted rather than seen (R106)

No map draw matches check|gate|marker|flag|hoop|ring; `wayfinding/finish-gantry` is present; the TV's text and HTML
contain no "checkpoint".
