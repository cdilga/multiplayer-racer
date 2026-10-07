# Self-review P1-M07 (Outback bitumen)

Captured with `node web/host/tests/biome-capture.mjs bitumen` (real host page, `&recipe=outback-bitumen`, seed 2; autopilot
cars stepped to the middle of the highway, point 158; headed Chrome). Reference:
`art/references/australia/generated/biome-outback-dirt-and-bitumen.png`.

## Looked at
- `highway-tv-1080p.jpg` (1920x1080): dark sealed road with yellow centre dashes, a cream edge band with a second white line
  inside it on each side, white guide posts with a red band at the verge, W-beam rail and yellow-banded posts on the far
  bend, a yellow diamond warning sign on the right, a small tan shed on the horizon, spinifex on red earth.
- `highway-tiles-1080p.jpg` (four tiles): the same road from four cars; a purple feature pad on the road in the lower tiles; the
  warning sign and shed small in the distance.
- `highway-laptop-1366.jpg` (1366x768, four tiles): the road with centre dashes, the warning sign, and in the upper right tile a
  green "STUART HWY / ALICE SPRINGS / DARWIN" direction sign; a "lead has changed hands" caption over the lower tiles.
- `plot-outback-bitumen.png`: top-down: lane lines along the whole lap, posts every 50 m both sides, rail runs and chevrons on corners.
- `validator-bitumen.txt`: ten seeds validate; a greybox to bitumen to greybox track validates on every seed.
- Against the reference: sealed road, yellow centre and white edge lines, rail, posts, a direction sign and a warning sign on
  red earth with spinifex. The reference's cracks, flared rail ends and culvert are missing; its domes on the horizon are too.

## Defects found and fixed
- The lane lines were invisible: they sat on the ground, under the road ribbon; they are now lifted onto the drawn road surface.
- The sealed road had a stepped edge (ground cells painting it); the road ribbon fixed that.
- The first captures drove cars off the road; captures now step autopilot cars to a named place.

## Remaining defects
- The edge line shows twice (the ribbon's cream edge band and the placed edge-line pieces just inside it).
- No cracks, no flared rail end terminals, no bridge or culvert ends; rail runs are short plain sections.
- Lane-line pieces are straight 3 m lengths: on a tight corner they cut the curve by up to 0.1 m.

## Not covered
- Phones, a resize/full-screen toggle pass, WebKit, and a fresh-eyes review by someone other than me.
