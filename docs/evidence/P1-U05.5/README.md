# P1-U05.5: shader and lighting POC (Mad Max looks, ink, lighting, AF, halftone, emissives)

The owner's POC round 2 items POC2-09 to 14 (`docs/playtests/poc-2026-10-03-round2.md`, ruling R108), on one scene in the
in-world mock. Live at `https://jammers-preview.dilger.dev/poc/world/#tv` (or `#grid&n=8`): the bar at the bottom switches
the looks live, and its menus reload the page with an ink, shadow, AO, AA, road or emissive option. `#closeup` is the car
close-up and `#shimmer&n=24` the line-shimmer test at 24 tiles (`?roadtex=0` for round 1's lines). How it's built:
`art/ui/poc/world/README.md`, "Shader and lighting POC".

**Machine and browser:** Apple M1 Pro (MacBookPro18,3), macOS 27.0.1, Chromium 151.0.7922.34 from Playwright, WebGPU.
The captures and the frame-cost table are headless on the Mac's GPU; the headed per-look costs are in
`perf-headed-looks.json` (see "What it costs"). Re-run with `node art/ui/poc/world/capture-looks.mjs` (captures, the
halftone and shimmer measurements, `report.json`) and `node art/ui/poc/world/capture-looks.mjs --perf --headless` (frame
costs, `perf.json`; without `--headless` it runs headed and needs the screen awake and unlocked), then
`python3 docs/evidence/P1-U05.5/make_sheets.py` for the contact sheets.

## The recommendation (one set, with why)

**Fury road, ink on the outer silhouette, PCF 4096 sun shadows with texel snapping, dust haze, the textured road with 16×
anisotropic filtering, the emissive kit, FXAA and bloom on four tiles or fewer.** Why: it is the most Mad Max of the looks
(a low, harsh sun with long shadows, teal shadows against hot orange light, dust taking the distance) while every paint
colour stays vivid. Each of its parts either costs nothing measurable or earns its cost. The options that cost more without
a visible gain at 24 tiles stay off: GTAO, SMAA, cascades, VSM and soft PCF (costs below).

### What it costs

GPU ms per frame (p50 / p95) from WebGPU timestamp queries: the shadow pass, the scene pass over every tile and the post
chain, 1920×1080, on the M1 Pro (`perf.json`). Frames ran at the display rate (8.3 ms, 120 Hz) in every row. The table
was measured **headless** on the same GPU. A headed run (`perf-headed-looks.json`) measured every Mad Max look at 1, 8
and 24 tiles before the screen locked and stopped its window; it ranks them the same way. **Caveats:** timestamp totals
exceed the frame interval at one tile, so they rank variants rather than give wall time (as in P1-U05). Repeat rows at
one tile spread by about ±5 ms (the recommended set measured 31.6 as an option row and 37.3 as the first look row, which
also carried warm-up), and at 24 tiles by about ±0.5 ms.

**Budget used:** at 24 tiles the recommended set costs 8.9 ms of GPU, and every look is within ±0.6 ms of it. At one
tile it costs about 32 ms, of which bloom (with FXAA) is about 22 ms: bloom is the one expensive part, and P1-R10
should try a downsampled emissive input before anything else (P1-U05's finding, still true).

| Look | 1 tile | 8 tiles | 24 tiles |
|---|---|---|---|
| **Fury road** (recommended) | 37.26 / 49.94 (first row, warm-up) | 7.04 / 9.93 | 9.08 / 11.91 |
| Dust storm | 29.78 / 42.53 | 6.73 / 9.75 | 9.06 / 11.43 |
| Bleached heat | 29.96 / 37.81 | 6.73 / 10.78 | 8.97 / 11.49 |
| Scavenged | 34.33 / 47.65 | 6.75 / 8.96 | 8.41 / 12.05 |
| Burnt dusk | 34.46 / 47.40 | 6.84 / 9.52 | 8.45 / 11.94 |
| Round 1 (for comparison) | 32.84 / 52.48 | 6.99 / 9.26 | 8.44 / 11.82 |

A look is lights, uniforms and a sky texture, so the looks cost the same. Fury road's single-tile row ran first on a
fresh page; as an option row the same set measured 31.6.

| One change from the recommended set | 1 tile GPU p50 | Δ | 24 tiles GPU p50 | Δ | Verdict |
|---|---|---|---|---|---|
| **Recommended set** | **31.6** | | **8.9** | | |
| Ink: none | 37.0 | +5.4 | 8.9 | 0.0 | free (the 1-tile Δ is noise); the owner's call, offered |
| Ink: silhouette only | 33.0 | +1.4 | 9.0 | +0.1 | free; offered |
| Ink: round 0, everywhere | 32.7 | +1.0 | 8.4 | −0.5 | free; offered |
| Shadows: PCF soft | 32.3 | +0.7 | 8.7 | −0.2 | free, but no visible gain at this map size |
| Shadows: VSM | 126.0 | +94.3 | 23.5 | +14.7 | **rejected**: the dearest option by far |
| Shadows: cascades ×3, 2048 each | 30.3 | −1.4 | single view only | | sharper near the car at no measured cost and +0.7 ms CPU; one view only until R10 fits cascades per tile |
| Shadows: off | 29.2 | −2.4 | 8.8 | −0.1 | shadows cost about 2 ms at one tile and nothing measurable at 24 |
| Shadow map 2048 | 29.9 | −1.8 | 8.6 | −0.3 | softer car shadows; 4096 kept |
| Shadow map 8192 | 42.3 | +10.6 | 9.6 | +0.7 | sharper, but +10 ms at one tile |
| GTAO, half resolution | 30.5 | −1.2 | single view only | | within noise; adds contact shading under the cars, which the toon ramp mostly hides; offered, not recommended |
| SMAA instead of FXAA | 41.4 | +9.8 | 22.7 | +13.8 | **not recommended**: +14 ms at 24 tiles, and it re-sharpens the filtered kerbs (POC2-12) |
| No haze | 32.5 | +0.9 | 8.5 | −0.3 | haze is free; it stays |
| Heat shimmer on | 29.4 | −2.2 | off at 24 tiles | | free on big tiles (the skill's tier rule); Bleached heat uses it |
| No bloom | 9.6 | −22.1 | off at 24 tiles | | bloom is most of the one-tile frame (see above) |
| Tone mapping AgX / ACES | 31.7 / 31.7 | 0.0 / +0.1 | not measured | | free; Neutral keeps the paint colours |
| Road: round 1's geometry lines | 34.9 | +3.3 | 7.2 | −1.7 | the textured road costs about 1.7 ms at 24 tiles and fixes the shimmer (POC2-12) |
| Road texture without AF | 32.4 | +0.7 | 8.6 | −0.3 | 16× AF costs about 0.3 ms at 24 tiles |
| Emissive kit off | 34.4 | +2.8 | 8.6 | −0.3 | the kit costs about 0.3 ms at 24 tiles |

## Acceptance

| AC | Result |
|---|---|
| POC2-09: at least four selectable Mad Max looks on one scene, each with measured cost | Five Mad Max looks plus round 1's for comparison (`art/ui/poc/world/shaders/looks.json`): **Fury road** (recommended), **Dust storm**, **Bleached heat**, **Scavenged**, **Burnt dusk**. They switch live from the bar on the same scene, cars and moment. Captures of each at 1, 8 and 24 tiles: `looks/`, `sheet-looks-tv.jpg`, `sheet-looks-grid_n8.jpg`, `sheet-looks-grid_n24.jpg`. Cost per look at each tile count: `perf.json` and the table above |
| POC2-10: ink toggle on the car's outer silhouette, plus no ink | Ink menu: **outer** (recommended: the object-id silhouette drawn 1.6× wider, the interior depth and normal lines at 45%), **silhouette only**, **round 0** (everywhere) and **no ink**. Close-ups of all four: `closeup/outer.jpg`, `silhouette.jpg`, `full.jpg`, `none.jpg` (`sheet-ink.jpg`); their costs are in the table |
| POC2-11: lighting and advanced-technique options with cost, and one recommended set | Every option below is in the bar or the URL and costed against the recommended set at 1 and 24 tiles: shadow filters (PCF, soft PCF, VSM, cascades), shadow-map size, texel-snapped stable shadows, GTAO, SMAA, dust haze (the volumetric-style option), heat shimmer, bloom, three tone mappers, the road texture and AF, and the emissive kit. Image-based light: r182's toon material ignores `scene.environment`, so its equivalent here is the hemisphere ambient, tinted per look from its own sky and ground (no cost). The budget used is the measured frame (table above), not an assumed one |
| POC2-12: AF/AA removes line shimmer; before/after captured | Measured where the owner saw it, a 24-tile grid tile (320×256, no FXAA, as the grid presents): against a 4×4-supersampled render of the same frame, the textured road with 16× AF cuts **kerb flicker by 68%** (5.28 → 1.67) and **edge-line flicker by 57%** (0.87 → 0.37), and the aliasing error by 42% and 62%. Before/after stills and flicker heat maps: `sheet-shimmer-grid-tile.jpg`, `shimmer/`; method and every variant in `report.json` `shimmer`. Full screen, where round 1's lines were already several pixels wide, changes little. See "What still shimmers" |
| POC2-13: the halftone shadow no longer renders over the car | The halftone pass now skips anything the object-id target marks dynamic (cars, flames). On the two-view close-up **57,763 car pixels were dotted before and 0 after**, while 225,069 ground pixels keep their dots (`report.json` `halftone`; `sheet-halftone.jpg`, the debug channels in `closeup/`) |
| POC2-14: at least three new emissive varieties | Four: **brake lamps** (the tail-lamp texels brighten with each car's braking), **boost flames** (a flickering white-to-blue cone from the exhaust, carrying the car's id so the ink treats it as part of the car), **hazard beacons** (amber, double strobe, on the corner chevrons, by the start and round the derby bowl) and **roadside flares** (red, flickering, along the start straight). The existing head lamps, light bar and tail lamps stay. All animate from the sim clock, so a capture repeats. Counts in the live scene: `report.json` `emissive`; close-ups `closeup/outer.jpg` and the 8-tile captures |

No page errors and no requests outside the local server in any capture (`report.json` `errors`, `external`).

## What still shimmers

The geometry edges: the W-beam guard rails, their posts and signs (the `geometry` region in `report.json`). Only
anti-aliasing changes those, since there's nothing to filter. SMAA cuts their flicker by 15% at grid-tile size, but it re-sharpens
the filtered kerbs (kerb flicker 1.67 → 3.07), and FXAA was already dropped at 24 tiles for cost. A temporal AA was not
tried: r182's TRAA needs per-camera jitter and velocity, which the 24-camera ArrayCamera pass doesn't give it. That is
P1-R10's to try with the frame budget.

## Notes

- **Round 1's road was paler than its own colours.** Measured: with the grit on (tiles 270 px and taller), the round-1
  vertex-coloured ribbons rendered about 20% lighter than the same colour given flat on the same mesh (224,162,97 against
  181,130,71 for `#D39A62`); with the grit off they match. The likely cause is that `vertexColor()` is a vec4 and the
  skill's grit takes the luminance of its input. The textured road shows the specified dirt and the token kerb red, like
  every other surface, so the road reads darker and redder than in round 1.
- Costs vary between runs on this laptop, by up to a third at one tile (GPU clocks), so compare rows within one run. The
  per-look rows switch the look live on one loaded page; the option rows reload the page.
- The shimmer metric turns ink, halftone and grain off: they are screen-space and resolution-dependent, so a supersampled
  reference could not match them.
