# Self-review P1-R12 (emissive and particle effects pass)

Captured with `JJ_CHROMIUM_GPU=1 node web/host/tests/look-capture.mjs fx` on eris: headless Chromium 151 over ANGLE/Vulkan on
the RTX 2080 Super (`captures/report.json` names the renderer), game commit b4266e4c (run `bc-fx-19`), the synthetic oval with the
effects demo (`?synthetic=24&map&look=on&fxdemo&res=1&autores=off`: car i cycles through the family its index names), 1920x1080
at native pixels. Each shot waits until its families are alive (`allFamiliesShown` true for every shot in the report); wreck-fire
shots also wait until a tile has the husk in view; short-lived bursts (hits, landings, detaches) are shot by holding the frame loop two drawn
frames after the family's one-frame burst, at 1, 4 and 24 tiles; the 1-tile hit and its reduced-motion twin show the same moment. Reference: the accepted Fury road look and style frames.
Independent reviews: `fresh-eyes-round1.md` (FAIL), `fresh-eyes-round2.md` (FAIL: gravel spray and a damaged car's smoke not visible), `fresh-eyes-round3.md` (FAIL: hits, landings and detach bursts read only at 1 tile) and `fresh-eyes.md` (this round).

## Looked at
- `captures/dust-dirt-1tile.jpg`: red-centre dust behind the cars on dirt, lighter puffs behind the followed car on tarmac; road ahead clear.
- `captures/gravel-spray-1tile.jpg`: pale gravel dust at the followed car's wheels; the pebble roost is clearest on the gravel cars ahead in `captures/impact-sparks-1tile-reduced.jpg` and `captures/damage-smoke-1tile.jpg` (pale inked stones trailing the teal, yellow and purple cars).
- `captures/tyre-smoke-1tile.jpg`: grey tyre smoke at the drifting cars' rear wheels, inked puffs; paint unobscured.
- `captures/boost-blue-1tile.jpg`: a blue flame streak with white-hot cores out of the exhausts (full meter), orange on the others.
- `captures/impact-sparks-1tile.jpg`: the followed car's hit: an inked comic burst at its bonnet, sparks spitting and falling.
- `captures/impact-sparks-1tile-reduced.jpg` (prefers-reduced-motion, the same moment): no burst to speak of, a few sparks: visibly calmer.
- `captures/landing-1tile.jpg`: a ring of dust puffs where a car landed.
- `captures/detach-damage-1tile.jpg`: a door on the road behind the followed car, its burst, smoke from the damaged car.
- `captures/damage-smoke-1tile.jpg`: the badly damaged purple car (door off, front loose) trailing a column of dark inked smoke; the teal car's identity clear beside it.
- `captures/wreck-fire-1tile.jpg`, `captures/wreck-fire-4tiles.jpg`, `captures/wreck-fire-overview.jpg`: the husk's fire and black smoke column from a chase tile, four tiles and the overview.
- `captures/driving-4tiles.jpg`: dust, tyre smoke, boost and lamps in four tiles.
- `captures/hits-4tiles.jpg`, `captures/hits-24tiles.jpg`: the moment of the demo's hits: inked bursts and sparks on the hit cars in every tile that has one.
- `captures/landing-4tiles.jpg`, `captures/landing-24tiles.jpg`: landing dust rings at the moment of landing.
- `captures/detach-4tiles.jpg`, `captures/detach-24tiles.jpg`: the detach moment: doors coming off with their bursts.
- `captures/all-24tiles.jpg`: every family across the 24 tiles; no tile covered by an effect.

## Defects found and fixed
- Round 1 review (FAIL): weak fire, smoke, flashes and sparks; families missing at 4 and 24 tiles; puffs without the comic ink; tan dirt dust; reduced motion not visibly calmer. Fixed: red-centre dust; an ink ring on every puff; stronger fire, detach bursts and damage smoke; shots per family at 1, 4 and 24 tiles; reduced motion at a fifth of the flash and a quarter of the sparks.
- The demo's hits never showed. Found with `Fx.inspect()` (lastImpact, impactsByCar, impactSample, drawnBursts): the hit was on the right car and opaque in the layer's buffer, but **the effects layers drew only their first 256 particles**: three.js caches an instanced geometry's instance limit on its first draw and clamped every later draw to it. Growing a layer now clears it (`fx/buffers.ts`, tested in `fx.test.mjs`). This was a silent particle cap.
- Also on the way: the demo "crashed" every car at its respawn (a zero velocity on the respawn tick); a flash fading from its first frame was a faint pale disc by the time it was seen (hot sprites now hold full strength for 60 % of their life, and hits are inked comic bursts that read on sand).
- Round 3 review (FAIL): hits, landings and detach bursts were only caught at 1 tile. Each now has its own frame-held shot at 4 and 24 tiles.
- Round 2 review (FAIL): gravel spray and a damaged car's smoke couldn't be seen. Gravel now throws pale inked stones at chase-camera size that keep most of the car's speed (moving backward over the ground, every pebble had passed the chase camera within 0.3 s), plus a pale gravel dust; small sprites fade only right at the lens; damage smoke is denser, with its own shot; the dirt and gravel shots wait for the spray to build up. A mislabelled 'real race crash' frame that showed no hit was removed.
- With every particle drawn, the emission tuned against the hidden cap was too heavy: tyre smoke, damage smoke (now from higher and behind, off the paint), sparks (fewer, finer, falling: long-lived light sparks hung as orange orbs) and the burst (3 m) were cut back.

## Remaining defects
- **The headed Mac frame-cost receipt is outstanding (AC3).** `cost.json` (df0582e) was measured while only 256 particles per layer drew, so it undercounts; the re-measure needs the Mac's display unlocked (2026-10-08: the session was locked, so a headed Chrome can't render). `look-cost.mjs --fx` also runs on eris with `JJ_CHROMIUM_GPU=1`, but the synchronous readback there costs about 300 ms a frame even with the effects off (the GPU idle), so it isn't a valid cost figure.
- Minor, from the passing round-4 review: landing puffs look like ordinary dust; gravel is weak at 24 tiles; damage smoke can hide a car's body for a moment at 1 and 4 tiles; smoke and dust discs carry only a light ink rim (no halftone); dust discs are clipped at the bottom frame edge near the camera; no frame singles out a brake lamp; the overview wreck reads as a glow and smoke column.

## Not covered
- Effects in a real race (the demo drives the families on purpose; the race path is the same emitter fed by snapshots).
- Real TV, phones as host, WebKit: Chromium headless on eris's GPU only. Full-screen and resize: effects have no layout.
- The WebGPU paths (no TSL compute particles yet; the WebGLRenderer route ships).

## 2026-10-10 evening: the 4K cost investigation
An attempt to cut the effects' 4K frame cost (dust, smoke and fire overdraw) re-captured every effect on the Mac (headed Chrome 154,
Apple M1 Pro) with a sprite-geometry, size-cap and per-kind-shader build and compared each image with the eris captures above:
the dust-dirt, wreck-fire, damage-smoke and all-24-tiles shots looked the same (the same inked puffs, the same smoke column and
fire, the cap only trimmed the largest near-lens puffs, which are already faded there). The build was then dropped because none
of its changes measurably reduced the cost against HEAD (see `cost.md`, "Investigation"), so the shipped effects code is
unchanged and the captures in `captures/` are the original eris set, restored. No new look to judge.
