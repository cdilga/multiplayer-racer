# Self-review P1-R04

Captured with `node art/ui/lib/live-check.mjs --base <local web/dist> --viewports 412x915,915x412,1920x1080,1366x768
--fullscreen` on `/host/?synthetic=12&map&tiles=7` and `/host/?synthetic=24&map&tiles=24` (16 captures), plus TV
captures at N = 1, 3, 5, 10, 13, 25, 27 and 32 compared with the POC mocks (`review.md`). Playwright Chromium
(headless, software GL), not the owner's devices.

## Looked at
- `self-review/matrix-all.jpg`: N = 7 and 24 on four screens, before and after a resize: equal tiles, the same order
  after the resize, paper gutters, spare cells painted, nothing black.
- `self-review/24_map_tiles_1_1920x1080.jpg`: one player fills the screen; the join chip in the corner.
- `self-review/24_map_tiles_13_1920x1080.jpg`: 4×4, then the QR cell, standings and backdrop.
- `self-review/32_map_tiles_32_1920x1080.jpg`: 7×5, code (address), standings, backdrop and the chip.
- `self-review/12_map_tiles_7_412x915.jpg` (phone portrait host): two columns stacked, the QR in the eighth cell.
- `self-review/12_map_tiles_7_915x412_after-resize.jpg` (phone landscape after resize): 4×2, QR cell.
- `r04-vs-poc-1080p.jpg`: the six POC mock sizes side by side with the host.

## Defects found and fixed
1. At N = 32 the join address in the small code cell was clipped ("127.0.0.1:8731/controll"): it wraps, smaller.

## Remaining defects
- At full grids (no spare cell) the join chip sits over the bottom-right player's tile, as the accepted pseudocode
  says; whether that's the right trade is a taste call for the owner at G-DESIGN.
- Tiles have no borders, names or positions yet (P1-R06/R07); the standings cell has only its title (P1-R07).

## Not covered
- The reflow animation is unit-tested (`grid.test.mjs`) but not captured as video.
- 21:9 and 4K captures: the kernel is tested on both; not captured in a browser here.
