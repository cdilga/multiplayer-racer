# P1-U02.2: TV mocks rework (equal tiles, one-line HUD, Cooee flash)

The owner's POC round 1 items POC1-04, 05, 06, 07 and 14 (`docs/playtests/poc-2026-10-03.md`; rulings R95, R99,
R100), on the live mock at `https://jammers-preview.dilger.dev/poc/tv/` (deployed by `poc-deploy.yml` on push).

**Machine and browser:** the Mac (Apple M1 Pro), Chromium 151.0.7922.34 from Playwright, channel chromium with the GPU
flags. This is Chromium, not Safari and not the TV. Run `node art/ui/poc/tv/capture-grid.mjs`; it writes `report.json`,
`captures/`, `identify/` and `identify-flash.webm`.

## What changed, with why

| Item | Change | Why |
|---|---|---|
| POC1-04 grid | `grid.js`: for each row count R, take C = ⌈N/R⌉ columns, one tile size for all in whole pixels, clamped to the 1.2–2.0 aspect band. Keep the largest tile; ties go to fewer empty cells. The C×R block is centred and filled in reading order. | R95: every player tile has exactly the same area at any N. The old rule gave short rows wider tiles: at N = 5 it was 634×527 above 954×534, and at N = 10 it was 474×354 above 634×354 (`P1-U02/capture-report.json`). |
| POC1-04/05 leftovers | The C×R − N empty cells sit at the end of the last row, each exactly a tile. In the first cell or margin that fits it goes a scannable QR (296 px at 1080p), then the standings. With no room for a QR, the room code and address go in instead, ahead of the standings: joining comes first. Everything else gets the dotted paper backdrop. | Whole cells keep the QR at the side of the players, big enough to scan. Nothing is black and no tile is larger. |
| POC1-06 HUD | Every pill is one line high (1.5 em). Position and lap share one pill on one line. Text is 7.5% of the tile height, from 16 to 32 px × the screen scale. Below about 230×140 px the name drops out. | The 32-tile HUD was too large: two-line position pill, 24 px floor, position ≥ 32 px. It now scales down with the tile. This drops below the TV's 24 px text minimum for the per-tile HUD only, and the owner judges the result at the review. |
| POC1-07 Identify | "Cooee #N" sits over a transparent, high-exposure flash in the seat colour: backdrop brightness ×2.2 and saturation ×1.6 over the 3D, plus a seat-colour wash with a hot centre. Attack is fast, decay takes 1.4 s, 1.5 s in all. The flash sits under the HUD. **Reduced motion** holds the wash at 60% for the same 1.5 s with no tween and no scale. | R99. Kept under the HUD, the pills stay readable while it plays. |
| POC1-14 name plates | No plates over cars on the per-player grid. The off-screen "your car" arrow and the Identify outline stay. Plates remain on the Overview. | R100 |

## Acceptance

| AC | Result |
|---|---|
| POC1-04: every tile the same area for N = 1..40 and larger N (5, 10, 25, 26, 27, 32 included; 24 right); leftovers QR, standings or captions, never black, never a larger tile | **CI:** `grid-check.mjs` (`checks` job) covers 252 layouts: N = 1..40, 64 and 99 on 1080p, 4K, 21:9, 5:4, 1366×768 and a portrait phone. In every one, all tiles are the same whole-pixel size (max/min area = 1), sit in the aspect band and in reading order, and every empty cell is exactly a tile placed after the last tile. Tiles, cells and margins cover the screen exactly once. A broken copy (one tile 40 px wider at N = 5) fails it on all six screens. **Rendered** (`report.json` `grid`): at 1080p for all 42 N, every `.tile` element and every 3D viewport is one size (ratio 1). Sampling every 6 px (57,600 points per N), 0 points fell outside a tile, a filler or a gutter line. N = 24 stays 6×4 (314×260 tiles). N = 25 is 5×5 with no gaps. N = 26 and 27 are 6×5 with 4 and 3 empty cells (standings, code, backdrop). N = 32 is 7×5 with 3 (standings, code, backdrop). |
| POC1-05: the join QR to the side stays | The QR fills an empty cell beside the players at N = 3, 5, 7 and 10 (`fillerRoles` `cell:qr`; `captures/1080p/grid_n=3.jpg`, `grid_n=5.jpg`, `grid_n=10.jpg`). Where no cell fits a scannable QR (at 1080p from N = 13), the room code and address take the first empty cell, ahead of the standings. At N = 2 they go in a margin. With no spare cell (N = 1, 4, 6, 8 … 64, 99) the corner chip carries the join. Every N has a way to join (`report.json` `fillerRoles`, `joinChip`). |
| POC1-06: at 32 tiles the layout is right and the HUD smaller, every pill one line and scaling down | 32 tiles at 1080p: 268×210 tiles, 16 px HUD text, tallest pill 28.9 px (13.8% of the tile). All 99 HUD pills measure one line high, including autopilot, reconnecting, wreck and identify (`report.json` `hud`). At 8 tiles the text is 26.6 px on 634×354 tiles. Captures: `captures/*/hud_n=32_base=100.jpg` at 1080p, 21:9 and 5:4. |
| POC1-07: "Cooee #N" over a transparent, high-exposure colour flash, tweened; a reduced-motion variant | **Full motion:** the label reads "Cooee #3". Flash opacity is 0, 0.91, 1, 0.87, 0.71, 0.11, 0.01, 0 at 0, 60, 120, 250, 500, 900, 1300 and 1500 ms; the label pops in and scales. **Reduced:** the flash holds 0.6 with the same transform from 0 to 1300 ms, then 0 at 1500 ms. Frames: `identify/full-*.jpg`, `identify/reduced-*.jpg`. Video: `identify-flash.webm`, 1280×720, two replays. |
| POC1-14: name plates only on Derby/Overview | Visible plates on the grid `overlays&n=8`: 0. Plates on `overview&n=8`: 8. |

No page errors and no failed requests in any run. The anti-narrowing clause stands: the owner reviews each item on
the live POC, and the next POC round record carries the verdict.

## Known gaps

- The per-tile 3-2-1 (`countdown&n=8`) is still round 0. R99 makes it one full-screen overlay, which is P1-U05.2's
  job, along with the motion reel's identify. The reel keeps the old burst style until then.
- `art/ui/tokens.json`'s `identify-pulse` text still describes the old burst. P1-U01.3 owns the tokens.
- The HUD's 16 px floor at 1080p is a proposal for the owner to judge from the couch; it hasn't been measured on the TV.
