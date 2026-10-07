# P1-G03 visual self-review

Build: `v0.2-revamp` at 4d98b73 (+ the results ordinal fix), run on eris (Linux, Playwright Chromium headless,
SwiftShader WebGL) through the real join path: `web/tests/journeys/jn3-round-loop.test.mjs` with
`JJ_CAPTURE_DIR` (run ids `g03-jn3f`, `g03-jn3g`). Phones are 844x390 landscape touch contexts; the TV is 1280x720.
Cohort: two phones (Davo, Shazza), nobody touching a stick after GO, the test surface's autopilot racing.

## Looked at

- `phone-idle-cue.png`: 15 s after GO with no deliberate input, the banner reads "Still there? Steer to keep your
  car: 3" and counts down.
- `phone-idle-autopilot.png`: 3 s later, "The autopilot is driving: steer to take over" until the next deliberate
  input.
- `phone-countdown.png`: the countdown banner, unchanged by G03 apart from the banner fill fix.
- `phone-results.png`: "You came 2 · 23 points" (before the ordinal fix below).
- `tv-racing.png`: both tiles racing, per-tile HUD, while the phones are idle.

## Defects found and fixed

- The cue never reached the phone in the real flow (JN3), though the host test passed. The newcomer's tutorial is the
  controller's menu (`Menu{open}`), and it was still open as the countdown began. The host handed the car over in the
  grid's first ticks, and the dropped flag kept it on the autopilot all race, with no cue. Two fixes: only a race hands
  a car over for an open menu (host; the test opens a menu on the grid and closes it before GO, red without the fix),
  and the tutorial closes when the countdown starts (controller).
- The banner showed dark ink on the `.banner` cobalt brush (inline `color` without `--bz-fill`): it now keeps its
  saffron fill (`phone-idle-cue.png` is the after shot).
- "You came 2" now reads "You came 2nd".

## Remaining defects

- The TV doesn't mark an idle or autopilot seat on its tile; `SimEvent::IdleCue` reaches the host page but no tile
  draws it yet. The per-tile HUD (P1-R07, `presence`) is where it belongs.
- `tv-racing.png`: the host's keys drawer (P1-C05) covers tile #1's name chip during a race, and the grid overlay's
  "Join at" chip sits over tile #2 (noted by P1-R07 too).

## Not covered

- Real phones (iOS Safari, Android Chrome): these are Playwright Chromium touch contexts, not devices.
- A backgrounded emulator phone (JN6 covers network loss in Chromium only).
- Portrait phones: the cue uses the same banner as the countdown and results, captured in landscape only.
