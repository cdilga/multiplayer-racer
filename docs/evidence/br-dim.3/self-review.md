# br-dim.3 self-review (host Render resolution, R111)

Run: `node web/host/tests/resolution-capture.mjs` (writes resolution-run.json) and `node --test web/host/tests/resolution.test.mjs`.
Hardware/browser: Apple M1 Pro, headed Google Chrome 154 (system GPU) via Playwright. DPR 2 and 3 are EMULATED (Playwright deviceScaleFactor), not real high-DPR displays. Frame cost is the rAF interval (vsync-paced at 120 Hz, median ~8.3 ms), so it is vsync-bound, not a GPU-only cost and not a cap; p95 was 10-17 ms at 4K with 32 tiles.

## Looked at
- coverage-4k-dpr1-12tiles.jpg, coverage-1080css-dpr2-12tiles.jpg (12 tiles, 3840x2160 backing store both ways)
- dpr1/2/3-12tiles-native.jpg and dpr1/2/3-12tiles-half.jpg (native vs deliberately 0.5; DPR 2 pair and DPR 3 32-tile viewed in detail)
- dpr2-12tiles-setting-open.jpg (popover open above the chip) and dpr2-12tiles-native.jpg (closed: only the chip, with a keyboard focus ring after Escape)
- dpr3-32tiles-native.jpg (32 tiles, spare cells show join QR/standings, chip and select in the corner)

- poc-before-412x915-n32-dpr2.jpg, poc-after-412x915-n32-dpr2.jpg (TV POC 32-tile grid, tile 1, DPR 2 emulated: forced 1x vs native); poc-dpr-check.json; design-live poc_tv_index_html_grid_n_32_1920x1080.png (HUD pills still aligned to tiles)

## Findings
- At 3840x2160 (CSS 3840x2160 @ DPR1, and CSS 1920x1080 @ DPR2 emulated) for 1, 4, 12, 32 tiles the single canvas backing store was exactly 3840x2160 = the display grid, and all tile rects sit inside it. Tiles are 99.3 / 98.6 / 97.6 / 87.6 % of the display pixels (the rest is the 5 % safe margin, gutters and spare cells, all in the same native backing store).
- DPR 1/2/3 x 4/12/32 tiles: backing store == CSS x DPR in every case (ratio 1.0; 0.5 for the deliberate half render). Laplacian variance native / half = 2.2 to 7.0x.
- Looking at the images: native is visibly crisper (panels, rails, lines); the 50 % image is soft.
- Far car size: the other cars' on-screen length (4.4 m span through each tile's own camera) ranged from 0.4 px (32 tiles, DPR1) up to 18 px. Smallest at 12 tiles: 2.2 px (DPR1), 4.4 px (DPR2), 6.6 px (DPR3); at 32 tiles: 0.4 / 0.8 / 1.3 px. "Far car at least N px and visible" is therefore NOT met at the smallest tiles; N from this capture is ~4 device px at 12 tiles / DPR2. Sub-pixel cars at 32 tiles are the ink/minimum-size work of br-dim.11.

- TV POC (art/ui/poc/tv): backing store was CSS px; now round(CSS x DPR) via world.resize, viewports/scissors in device px, HUD stays CSS (`dpr-check.mjs`, DPR 1/2/3 EMULATED, 412x915 and 1920x1080, n=4/12/32: canvas == round(CSS x DPR) in all 18 cases, `__poc.backing()` agrees, not clamped). Tile Laplacian variance native/forced-1x: 1.26 to 1.49x at DPR 2/3 (0.98 to 1.03 at DPR 1, as expected). Before crop is soft and merges cars; after is crisp. A GL-limit clamp exists and is reported in `__poc.backing().clamped`, untested on a real limit. live-check --local --tv --fullscreen: 216 ok, 0 fail.

## Defects found and fixed
- The select was permanently overlaid on a tile (coordinator review); now a chip-opened popover, closed by default, asserted in resolution.test.mjs (no box when closed, keyboard open/close, click-away).
- Auto-lowering tests were flaky when injected frame times did not divide a second; they now use whole-second multiples.
- Sharpness rects were first mapped with the wrong factor; fixed to device/backing ratio.

## Remaining defects
- The pre-existing status chip still sits over the bottom-right tile's corner (small, as before); the Render resolution select no longer does: it is a popover opened from the chip (click/Enter/Space; Escape or click-away closes). Fixed after review; P1-U02's host settings may take both over.
- A wall in one 32-tile tile shows blocky texture close up (texture itself, not resolution).
- Far cars are sub-pixel at 32 tiles / low DPR.

## Not covered
- The headed 4K capture on the TCL TV (G-PERF) for 1/12/24/32 tiles: NOT done (hardware, owner).
- The owner's real Android phone host run (backing store vs innerWidth x DPR on a real device): NOT done (owner).
- Real browser canvas/memory limits: the cap path is tested with `?maxcanvas=` (a simulated limit), not a real device limit.
- Auto-lowering under real GPU load: only tested with injected frame times; the budget (p95 > 50 ms for 5 s in a row) is untuned.
