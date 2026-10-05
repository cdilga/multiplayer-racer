# Self-review br-awxz.1: Brushed button variant and the component sheet

Round 4 was one pass across three beads; the full account (viewports, tools, every loop) is
`docs/evidence/br-awxz/self-review.md`. This file lists what was looked at for this bead. Playwright Chromium with
mobile emulation at the owner's bars-showing sizes (412 x 706, 806 x 325, DPR 2.625), one WebKit run; not a device.

## Looked at

- `docs/evidence/br-awxz/frames/sheet_buttons_1600.jpg`: 1600 x 900: every button variant x state; brushed slabs and the compact plain variant
- `docs/evidence/br-awxz/frames/sheet_phone_412x706.jpg`: phone emulation: the sheet readable, the state grid scrolls sideways in its section
- `docs/evidence/br-awxz/frames/tv_index_html_lobby_n_2-412x706.jpg`: Start race as a slab (no slip inlay)
- `docs/evidence/br-awxz/frames/tv_index_html_paused_n_8-1920x1080.jpg`: pause flow: Resume and the secondary actions as slabs
- `docs/evidence/br-awxz/frames/tv_index_html_results_n_8-806x325.jpg`: host buttons on the round screen, gamepad ring on Start next round
- `docs/evidence/br-awxz/frames/phone_index_html_gate-806x325.jpg`: controller buttons, black shadow on ink
- `docs/evidence/br-awxz/frames/phone_index_html_lobby-806x325.jpg`: Ready slab at the short landscape size

## Defects found and fixed

See `docs/evidence/br-awxz/self-review.md`, "Defects found and fixed" (items for this bead are listed there with their
causes and fixes).

## Remaining defects

See `docs/evidence/br-awxz/self-review.md`, "Remaining defects".

## Not covered

The owner's Android phone and a real iPhone (emulation only); the owner's review is the device check.
