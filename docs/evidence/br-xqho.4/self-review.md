# Self-review br-xqho.4: Brushed tiny chips; grid-player and duplicate demos retired

Owner review 2026-10-06 (round 5). Playwright Chromium with mobile emulation at the owner's bars-showing sizes (412 x 706,
806 x 325, DPR 2.625) and 1920 x 1080; not a device. Checks: grid-check.mjs ok (252 layouts, now asserting the fill and
the band's arrangement); qr-space-check.mjs ok (rewritten to the round-5 rule: tile area equals the plain filled grid's,
the QR is in the grid when its spare cells fit it and docked otherwise, every player is in the grid list or the footer,
and every QR decodes); check.mjs ok; live-check --tv: every state ok at 412x706, 806x325 and 1920x1080.

## Looked at

- `docs/evidence/br-xqho/results_n_32-806x325.jpg`: tiny result cells as brushed dabs
- `docs/evidence/br-xqho/lobby_n_150-806x325.jpg`: tiny lobby cells as brushed dabs
- `docs/evidence/br-xqho/gallery-412x706.jpg`: the gallery: one link per screen, no dead links, no style frames, the lobby at 16 as the lead

## Defects found and fixed

- #grid-player (a second grid with the rule text) redirects to #grid&n=32&reflow=1: the real host layout as players join and leave.
- Dead gallery links (host puck, End or Disband, input drawer, old caption kinds) replaced by current states; the round-0 style frames (an old lobby among them) removed from the gallery; results and intermission listed once; the motion reel labelled as timings with stand-in screens.

## Remaining defects

- At 1080p a scannable QR (8 px per module, read from the couch) with its label is taller than one grid cell, so at
  many N it docks rather than sitting in a spare cell. That follows the rule; the module minimum or the label size is
  the lever if the owner wants it in the grid more often.

## Not covered

The owner's phone and the TCL (emulation only).
