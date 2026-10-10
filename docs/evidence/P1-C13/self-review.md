# P1-C13 visual self-review (R119: one join journey)

Captured by `JJ_CAPTURE_DIR=<dir> node --test web/tests/journeys/c13-one-join.test.mjs` (headless Chromium, SwiftShader, emulated
Gamepad API and real key events).

## Looked at

Every image below was opened and looked at (PearlPond re-checked the race chip and the phone portrait).

| Image | What it shows |
|---|---|
| `c13-laptop-carrier-empty.png` | A laptop at the normal join card, nothing pressed: just the card and one hint line (plug in a pad or press a key cluster). No mode, no route. |
| `c13-laptop-carrier-three-seats.png` | The same page after two pads and a key cluster were pressed one at a time, the touch player never tapped in: three rows (seat number in seat colour, kind, state chip, Leave). |
| `c13-laptop-unplugged-row.png`, `c13-laptop-unplugged-state.png` | Pad 1 unplugged: dashed row, dimmed, an orange "Unplugged for Ns" chip and a Remove button; Keys A beside it is still Connected. |
| `c13-laptop-six-sources.png` | Four pads and two clusters (the ported C08 case); a pad that left reads "Left: press to rejoin". The list scrolls inside its panel. |
| `c13-phone-with-pad-landscape.png`, `c13-phone-with-pad-portrait.png` | A phone driving as the touch player (#1 "This device") with a plugged-in pad (#2) listed together in the slim tray between the sticks, with Leave. |
| `c13-phone-pad-unplugged-portrait.png` | The phone's pad unplugged: the tray row shows "Unplugged for 1s" and Remove; the touch player keeps driving. |
| `c13-phone-carrier-dropped.png` | The phone mid carrier drop (network cut). |
| `c13-tv-lobby-unplugged.png` | The TV's lobby: card #1 greyed with "Unplugged 1s", card #2 unaffected. |

## Defects found and fixed

1. The sources panel sat on top of the join card on a laptop (a fixed bottom panel over a centred card), hiding the Join button
   and overlapping the hint. Fixed: off the driving screen the card makes room (`padding-bottom` while rows exist) and the panel
   takes touches so it scrolls.
2. Rows were three lines tall (path and byte counters), pushing the third seat off the page. Fixed: the byte counters are never
   drawn (still in `inspect()`), the path is dropped from the tray; three seats fit.
3. On the phone the state chip and Leave squeezed the labels to "This devi…" and "P…", and "Unplugged for 1s" was clipped in
   portrait. Fixed: on the driving screen the Connected chip is hidden (only exceptions get a chip), the tray is wider (300 px
   landscape, 94% up to 360 px portrait) and its buttons only take touches themselves.
4. The TV's lobby did not repaint while a pad stayed unplugged; its repaint key now includes the unplugged seconds.

## Added after the first review

- `c13-tv-race-unplugged-chip.png`: a real two-car race on the TV, pad 1 unplugged. Its tile carries an orange "Unplugged 4s" chip
  bottom right (beside the boost bar); the keys tile is untouched. Legible at 1280x720 and clear of the car. This closes the
  "Not shown" item above.
- `c13-laptop-add-a-player.png`: "Add a player" tapped on a laptop's join card: the hint becomes a saffron prompt to press a pad
  button or a cluster key, with Cancel. The join card is untouched (no second touch player, R65).

## Remaining defects

- Portrait phone (`c13-phone-with-pad-portrait.png`): the tutorial card is drawn over the "Turn sideways" prompt. It predates this
  bead; filed as br-2cy4.

## Not covered

- Real devices (`ev:owner`): the P1-Q02 checklist row. WebKit and a real TV were not captured.
