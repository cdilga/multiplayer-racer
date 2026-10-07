# Self-review P1-M06 (Outback dirt)

Captured with `node web/host/tests/biome-capture.mjs dirt` (real host page, `&recipe=outback-dirt`, seed 2; autopilot cars
stepped to the middle of the dirt track, point 158; headed Chrome) and `readability.test.mjs` (headless Chromium, software GL).
Reference: `art/references/australia/generated/biome-outback-dirt-and-bitumen.png`.

## Looked at
- `track-tv-1080p.jpg` (1920x1080): a light graded-dirt road with cream edge lines curving across red earth; spinifex tussocks
  scattered both sides, desert oaks (thin dark trunks, flat grey-green crowns) from near to the horizon, a yellow diamond warning
  sign on the right, rail and posts on the far bend.
- `track-tiles-1080p.jpg` (four tiles): the same track from four cars; yellow and black feature markers on the road in the lower
  tiles; the warning sign small in the distance.
- `track-laptop-1366.jpg` (1366x768, four tiles): the same at laptop size.
- `readability-1080p.png` (1920x1080, one player) and `readability-small-tile.png` (640x360): the dirt road just before the
  dirt-to-bitumen change (dark tarmac visible ahead), edge lines, rail and posts on the left, spinifex, oaks, a shed far right.
  `readability.json`: road median colour (234,186,129) against ground (172,82,45): CIE76 distance 40.9 at 1080p and 40.4 in the
  small tile (68 and 35 road samples), measured on the screenshot pixels between the cream edge lines and just outside them.
- `plot-outback-dirt.png`: top-down: an even field of small dots (spinifex), larger ones (oaks), a clear verge along the road.
- `validator-and-autopilot-dirt.txt`: ten seeds validate; the autopilot laps three seeds unaided (no recovery, no wreck).
- Against the reference: red earth, a dirt track through low tussocks and sparse trees, an unsealed-road style warning. The
  reference's wheel ruts and distant domes are missing, and its tussock carpet is denser.

## Defects found and fixed
- The ground was sand coloured, then the first red/dirt pair was only about 20 apart in colour distance (borderline). Graded dirt
  is now `#e0b684` against `#a4502e` earth: 40.5 flat, 40.4 to 40.9 measured on screen, with a test that fails below 25.
- Spinifex first looked like green rubble; two layers (rim cones and a central spike over a flat disc) now read as a tussock.
- The first capture script ran cars off the road; captures now step autopilot cars to a named place on the stretch.

## Remaining defects
- No wheel ruts, no distant domes; tussock density is a fraction of the reference's.
- The yellow/black marker pads on the road are the core's feature markers, not dirt-biome pieces.

## Not covered
- Phones, a resize/full-screen toggle pass, WebKit, and a fresh-eyes review by someone other than me.
- The readability test samples a straight-ish view above the car, found by the cream edge lines; it doesn't cover a view into the sun
  or the road on a tight corner.
