# br-dim.11 decisions (P1-U05 ink and edge quality at small vehicle sizes)

Method: `art/ui/poc/world/ink-check.mjs` (fixed fixture = the look page's bunched starting grid, `?freeze=90`, grain and shimmer off,
24/32/64 tiles, phone 412x915 and 915x412, TV 1920x1080, DPR 1/2/3 by Playwright deviceScaleFactor: EMULATED, Chromium on this Mac,
WebGPU/Metal). Per car box: inkRatio = ink coverage (debug=edge channel, within 4 device px of a car pixel) / body px (debug=dynamic car
mask x (1 - ink)). "Tiny" = box 16..48 device px wide, judged at p90 <= 0.6; "specks" (< 16 px) are reported, not judged (a 1 px outline
alone is most of a 6 px car). A/B and the full-size check use br-dim.12's `compare.js` (`#compare=inkscale`) via `capture-compare.mjs`.

## 1. Native-resolution tiles (R111): already in the page, verified, KEPT
`world.js` sets `renderer.setPixelRatio(devicePixelRatio * resStep)`; every cell of the matrix reports canvas = CSS x DPR (`nativeOk`
true in all 27). Before = `?res=1/DPR` (CSS-pixel backing, `ink-check-css-res-dpr2/3.json`, canvas 412x915 at DPR 2 and 3). The ink
numbers, DPR 2 emulated (CSS-res -> native, p90 ink/body): phone n24 tiny 2.32 -> 1.87, all cars 6.69 -> 2.78; phone n64 tiny 3.45 -> 1.95, all 20.2 -> 7.4; TV n64 tiny 5.31 -> 4.32, all 33.8 -> 23.9. It helps because the ink band is a fixed number of DEVICE px and the car then has more of them; the picture is visibly cleaner (`ba-phone-p-dpr2-n64.jpg`, `ba-phone-p-dpr2-n24.jpg`). Native alone does NOT make the matrix
pass: 0/27 cells under 0.6 (`ink-check-native-base.json`; tiny p90 1.7-5.3, specks up to 35 at TV n64 dpr1): at DPR 1 (no extra
pixels) cars still merge. So steps 2-3 stay justified by the numbers.

## 2. Ink scaled by car size: KEPT (default on, data in looks.json `inkScale`)
Per pixel: car size px = carSizeM(3) x focalPx / z of the nearest car pixel in reach. >= fullPx (160) the tuned width applies unchanged;
below it width falls in proportion (floor minPx 1); alpha fades to 0.4 between 28 and 8 px; below outsideBelowPx (60) the line is drawn
on the background side only (never over the body colour); interior depth/normal lines fade out between 110 and 40 px. Non-car edges
unchanged. Tried first without the interior fade and outside-only (tiny p90 still 1.2-3.8); the interior lines were the biggest
contributor. Result: **tiny p90 0.22-0.46 in 27/27 cells (was 1.7-5.3, 0/27 pass)**. Full size unchanged: compare `inkscale`, one
1920x1080 tile: mean abs diff **0**, 0% pixels changed, max 0 (`cmp/final-compare-metrics.json`). In grids it changes 4.9% of pixels (24
tiles, TV) and 9.2% (64 tiles, phone, DPR 2): the intended thinning of small cars.

| size | DPR | tiles | tiny n (base/after) | tiny p90 base | tiny p90 after | specks p90 base | specks p90 after |
|---|---|---|---|---|---|---|---|
| phone-p | 1 | 24 | 108/108 | 2.316 | 0.344 | 7.714 | 0.466 |
| phone-p | 1 | 32 | 123/123 | 2.192 | 0.317 | 14.051 | 0.643 |
| phone-p | 1 | 64 | 149/149 | 3.452 | 0.415 | 20.521 | 0.825 |
| phone-p | 2 | 24 | 136/136 | 1.868 | 0.276 | 3.456 | 0.327 |
| phone-p | 2 | 32 | 163/163 | 2.214 | 0.311 | 5.302 | 0.37 |
| phone-p | 2 | 64 | 322/322 | 1.946 | 0.265 | 7.908 | 0.509 |
| phone-p | 3 | 24 | 164/164 | 1.704 | 0.301 | 2.417 | 0.221 |
| phone-p | 3 | 32 | 206/206 | 1.889 | 0.295 | 3.344 | 0.283 |
| phone-p | 3 | 64 | 414/414 | 1.811 | 0.261 | 4.772 | 0.351 |
| phone-l | 1 | 24 | 104/104 | 2.087 | 0.32 | 8.199 | 0.5 |
| phone-l | 1 | 32 | 119/119 | 2.212 | 0.348 | 14.315 | 0.615 |
| phone-l | 1 | 64 | 184/184 | 2.553 | 0.306 | 22.261 | 0.988 |
| phone-l | 2 | 24 | 129/129 | 1.869 | 0.287 | 3.497 | 0.313 |
| phone-l | 2 | 32 | 180/180 | 2.34 | 0.297 | 4.875 | 0.342 |
| phone-l | 2 | 64 | 386/386 | 2.014 | 0.27 | 10.861 | 0.605 |
| phone-l | 3 | 24 | 164/164 | 1.735 | 0.289 | 2.535 | 0.232 |
| phone-l | 3 | 32 | 234/234 | 1.898 | 0.268 | 3.297 | 0.27 |
| phone-l | 3 | 64 | 485/485 | 1.976 | 0.261 | 7.151 | 0.421 |
| tv | 1 | 24 | 155/155 | 3.803 | 0.277 | 9.038 | 0.356 |
| tv | 1 | 32 | 184/184 | 4.121 | 0.285 | 19.143 | 0.376 |
| tv | 1 | 64 | 377/377 | 5.312 | 0.319 | 35.373 | 1.252 |
| tv | 2 | 24 | 115/115 | 3.148 | 0.395 | None | None |
| tv | 2 | 32 | 272/272 | 4.137 | 0.263 | 9.545 | 0.245 |
| tv | 2 | 64 | 639/639 | 4.324 | 0.234 | 33.192 | 0.824 |
| tv | 3 | 24 | 55/55 | 2.033 | 0.456 | None | None |
| tv | 3 | 32 | 246/246 | 3.689 | 0.296 | None | None |
| tv | 3 | 64 | 874/874 | 4.917 | 0.224 | 19.186 | 0.636 |

Caveat: the fade and outside-only mean mid/far cars have a thin or no outline: they read by body colour and silhouette (the bead's
intent), and the owner may want a bit more line at 60-110 px: `fullPx`, `outsideBelowPx`, `innerLoPx/HiPx` are the knobs (`&inkp=name:v,...`
overrides live; `?inkscale=0` is the old look).

## 3. Texture filtering variants: DROPPED (no measured legibility benefit)
Ink metric with `af=1`, `af=16` (car atlas too), `mipbias=+0.75` and `-0.5` is IDENTICAL to the base in every judged cell
(`ink-check-filt-*.json`; textures don't touch ink). A/B pixel change (compare): af 1 vs 16: 1.0-1.8 mean abs diff, 2.5-4.3% pixels
(mostly the road at grazing angles and the cockpit wiper texture; the road/ground are ALREADY 16x by default, so nothing to change);
mip bias +0.75: 0.3-0.9 mean, 0.5-1.6% pixels, only a softer car atlas, no sharper silhouette. `?af=` (atlas too) and `?mipbias=` remain
as URL options on the page for later. Dropped: car atlas anisotropy stays 4 (default), no mip bias.
Not evaluated: a temporal shimmer measure for the ink edge (no moving-frame metric built); the existing `#shimmer` page covers the road only.
