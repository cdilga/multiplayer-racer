# P1-G01 visual self-review

Build: `v0.2-revamp` at d8e07b9, run on eris (Linux, Playwright Chromium headless, host drawing through ANGLE Vulkan
on the RTX 2080 Super) through the real join path: `web/tests/journeys/jn3-round-loop.test.mjs` with `JJ_CAPTURE_DIR`
(run `r06-h`; the same journey also runs on SwiftShader in CI). TV 1280x720; phones 844x390 landscape touch contexts.
Cohort: two phones (Davo, Shazza), a 1-lap round raced by the test surface's autopilot, then the next round.

## Looked at

- `tv-lobby-empty.png`: Lobby with nobody in it, "0 in the room · 0 ready", the QR, room code and address; Start race
  is drawn as unavailable and the hint says how to join.
- `tv-lobby-two-players.png`, `tv-lobby-one-ready.png`: two cards; Davo's turns green "Ready", Shazza's "Choosing
  car…"; the header counts 2 in the room, 1 ready; Start race is live, with "Everyone ready starts the race on its own".
- `tv-countdown.png`: both cars on the grid in their seat colours, two tiles with their HUD, the big "3".
- `tv-racing.png`: the race on two tiles.
- `tv-round-complete.png`: Round 1 complete: Shazza 1st (1:02.12, +30), Davo 2nd (1:03.40, +23), the winner card,
  "Next race in 60 s", Start next round now and Return to lobby.
- `phone-lobby-not-ready.png`: the phone in the Lobby with Ready and the newcomer's tutorial open.
- `phone-countdown.png`: "Get ready: 3" on the phone.
- `phone-results.png`: "You came 2nd · 23 points" (see P1-G03's review for the banner fixes).

## Defects found and fixed

- The round screens sat under the drawer's stacking context and their brush buttons were unpainted (moved to the body,
  painted with the kit).
- The Ready button ignored its fill (dark on dark): it uses the brush fill variable.
- The phone's results banner said "You came 2"; it now says "2nd".
- The host's keys drawer covered tile 1's name and place on the grid and in the race: it folds to a "Keys & pads" pill
  at the bottom centre in the Countdown and while racing (fixed after these captures; `tv-countdown.png` still shows
  the drawer open).
- Tiles lost their seat-coloured border after a reflow (`--seat` was dropped when the HUD was placed); fixed with R06.

## Remaining defects

- The audio caption strip at the bottom centre overlaps the results QR card's address line (`tv-round-complete.png`).
- Before GO the tiles' HUD already shows "1st/2nd, Lap 1/1" (grid order), not a neutral pre-race state.
- The lobby has no crane view of the track behind the cards (P1-R07's remaining defect).

## Not covered

- Real phones and a real TV; these are Playwright Chromium contexts on one Linux box.
- Portrait phones and resize/full-screen during the round loop (JN1 covers resize).
- More than two players through the loop: JN5 (P1-G02) covers 12 through every phase.

## Update 2026-10-08
This bead gained journeys only (no new screens): the new tests capture no extra images. See the journey files named in the commit; the Looked at list above still describes the screens.
