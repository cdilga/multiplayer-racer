# P1-C07.2 self-review (tilt steering)

Captures: `web/tests/journeys/c07-tilt-join.test.mjs` with `JJ_CAPTURE_DIR` on eris (Chromium, software GL, commit 641249c), real host in free drive and a real phone page. The accelerometer is emulated with dispatched `devicemotion` events, so this is not a device: the sign and feel on real iOS and Android phones are untested.

## Looked at
- `c07-tilt-settings-off-844x390.png`: the Settings sheet in landscape; the tilt row sits among the other toggles, off by default.
- `c07-tilt-settings-on-844x390.png`: tilt on: Sensitivity (Gentle / Normal / Sharp), Dead zone (Small / Medium / Large) and "Straight ahead: Set neutral" appear, with "Straight ahead set." confirmed under them.
- `c07-tilt-no-sensor-844x390.png`, `c07-tilt-no-sensor-390x844.png`, `c07-tilt-no-sensor-1920x1080.png`: a device with no motion sensor: the Tilt steering row is greyed with "This device has no motion sensor", the switch is off and disabled, and "This device has no motion sensor, so tilt stays off." shows under it, at landscape, portrait and TV-size windows.

## Defects found and fixed
- A device with the motion API but no sensor (most laptops, headless) left the setting appearing on and the sheet silent: the sensor gives up after 1.5 s and the sheet now says so and puts the setting back off.
- The first journey expected the wrong sign: the host turns a clockwise roll into the same applied steer as a stick pushed right (which the sim reads as negative). The journey now takes the sign from a stick pushed right.
- While Settings is open the car is held neutral even if the phone is turned (asserted).

## Remaining defects
- Measured on this run only: the host's input age while tilting was p50 75 ms, p95 159 ms, max 159 ms (n=20, loopback, sampled every 60 ms so each figure includes up to that interval). Real-network and real-sensor numbers are a P1-Q02 row.
- The sign convention (clockwise turns right) and the landscape orientations are derived and unit-tested for Android and iOS reading conventions in all four screen angles, but never run on a phone.
- iOS asks for motion access only inside a tap: after a reload with tilt saved, iOS needs the toggle tapped again (Android turns the sensor back on by itself).

## Not covered
- Real phones, tilt in portrait play, a tilt calibration drift over a long session, WebKit.
- Accelerometer boost or flick stays absent (R60): asserted by a unit test that tilt only replaces the drive steer axis, and by the journey (no actions, `boosting` stays false).
