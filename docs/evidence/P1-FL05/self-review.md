# Self-review P1-FL05 (br-bbki.5): the drift input is gone (R128)

Captured on the Mac (macOS 27.0.1) in Playwright Chromium (headless, software GL) from the shared tree at 7e88eb64 plus
other agents' uncommitted work, by `JJ_CAPTURE_DIR=… node --test web/tests/journeys/c06-tutorial.test.mjs`. This is
Chromium emulation of a phone, not a device.

## Looked at

- `captures/phone-tutorial-step1.png` (844x390, phone landscape, first-run tutorial): "Step 1 of 5 · Steer". Five
  pager dots; there is no Drift step.
- `captures/phone-tutorial-step2.png`: "Step 2 of 5 · Go and stop", left stick up/back, no sideways.
- `captures/phone-tutorial-step3-launch.png`: "Step 3 of 5 · Launch", R127's copy. The pager dots touch the
  "#1 This device" chip below the card (see Remaining).
- `captures/phone-tutorial-oi.png`, `captures/phone-tutorial-step5-cone.png`: steps 4 and 5 of 5. The right stick's flicks.
- `captures/phone-tutorial-done.png`: "You're ready". The help copy mentions driving help, not drift.
- `captures/tv-prompt-go-and-stop-1280x720.jpg`, `captures/tv-prompt-launch-1280x720.jpg`: the TV's first-drive prompt
  reads "2/5" and "3/5" with the left stick up/back and pull-then-snap. There is no drift prompt.
- The host's keyboard controls card, as drawn in P1-FL04.2's driving captures (1920x1080, its `captures/` folder):
  Keys A/B/C list Steer, Go · brake, Launch, OI! · cone, Identify and READY. The ACTION left and right keys (drift) are
  gone.

## Defects found and fixed

- The lobby controls card for a pad or keyboard never folded: it waited for 7 used controls, but there are 6 now
  (c14 AC3 failed). It folds at 6 (`web/host/src/round/screens.ts`).
- CI's checks lane: the engine voice's `drift` input became `slide`, so the generated `engine-synth.js` bundle was
  stale. Regenerated.

## Remaining defects

- br-nbn2: on the Launch step the tutorial card's pager dots touch the "#1 This device" chip at 844x390. Steps 1, 2, 4
  and 5 clear it. The cause is R127's longer Launch copy, not this bead.

## Not covered

- Real phones and WebKit (Safari-shaped). Only Chromium emulation was captured; the owner's couch test covers the
  devices.
- Portrait phone. The controller is landscape-first, and the c06 journey captures landscape.

## Acceptance evidence

- No drift field remains in the input or vehicle profiles or `DriveInput` (27859cc5): `jj-input`, `jj-sim`,
  `jj-protocol` (CMD_VERSION 3 → 4), `jj-wasm-host` and `jj-fixture` all compile without it. Their tests pass, and
  `jj validate` passes on every profile.
- A left-stick sideways push does nothing on the dual layout. The `c02-wire` journey asserts no throttle, brake, steer
  or boost from `{x: 1, y: 0}` (local run: pass 1/1).
- The tutorial and coach no longer mention drift (the captures above, and `c06-tutorial` / `c14-controls` pass
  locally).
