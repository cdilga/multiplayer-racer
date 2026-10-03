# Self-review P1-R02

Captured with `node art/ui/lib/live-check.mjs --base <local web/dist> --viewports 412x915,915x412,1920x1080,1366x768
--fullscreen` on three routes: `/host/?synthetic=24&damage` (overview, 24 cars, every third with a loose door and the
next with a detached front and wheel), `/host/?synthetic=24&damage&tiles=24` (24 chase tiles, LOD by tile height) and
`/host/?synthetic=3&damage&freeze=440&tiles=2&lods=0,2&follow=2,2&orbit=250,250` (one damaged car in two adjacent
tiles at LOD0 and LOD2). 24 captures, each looked at full size or in the contact sheet; the CI test captures too.
Playwright Chromium (headless, software GL), not the owner's devices.

## Looked at
- `self-review/matrix-all.jpg`: all 24 (3 routes × 4 viewports × before/after resize): nothing blank, cars painted,
  re-framed after resize.
- `self-review/24_damage_1920x1080.jpg` (TV overview): 24 painted cars, detached fronts and wheels lying where their
  cars respawned.
- `self-review/24_damage_tiles_24_1920x1080.jpg` (TV, 24 tiles at LOD1): every car's paint key (body tinted, lamps,
  glass and livery kept), shadows, neighbours visible in each tile.
- `self-review/24_damage_tiles_24_412x915.jpg` (phone portrait, 24 tiles): tiny tiles still show distinct cars.
- `self-review/3_damage_freeze_440_tiles_2_lods_0_2_follow_2_2_orbit_250_250_915x412.jpg` and `damage-lod0-lod2.jpg`:
  the damaged car side on: front detached and lying on its side in the owner's yellow, the dark bay where it was, the
  rear-right wheel detached on the ground, LOD0 (top/left) vs LOD2 (octagonal wheels, no wing endplates).
- `cars-130.jpg`: 130 cars from buffers that grew 16 → 256.

## Defects found and fixed
1. Every car was invisible (only shadows drew): the paint-key shader used `vColor` as a vec3, but three r186's
   instance colour is a vec4, so the fragment shader failed to compile. Live-check passed because a shader error is a
   console error, not an uncaught one. Fixed (`vColor.rgb`), and the R02 tests now fail on any console error.
2. Cars floated about 0.5 m: the synthetic source put the body origin at y = 0.5, but the vehicle contract (and the
   sim's body frame) has it on the ground. Fixed.
3. Damage wasn't visible from a chase camera (the detached parts lie behind or beside the car). Added a per-tile orbit
   angle to the plain tile view so a capture can look at a car's side (P1-R05 owns the real cameras).

## Remaining defects
- A loose door turns about the middle of the panel, not its front edge: the V02 bake puts each door's pivot at the
  panel centre (`cruz-missile.asset.json`, door pivot z = panel centre). R02 follows the sidecar; filed against the bake
  as br-nd1a.
- The paint key is GLSL (`onBeforeCompile`), which WebGPURenderer ignores: on the `?renderer=webgpu|webgl2` paths the
  whole car takes the identity colour and the white livery is lost (`../P1-R01/frame-webgl2-fallback.png` vs
  `../P1-R01/frame-webgl.png`; the R01 capture test still passes at a mean difference of 0.57/255). The shipped backend
  is WebGLRenderer (P1-R01); the TSL version belongs with P1-R10's look materials, noted on that bead.
- Chase tiles are about 40 % sky and the 24-tile layout leaves one cell empty: the cameras are P1-R05 and the grid
  P1-R04 (R95 equal tiles); this view is a stand-in for both.

## Not covered
- The owner's phone, the TCL, Safari/WebKit: Chromium emulation only; WebGPU isn't used (P1-R01 decision).
- Loose parts driven by the real sim: the sim doesn't write part records yet (the snapshot layout now has room for
  them; the header's reserved field is the part count). The synthetic source drives them here.
