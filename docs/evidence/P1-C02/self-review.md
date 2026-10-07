# P1-C02 self-review (controller app: sticks, buttons, HUD)

Captures: `web/tests/journeys/c02-controller.test.mjs` and `c02-style-compare.test.mjs` with `JJ_CAPTURE_DIR` on eris (Chromium, software GL, commit e6f5abe or later), phone contexts at 844x390, 390x844 and 375x667, drawn from the URL-fragment state opener (`B/j/ABCD#state=playing...`, no network). Chromium on eris, not a device. The images named below are in this folder, except the side-by-side pairs with the accepted mock, which are in `docs/evidence/P1-C02.style/`.

## Looked at
- `c02-pod-landscape.jpg`, `c02-pod-portrait.jpg`: the boost pod is a flat meter with its "Boost →" label, top-centre between the sticks in landscape and a row above the sticks in portrait; nothing in it looks tappable.
- `c02-rotate-prompt.jpg`: portrait shows "Turn sideways" with "Play upright anyway"; the sticks stay behind it.
- `c02-identify-flash.jpg`: Identify from the strip washes the screen in the seat colour with the "Cooee #12" chip and "That's you on the TV"; the strip stays above it.
- The race screen against the accepted mock at three sizes (`../P1-C02.style/pair-race-*.jpg`): strip with the number in the seat colour, the place over the lap, the tools, the boost pod, DRIVE and ACTION zones with the knobs (bolt on the ACTION knob) and the seat-colour frame round the screen.

## Defects found and fixed
- Pinching with real touch points zoomed nothing (asserted), but CDP's synthetic pinch zoomed to 2.5x: that gesture bypasses touch-action, so the test now pinches with two real touch points instead.
- At short landscape heights (the Android emulator's drive-android-g03 captures) the banner covered Leave, bases overflowed their zones and the tools wrapped: fixed with size-from-zone sticks, a one-line strip and a low banner (layout-short.css), guarded by `c07-landscape-short.test.mjs` at five sizes.
- The strip crowded with seven text buttons and the connection badge: now icon-only tools beside Identify's label (every tool keeps its spoken name), the badge hidden when there is no link.
- The place read "P3" crammed against the lap: now "3rd" over "Lap 2/3" as in the mock.

## Remaining defects
- The pod has no cone or front-slot indicators (the accepted mock shows "Cone ready" and the front slot): the HUD carries only the boost meter today.
- The accepted mock puts Help, Settings and Leave behind a menu button; the controller keeps them as icon buttons in the strip (the journeys press them directly). Same actions, different arrangement.
- "The controller background is the seat's identify colour at all times": built as the accepted mock draws it (a seat-colour frame round the whole screen, the number and DRIVE knob in the seat colour, the ink background kept); the asserted colour is the frame pixels, the number and the knob.
- WebKit was not run on eris (the engine isn't installed there): the touch checks that run in WebKit are skipped there. F08's iOS run (`docs/evidence/P1-F08/drive-ios-local-sticks.png`) covers Safari on the simulator for the two sticks only.

## Not covered
- Real phones, real thumbs, a real full-screen toggle on iOS (no Fullscreen API there; the card says Add to Home Screen only in the mock's gate, which the controller doesn't have: it plays in the browser).
- The F08 emulator rows are P1-F08's recorded receipts (docs/evidence/P1-F08/drive-android-c02.png, android-run1.json, android-run2.json), labelled "emulator".
