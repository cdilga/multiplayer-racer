# P1-C06 visual self-review (tutorial-lite on the phone)

Captured by `JJ_CHROMIUM_GPU=1 JJ_CAPTURE_DIR=<dir> node --test web/tests/journeys/c06-tutorial.test.mjs` on eris
(Linux, headless Chromium, a mobile touch context at 844x390, real host + jj-server + loopback WebRTC), commit c79d8a4
(run `c06-c`). Chromium only. Rewritten after the fresh-eyes review (`fresh-eyes.md`, FAIL on the earlier captures).

## Looked at

- `phone-tutorial-step1.png`: step 1 of 7 "Steer": the card sits large and central (R101), Skip tutorial top right,
  the Right/Left goal chips and seven progress dots; Ready (saffron) in the tools row.
- `phone-tutorial-step1-won.png`: both goals ticked: green chips "✓ Right", "✓ Left" and the green "Nice! On to the
  next one" strip.
- `phone-tutorial-step2.png`, `phone-tutorial-step3-boost.png`, `phone-tutorial-step4-drift.png`, `phone-tutorial-oi.png`, `phone-tutorial-step6-cone.png`,
  `phone-tutorial-step7-wheelie.png`: each step's title, plain instruction, goal chip and progress dots (done steps green).
- `phone-tutorial-oi-ticked.png`: "✓ OI!" green with the strip.
- `phone-tutorial-done.png`: "You're ready" with "Let's race".
- `phone-tutorial-help-again.png`: Help reopens the tutorial at step 1.
- `phone-tutorial-before-skip.png`, `phone-tutorial-skipped.png`: Skip on step 2 closes the card at once; the play
  screen shows "Tap Ready when you are".
- `phone-ready-pressed.png`: Ready pressed after skipping; the lone player's round starts ("Go!").

## Looked at (TV side, added after the second fresh-eyes review)

- `tv-prompt-go-and-stop-1280x720.png`: the race has started and the host has already seen the seat steer both ways, so its tile shows "2/7 GO AND STOP, Left stick up to drive, back to brake" with the goal chips Go and Brake, in a paper caption low in the tile above the boost meter; the car and the road stay clear.
- `tv-prompt-boost-1280x720.png`: Go and Brake seen, the caption moves on to "3/7 BOOST".
- `tv-prompt-late-joiner-steer-1280x720.png`: a second phone joined a race already running; its tile (blue, #2) shows "1/7 STEER" with no card on the phone.
- `tv-no-prompt-after-skip-1280x720.png`: the player skipped in the lobby; the same race has no caption on the tile.

## Defects found and fixed
- No TV-side prompt: the host now tracks the seven controls per seat from what it sees (`host/prompts.rs`, protocol 5 `Tutorial{on}`, `room_json` seat `prompt`) and the seat's tile shows the next one, clearing it as it is seen; skip or finish hides it, Help repeats it, a newcomer who joins a race gets it with no card.
- A card closed by the race starting (not by Skip or finishing) used to count as done and was remembered; it is no longer remembered, and the host's prompts carry on over the car.

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

## Not covered

- Prompts on a TV tile at 4+ players, and the compact (small tile) caption, are not captured; the compact rule only hides the sentence.
- Portrait, WebKit/iOS Safari and real phones (F08 lane and P1-Q02).
