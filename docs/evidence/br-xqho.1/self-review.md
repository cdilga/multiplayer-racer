# Self-review br-xqho.1: QR and positions only in waste, docked otherwise, Join now, QR in the pause menu

Owner review 2026-10-06 (round 5). Playwright Chromium with mobile emulation at the owner's bars-showing sizes (412 x 706,
806 x 325, DPR 2.625) and 1920 x 1080; not a device. Checks: grid-check.mjs ok (252 layouts, now asserting the fill and
the band's arrangement); qr-space-check.mjs ok (rewritten to the round-5 rule: tile area equals the plain filled grid's,
the QR is in the grid when its spare cells fit it and docked otherwise, every player is in the grid list or the footer,
and every QR decodes); check.mjs ok; live-check --tv: every state ok at 412x706, 806x325 and 1920x1080.

## Looked at

- `docs/evidence/br-xqho/grid_n_32-806x325.jpg`: neat 8x4 grid: no spare cell, so the QR and all 32 positions dock in the footer (a ticker)
- `docs/evidence/br-xqho/grid_n_32-1920x1080.jpg`: 7x5 with 3 spare cells: the list takes the run; a scannable QR with Join now needs about 300 px and a cell is about 170, so it docks
- `docs/evidence/br-xqho/grid_n_8-1920x1080.jpg`: 3x3 with one spare cell
- `docs/evidence/br-xqho/paused_n_8-1920x1080.jpg`: the join card (Join now, ROO7, address) beside the pause menu
- `docs/evidence/br-xqho/paused_n_8_sub_join-1920x1080.jpg`: footer QR click: the join card big
- `docs/evidence/br-xqho/paused_n_8_sub_join-412x706.jpg`: the same on a portrait phone host

## Defects found and fixed

- Strips taken from the tiles for the QR (the owner's n=32 screenshot): removed; only spare cells hold chrome.
- Equal-size spare cells were de-duplicated, so the QR and the list could never take two cells: fixed; the run of spare cells is also one region.
- The QR was dropped when the list fit nowhere: QR-only candidates; the priority is QR and list, then QR, then list.
- Docked positions were hidden (the strip's flex basis wrapped it onto the clipped line): flex-basis 0. Badges on the ink footer are filled plainly (an ink outline can't show on ink).
- During a join/leave reflow the new chrome showed over still-moving tiles: it now fades in after the tiles land.

## Remaining defects

- At 1080p a scannable QR (8 px per module, read from the couch) with its label is taller than one grid cell, so at
  many N it docks rather than sitting in a spare cell. That follows the rule; the module minimum or the label size is
  the lever if the owner wants it in the grid more often.

## Not covered

The owner's phone and the TCL (emulation only).
