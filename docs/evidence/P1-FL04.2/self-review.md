# Self-review P1-FL04.2 (br-bbki.21): the arcade controller as drawn, and the Feel Lab

Captured on the Mac (macOS 27.0.1) in Playwright Chromium (headless, software GL), from the shared tree at 7e88eb64. The
driving stills come from `node web/host/tests/slide-capture.mjs --out …/captures` (the S02 test surface loads a
skidpad fixture with the vehicle profile and steps it). The lab captures come from
`JJ_CAPTURE_DIR=… node --test web/tests/journeys/fl03-feel-lab.test.mjs` (1280x720).

## Looked at

- `captures/ute-punch-t72.jpg`, `ute-punch-t120.jpg`, `ute-punch-t230.jpg` (1920x1080, chase camera). The Ute's 6 m/s
  throttle punch at full lock: tick 72 yaw 135 deg/s with the slide at 1; tick 120 yaw 107 deg/s; tick 230 caught (yaw
  9 deg/s, slide 0.14). Each frame shows the body level and upright (up-y 0.999), wheels on the ground, nothing
  clipped. The numbers are in `captures/capture.json`.
- `captures/cruz-turn-in-t90.jpg`: the Cruz 0.25 s after a full-lock throw at 21.9 m/s, yaw 84 deg/s, flat, no slide.
- `captures/lab-turn-1280x720.jpg`: the Feel Lab tab. An intro line, then the Power, Turn-in and Grip ↔ slide
  sliders, each with the selected vehicle's live numbers. Turn-in 1.52x reads `turn g 5.00` for the Lion President,
  its own 3.3 × 1.52. There is no preset picker.
- `captures/lab-ab-1280x720.jpg`, `lab-flipped-1280x720.jpg`: the A/B slots ("power 1.52x, turn-in 1.52x, grip 0.71x"
  / "sliders at 1x") flipped live mid-race, with the car mid-corner on the greybox. The footer reads "8 changed".

## Defects found and fixed

- The Feel Lab could take another vehicle's numbers as a car's shipped base, and so give the Hawk the Cruz's turn
  (5.76 instead of 5.00) on a slow host. The tuning panel carried on after a 1 s wait whether or not the host had
  switched vehicles. The lab's base capture also raced the panel's own vehicle selector. Now:
  - a switch waits up to 10 s and fails loudly;
  - pending changes are set aside only once the switch lands (an export mid-switch was empty);
  - each base is checked against the vehicle the host says it is tuning.
- The fl03 journey read values after a fixed 300 ms. It now waits for the host's confirmed vehicle.

## Remaining defects

- On a scrolled Feel Lab pane, the status line ("Applied to 4 vehicles…") sits half under the sticky footer. That is
  the panel's existing scroll layout, and the line is readable when scrolled to the end.
- The stills can't show the slide itself: the chase camera turns with the car, and the skidpad has no landmarks. The
  yaw, heading and slide beside each file in `capture.json` carry that. The feel is the owner's to judge in the preview
  (R136).
- A fixture-loaded profile is drawn with the Cruz body (the test surface names it `simulation-fixture`), so the Ute
  run shows a Cruz.

## Not covered

- Real devices and WebKit. TV-size GPU rendering: these are software-GL Chromium stills.
- The couch verdict (R136): pending the owner.
