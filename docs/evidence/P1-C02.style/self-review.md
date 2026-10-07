# P1-C02.style self-review (the play screen restyled to the accepted mock)

Captures: `web/tests/journeys/c02-style-compare.test.mjs` with `JJ_CAPTURE_DIR` on eris (Chromium, software GL, commit e6f5abe or later): the accepted phone mock (`art/ui/poc/phone`, frozen as `art/ui/accepted/2026-10-07/poc/phone`) and the real controller side by side, left and right of each `pair-*.jpg`, at the same size. Reference named: the mock's `race` and `tutorial` states.

## Looked at
- `pair-race-landscape-844x390.jpg`, `pair-race-portrait-390x844.jpg`, `pair-race-small-375x667.jpg`: side by side.
- `pair-lobby-play-landscape-844x390.jpg`: the lobby play screen with the tutorial card against the mock's tutorial.

## Defects found and fixed (before and after each in the earlier pairs)
- The tools were seven text buttons wrapping onto a second line, with Leave alone; now Identify with its icon and label and icon-only camera, recover, help, settings and leave, as in the mock.
- The place read "P3" next to the lap; now "3rd" in the display face over "Lap 2/3".
- The ACTION knob was an empty cream square; it carries the bolt as in the mock.
- The connection badge showed "Reconnecting…" on a page with no link; it hides when there is nothing to report.
- Identify's flash used the wrong class so the accepted flash styling never applied; it is now the mock's (seat-colour wash, "Cooee #N" chip, "That's you on the TV").

## Remaining defects
- The mock's pod shows cone and front-slot wells and "Cone ready"; the controller has the boost meter only (no item or cone state on the HUD yet).
- The mock's menu button is replaced by the individual Help, Settings and Leave icons (the journeys and the wire tests press them directly).
- The tutorial card's "Step 1 of 7" tag is plain ink text, where the mock draws it as a torn saffron tag (the C06 card, left alone here).
- Name in the strip is empty on these captures because the state opener has no name unless `&name=` is given; with one it sits beside the number.

## Not covered
- Real phones and the TV size (the controller is a phone page).
- The Android and iOS emulators: the accepted-set comparison was made in Chromium.
