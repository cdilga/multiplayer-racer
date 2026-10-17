# br-gw74.13.1.1.1 (P1-R-overview-label): jumps and loops read in the overview; a car's label never covers them

In the host's overview (no tiles, whole-lap scale), a car is a speck. Its label was anchored 2.2 m above the car, which
at that scale is a pixel or two, so "#0 Player 0" sat on the car and on the jump or loop it was on
(`before-label-over-car-1920x1080.jpg`). And a road-wide jump was a tan ramp on a tan road: at that scale it read as more
road.

What changed:
- **Labels in the overview** (`web/host/src/render/world.ts`, `identity/nameplates.ts`, `nameplates.css`):
  - The label shows the number alone (the HUD and the roster carry names).
  - It stands beside the car, off the side of its travel that faces up the screen, a line's height clear, with a leader
    to the car at whatever angle that is.
  - A first try put the label above the car (`step1-label-above-loop-1920x1080.jpg`). That still sat on the jump's
    landing whenever the road ran up the screen, since the set piece lies along the road.
- **In a tile**, a label also stands at least a line's height above its car, with a leader.
- **Jumps** (`render/map/map.ts`): the last 1.5 m of a ramp up to its lip, the first 1.5 m of a set piece's landing and
  the far edge of a table are painted a band. The band is ink or paper, whichever stands out from the surface under it
  (ink on the tan ramps and dirt, paper on tarmac). A paper-white first try vanished on tan.

Checks: `generated-jump` and `generated-loop` assert, in the overview at 1920x1080 and 1366x768, that the label covers
neither the car nor its road 8 m ahead of or behind it (`lib/in-frame.mjs` `labelClear`). Both pass on eris at
4b5f9c7f, Chromium, GPU (ANGLE Vulkan); the loop also passes on SwiftShader.

## Looked at

- `chromium-overview-air-1920x1080.jpg` / `-1366x768.jpg`, plus `crop-jump.png` (crop of the 1920 still): the car mid-air
  over a generated road-wide jump (rocks), seen from the overview.
  - Two ink lines cross the road, the lip and the landing's start, with the shaded ramp between: it reads as a jump.
  - The "#0" badge stands to the left of the road, its leader running to the car between the lines. Neither the badge
    nor the leader covers the bands.
- `top-overview-1920x1080.jpg` / `-1366x768.jpg`: the car at the top of a generated loop. The badge stands to the right
  of the loop with a short leader, and the loop's ring and its shadow are clear of it.

## Defects found and fixed

- Label over the car and its set piece; a label above the car covering the landing; paper bands invisible on tan.

## Remaining defects

- The loop at whole-lap scale is small: a ring about 20 px across at 1920x1080. It reads as a loop when you look for it,
  not at a glance. A bigger read would need an overview marker or a closer overview camera: a design call, not taken
  here.
- These fixtures' seat is #0 with no paint, so the badge has no fill (outline and ink text only). A real room's seats
  are #1 and up, in their colours.

## Not covered

- WebKit captures of the overview (the WebKit jump run reported page errors from the second navigation, now fixed by its
  own page; not yet recaptured). Physical TV.
