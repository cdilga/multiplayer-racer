# Self-review P1-M06 (Outback dirt), second pass

Captured with `JJ_HEADLESS=1 node web/host/tests/biome-capture.mjs dirt` (headless Chromium, software GL, `res=1&autores=off`,
HUD hidden, seed 2, autopilot cars at point 159 of the dirt) and `web/host/tests/readability.test.mjs` (also
`res=1&autores=off`, so the fresh-eyes finding that the "1080p" capture had been auto-lowered to 960x540 is fixed:
`readability.json` records a 1920x1080 viewport for the large shot and 640x360 for the small tile).
Reference: `art/references/australia/generated/biome-outback-dirt-and-bitumen.png`.

## Looked at
- `track-tv-1080p.jpg` (1920x1080): light graded-dirt road with cream edge lines bending across red earth; spinifex tussocks
  and desert oaks to the horizon; rail and yellow-banded posts on the left. No yellow/black pad in this frame.
- `track-tiles-1080p.jpg`: four cars, bunched in the left tiles and strung out in the right ones; the road reads clearly against
  the ground in every tile; no marker pads.
- `track-laptop-1366.jpg`: same at 1366x768 (checked in the contact set; nothing clipped).
- `readability-1080p.png`, `readability-small-tile.png`, `readability.json`: CIE76 delta-E road vs ground = 40.9 at 1080p and in
  the 640x360 tile (threshold in the test is lower and passes; 1 of 1 test). These two measurement shots still show the
  join pill, "Keys & pads" button and render chip (they are test screenshots, not evidence frames); the render chip reads
  "1920x1080 native", confirming no auto-lowering.
- `plot-dirt.png`, `validator-and-autopilot-dirt.txt`: regenerated.

## Fixed this round
- 1080p readability is measured at true 1080p.
- Feature markers on dirt are now painted lines and ramp walls (see M05) instead of coloured pads.
- HUD and banner hidden in the capture frames.

## Remaining defects
- The readability shots keep their HUD chrome.
- The yellow/black pads are gone from the renderer, but a creek-dip wash can still look like a flat brown patch (see M07 tiles).
- Cars bunch on the autopilot run; headless software GL.

## Not covered
- Phones, WebKit, real GPU, a fresh-eyes review of this pass.
