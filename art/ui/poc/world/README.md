# In-world look (P1-U05)

The comic look rendered live with the real Cruz Missile under the TV mocks' HUD, built only from the `jammers-look` skill's
tested module (`../vendor/look/look.js`, vendored by `../vendor.mjs`) and Spike J's model. Serve `art/ui/`
(`node art/ui/lib/serve.mjs`) and open `/poc/world/`. States by URL fragment:

| State | What it shows |
|---|---|
| `#grid&n=24` | 24 live tiles under U02's HUD, three of them first person; the cost case |
| `#tv` | one full-screen tile |
| `#graphics` | the start-finish race banner, a W-beam guard rail run and its terminal, corner chevron posts, the rail along the track (P1-U05.3) |
| `#paint` | every identity colour as lit paint on the car, next to its flat badge |
| `#overview&n=16` | the derby bowl from the Overview camera (P1-U05.4: near-fixed, predictive, smoothed; `&cam=round0` for round 0's), with a nameplate over every car. The arena is designed for it: a range of Olgas-style domes behind the far rim (the top of every frame) and quarry terraces on both flanks; `overview-zones.json` records what stays in view (for P1-M10) |
| `&dist=near\|mid\|far\|round0` | the race tiles' camera distance from `../shared/framing.json` (P1-U05.2, R98), shared with the TV mock |

| `#closeup` | one car on the start straight from the front three-quarter (its shaded flank and cast shadow) and the rear (brake lamps, boost flame), P1-U05.5 |
| `#shimmer` | a chase-height camera crawling down the start straight with no cars: the line-shimmer test (`&n=24` runs it in every tile of a 24-tile grid, `&speed=` m/s), P1-U05.5 |

`?mode=ids` (outlines on objects only), `?mode=plain` (no post), `?bloom=1|0&fxaa=1|0&halftone=1|0` (isolate one effect),
`?ts=1` (GPU timestamp queries for `window.__world.perf()`). The shader and lighting options (P1-U05.5) are below.

**How it renders:** one `WebGPURenderer`; every tile is a sub-camera of one `ArrayCamera`, so the whole grid is one scene pass
into the shared MRT targets (colour, emissive, normal + shade, object id, depth) and the comic post chain (ink outlines from
depth + normals + object id, halftone in the shadows, grade) runs **once over the screen**, as the skill's per-tile cost rule
says. The ArrayCamera pass issues one draw per object per tile, so the static props are built as plain meshes and then baked
into one mesh per material (606 meshes into 92; CPU submit fell from 5.4 to 2.2 ms a frame). One track-wide sun shadow (R10
replaces it with cascades).

## The proposal (one, with why)

**At 24 tiles the look is toon + ink outlines + halftone + grade, with no bloom and no FXAA; bloom and FXAA return at four
tiles or fewer.** Why: measured headed on the M1 Pro (`docs/evidence/P1-U05/world/perf.json`, GPU timestamp queries), r182's
bloom and FXAA nodes together add about 72 ms of GPU per frame at 1080p and about 192 ms at 4K (FXAA alone about 7 ms at
1080p, from a same-session A/B), while toon, ink, halftone and grade together cost under 1 ms over no post at all at 1080p
(about 4 ms at 4K). Without bloom the emissives (head
and tail lights, LED bar, gantry lamps) still read through their bright colour, without a halo; without FXAA the ink outlines
carry the edges.

| 24 tiles, headed, M1 Pro, Chromium 151, WebGPU | 1080p GPU ms p50 / p95 | 1080p frame ms p50 / p95 | 4K GPU ms p50 / p95 | 4K frame ms p50 / p95 |
|---|---|---|---|---|
| **The presented look** | **12.4 / 13.9** | **8.3 / 9.6** | **24.0 / 30.3** | **8.9 / 17.1** |
| With bloom and FXAA (the skill's big-tile default) | 84.5 / 93.9 | 8.3 / 9.4 | 216.1 / 228.1 | 16.7 / 24.5 |
| Outlines on objects only (`ids`) | 11.9 / 13.8 | 8.3 / 9.3 | 22.9 / 29.0 | 8.9 / 16.9 |
| No post (`plain`) | 12.2 / 13.9 | 8.3 / 9.6 | 19.6 / 25.8 | 8.4 / 17.0 |

Frame ms is the requestAnimationFrame interval on the 120 Hz display: the presented look holds 120 Hz at 1080p, and at 4K it
holds 120 Hz at the median with some frames at 60 Hz (p95 17 ms). **Caveat:** the timestamp totals exceed the frame interval in
every row, so they are not wall time; they rank the variants reliably, but the absolute numbers aren't a budget. A same-session
A/B before this run (two repeats each) gave the same ranking within 2 ms.

What the world dressing cost: before it (the first measurement, same machine) the scene pass was about 9 ms at 1080p and 12 ms
at 4K by the same timestamps; with the dressing it is about 12 and 20. P1-R10's frame budget for the look is this measurement +
20 %; R10 should find where the scene pass's extra 4K time goes (sky texture size, prop overdraw) and why bloom and FXAA are
so expensive at this size (a downsampled emissive input for bloom is the first thing to try).

## In-world graphics

Reworked for owner round 2 (P1-U05.3, R104 to R106), in the common Australian road style. The references are in
`art/references/australia/raw/` (`wbeam-*.jpg`, `chevrons-*.jpg`) and `art/ui/refs/owner-2026-10-03/world-finish-gantry-tatts-finke.png`.

- **Start-finish:** a race banner across the track on a light truss frame, in the reference's language and never its
  sponsors or words. A long ink banner carries big paper type, "START · FINISH" with "FINISH" in saffron. A slanted
  saffron end panel carries our name, a slanted chequer panel closes the other end (R102), a chequered flag stands on
  a pole by the line, and the chequered line is on the road.
- **Barriers:** Australian steel guard rail: a galvanised W-beam (a real W profile, 20% over life size so it reads at
  chase distance) on posts, with yellow delineators and flared terminals with rounded caps at the ends of each run.
  It's continuous on the outside of bends and on both sides of straights, where the tyre walls and rails were. Tyres
  are now only derby dressing (the bowl).
- **Wayfinding:** rows of posts on the outside of every sharper bend, each carrying one yellow chevron pointing the way
  the road turns: the chevron alignment marker.
- **No checkpoint gantries** (R106). Lap-validity checkpoints stay as invisible gameplay (plan §8) until the owner
  decides.
- Route edges are unchanged: cream edge lines inside red and white kerb blocks. Paint colours are unchanged (POC2-05).

## World dressing (after the fresh-eyes review, toward H4)

- **Sky:** small hand-inked cumulus 6–18° up on the festival-blue gradient (an equirect background texture, so it stays sky
  for the post chain).
- **Ground:** painted patches of lighter and darker earth (flat colour from a noise texture, so they add no ink lines);
  spinifex as squat olive clumps and gum trees kept near the road. Far-off props were what clumped the ink at the horizon.
- **Props:** windmills with turning fans, a water tower, tin sheds, bunting on the start straight and round the bowl, and
  hand-painted signs ("SEND IT!", "G'DAY").
- **Derby bowl:** a tyre-stack wall with gaps, hay bales, donut marks on the floor, doors, bumpers and wheels lying where
  they fell (identity colours), parked utes, a windmill and a shed beyond the rim, and a nameplate over every car in Overview.
- **Cars:** the livery bolts are cream and navy, so only the paint carries the player colour (the review found the shared
  pink-and-lime livery competing with #6 pink and #8 green).

## Shader and lighting POC (P1-U05.5, owner round 2)

The owner asked for a Mad Max tone with the choices side by side (POC2-09 to 14, R108). Everything is on one scene; the bar
at the bottom switches the **looks** live, and its menus reload the page with an **option**. Measurements, captures and the
cost of every look and option: `docs/evidence/P1-U05.5/`.

**Recommended:** Fury road, ink on the outer silhouette, PCF 4096 shadows with texel snapping, dust haze, the textured road
with 16× anisotropic filtering, the emissive kit, and FXAA and bloom on four tiles or fewer. Why: the most Mad Max of the
looks with every paint colour still vivid; each part costs nothing measurable or earns its cost.

- **Looks** (`shaders/looks.json`, data): sun azimuth, elevation, colour and intensity; the hemisphere ambient's sky and
  ground colours; fog; the painted sky's colours; tone mapping and exposure; the grade (split tone as linear multipliers
  for shadows and highlights, contrast, saturation, highlight bleach, vignette, grain); dust haze by depth; heat shimmer; the
  ground's grit, bleach and dust; and paint wear (damage creep on every car). Fury road, Dust storm, Bleached heat,
  Scavenged, Burnt dusk, and Round 1 for comparison. `world.applyLook()` sets all of it at runtime.
- **Post chain** (`shaders/pipeline.js`, `jjPipeline`): the skill's `comicPipeline` (still the tested reference in
  `../vendor/look/look.js`) plus round 2's changes. Ink is `outer` (the object-id silhouette sampled 1.6× wider, the depth
  and normal interior lines at 45%), `silhouette`, `full` (round 0) or `none`. The halftone is multiplied by the object-id
  target's dynamic flag, so it never lands on a car (POC2-13), while a car's cast shadow on the ground keeps its dots. Then
  GTAO (half resolution, single view only: it rebuilds positions from one camera), dust haze, heat shimmer (far ground only,
  never the cars), the split-tone grade, and FXAA or SMAA. An option that is off is left out of the graph.
