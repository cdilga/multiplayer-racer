# Self-review P1-R03

Captured with `node art/ui/lib/live-check.mjs --base <local web/dist> --viewports 412x915,915x412,1920x1080,1366x768
--fullscreen` on three routes: `/host/` (the greybox through the real sim worker, nobody joined), `/host/?kitx=10`
(the greybox's dressing placed 10×, the draw-count probe) and `/host/?synthetic=6&map&tiles=6` (six synthetic cars in
chase tiles over the greybox, close to its kit pieces and markings). 24 captures, every one looked at in the contact
sheet and the five below at full size; the CI test's captures too. Playwright Chromium (headless, software GL).

## Looked at
- `self-review/matrix-all.jpg`: all 24 (3 routes × 4 viewports × before/after resize): the map framed whole, nothing
  blank, re-framed after resize.
- `self-review/1920x1080.jpg` (TV): tarmac loop, the packed-dirt back straight, the jump's hazard band and landing
  envelope, barriers along the bends, box buildings, start posts and chequered line, cones and bins.
- `self-review/915x412.jpg` and `self-review/412x915.jpg` (phone host landscape and portrait): the whole loop in view;
  the input drawer in its corner.
- `self-review/kitx_10_1920x1080.jpg`: 800 placements drawn with the same draws as 80.
- `self-review/synthetic_6_map_tiles_6_1920x1080.jpg`: close views: kerb stripes, the jump band, barriers, a building,
  the road edge lines, cars on the sand.
- `greybox-1280x720.jpg` (CI capture): where the surface colours are sampled (tarmac, packed dirt, off-track).

## Defects found and fixed
1. A post measured 5 % narrower than its collider (a 10-sided cylinder doesn't reach its radius on the x axis): round
   parts now use a multiple of 4 segments, so their bounds equal the proxy's.
2. The overview camera stepped back 8 % at a time and left a third of the TV empty: 3 % steps from a closer start.
3. On a landscape phone host the input drawer (P1-C05) covered about 40 % of the map: compact on small screens.
4. The route ribbon and its edge lines were wound to face down (they'd have lit dark): fixed before the first capture
   by checking each quad's winding.

## Remaining defects
- Tarmac and dirt squares poke out past the road ribbon at the hairpin and the S-bend: they are the sim's 10 m
  surface cells (nearest-sample grip, jj-sim `surface_at`), drawn truthfully on purpose so the colour under a car is
  the grip it gets. A finer surface grid is the generator's call (M01/M03), not the renderer's.
- Features are ground markings, not solid shapes: the sim doesn't drive features yet (P1-M03d makes them drivable
  pieces); a solid ramp the car passed through would mislead.
- The generic pieces are plain primitives in flat colours; the look (ink, toon ramp, grit) is P1-R10's.

## Not covered
- Gravel and rock surfaces: the greybox has none (their colours are in `SURFACE_COLOURS`; M04–M07 maps will show them).
- The owner's phone and the TCL: Chromium emulation only.
