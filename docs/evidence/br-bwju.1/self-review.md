# Self-review br-bwju.1

`/poc/vehicles/` lists every roster vehicle (roster.json, generated from `art/vehicles/*` by `tools/vehicles/review/build.mjs`; no list in the page code) and has one viewer with LOD, damage and paint toggles. It loads the baked GLBs through the vendored three GLTFLoader, self-hosted. Playwright Chromium headless, software GL.

## Looked at
- `poc_vehicles_index_html_1440x900.png`, `poc_vehicles_index_html_412x915.png`: roster card, the viewer, toggles (LOD, All intact/loose/detached, per-group selects, 13 paints, Spin). Toggles wrap cleanly on the phone; targets are 44 px.
- `viewer-intact-lod0.png`: LOD0, 1264 tris of 1300, 11 draws.
- `viewer-loose.png`: doors swung open about their hinges, front/back hanging, engine and cabin blocks showing.
- `viewer-detached.png`: wheels beside the car, front lying upside down ahead, doors/back off-screen at this angle, interior blocks showing.
- `viewer-lod2-orange.png`: LOD2, 594 tris of 600, seat 3 paint (tyres and glass keep their colour).

## Defects found and fixed
Car too small in the stage: camera moved closer. Everything else rendered as intended on the first look.

## Remaining defects
- Detached parts' resting poses are approximate (placed beside the car, not simulated); the real states are in the captured strip on the review page.
- Not run on the deployed preview or a real phone; the car rotates by default (Spin toggles it).
