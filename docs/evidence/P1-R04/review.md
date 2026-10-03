# P1-R04 · Fresh-eyes review: host grid vs the current POC TV mocks

**Reference:** the P1-U02.2 TV mocks at 1080p (`docs/evidence/P1-U02.2/captures/1080p/grid_n=*.jpg`, the R95
equal-tile rule in `art/ui/poc/tv/grid.js`). **Compared:** the host's grid (`web/host/src/layout/grid.ts`, drawn by
`host/?synthetic=<cars>&map&tiles=<N>`) at 1920×1080, side by side in `r04-vs-poc-1080p.jpg`, both opened at gameplay
size. This is a layout match against the current POC; the accepted-set match is P1-R04.style, behind G-DESIGN.

| N | POC | Host | Match |
|---|---|---|---|
| 3 | 2×2, last cell: join QR card | 2×2, last cell: join QR | rows, cols, tile size, gap cell and role |
| 5 | 3×2, last cell: join QR card | 3×2, last cell: join QR | same |
| 10 | 4×3, then QR card, standings | 4×3, then QR, standings | same |
| 25 | 5×5 full, join chip in the bottom-right corner | 5×5 full, join chip bottom-right | same |
| 27 | 6×5, then code card, standings, backdrop | 6×5, then code (address), standings, backdrop + join chip | same cells and roles; the host also shows the chip, since no cell is big enough for a QR |
| 32 | 7×5, then code card, standings, backdrop | 7×5, then code, standings, backdrop + chip | same |

**Elements present:** equal tiles in join order, paper gutters and spare cells (never black), the join QR or address in
the first spare cell, standings in the next, the join chip when no cell holds a QR.
**Absent by design (other beads):** the seat-colour tile borders and name/position pills (P1-R06/R07 HUD), the room
code "R007" and its address (rooms are P1-N03/G00; the QR points at the join page until then), the standings' rows
(P1-R07), the comic look (P1-R10, P1-R04.style).
**Ambiguous:** none in the layout. **First look:** reads as the same grid as the mock at every N.
**Defect found and fixed:** at N = 32 the code cell clipped the join address ("…/controll"); it wraps now.