- **Lighting** (`world.js`): `&shadow=pcf|soft|vsm|basic|csm|off`, `&shadowSize=`. Cascades (three, `CSMShadowNode`) are
  fitted to the first tile's camera, so they are a single-view option until P1-R10 gives each tile its own. The sun's
  frustum centre snaps to whole shadow texels, so a sun that follows a camera never crawls the shadow edges. Image-based
  light: r182's toon material ignores `scene.environment`, so each look tints the hemisphere ambient from its own sky and
  ground instead.
- **Road** (POC2-12): one ribbon textured from a mipmapped canvas (dirt, ruts, cream edge lines, red and white kerbs, an
  inked kerb edge), with 16× anisotropic filtering on every world texture. Round 1's thin geometry strips were thinner than
  a pixel at grid-tile size and broke up as they moved. `&roadtex=0` brings them back, `&af=1` turns AF off.
- **Emissive kit** (POC2-14): brake lamps (the atlas's tail-lamp texels brighten with each car's braking, through a
  per-instance `aKit` attribute), boost flames (an instanced cone carrying the car's id), amber hazard beacons that double
  strobe, and red roadside flares that flicker. All are driven from the sim clock, so captures repeat. `&emissive=0` turns
  the kit off for the cost table.
- Other parameters: `&tm=neutral|agx|aces|none` (tone mapping override), `&haze=0`, `&shimmer=1`, `&grain=0`, `&ao=1`,
  `&smaa=1`, `&debug=halftone|dynamic|edge|shade|glow`, `&htcar=1` (round 1's halftone on the cars, for the before), and
  `&tierH=` (the effect tier for a given tile height, for the shimmer metric's supersampled reference).

`capture-looks.mjs` makes the evidence: the looks at 1, 8 and 24 tiles, the close-ups, the halftone overlap measurement,
the shimmer metric against a supersampled reference, and the headed frame-cost table (`--perf`).

## Known gaps

- No impact words, speed lines or sparks yet (skill sketches; R12).
- The guard rails, posts and signs still alias at grid-tile size: geometry edges need anti-aliasing, and a temporal AA
  over the 24-camera ArrayCamera pass is P1-R10's to try (`docs/evidence/P1-U05.5/`, "What still shimmers").
- No light halos at 24 tiles (no bloom); the lamps read by colour alone.
- The sun's shadow covers the whole track at about 0.13 m per texel, so car shadows are soft.
- One biome only; the other three biomes' dressing is procgen work (P1-M beads).
