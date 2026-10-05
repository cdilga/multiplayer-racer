# Self-review br-dim.4 (P1-C/R reversing camera)

Captured by `node web/host/tests/reverse-camera.mjs` against `web/dist` (headless Chromium 151, software GL, macOS arm64).
The "phone controller" is the test surface's fake controller (joins through the real controller path, sends DRIVE
state); no real WebRTC phone, no real device. Numbers per frame are in `reverse-run.json`.

## Looked at

- `phone-1tile-412x915-1-forward.jpg`: 412x915 portrait, one tile, driving forward. Chase from behind, road ahead, car
  centred low. Fine.
- `phone-1tile-412x915-2-mid-swing.jpg`: same tile, camera about 40 deg round (logged 39 deg, 90 deg after the capture):
  car seen from the side, no jump, car stays in frame.
- `phone-1tile-412x915-3-reversing.jpg`: camera fully round (180 deg): the car's nose faces the camera, the road it is
  travelling over is behind the car. This is the point of the bead.
- `phone-1tile-412x915-4-mid-swing-back.jpg`: forward again, camera about 135 deg on its way back, side-on car.
- `phone-1tile-412x915-5-back-forward.jpg`: back behind the car.
- `tv-6tiles-1920x1080-1-forward.jpg`: 1920x1080, 6-tile grid; tile 1 (top left, the driven car) chasing forward.
- `tv-6tiles-1920x1080-2-mid-swing.jpg`: tile 1 already at the rear (see Remaining defects: capture too slow to catch the
  swing in the grid). The other five tiles are idle grid cars and correctly stay in their normal chase.
- `tv-6tiles-1920x1080-3-reversing.jpg`: tile 1 looks back down the road with the car's nose to the camera; tiles 2-6
  unaffected (the swing is per seat).
- `tv-6tiles-1920x1080-4-mid-swing-back.jpg`: tile 1 back to chase from behind (swing finished during capture).
- `tv-6tiles-1920x1080-5-back-forward.jpg`: tile 1 chasing forward again.

## Defects found and fixed

- First journey runs reversed, then the camera flipped back by itself: the fake controller's stick is only re-sent while the
  test surface steps the sim, so between bursts the car lost its brake and rolled forward (the camera was right). Fixed in
  the journey with a 30 ms pump that re-sends the stick as a phone does.
- Mid-swing shots were caught at 0 or 180 deg: the swing runs on render time; waits now poll in the page's rAF for
  0.3 < blend < 0.7 before the screenshot.
- Found on the way (not mine, not fixed): every fake controller joins as `source: 1`, and with several fakes sending DRIVE the
  cars' inputs flicker; only the first fake drives in the journey.

## Remaining defects

- TV grid mid-swing frames are not true mid-swing: software-GL capture of six tiles at 1920x1080 takes longer than the
  0.7 s swing, and frames there run at the 0.1 s dt clamp (measured biggest per-frame yaw step 38 deg, which is the
  smoothstep's peak rate at 10 fps; 9.7 deg at the phone tile's higher frame rate). Mid-swing is shown at the phone tile and
  as per-frame data. Real GPU rates are not measured.
- The phone tile sits small in the middle of a tall page with the keys help panel above it: pre-existing host layout, not
  this bead.

## Not covered

- A real phone controller over WebRTC, real devices, WebKit/Safari, 915x412 landscape, 375x667, full-screen toggle and
  resize (the camera has no layout of its own; it reads the tile aspect only through the existing rig).
- First person and overview cameras were not captured reversing: first person deliberately does not swing (the mirror
  toggle covers looking back; the reverse state still tracks, so switching to third person mid-reverse shows the swung
  view straight away); the overview camera frames the field and ignores the rig.
- Reversing on a ramp or against a barrier (pull-in and ground clearance act on the swung position as usual, untested here).
