# Self-review P1-G07

Chromium on eris (GPU), host fixtures (`chrome.test.mjs`) and a real room with synthetic controllers (`web/tests/journeys/g07-remove-player.test.mjs`, `JJ_G07_RUST=1`). Captures: `lobby-confirm-remove@1080p.png`, `race-confirm-remove@1080p.png`, `race-after-remove@1080p.png`, `confirm-remove@1080p.jpg`.

## Looked at
- `confirm-remove@1080p.jpg`: selecting a lobby card opens "Remove #3 ..." with Remove player / Keep them.
- `menu-race-8@1080p.jpg`, `menu-race-8@phone.jpg`: the pause menu lists every player with a Remove button and their state.
- `menu-race-8@phone.jpg` (412x915, 8 players, paused race, captured by the journey's own phone-host test): QR, Join, Paused with Resume / End round / Disband, then Players 8 with a Remove button on each row; the list scrolls inside the panel so row 8 is half under the panel's edge (scrolling, no cap).
- Confirmation copy in a race says the car leaves at the next tick and the debris stays; points stay in the standings; they can join again as a new player.

## Defects found and fixed
- My journey asserted the wrong seat count after the rejoin (waited for 5, there are 4): fixed in the test; both journey tests pass on eris at 486ab11 with `JJ_G07_RUST=1`.
- The pause menu's list cut a row mid-height at 8 players on a 1080p screen (it scrolls inside the panel; no cap).

## Remaining defects
- The menu's player list scrolls when the room is larger than the panel; a 99-player room needs scrolling (never capped). Not captured at N=99.
- The controller's "The host removed you" screen with Join again is not part of this lane's paths and was not looked at.

## Not covered
- A controller sending RemoveSeat (no such message on the controller protocol; Rust test).
- Remove of a disconnected autopilot seat via real WebRTC; both journeys use synthetic controllers.

## Update 2026-10-08 (the verifier's gaps)
- Standings kept: `g07-remove-player.test.mjs` 'a disconnected (autopilot) seat removed in the Lobby after a round' plays a round (autopilot, `finishRace`), returns to the Lobby, removes Racer 3 and asserts the card goes, no car stands in the Lobby, and the room's standings rows are exactly what they were.
- Debris stays: the mid-race journey takes Racer 2's bumper off first and asserts the same debris is in the world after the removal and no seat owns the car or drives it; the native test `the_host_removes_a_player_mid_race_and_a_rejoin_is_a_new_seat` asserts the removed car's parts are still dynamic bodies. The car's body itself stays in the world, stopped (the host's withdrawal rule until S04c).
