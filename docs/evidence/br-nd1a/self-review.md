# br-nd1a self-review: loose door pivots

Build: web/dist at the working tree of 2026-10-10 (V03's pivots, ffc454e). Chromium headless (Playwright, software GL), macOS arm64.
Captures use the R02 damage URL `host/?synthetic=3&damage&freeze=440&tiles=2&lods=0,2&follow=2,2&orbit=<a>,<a>&look=plain` at 1600x900
(left tile LOD0, right tile LOD2; car 2 has its rear-left door loose, its front and rear-right wheel detached).

## Looked at

- `required-orbit250.jpg`: the bead's orbit (250). Front-left quarter. The rear-left door is ajar, its rear edge out of the body line
  and its front edge flush against the front door's rear edge; the front piece and front-left wheel are missing/offset as the fixture says.
- `left-side-orbit270.jpg`: dead side-on from the car's left. The rear door's front edge stays on the B-pillar line while the rear edge
  stands proud of the skin, on both the LOD0 and LOD2 tiles. It is not rotated about its middle.
- `left-rear-quarter-orbit300.jpg`: the clearest view. The door is swung open about its front edge, the dark cabin interior shows in the
  gap behind it, and the door's rear edge is well clear of the body on both LODs.
- `damage-lod0-lod2.jpg` (from `web/host/tests/vehicles.test.mjs`, 1280x720) and `browser-run.json` (part positions): the door_RL
  position equals its pivot (core + [0.94, 0.648, -0.15]), the front edge of the door.
- Earlier trial orbits (60/90/120) showed the car's right side, where the doors are intact; discarded, not committed.

## Defects found and fixed

- None new in the model: V03 (ffc454e) already moved the pivots onto the hinge lines. This bead adds the check that keeps them there:
  `tools/vehicles/test/pivots.test.mjs` (run by `node --test tools/vehicles/test/`, which `scripts/ci/checks.sh` already calls). For every
  `art/vehicles/<id>/` with model.js, params.json and vehicle.json, at every LOD, it asserts doors pivot on the front edge (max z) on the
  outer skin (max |x|) within 2 cm, front/back on their body edge, centre line and top edge, and that pivots match across LODs and the
  committed `.asset.json`. Defect injection: a pivot at the panel centre (every hinged part), at a door's rear edge, or at its mid
  thickness is rejected.

## Remaining defects

- The synthetic fixture swings the loose door only 10-40 degrees, so the side-on views show it only slightly ajar; the quarter view shows
  it plainly. The bake's hinge limit is 70 degrees; that range is not exercised by this capture.
- With `look=plain` the loose door's inner face has no interior panel (V03's interior blocks cover the cabin behind it only).

## Not covered

- Headed GPU rendering and the comic look (`look=on`); this is the plain look in software GL.
- Front-hinged check applies to `door*`, `front` and `back` by name; a roster car with differently named hinged parts would need the
  rule extended. Only cruz-missile exists in the roster today.
- The front/back "top edge" check is that the pivot lies in the upper half of the part's height, a looser test than the door rule.
