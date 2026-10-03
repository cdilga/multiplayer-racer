# Self-review P1-V03

Captured with `node art/ui/lib/live-check.mjs --base <local web/dist> --viewports 412x915,915x412,1920x1080,1366x768
--fullscreen` on the damage strip (tiles and overview), plus the 1/4/24-tile identity grids and the vehicle contact sheets
(`tools/vehicles/view/capture.mjs`). Playwright Chromium headless, software GL; not the owner's devices.

## Looked at
- `damage-strip.jpg`: every state, tile by tile (see `validation.md`): doors swing out about their front edges, front and
  back hang about their top edges with the engine/boot block showing, the wheel cambers, detached parts lie flat or
  upside down in the owner's paint, the stripped shell shows dark bays and the cabin block.
- `damage-strip-overview.jpg`: the row from the overview camera, left to right.
- `self-review/matrix-all.jpg`: the strip on four screens before and after a resize, and the 1/4/24-tile grids.
- `views.jpg`, `paints.jpg`, `lods.jpg`, `colliders.jpg`: the intact car, paint key, LOD ladder and collider hulls.
- `grid-1.jpg`, `grid-4.jpg`, `grid-24.jpg`: own car readable in its tile.

## Defects found and fixed
1. A loose door turned about the middle of its panel (pivots were bounding-box centres): pivots now sit on the §6.3 hinge
   lines (br-nd1a).
2. The strip read right to left from the overview camera: the row now runs left to right.
3. Detached doors and wheels stood on edge, and a detached front stood on its end overlapping its car: doors and wheels
   lie flat, the front and back lie upside down, further from the car.
4. The interior blocks were first inserted twice into the model script (a re-run of the edit): removed before baking.

## Remaining defects
- A detached front lying upside down shows its dark underside; it reads as debris, but the look pass (P1-R10) may want
  its underside lighter.
- The rear-view of a hanging back piece is subtle from the front three-quarter; visible from behind.

## Not covered
- Damage driven by the sim (P1-S04): the strip uses the synthetic source's part records.
- The owner's phone and the TCL.
