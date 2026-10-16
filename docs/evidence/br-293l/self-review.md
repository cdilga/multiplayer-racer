# Self-review br-293l: WebKit badge paint and the docked QR after host resize

**Fix:** landed in 1a225185 (CyanBridge, 2026-10-12). WebKit corrupted small `crispEdges` QR thumbnails, so the shared QR now
uses normal vector sampling for reductions, and brush SVGs declare intrinsic sizes. `receipt.md` has the reproduction.

**This review:** the deployed matrix and the real-room journey that AC1 asks for.

- **Journey:** `web/tests/journeys/r-resize-paint.test.mjs`.
- **Build:** the deployed preview `https://jammers-preview.dilger.dev/p/v02-a1f7bf4b/` (`JJ_PREVIEW_URL`), the newest preview
  live on 2026-10-16. It contains 1a225185.
- **Machine:** run from the Mac (Apple M1 Pro). Playwright **Chromium** and Playwright **WebKit**; WebKit is not Safari. DPR 1.
- **Room:** a real room (`host?room&test=live`) with four synthetic seats racing on autopilot, and more seats added until the
  QR has no grid cell and docks in the footer.
- **Cycle:** three rounds of 1920x1080 → 1366x768 → 915x412 → 412x915, then 1366x768 into full screen (entered in both
  engines) and back out.
- **Each step asserts:**
  - Every visible number badge (tile HUD and footer positions) is painted in its seat colour.
  - A QR in a grid cell decodes to the join URL.
  - The docked footer QR (~22-44 px) is paper with ink, not near-black.
- **Repeats:** three back-to-back deployed runs, 2/2 each. Also green locally (the Mac's own jj-server and build).
- **Stills:** in `deployed/`. They are the exact frames the assertions judged.

## Looked at

- `deployed/webkit-r3-1920x1080.jpg`, `deployed/webkit-r3-1366x768.jpg`, `deployed/webkit-r3-915x412.jpg`, `deployed/webkit-r3-412x915.jpg`:
  four tiles; every `#N` HUD badge and every footer positions badge is solid seat colour with its pattern and number. The
  docked QR is paper with sharp finder squares at each size.
- `deployed/webkit-r3-fullscreen-true.jpg`, `deployed/webkit-r3-after-fullscreen.jpg`: the same after entering and leaving full
  screen. No blank badge, no dark QR.
- `deployed/chromium-r3-1920x1080.jpg`, `deployed/chromium-r3-1366x768.jpg`, `deployed/chromium-r3-915x412.jpg`, `deployed/chromium-r3-412x915.jpg`,
  `deployed/chromium-r3-fullscreen-true.jpg`, `deployed/chromium-r3-after-fullscreen.jpg`: the same in Chromium. At
  412x915 the four tiles stack and the footer positions strip runs off the right edge behind its fade, as designed.
- Rounds 1 and 2 of all three runs (scratch, not committed): judged by the same assertions; no failure.

## Defects found and fixed

1. **The positions strip scrolls under the measurement (test defect, not game).** The footer positions strip scrolls on
   Chromium's compositor. A paused animation could still be drawn a step on, so the box measured for `#4` held the
   "Racer 3" text in the screenshot (0.00 seat colour, in 2 of 3 runs). The journey now switches the strip's animation off
   for each capture and remeasures around the screenshot until nothing moved. The judged frames confirmed every drawn
   badge was painted.
2. **A one-car race in WebKit (test defect).** Seats that ready one by one let WebKit start the race with only Racer 1.
   All four seats now claim before any readies, and the journey asserts at least four player tiles.

## Remaining defects

None seen. The original intermittent blank badge didn't reproduce across 3 runs × 2 engines × 18 steps on the deployed
build or in the local runs.

## Not covered

- Real Safari, iPhone or iPad, and a real TV: Playwright engines on a Mac only.
- The tiny docked footer QR is checked for paint (paper and ink), not decoded. At 1 px per CSS px it has ~1.5 px per
  module. It is a tap-to-enlarge button, and the big card it opens is decoded by `r07b-join-card`.
- High-DPR hosts (all captures at DPR 1).
