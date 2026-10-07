# P1-C06 visual self-review (tutorial-lite on the phone)

Captured by `JJ_CAPTURE_DIR=<dir> node --test web/tests/journeys/c06-tutorial.test.mjs` on eris (Linux, headless
Chromium, a mobile touch context at 844x390, real host + jj-server + loopback WebRTC), commit 0910517. Chromium only.

## Looked at

- `phone-tutorial-step1.png`: step 1 of 7 "Steer": the card sits large and central over the sticks (R101), with Skip
  tutorial, the two goal chips (Right, Left) and the seven progress dots.
- `phone-tutorial-oi.png`: a later step mid-way, goals ticking as the gesture lands.
- `phone-tutorial-done.png`: "You're ready" with "Let's race" after every control was done.

## Defects found and fixed

- The tutorial never advanced when input came through the session (only touch handlers fed it): the session now
  reports every stick sample (`onSticks`), so touch, tests and anything else that drives the sticks coach alike.
- The Ready button in the tools rendered dark on dark: the brush system sets the slab fill through `--bz-fill`
  (with `!important`), so Ready now sets that (saffron; green once ready).

## Remaining defects

- The goal chips are paper-on-paper inside the card; readable, but flatter than the POC's ticked chips.
- The card covers the middle of both stick zones; gestures still register (the sticks sit under it), but a player
  may hesitate to touch through the card. The POC does the same; watch it at the playtest.

## Not covered

- Portrait, WebKit/iOS Safari, real phones (F08 lane and P1-Q02), and the TV-side prompt on the seat's tile.
