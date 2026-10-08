# Self-review P1-R12 (emissive and particle effects pass)

Captured with `JJ_CHROMIUM_GPU=1 node web/host/tests/look-capture.mjs fx` on eris: headless Chromium 151 over ANGLE/Vulkan on
the RTX 2080 Super, game commit a32f959, the synthetic oval with the effects demo (`?synthetic=24&map&look=on&fxdemo&res=1&autores=off`:
car i cycles through the family its index names), 1920x1080 at native pixels. Each shot waits until the families it names are alive
(`captures/report.json`: `allFamiliesShown` true for every shot). Reference: the accepted Fury road look and the style frames. The
independent review is `fresh-eyes.md`; the headed Mac cost receipt is `cost.json`.

## Looked at
- `captures/dust-dirt-1tile.jpg`: beige dirt puffs behind the cars on dirt, light puffs behind the followed car on tarmac; road ahead clear.
- `captures/gravel-spray-1tile.jpg`: gravel flecks and dust behind the wheels.
- `captures/tyre-smoke-1tile.jpg`: grey tyre smoke at the drifting cars' rear wheels; paint unobscured.
- `captures/boost-blue-1tile.jpg`: a blue flame streak with white-hot cores out of the followed car's exhausts (full meter), orange on the others.
- `captures/impact-sparks-1tile.jpg`: the hit is on a car up the road (the demo's impact car), a small flash and sparks there; dust puffs around.
- `captures/impact-sparks-1tile-reduced.jpg` (prefers-reduced-motion): the same moment, flash and sparks smaller and fewer.
- `captures/landing-1tile.jpg`: a ring of dust puffs where a car landed.
- `captures/detach-damage-1tile.jpg`: a door lying on the road behind the followed car, smoke from the damaged car, a burst trail.
- `captures/wreck-fire-overview.jpg`: the overview camera; the husk's fire reads as a yellow-orange glow, small at this distance.
- `captures/mixed-4tiles.jpg`, `captures/mixed-24tiles.jpg`: dust, smoke, boost and lamps across the tiles; no tile covered by an effect.
- `cost.json`: headed Chrome 154 on the Mac (M1 Pro), 24 cars x 24 tiles, every family firing, about 2,000 live particles: effects
  cost +0.3 ms at 1080p and +1.3 ms at 4K (look 7.5 / 10.0 ms, look+fx 7.8 / 11.3 ms). **Budget set here: effects add at most
  2.0 ms per frame at 24 tiles on the Mac at 1080p and 4K.** Within it.

## Defects found and fixed
- Loop 1 (software GL by mistake, see P1-R10): the boost flame didn't show (additive sprites behind the bumper were thinned by the
  near-camera fade and washed out over sunlit ground); the wreck fire was a speck from the overview; dust and smoke puffs read as
  soap bubbles (a hard white highlight and a full ink ring).
- Fixes: flames, sparks and the impact/detach flashes are "hot" sprites, alpha-blended with a white-hot core (added light washes out
  in daylight); emissive sprites thin out only right at the lens; big sprites keep a minimum on-screen size (hot ones larger), so
  fire reads from the overview; puffs are two-tone (lit top, shaded underside, ink only underneath) with a soft edge.
- Loop 2: the boost was two round blobs; now a stream of small fast sprites, a streak behind each exhaust.

## Remaining defects
- **Independent review (`fresh-eyes.md`): FAIL.** Open from it: wreck fire and glow too weak (one small blob from the overview); damage smoke, detach burst, impact flash and sparks too weak to read; the 4- and 24-tile shots don't show most families; puffs read as flat translucent discs without the comic ink line; dirt dust reads tan, not red; the reduced-motion frame isn't visibly calmer. These keep AC1 and AC2 open.
- Sparks at chase distance are small: they read on the car they come from but not strongly from a car behind (the demo's hit is on
  another car).
- The overview wreck fire reads as a glow, not flames, at that distance.

## Not covered
- Effects in a real race (the demo field drives the families on purpose; the race path is the same emitter fed by snapshots).
- Real TV, phones as host, WebKit: Chromium headless on eris's GPU only. Full-screen and resize: effects have no layout.
- The WebGPU paths (no TSL compute particles yet; the WebGLRenderer route ships).
