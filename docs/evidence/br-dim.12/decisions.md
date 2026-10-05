# br-dim.12 (P1-U05): look setting decisions from the A/B compare

Tool: `art/ui/poc/world/index.html#compare=gtao|smaa|shadows|control` (`&view=tv|grid&n=24&size=WxH&mode=side|wipe&crop=x,y`),
captured by `art/ui/poc/world/capture-compare.mjs`. Both frames are the same world, stopped on frame 90 of a fixed 1/60 s sim
(`?freeze=90`), grain and heat shimmer off (they read the renderer clock). **Control (A = B) reads exactly 0 on every case**, so every
difference below is the setting. Machine: Chromium (Playwright) on this Mac, WebGPU (Metal). Metrics are over scene pixels (tile
interiors); "changed" = largest channel differs by more than 12 of 255. Raw numbers: `compare-metrics.json`.

| Setting | Case | Mean abs diff | % changed (>12) | % changed (>32) |
|---|---|---|---|---|
| GTAO on vs off | one 1920x1080 tile | 2.08 | 5.74 | 2.33 |
| | one 384x216 tile (a 24-grid tile) | 3.07 | 11.34 | 3.00 |
| | 24-tile grid, 1920x1080 | 0 | 0 | 0 (GTAO never runs in a grid) |
| SMAA vs default AA | one 1920x1080 tile | 0.57 | 1.78 | 0.23 |
| | one 384x216 tile | 2.27 | 8.51 | 2.48 |
| | 24-tile grid | 1.93 | 7.49 | 3.17 |
| Shadows PCF 4096 vs off | one 1920x1080 tile | 2.31 | 4.43 | 3.68 |
| | one 384x216 tile | 1.65 | 4.61 | 3.42 |
| | 24-tile grid | 1.70 | 3.76 | 3.14 |

Images per case (`<setting>-<big|small|grid>-`): `ab.jpg` (the compare page), `a.jpg`, `b.jpg`, `heat.jpg`, `crops.jpg` (4x crop of A, B, difference).
`wipe-shadows.jpg` and `phone-compare-shadows.jpg` show the wipe mode and the page at 412 px wide.

## Decisions

**GTAO: remove (drop the cost).** It changes 6 to 11% of a tile, but what changes is wrong, not better. In `gtao-big-crops.jpg` the
W-beam guard rail goes solid navy (A) against its real galvanised grey (B), and the far mesas gain dark vertical and horizontal stripes
(`gtao-small-crops.jpg`, the heatmap `gtao-big-heat.jpg`: moire over the whole horizon). No contact shadow under the cars shows at any
size. It also needs one camera, so in the owner's review URL (`ao=1` at `#grid&n=24`) it was never running: a silent no-op, which is
why the owner saw no difference. Removed from the settings panel; `?ao=1` still works for the compare page; the pipeline code can go in
P1-R10.

**SMAA: default-off (and out of the panel).** Only edge pixels change (1.8% of a big tile, 7.5% of a 24 grid) and the change is a
softer stair-step: clear in the 4x crop, not at 1:1 (`smaa-big-ab.jpg`). Default AA stays: FXAA at four tiles or fewer, nothing in a
grid where the ink outlines carry the edges. Grid-tile edge shimmer is a temporal AA job for P1-R10 (README known gap), not SMAA.

**Shadows: keep.** The one setting with a visible, named benefit at every size: the cast shadow grounds each car on the road, and the
halftone dots in it are the comic look (the dots key on the shadow). 3.1 to 3.7% of the scene changes strongly (>32), visible at 1080p
(`shadows-big-ab.jpg`), and at grid-tile size the dark patch behind each car is visible in the whole-grid image
(`shadows-grid-ab.jpg`). Without it the cars float on a flat ground. The options in the panel are unchanged (PCF 4096 recommended,
soft, VSM, cascaded, off).

**Unchanged:** textured road + 16x anisotropic filtering stays the default; recommended presets are untouched.
**Discrepancy to flag:** the code default for shadows is `pcf` (on), as the README's recommended preset says; the owner's review URL
passed `shadow=off`. The evidence says on is better, so the default was left as is rather than switched off.

Settable record: the same decisions are in `art/ui/poc/world/shaders/looks.json` (`settingDecisions`) and
`.claude/skills/jammers-look/SKILL.md` (last section).
