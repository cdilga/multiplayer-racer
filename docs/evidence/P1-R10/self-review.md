# Self-review P1-R10 (in-world look pass)

Captured with `JJ_CHROMIUM_GPU=1 node web/host/tests/look-capture.mjs` on eris: headless Chromium 151 over ANGLE/Vulkan on the
RTX 2080 Super (the report's `mode` line names the WebGL renderer), game commit a32f959, real host page (`?test=live&room`),
fake controllers through the real join path, autopilot cars, `?look=on&res=1&autores=off` (native pixels, R111). The 24-tile
shots are a real 24-controller room (the synthetic fallback wasn't needed). References: the accepted Fury road look
(`docs/evidence/P1-U05.5/looks/fury-road__tv.jpg`, `fury-road__grid_n24.jpg`) and `art/ui/accepted/2026-10-07/frames/tv-race-grid.webp`.
The independent review is `fresh-eyes.md`; the headed Mac cost receipt is `cost.json`.

## Looked at
- `captures/corner-1tile-tv-1080p.jpg` (1920x1080, 1 tile, sharpest bend): toon-shaded gums, inked clouds, warm haze at the horizon, galvanised W-beam with delineators and yellow chevron boards on the outside of the bend, car ink outline and halftone shadow, paint true.
- `captures/corner-4tiles-tv-1080p.jpg` (4 tiles): same bend from four cars; rail and chevrons in every tile; two pairs of cars side by side (the grid start), not duplicated tiles.
- `captures/corner-24tiles-tv-1080p.jpg` (24 tiles): every tile shows the street or bend with the wayfinding kit; cars keep their colours at tile size; a commentary caption strip in one tile (not hidden by the capture's HUD filter, not a look defect).
- `captures/gantry-1tile-tv-1080p.jpg` (1 tile at the start): the pole car's camera is under the banner, so the banner isn't drawn (the fix below); town street ahead.
- `captures/gantry-ahead-1tile-tv-1080p.jpg` (1 tile, the town street; the same frame as P1-M04's hero): the race-banner gantry ("JOYSTICK JAMMERS / START · FINISH", chequered end, truss legs) ahead down the street.
- `captures/gantry-4tiles-tv-1080p.jpg` (4 tiles): front row looks down the street, second row sees the banner and gantry legs clearly.
- `captures/gantry-24tiles-tv-1080p.jpg` (24 tiles): the gantry at every distance on the grid; front-row tiles clear.
- `captures/corner-1tile-laptop-1366.jpg`, `captures/straight-4tiles-laptop-1366.jpg` (1366x768): same look, town houses with verandahs, bins and poles; nothing clipped.
- `captures/corner-1tile-phone-915x412.jpg`, `captures/straight-2tiles-phone-412x915.jpg` (phone as host, R08): legible at phone size; dust puffs on tarmac are the light grey the effects pass draws.
- `captures/identity-strip-1080p.jpg` + `identity.json` (8 cars parked): every car's lit roof reads as its badge colour; lit-pixel share within 38/255 per channel of the badge: 0.17 to 0.30 per car (bar 0.03).
- `cost.json`: headed Google Chrome 154 on the Mac (M1 Pro), 24 cars x 24 tiles at 1080p: plain 6.9 ms, look+fx 6.8 ms median (throughput 4.41 vs 4.90 ms); at 4K 9.3 vs 10.0 ms. Bar: U05's 12.4 ms + 20 % = 14.9 ms.

## Defects found and fixed
- Loop 1 (eris, software GL by mistake): the capture's GPU launch asked for a headed browser with no display and silently fell back to software GL while labelling itself "GPU Chromium"; it now uses the journeys' ANGLE/Vulkan arguments, fails loudly and records the renderer.
- Loop 1: the W-beam rail read navy: its two-sided sheet gave the inverted-hull ink its whole face. The rail has no ink hull now (R108: ink mainly on the car); it reads galvanised grey.
- Loop 1: no dust haze: 170-1100 m fog left the horizon crisp. Now the accepted Fury road values (#E9B98A, 160-620 m); the horizon warms.
- Loop 1: 24-tile shots were the synthetic oval on the greybox (no wayfinding kit). They try the real room first now, and on the GPU it ran: the kit is in the 24-tile frames.
- Loop 2: the front-row tiles at the start were filled by "START"/"FIN" (the chase camera sits in the banner's plane). The banner isn't drawn within 4 m of a camera; the front row now looks down the street.
- CI (run 1928): with the look on by default, SwiftShader journeys timed out (readability, C06, churn). A software rasteriser draws the plain look now (a cost tier, like the small-tile tiers); `?look=on` forces it.
- The look is on by default on the WebGLRenderer route (`?look=plain` turns it off); the draw-count tests and the renderer fallback comparison ask for `look=plain`.

## Remaining defects
- **Independent review (`fresh-eyes.md`): FAIL.** Open from it: the sky reads pale cool blue rather than Fury road's deeper blue over a hot horizon, and the sun is high (no long low-sun shadows; it was raised so chase cameras don't see shaded car rears, and rear faces still go dark on some headings); chevron boards read olive in shade; at 24 tiles the wayfinding pieces are a few pixels; the 1-tile gantry frame it judged had no gantry (`gantry-ahead-1tile-tv-1080p.jpg` was added after the review); the portrait-phone and straight laptop frames show no wayfinding piece. These keep AC1 open.
- One 404 per room shot (a resource the test page asks for; not a render asset; the frames are complete).
- The WebGPU paths still draw the plain materials (no TSL port of the look); WebGLRenderer is the shipping route (P1-R01).
- No post grade (split tone, vignette, grain) as in U05's WebGPU POC: the look is materials, rig, haze and sky. The frames match the reference's palette and tone without it; a grade pass is a separate cost decision.

## Not covered
- A real TV, a real phone as host and WebKit: the captures are Chromium headless on eris's GPU at those viewport sizes (not devices). Full-screen toggle and resize: the look has no layout of its own (the tile grid and HUD are R04/R07's), so they weren't re-captured here.
- The cost receipt was measured at commit df0582e (before the haze, banner and hot-sprite changes; none adds a draw or a pass).
