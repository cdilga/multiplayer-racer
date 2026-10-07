# Self-review P1-R04.3

Captures from `web/host/tests/grid-dock.test.mjs` (fixture rooms `host/?roundfixture=race-N`, the real host build) on eris,
Playwright Chromium headless, software WebGL, at commit 2f59650 (run dir `~/Work/runs/style1`). Emulated viewports, not
the owner's TV or phone. Reference: the accepted round-5 grid (art/ui/accepted/2026-10-07/poc/tv, grid states;
docs/evidence/br-xqho/grid_n_8-1920x1080.jpg).

## Looked at

- `race-4-1920x1080.jpg`: 4 racers, 2x2, no spare cell: tiles reach every edge and the footer; the footer carries the paper QR, the code and all four positions in order. No band anywhere.
- `race-9-3840x2160.jpg`: 4K, 3x3, no spare cell: same at native size; footer QR and the nine positions (a ticker: the row is wider than the space, it scrolls and nothing is cut).
- `race-8-1920x1080.jpg` (Mac Chromium, recaptured after P1-R04.style's QR-cell fix): 3x3 with one spare cell: the QR card has the cell, the footer has no QR, the positions dock in the footer (seat 7 has left the race, so seven entries).
- `race-2-915x412.jpg`: phone landscape, 2 side by side, both full height; footer QR and positions.
- `race-3-412x915.jpg`: phone portrait, 3 stacked, every tile the full width; the narrow footer shows the QR and scrolls the positions (the ticker, masked at the edges).
- `race-25-1920x1080.jpg`: 25 racers, 5x5, no spare cell: tiles equal, edge to edge; every racer in the footer ticker.
- `race-8-resized-1366x768.jpg`: race-8 opened at 1920x1080 and resized to 1366x768: the grid re-fills the new size with the same 3x3, the QR cell keeps its tile size (this capture predates P1-R04.style's fix, so the QR card still sits on the stray saffron oval).

## Defects found and fixed

- The first CI run (1677) failed the chrome footer test: the footer hid the room count outside a race, because the positions element had no count until the first race update. It starts at `data-count="0"`.
- The first dock test measured the HUD boxes (inset from the tiles) and failed at 4K; it now reads the kernel's own tile rects through the fixture hook.
- The resize test read element handles one at a time and caught the overlay mid-rebuild (null box); it now reads every cell in one evaluate.

## Remaining defects

- On a portrait phone the footer is narrow, so the positions ticker shows two or three entries at a time; nothing is cut (they scroll), but they're small. The footer's layout belongs to P1-R07.

## Not covered

- Real TV, laptop and phone hardware; WebKit (host tests run Chromium only).
- A live room (these are fixture rooms through the real host build; the tiles, HUD and footer are the production code).
