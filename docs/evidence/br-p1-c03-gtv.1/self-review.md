# P1-C03.style self-review (the §11 cards and the join card restyled to the accepted mock)

Captures: `web/tests/journeys/c02-style-compare.test.mjs` with `JJ_CAPTURE_DIR` on eris (Chromium, software GL, commit ba8106e): the accepted phone mock (`art/ui/poc/phone`, frozen as `art/ui/accepted/2026-10-07/poc/phone`) on the left and the real controller on the right of each `pair-<state>-<size>.jpg`, same state, same size (landscape 844x390, portrait 390x844, small 375x667). Reference named: the mock's `CARDS` table and its `ready-to-join` card.

## Looked at
- All fourteen pairs at all three sizes: finding, no-such-room, room-ended, preview-expired, connecting, finding-relay, no-route, ready-to-join, joining, reconnecting, host-gone, host-paused, another-tab, update-needed. For example `pair-no-such-room-portrait-390x844.jpg`, `pair-ready-to-join-landscape-844x390.jpg`, `pair-host-gone-portrait-390x844.jpg`, `pair-another-tab-small-375x667.jpg`, `pair-room-ended-landscape-844x390.jpg`, `pair-host-paused-portrait-390x844.jpg`.

## Defects found and fixed (the first pairs showed these)
- The cards were bare cream boxes with a title and a plain saffron button: no icon circle or spinner, no line under the title, plain rounded buttons, no second button. They now have the mock's icon circle (warn tone for the host-gone), the spinner for the waiting states, the line under the title, the brushed (torn-outline) buttons and the secondary "Scan again".
- The wording differed from the mock (Try another code, Ask the host for a fresh link, Thanks for playing): now the mock's, with its typographic apostrophes.
- The join card was "Room ABCD / Your name"; it is now "You're in ABCD" with the people icon, "Pick a name, then join the race.", the name field with the dice button and Join the race. The kit's `.field` class boxed the whole row in an outline; fixed.
- "Cancel" was drawn as the primary button; it and "Enter a new code" are the quiet button, as in the mock.
- Host paused was a dimmed play screen with a small card; it is the mock's full card with the pause icon.

## Remaining defects
- The room-ended card says "Cheers for playing!" and adds the place only when the controller holds the results (the mock's capture shows "You finished 3rd").
- The join card has an extra "Aussie" button beside the dice (the Australian-name feature, which the mock predates).
- The spinner's start angle differs from the mock's frame (it spins).

## Not covered
- Phones, and the TV size (these are phone pages).
- The mock's lobby car picker and "Get set" gate as separate screens: the car picker is a sheet from the Car button (`docs/evidence/P1-C03/c03-car-*.jpg`), and there is no gate card (the first tap asks for full screen and a wake lock instead).
