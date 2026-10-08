# P1-C11 visual self-review (R116 controls on the phone)

Captured by `JJ_CHROMIUM_GPU=1 JJ_CAPTURE_DIR=<dir> node --test tests/journeys/c06-tutorial.test.mjs c07-settings.test.mjs c07-landscape-short.test.mjs` on eris
(Linux, headless Chromium, a mobile touch context, real host + jj-server + loopback WebRTC), run `c11cap` at ad02dcb3. Chromium
only; an emulated phone page, not a device. The R116 core (jj-input dual layout, the launch, protocol 6) is covered by its Rust
tests, the journeys named in the bead and the scenario bank, not by these images.

## Looked at

- `phone-launch-cooldown-ring-844x390.png`: right after a launch (the step-4 card ticked "Launch", "Nice! On to the next one"), the left stick
  shows a pale arc round its knob: the cooldown ring (a conic fill that empties as the wait ends). The knob carries the zap icon, the
  right stick (labelled Steer) is plain.
- `phone-tutorial-step4-launch.png`: "Step 4 of 6, Launch: Pull the left stick all the way back, hold a moment, then snap it forward. It is your
  boost." with its goal chip and six dots (three green, one blue).
- `c07-settings-phone-landscape-844x390.png`, `c07-settings-phone-portrait-390x844.png`: Your controls sheet with the new row "Two sticks /
  One stick (old)" under the stick placement row; it wraps to two lines on the segment but stays readable at 390 px.
- `c07-short-landscape-640x300.png`: the 640x300 play strip with the pod's "Launch ↓↑" meter between the sticks (empty, ready), the
  sticks labelled Drive and Steer, nothing overlapping.

## Defects found and fixed

- The settings row was called "Layout" beside "Stick placement" (floating or fixed): the two read as the same thing. It is now "Controls".
- The pod's meter used to show the host's boost meter; the boost is the launch now, so the bar shows the launch wait (full right
  after a launch, draining) and starts empty, which the short-screen overlap journey needs (the fill must leave the track visible).
- The action stick's knob carried the boost's zap icon; the icon moved to the left stick, where the launch is.

## Remaining defects

- The old Layout wording is in the images above (they were taken before the rename); the sheet itself reads "Controls".
- The cooldown ring is a thin arc in the capture: it is easy to miss against the dashed zone while the tutorial card is open. It needs a look
  in the hand at the playtest.
- Boost on the sim (the drift-charged meter) can no longer be spent in the default layout; only the old one-stick layout reaches it. The launch is
  the boost now (R116). This is a gameplay-lane follow-up, not a controller defect.
- The TV prompt capture (`tv-prompt-*` of C06) was not re-looked at for the six-step wording.

## Not covered

- Real phones and the iOS simulator; portrait play screen with the pod; the hub page with the new key mapping (c08 passes, not re-captured).
- Pads, key clusters and wheels were checked by tests (input, wheel and camera journeys, a native pad test), not by captures.
