# P1-G02 visual self-review

Build: `v0.2-revamp` at c8359d5, run on eris (Linux, Playwright Chromium headless, SwiftShader WebGL; the host
auto-lowered its Render resolution to 50 %) through the real join path: `web/tests/journeys/jn5-churn.test.mjs` with
`JJ_CAPTURE_DIR` (run `g02-jn5m`; earlier runs `g02-jn5a`–`l` found the defects below). TV 1280x720; phones 844x390
landscape touch contexts. Cohort: up to ten phones and the host's two key clusters (12), then down to 2.

Drop-in (`dropin.json`): accepted claim → the car moving under the phone's own throttle, loopback WebRTC, five
mid-race phones: 1284, 1372, 2472, 1785, 1612 ms; p95 2472 ms against the 3 s target. Earlier runs: p95 1753–2076 ms.
The 32-controller run without a cap is the host test
`thirty_two_controllers_churn_through_every_phase_with_no_phantom_seats`.

## Looked at

- `tv-lobby-5.png`: three phones and both key clusters in the Lobby, "5 in the room · 0 ready", QR and code.
- `tv-countdown-6.png`: Kylie joined in the Countdown and has a tile on the grid with the other five.
- `tv-racing-12.png`: twelve tiles, one per car, each HUD over its own car, after five drop-ins and one more phone.
- `tv-racing-after-churn.png`: two phones left and a key cluster sat out; the grid reflowed to nine tiles (3x3), every
  label over its own car.
- `tv-intermission.png`, `tv-shrunk-2.png`: Round complete with twelve rows (the leavers and the sitter with "–"
  places and DNF), unchanged after shrinking the room to two.
- `phone-dropped-in.png`: Jonesy's phone after dropping in mid-race.

## Defects found and fixed

- Seats that left stayed in the room as "away" cards forever (phantom seats): the TV's room view drops them; the
  standings keep their rows.
- A phone that joined in the Countdown got no car until the next round: it takes the next grid slot.
- Mid-race drop-ins had no standings rows (6 rows for 12 racers): they race as late entrants.
- Withdrawn cars kept their tiles (three of twelve tiles chasing nobody): in a room the grid follows the seated cars,
  the HUD maps tiles the same way, and camera choices stay with their car through a reflow.
- After a reflow on a slow host the HUD, frames and join chip stayed on the old 4x3 rects over a 3x3 canvas: the
  grid gives its DOM layers one last layout when it settles; JN5 checks every HUD box sits inside its tile.

## Remaining defects

- The host's keys drawer (P1-C05) covers tile 1's name chip, and the grid overlay's "Join at" chip sits over tile 3
  (also in P1-G03's and P1-R07's reviews).
- The TV doesn't draw the Identify pulse yet (P1-R06): JN5 checks a drop-in's Identify event reaches the host page.
- Lobby cards and results show key clusters as "Player 4"/"Player 5"; that's the cluster's default name.

## Not covered

- Real phones and a real TV; Playwright Chromium contexts on one Linux box, not devices or a LAN.
- Portrait phones, full-screen and resize during churn (JN1 covers resize; JN5 doesn't).
- Pads: the mixed cohort is phones and key clusters; pads join through the same seat path (P1-C05's input test).
