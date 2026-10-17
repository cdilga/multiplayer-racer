# br-bwju.10 (P1-V-picker-art): every roster car has a real render in the phone picker

Owner, 2026-10-17: "I see crayon like drawings in places in the UI where we should have a proper render." The phone picker
drew every car except the Cruz as a flat SVG silhouette (the stand-in shape the `&roster=N` test cars use).

## What changed

- `tools/vehicles/view/view.js` gained a `hero` sheet: the car's in-game LOD0 GLB with the paint-key material, framed from
  its own bounds (front 3/4, nose left as in the brand render), on a transparent backdrop, cropped to the car.
- `node tools/vehicles/view/capture.mjs --heroes` renders every row of `web/shared/src/roster.json` to
  `art/ui/brand/renders/picker/<id>.png`. A car added to the roster gets its render from this command, not by hand.
- `web/controller/src/app/carsheet.ts` picks the render by car id (a Vite glob of that folder); the roster's `art` field is
  gone. Only cars with no render (the test stand-ins) draw a silhouette.
- `controller.css`: the big render sits in a 3:2 box (`object-fit: contain`), so a tall bike and a long sedan leave the panel
  the same height.

## Checks

- `node --test web/tests/journeys/c03-car.test.mjs`: 6/6 pass (Playwright Chromium, Mac, 2026-10-17). The new test walks
  every real car at 844x390 and 390x844 and asserts its thumbnail and big panel are images that decode at >= 400 px, each
  car's render is its own, and only the two stand-ins are silhouettes.

## Looked at

- `renders.png`: the six renders. Cruz Missile, Tradie Ute (canopy, rack), Hawk Dash (twin stripes), Lion President, Postie
  Bike (rider, mail boxes), Pig Catcher (rider, pig). All read as their car; none is a silhouette.
- `picker-landscape-844x390.png`: each car in the landscape picker. The render, name, class, stats and blurb are all
  visible; the thumbnails show real renders; Use this vehicle and Leave the room are unobstructed.
- `picker-portrait-390x844.png`: the same in portrait. Before the 3:2 box, the Pig Catcher's tall render pushed the
  buttons down; after it, the panels match and only the blurb length varies.

Known gap: the renders use the default cyan paint, not the player's seat colour (the silhouette was tinted). The seat
colour shows elsewhere on the phone.
