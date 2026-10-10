# br-gw74.1 (P1-R06 bug): Identify on every press; a see-through phone flash

## Cause
Each round builds a new sim (`reset_world`) whose tick restarts at 0. The host fed that tick to the seat reducer, which
keeps the highest tick it has seen, so the seats' clock froze after every round start until the new round's tick caught
up with the Lobby's. The Identify limit is measured on that clock, so the second press in a race was refused (the
journey reproduced it: race press 1 shown, press 2 lost, press 3 shown). Fixed with a seats clock that never resets
(`Host::session_tick`). Also: the limit is now 1 s (anti-spam only), a respawn's own flash no longer uses up the
player's press, and a host pad's leave chord (which holds Identify) doesn't flash.

## Tests
- `crates/jj-wasm-host` `identify_answers_every_press_after_a_long_lobby_and_a_round_start` (fails on the old clock).
- `crates/jj-session` `identify_rate_limit_table` (1 s; a respawn doesn't use the press).
- `web/tests/journeys/pt1-identify-repeat.test.mjs`: three presses 3.5 s apart in the Lobby and in a race, with a
  second player's press between; every one reaches the host and pulses the tile in the race (Mac, Playwright Chromium).
- `web/tests/journeys/c02-controller.test.mjs` "the Cooee flash is see-through and both sticks keep driving under it".

## Looked at
- `c02-identify-flash.jpg`: 844x390 landscape phone (Chromium, isMobile), tutorial open, flash fading: sticks, tools
  and the card all visible under the wash.
- `c02-identify-flash-driving.jpg`: same, both thumbs down: the DRIVE knob is visibly pushed up under the flash and the
  STEER stick is held; "Cooee #12" still reads.

## Defects found and fixed
- The flash was an opaque wall of seat colour over the sticks: now a 30 % wash with a softer white burst (peak 55 %).

## Remaining defects
- None seen. Seat 12's light blue chip reads lighter than a dark seat colour would; it keeps its ink border, so it stays
  legible.

## Not covered
- A real phone (the owner's Android at the couch test); WebKit for the new flash test (that harness test runs Chromium
  only); reduced motion (unchanged: no wash, held label).
