# Self-review br-dim.11

## Looked at
- `ba-phone-p-dpr2-n64.jpg`, phone portrait 412x915 DPR 2 (emulated), 64 tiles, three columns: CSS-px backing / native / native + ink scaled. Checked pixel crispness, navy blobs where cars bunch, body colour inside outlines.
- `ba-phone-p-dpr2-n24.jpg`, same, 24 tiles.
- `ba-tv-dpr1-n64.jpg`, TV 1920x1080 DPR 1, 64 tiles (CSS-res = native here, so columns 1-2 match, as they should).
- `cmp/final-inkscale-big-crops.jpg`: one full-size TV tile A/B: identical (diff panel black). `cmp/final-inkscale-grid-*.jpg`, TV 24-tile A/B + 4x crops: B shows body colours in bunched cars, near-car outlines thinner.
- `cmp/final-dpr2-inkscale-phone64-crops.jpg`: 4x crop at DPR 2, 64 tiles: far cars now colour specks, mid cars keep a thin outside line.
- `cmp/filt-*-crops.jpg`: af and mip-bias crops: differences are road/cockpit texture softness, no change in car legibility.
- Full-size single tile (`cmp/final-inkscale-big-b.jpg` removed after confirming a diff of 0): looked at before pruning.

## Defects found and fixed
- First ink-check frames were black/magenta: the snapshot canvas must be read before its iframe is removed and JPEGs need an opaque background (script fixed).
- First metric said ratios 2-35 even at modest sizes: ink from ground/rail inside the box was counted; now counted only within 4 px of a car pixel.
- Outside-only and width scaling alone left interior depth/normal lines covering small cars; interior lines now fade with car size.

## Remaining defects
- Cars below ~16 px wide are specks: a floor of 1 px outside line still takes about half of them (p90 ink 0.3-1.25, not judged). Honest limit of pixels, not a bug.
- Mid cars (60-110 px) now have thin outlines in grids; whether the owner likes that is taste (knobs in looks.json inkScale).
- The FP-tile black cockpit dash (existing) was left alone.

## Not covered
- Real devices: DPR is Playwright's emulated deviceScaleFactor on Chromium/Metal; no WebKit/Safari run, no physical phone.
- Moving-frame ink shimmer (only frozen frames measured).
- First-person tiles' car size uses the first tile's FOV for focalPx (FP tiles use a wider FOV, so their car size is slightly over-estimated).
- 3840x2160 and 5760x3240 captures were measured, not all viewed (viewed TV DPR 1 and phone DPR 2).
