# Self-review P1-G07

Chromium on eris (GPU), host fixtures (`chrome.test.mjs`) and a real room with synthetic controllers (`web/tests/journeys/g07-remove-player.test.mjs`, `JJ_G07_RUST=1`). Captures: `lobby-confirm-remove@1080p.png`, `race-confirm-remove@1080p.png`, `race-after-remove@1080p.png`, `confirm-remove@1080p.jpg`.

## Looked at
- `confirm-remove@1080p.jpg`: selecting a lobby card opens "Remove #3 ..." with Remove player / Keep them.
- `menu-race-8@1080p.jpg`, `menu-race-8@phone.jpg`: the pause menu lists every player with a Remove button and their state.
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
