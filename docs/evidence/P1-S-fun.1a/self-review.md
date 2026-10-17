# br-gw74.13.1.1 (P1-S-fun.1a): big air reads as big air from the chase camera

The chase rode at a fixed height over the car (`car.y + upM`), so on a jump it rose with the car: the car stayed in the
same place in the frame and the ground never fell away. Now, off the ground, the chase holds `rig.airHold` (0.6) of the
car's height above `rig.airFromM` (0.9 m) to the ground, up to `rig.airHoldMaxM` (4 m), keeping its pitch
(`web/host/src/camera/rig.ts` `airHold`, values in `assets/profiles/camera.json`). On the ground nothing changes.

## Looked at

`compare.jpg`: generated Rocks seed 8 (`jj procgen --seed 8 --recipe rocks`), its 2.5 m road-wide jump at 35 m/s, chase
stills at ticks 90, 135, 180, 240 (`node web/host/tests/jump-capture.mjs`, Playwright Chromium on the Mac, local web
build), top row with the hold off (`airHold` 0, `before/`), bottom row with it (`after/`).

- Before: the car sits at the same spot in the frame through the whole flight; you can't tell it left the ground.
- After: at take-off (t135) the car lifts in the frame with its shadow on the table under it; at the top (t180) it is
  high in the frame, the underside visible, the shadow far below on the table; on the landing (t240) it comes back down
  to its usual spot. The ramp, the table and the landing slope are all visible beneath it. It reads as a jump.

## Tests

`node --test web/host/tests/camera.test.mjs`: 10/10 pass. New: `big air: the chase holds to the ground…`: on the ground
the camera is bit-identical to before; 6 m up it sits the stated hold lower and the car's screen height rises by more
than 0.15 while staying in frame (also at 40 m, the hold's limit); and through a 2.5 s flight the camera's frame-to-frame
vertical jerk never exceeds the car's own (no pop at the lip or the landing). The judder probe
(`camera-judder.mjs`) drives the flat greybox straight, where the hold is 0 by construction, so it can't regress.

## Defects found and fixed

- The camera rose with the car (above).

## Remaining defects

- The overview camera: at whole-lap scale the jump is a small shape and the car's name label sits over it
  (`after/overview-t180.jpg`). Moved to br-gw74.13.1.1.1 with the overview half of AC2.

## Not covered

- WebKit, a deployed preview (the change isn't published yet), phones (the chase tile is a host render; phone size
  doesn't change the rig), several cars in the air at once.
