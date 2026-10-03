# Self-review P1-R01

Captured with `node art/ui/lib/live-check.mjs --base <local web/dist> --viewports 412x915,915x412,375x667,1920x1080,1366x768
--fullscreen` on three routes: `/host/` (the sim worker on the greybox, nobody joined), `/host/?synthetic=24` (24 cars
from the synthetic snapshot source) and `/host/?synthetic=24&res=0.5` (Render resolution 50 %). 30 captures (each
viewport before and after the full-screen-style resize), all looked at as full images and as one contact sheet
(`self-review/matrix-all.jpg`); five kept at full size. Playwright Chromium (full, headless, software GL), not the
owner's devices.

## Looked at
- `self-review/matrix-all.jpg`: all 30: three routes × five viewports × before/after resize. Checked: canvas filled edge to edge,
  nothing blank, every car on screen, chip readable and naming the true backing-store size.
- `self-review/host_synthetic_24_1920x1080.jpg` (TV, 24 cars): whole field in frame, cars distinct, shadows under them.
- `self-review/host_synthetic_24_412x915.jpg` (phone portrait): field spans the width; chip says `412×915 native` at DPR 1.
- `self-review/host_synthetic_24_915x412_after-resize.jpg` (phone landscape after resize): re-framed, no stretching.
- `self-review/host_1920x1080.jpg` (the sim worker, nobody joined): the greybox's five cones on a gridded ground.
- `self-review/host_synthetic_24_res_0_5_1366x768.jpg` (laptop at 50 %): chip says `683×384 50 %`, image upscaled, not cropped.
- `frame-webgl.png` / `frame-webgl2-fallback.png` (CI captures): the same frame through both backends.
- `unsupported.png`: the capability refusal: heading, reason, next step and a Join button, readable.

## Defects found and fixed
1. Loop 1: the oval's near end ran off the bottom edge (camera fit by half-extent ignored perspective). Then fit by the
   bounding circle; loop 2 still clipped the near cars on landscape and wasted most of a portrait screen. Fixed:
   the camera backs off until the field's four corners project inside the frame.
2. Loop 1: `/host/` with nobody joined was one flat orange (live-check flagged "canvas looks blank"), and the
   greybox's orange cones vanished into the orange ground. Fixed: neutral dusty ground with a 5 m grid, and the camera
   frames debris as well as cars.
3. The input drawer (P1-C05) became unreachable once the host page went full-screen (`overflow: hidden` pushed it
   below the viewport; the C05 journeys timed out on its buttons). Fixed: the drawer floats top-left over the world,
   scrolls inside itself and hides when empty.
4. Native resolution read the canvas's CSS size under an emulated DPR (2.625): the device-pixel box from
   ResizeObserver reports 1× under emulation. Fixed: it is used only when it agrees with CSS × DPR to rounding; the
   test now asserts 2402×1082 at 915×412 @2.625.

## Remaining defects
- With nobody joined, the five greybox cones are tiny specks on a portrait phone: the field is just ground until P1-R03
  draws the map and P1-R05 brings the cameras. Not a renderer-foundation defect; recorded here for R03/R05.
- Cars are placeholder blocks until P1-R02 (instanced vehicles).
- In the headless shell Chromium that CI installs, `GridHelper` lines running away from the camera don't rasterise
  (both backends alike, so the fallback comparison holds); full Chromium and Chrome draw them. Capture quirk, noted in
  `docs/learnings/render.md`.

## Not covered
- The owner's real phone, the TCL and Safari/WebKit: Playwright Chromium emulation only. The page has no touch UI yet.
- WebGPU in the matrix: live-check's Chromium has no WebGPU; WebGPU was exercised headed in the bench only.
