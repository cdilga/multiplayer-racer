# P1-C06 visual self-review (tutorial-lite on the phone)

Captured by `JJ_CHROMIUM_GPU=1 JJ_CAPTURE_DIR=<dir> node --test web/tests/journeys/c06-tutorial.test.mjs` on eris
(Linux, headless Chromium, a mobile touch context at 844x390, real host + jj-server + loopback WebRTC), commit c79d8a4
(run `c06-c`). Chromium only. Rewritten after the fresh-eyes review (`fresh-eyes.md`, FAIL on the earlier captures).

## Looked at

- `phone-tutorial-step1.png`: step 1 of 7 "Steer": the card sits large and central (R101), Skip tutorial top right,
  the Right/Left goal chips and seven progress dots; Ready (saffron) in the tools row.
- `phone-tutorial-step1-won.png`: both goals ticked: green chips "✓ Right", "✓ Left" and the green "Nice! On to the
  next one" strip.
- `phone-tutorial-step2.png`, `-step3-boost.png`, `-step4-drift.png`, `-oi.png`, `-step6-cone.png`,
  `-step7-wheelie.png`: each step's title, plain instruction, goal chip and progress dots (done steps green).
- `phone-tutorial-oi-ticked.png`: "✓ OI!" green with the strip.
- `phone-tutorial-done.png`: "You're ready" with "Let's race".
- `phone-tutorial-help-again.png`: Help reopens the tutorial at step 1.
- `phone-tutorial-before-skip.png`, `phone-tutorial-skipped.png`: Skip on step 2 closes the card at once; the play
  screen shows "Tap Ready when you are".
- `phone-ready-pressed.png`: Ready pressed after skipping; the lone player's round starts ("Go!").

## Defects found and fixed

- The tutorial never advanced when input came through the session (only touch handlers fed it): the session now
  reports every stick sample (`onSticks`).
- The Ready button rendered dark on dark: it sets the brush fill (`--bz-fill`, saffron; green once ready).
- Ticked goal chips and the "Nice!" strip rendered paper on paper (blank chips in the fresh-eyes review): the chip sets
  `--bz-fill` to the success green, and the strip has a plain green fill.
- An open tutorial is the controller's menu (G03): it now closes when the countdown starts, so nobody starts a race
  on the autopilot.

## Remaining defects

- The card covers the middle of both stick zones; gestures still register under it (as in the POC), but a player may
  hesitate to touch through the card. Watch it at the playtest.
- The tutorial has no TV-side prompt on the seat's tile yet.

## Not covered

- Portrait, WebKit/iOS Safari and real phones (F08 lane and P1-Q02).
