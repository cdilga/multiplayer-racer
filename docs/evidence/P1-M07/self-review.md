# Self-review P1-M07 (Outback bitumen), second pass

Captured with `JJ_HEADLESS=1 node web/host/tests/biome-capture.mjs bitumen` (headless Chromium, software GL, `res=1&autores=off`,
HUD hidden, seed 2, autopilot cars at point 159-162 of the bitumen). Reference:
`art/references/australia/generated/biome-outback-dirt-and-bitumen.png`.

## Looked at
- `highway-tv-1080p.jpg` (1920x1080): sealed dark road with a single cream edge line each side and yellow centre dashes,
  rail and posts on the left, red earth with sparse spinifex, two tan buildings at the horizon. The doubled edge line the
  fresh-eyes review found is gone: the white line is the road ribbon's own, and the separate `edge-line` kit piece and its
  rule were deleted (so no second line lies beside it).
- `highway-tiles-1080p.jpg` (four tiles): long straight with centre dashes; in the right and lower tiles a flat brown band
  crosses the tarmac with broken white marks either side (a creek-dip wash). It reads as a floodway, but it is a flat
  rectangle of paint; I'd call it acceptable but crude. A yellow warning sign stands at the far right.
- `highway-laptop-1366.jpg`: same at laptop size (checked in the contact set, nothing clipped).
- `plot-bitumen.png`, `validator-bitumen.txt`: regenerated; the counts now cover centre dashes and posts only.

## Fixed this round
- Double edge line removed (piece, rule, data, kit render module, and the registry entry).
- Captures at true 1080p, HUD hidden.

## Remaining defects
- Creek-dip wash is a flat brown patch.
- No cracks or flared rail ends; sparse scenery on a long straight (by design for this biome, but plain).
- Cars bunch on the autopilot run; headless software GL.

## Not covered
- Phones, WebKit, real GPU, a fresh-eyes review of this pass.
