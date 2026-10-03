# In-world look (P1-U05)

The comic look rendered live with the real Cruz Missile under the TV mocks' HUD, built only from the `jammers-look` skill's
tested module (`../vendor/look/look.js`, vendored by `../vendor.mjs`) and Spike J's model. Serve `art/ui/`
(`node art/ui/lib/serve.mjs`) and open `/poc/world/`. States by URL fragment:

| State | What it shows |
|---|---|
| `#grid&n=24` | 24 live tiles under U02's HUD, three of them first person; the cost case |
| `#tv` | one full-screen tile |
| `#graphics` | finish gantry and chequered line, a checkpoint gate, corner chevrons, tyre walls and rails |
| `#paint` | every identity colour as lit paint on the car, next to its flat badge |
| `#overview&n=16` | the derby bowl from the fixed 60° Overview camera, with a nameplate over every car |

`?mode=ids` (outlines on objects only), `?mode=plain` (no post), `?bloom=1|0&fxaa=1|0&halftone=1|0` (isolate one effect),
`?ts=1` (GPU timestamp queries for `window.__world.perf()`).

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

Checkpoint gates: cobalt posts, a saffron "CHECKPOINT n" banner and a wide saffron line with navy edges on the road. Finish: an
ink gantry with a cream "FINISH" banner, seven lamps in navy housings (emissive) and a navy-edged chequered line. Route edges:
cream edge lines inside crisp red and white kerb blocks. Barriers: tyre walls on bends (black, with red and white painted tyres)
and red/white rails on straights. Wayfinding: yellow boards with black chevrons on the outside of every bend (the warning-sign
family; the owner's road-sign direction is R83).

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

## Known gaps

- No impact words, speed lines, sparks or boost flames yet (skill sketches; R12).
- No light halos at 24 tiles (no bloom); the lamps read by colour alone.
- The sun's shadow covers the whole track at about 0.13 m per texel, so car shadows are soft.
- One biome only; the other three biomes' dressing is procgen work (P1-M beads).
