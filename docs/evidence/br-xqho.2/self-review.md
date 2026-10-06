# Self-review br-xqho.2: The grid fills the screen

Owner review 2026-10-06 (round 5). Playwright Chromium with mobile emulation at the owner's bars-showing sizes (412 x 706,
806 x 325, DPR 2.625) and 1920 x 1080; not a device. Checks: grid-check.mjs ok (252 layouts, now asserting the fill and
the band's arrangement); qr-space-check.mjs ok (rewritten to the round-5 rule: tile area equals the plain filled grid's,
the QR is in the grid when its spare cells fit it and docked otherwise, every player is in the grid list or the footer,
and every QR decodes); check.mjs ok; live-check --tv: every state ok at 412x706, 806x325 and 1920x1080.

## Looked at

- `docs/evidence/br-xqho/grid_n_3_layout_static-806x325.jpg`: n=3 static on a phone: no bands above or below
- `docs/evidence/br-xqho/grid_n_32-806x325.jpg`: n=32 fills edge to edge

## Defects found and fixed

- The band clamp left paper bands (the owner's n=3 static screenshot): the band now picks the arrangement and the race grid fills (grid.js fill).

## Remaining defects

- At 1080p a scannable QR (8 px per module, read from the couch) with its label is taller than one grid cell, so at
  many N it docks rather than sitting in a spare cell. That follows the rule; the module minimum or the label size is
  the lever if the owner wants it in the grid more often.

## Not covered

The owner's phone and the TCL (emulation only).
