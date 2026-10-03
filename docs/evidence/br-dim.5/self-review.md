# Self-review br-dim.5 (P1-U: Reconnecting chip and the boost indicator never stack)

The TV tile HUD (`art/ui/poc/tv/`, `#hud`). Checked with the new `node art/ui/poc/tv/hud-states-check.mjs` (Playwright
Chromium on a Mac: 5 screens × 13 player counts = 65 layouts, 885 tiles, from 1914x986 down to 99x81; `#hud&states=matrix`
cycles every seat through status none/Autopilot/Reconnecting × Wrecked × boost empty/full, so every combination appears
at every tile size; per tile, the boost bar, status chip, position/lap pill, number/name and Wrecked overlay must not
intersect and must stay inside the tile: 0 failures, `hud-states-check.json`) and `node art/ui/lib/live-check.mjs --local
--fullscreen` at 1920x1080, 1366x768, 412x915 and 915x412 over `#hud&n=8`, `#hud&n=32&base=100`,
`#hud&n=12&states=matrix`, `#grid&n=99` and `#identify&n=32&seat=12` (20/20 ok). Emulation, not the owner's TV.

## Looked at
- `hud-states-1920x1080-n12.jpg`: all twelve combinations at 474x324 tiles: boost bar bottom-left, Autopilot or
  Reconnecting chip bottom-right on the same line, Wrecked between the rows; empty and full boost bars both read.
- `hud-states-1920x1080-n40.jpg`: 234x192 tiles: full chip words still fit beside the bar.
- `hud-states-1366x768-n32.jpg`: laptop host, 193x137 tiles: the same, nothing touching.
- `hud-states-915x412-n24.jpg`: phone landscape host: small but clean.
- `hud-states-412x915-n12.jpg`: phone portrait host, 202x140 tiles.
- `hud-states-412x915-n40.jpg` and `hud-states-412x915-n40-zoom.jpg`: 99x81 compact tiles: icon-only chips in their
  colours, a compact "Wrecked!" over "3 s", nothing overlapping.
- `hud-default-1920x1080-n8.jpg`: the normal `#hud` state (Autopilot, Reconnecting, Wrecked, first-person mirror).

## Defects found and fixed
- The status chip sat above the boost bar (stacked). The tile's bottom row is now one flex row: boost bar left, status
  chip right, centred on one line, so they can't stack.
- Loop 1: the matrix check failed on a phone-portrait host at 32 and 40 players (133x74 and 99x81 tiles): the big
  Wrecked overlay covered the bottom row. Compact tiles now hug the edges with their rows, show the chip as its icon
  (the word moves to the label, as compact tiles already drop names), and draw Wrecked as a smaller word over "3 s".
- live-check reported every 3D page's world canvas as "blank: one flat colour", on the deployed preview too: it read the
  WebGL canvas back after the browser had cleared its drawing buffer. A flat read is now re-judged from a screenshot of
  the canvas's visible area (tested: a blank WebGL canvas still fails, a drawn one and the TV world pass).

## Remaining defects
- None in this bead. At 99x81 the "3 s" pill is small; that size only occurs with 40 players on a phone-sized host.

## Not covered
- The owner's TV and phone: Chromium emulation only. The deployed preview is checked after the push.
- The first-person mirror's display error is br-dim.2, not this bead.
