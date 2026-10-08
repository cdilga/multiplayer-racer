# Self-review P1-R10 (in-world look pass)

Captured with `JJ_CHROMIUM_GPU=1 node web/host/tests/look-capture.mjs` on eris: headless Chromium 151 over ANGLE/Vulkan on the
RTX 2080 Super (each report's `mode` line names the WebGL renderer), game commit e10663d (run `bc-r10-7`), the real host page
(`?test=live&room`), fake controllers through the real join path, autopilot cars, `?look=on&res=1&autores=off` (native pixels,
R111). The 24-tile shots are a real 24-controller room. References: the accepted Fury road look
(`docs/evidence/P1-U05.5/looks/fury-road__tv.jpg`, `fury-road__grid_n24.jpg`) and `art/ui/accepted/2026-10-07/frames/tv-race-grid.webp`.
Independent reviews: `fresh-eyes-round1.md` (FAIL), `fresh-eyes-round2.md` (FAIL on two evidence gaps), `fresh-eyes.md` (PASS).
The headed Mac cost receipt is `cost.json`.

## Looked at
- `captures/corner-1tile-tv-1080p.jpg` (1920x1080, 1 tile): deep blue sky warming to a dusty band and the haze at the horizon; long low-sun shadows; bright yellow chevron boards with black chevrons on the outside of the bend; galvanised W-beam; clumped gums; car ink outline and halftone shadow; paint true.
- `captures/corner-4tiles-tv-1080p.jpg`, `captures/corner-24tiles-tv-1080p.jpg`: the same bend in every tile; at 24 tiles the boards read as yellow chevron boards, water towers and the gantry stand out.
- `captures/gantry-1tile-tv-1080p.jpg` (1 tile, the run-in to the line): the START · FINISH gantry down the town street, the Olgas domes on the horizon.
- `captures/gantry-4tiles-tv-1080p.jpg`, `captures/gantry-24tiles-tv-1080p.jpg` (race start): the front row looks down the street (the banner isn't drawn within 4 m of a camera); the rows behind see the banner and truss legs.
- `captures/corner-1tile-laptop-1366.jpg`, `captures/straight-4tiles-laptop-1366.jpg` (1366x768); `captures/corner-1tile-phone-915x412.jpg`, `captures/straight-2tiles-phone-412x915.jpg` (phone as host, R08): same look, nothing clipped.
- `captures/identity-strip-1080p.jpg` + `captures/identity.json`: every car's lit roof reads as its badge colour; lit-pixel share 0.17 to 0.32 per car (bar 0.03).
- `cost.json`: headed Google Chrome 154 on the Mac (M1 Pro), 24 cars x 24 tiles at 1080p: plain 6.9 ms, look+fx 6.8 ms median; bar U05's 12.4 ms + 20 % = 14.9 ms.

## Defects found and fixed
- Loop 1: the capture's GPU launch silently fell back to software GL; it now uses the journeys' ANGLE/Vulkan launch and records the renderer.
- Loop 1: the W-beam read navy (an inverted-hull ink on a two-sided sheet): no ink hull on the rail. No dust haze: the Fury road fog values.
- Loop 1: 24-tile shots were the synthetic oval: they are a real 24-controller room now.
- Loop 2: front-row tiles filled by the banner at the start: it isn't drawn within 4 m of a camera.
- Round 1 review (FAIL): pale cool sky, high sun, chevron boards olive in shade, illegible kit at 24 tiles. Fixed: Fury road sky gradient, sun colour and fill; a 32-degree sun from -z (long shadows, car rears lit); chevron boards drawn as unlit printed faces (`decor.face`) and 1.7x life size.
- Round 2 review (FAIL on evidence): the identity strip wasn't copied into the evidence, and the 1-tile gantry frame (under the banner) showed no gantry. The strip is in; the 1-tile gantry is shot on the run-in.
- CI: with the look on under SwiftShader, journeys timed out; a software rasteriser draws the plain look (`?look=on` forces it). The look is on by default on the WebGLRenderer route (`?look=plain` turns it off).

## Remaining defects
- Minor, from the passing review: rail delineators too small to make out; the water tower is flat grey without an outline; a hard horizon seam; start-grid cars overlap on the grid (sim/grid, not the look); the road stays the map's dark tarmac; one tile in `corner-4tiles` has dust puffs over a car's rear.
- One 404 per room shot (a resource the test page asks for; not a render asset).
- The WebGPU paths draw the plain look (no TSL port; WebGLRenderer ships, P1-R01).
- `cost.json` was measured at df0582e, before the sky, sun, haze, banner and sign-face changes; none adds a draw or a pass.

## Not covered
- A real TV, a real phone as host, and WebKit: Chromium headless on eris's GPU at those viewport sizes (not devices). Full-screen and resize: the look has no layout of its own (the grid and HUD are R04/R07's).
