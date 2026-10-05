# P1-M02 self-review

Spike captures on the real host (Chromium 151, Playwright headless, software GL, darwin/arm64, 1280×720 overviews and
960×540 drives). Commands are in `report.md`. The compare sheets were built with
`montage -font /System/Library/Fonts/Supplemental/Arial.ttf -pointsize 20 -label <biome>:<und>+<scatter> captures/… -tile 3x3 -geometry 640x360+6+6`.

## Looked at

- `docs/evidence/P1-M02/compare-town.jpg`, `compare-rocks.jpg`, `compare-outback-dirt.jpg`,
  `compare-outback-bitumen.jpg`: all 36 candidates, before and after the plain fix.
- `docs/evidence/P1-M02/captures/town-route-cluster.jpg` and `captures/rocks-noise-blue.jpg` at full size.
- Frames from `docs/evidence/P1-M02/drives/outback-bitumen.webm`, sampled every 2.5 s: the car leaves the start, runs
  the sealed road, weaves off and stops against a shed.

## Defects found and fixed

- **Sand holes in undulating terrain, and road sections missing (town route).** The host's off-map plain at y = −0.05
  covered every part of the map below zero. Fixed in `web/host/src/render/world.ts`: the plain sits under the map's
  lowest ground. I re-captured everything after the fix, and the rocks/noise and town/route captures now show
  continuous ground and road.
- **Compare sheets had no labels** (montage had no font). Rebuilt with an explicit font. Each tile is now labelled
  biome:undulation+scatter.

## Remaining defects

- The road edge stair-steps on diagonal straights (the surface is painted per heightfield cell). Recorded in the report
  as a finding for M03 and the map renderer. It's visible in every capture.
- The bitumen drive's open-loop weave left the road and stopped at a shed. That's the drive script, not the map (see
  report). No recoveries and no page errors.

## Not covered

- No phone-host timing on a real device: the 4× and 6× CPU-throttled Chromium figures stand in, labelled as such.
- No WebKit or WebGPU captures: the spike's maps go through the same `jj.map.v1` loader as every map, and the renderer
  matrix belongs to R01/R02.
- Seeds 2–8 were benchmarked and validated but only seed 1 was drawn.
