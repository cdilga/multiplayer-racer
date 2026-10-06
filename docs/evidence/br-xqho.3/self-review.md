# Self-review br-xqho.3: Pause menu settings scope and a pad player's own settings

Owner review 2026-10-06 (round 5). Playwright Chromium with mobile emulation at the owner's bars-showing sizes (412 x 706,
806 x 325, DPR 2.625) and 1920 x 1080; not a device. Checks: grid-check.mjs ok (252 layouts, now asserting the fill and
the band's arrangement); qr-space-check.mjs ok (rewritten to the round-5 rule: tile area equals the plain filled grid's,
the QR is in the grid when its spare cells fit it and docked otherwise, every player is in the grid list or the footer,
and every QR decodes); check.mjs ok; live-check --tv: every state ok at 412x706, 806x325 and 1920x1080.

## Looked at

- `docs/evidence/br-xqho/paused_n_8-1920x1080.jpg`: camera and distance moved out of This room into Each player's own; laps locked
- `docs/evidence/br-xqho/padsettings_n_8_seat_3-1920x1080.jpg`: a pad player's settings over their own tile, their car on autopilot
- `docs/evidence/br-xqho/padsettings_n_32_seat_12-412x706.jpg`: the same on a tiny tile: the title and hint drop, the card stays inside

## Defects found and fixed

- The pause card ran into the footer at 1080p with the new row: its footnote is gone (End and Disband name their consequences).
- The pad card's caption strip rendered as a scrap at tile size: plain text.
- On tiny tiles the card spilled out of the tile: a container query trims it.

## Remaining defects

- At 1080p a scannable QR (8 px per module, read from the couch) with its label is taller than one grid cell, so at
  many N it docks rather than sitting in a spare cell. That follows the rule; the module minimum or the label size is
  the lever if the owner wants it in the grid more often.

## Not covered

The owner's phone and the TCL (emulation only).
