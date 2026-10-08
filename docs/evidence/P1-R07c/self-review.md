# P1-R07c self-review: a joiner is seated while the race is paused

The fix is in `crates/jj-wasm-host/src/host.rs`. While the sim is held (a pause or the resume countdown, never a fault),
`Host::advance` runs `session_while_paused`. It applies queued controller commands that only join or dress a seat:
Hello, Claim, Identify, SetName, Ping, Pick, Menu, SetCamera, SetCameraDistance and Tutorial. These apply on the host's
clock, and no tick is stepped. Leave, Sit out and Ready move the round director, and Recover and Action move a car, so
they wait for the resumed tick. The car comes from the seat reducer's `CarAdded` on the first tick after Resume, which
is the late-join placement, and the seat goes into the round's cohort and its `late` list.

- Native test: `a_claim_while_paused_is_welcomed_and_seated_and_places_at_resume` (`crates/jj-wasm-host/src/host/tests.rs`).
  A claim made while paused gets Welcome and a seat with no car. The tick, the state hash, the pause mask (Manual) and
  the phase (Running) are all unchanged. A Ready sent during the pause doesn't apply. After Resume the seat has a car and
  is a late entrant. Run through RCH; the whole `jj-wasm-host` suite passes with `--all-features`, and clippy `--tests`
  is clean.
- Journey: `web/tests/journeys/r07b-join-card.test.mjs` on eris (run `bc-r07c-2` at fb81fc61, with the wasm rebuilt;
  Chromium, loopback WebRTC). A phone joins from the decoded QR while the race is paused. It shows its play screen as
  #6 before Resume, the host's room view and the join card count it ("6 in the room"), the pause holds, and the sim tick
  doesn't move. After Resume its car is placed. `g07-remove-player` and `c09-credits` still pass after the menu change.

## Looked at

- `phone-915x412-joined-while-paused.jpg`: the joiner's phone during the pause, seated as #6 Davo, with the sticks and
  tools up.
- `tv-1920x1080-join-big-after-phone.jpg`: the TV's join card during the same pause, reading "6 in the room". The
  footer's standings don't list Davo yet: no car until Resume.
- `tv-1920x1080-pause-menu.jpg`: the tidied pause menu at 1080p. It has two columns: the menu (Resume, End round, Disband
  room; Display; Players) and the join card with "Join in", the URL and Credits. All six players are in the first
  screen, and the journey asserts that no row falls below the panel's fold.

## Defects found and fixed

- With the join card in the menu, the player list started below the fold at 1080p. That held first with Credits in the
  action rows, then with a CSS grid whose spanning card stretched the rows. Now the menu and the join card are two flex
  columns, Credits sits under the card, and the player rows are a notch tighter.
- The all-modes journey ran past its time limit on a loaded runner (run 2087). It now decodes the QR at the TV and
  handheld scales per size, and has 12 minutes.

## Remaining defects

- The joiner's phone shows its normal play screen during the pause, not "Host paused". HUDs while paused only go to
  seats with a car. The phone can't drive until Resume anyway.

## Not covered

- A hidden-host pause (the tab in the background) with a joiner. The same code path handles it, but it was not
  captured.
- Real phones over the LAN or TURN.
