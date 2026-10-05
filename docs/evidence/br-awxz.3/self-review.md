# Self-review br-awxz.3: Scale and browser-chrome defects; iPhone without full screen

Round 4 was one pass across three beads; the full account (viewports, tools, every loop) is
`docs/evidence/br-awxz/self-review.md`. This file lists what was looked at for this bead. Playwright Chromium with
mobile emulation at the owner's bars-showing sizes (412 x 706, 806 x 325, DPR 2.625), one WebKit run; not a device.

## Looked at

- `docs/evidence/br-awxz/frames/tv_index_html_overlays_n_8-412x706.jpg`: portrait with the bars: every tile one scene, no shifted second image
- `docs/evidence/br-awxz/frames/tv_index_html_diagnostics_n_8-806x325.jpg`: diagnostics under the grid, never over a tile
- `docs/evidence/br-awxz/frames/tv_index_html_grid_n_8-1920x1080.jpg`: TV size unchanged
- `docs/evidence/br-awxz/frames/rotate_lobby32_412x706-to-806x325.jpg`: rotation: the LOBBY banner repainted, card 1 visible
- `docs/evidence/br-awxz/frames/rotate_grid-player_412x706-to-806x325.jpg`: rotation: grid player frame and rule follow
- `docs/evidence/br-awxz/frames/tv_index_html_grid-player_at_6-412x706.jpg`: portrait grid player: tiles render, rule fits its panel
- `docs/evidence/br-awxz/frames/tv_index_html_grid-player_at_13-806x325.jpg`: landscape grid player
- `docs/evidence/br-awxz/frames/phone_index_html_gate-806x325.jpg`: gate fits with the bars showing; full screen offered, not required
- `docs/evidence/br-awxz/frames/phone_index_html_gate_fs_0-412x706.jpg`: WebKit, iPhone path: Let's play plus Add to Home Screen
- `docs/evidence/br-awxz/frames/phone_index_html_lobby-412x706.jpg`: controller lobby portrait: car panel no longer over the thumbnails
- `docs/evidence/br-awxz/frames/phone_index_html_race-806x325.jpg`: controller race at the short landscape size
- `docs/evidence/br-awxz/frames/sheet_phone_412x706.jpg`: sheet at 412 px: no horizontal page overflow (innerWidth 412)

## Defects found and fixed

See `docs/evidence/br-awxz/self-review.md`, "Defects found and fixed" (items for this bead are listed there with their
causes and fixes).

## Remaining defects

See `docs/evidence/br-awxz/self-review.md`, "Remaining defects".

## Not covered

The owner's Android phone and a real iPhone (emulation only); the owner's review is the device check.
