# Self-review P1-R04.style

The grid's spare cells against the accepted set (art/ui/accepted/2026-10-07/, poc/tv grid states; the round-5 capture
docs/evidence/br-xqho/grid_n_8-1920x1080.jpg): the join cell, the Players cell, the dotted paper backdrop. Captures are
fixture rooms (`host/?roundfixture=race-N`) through the real host build, Playwright Chromium. The final three are from
the Mac (one local Chromium, a probe script in the session scratchpad, after the fix below); the "before" is from eris.

## Looked at

- `before-fix-race-7-1366x768.jpg` (eris, 2f59650): 3x3 with two spare cells: the Players card was right (every racer in race order, kit badges), but the QR card sat on a big saffron oval.
- `race-7-1366x768.jpg`: after the fix: QR cell is the kit's paper QR card under a saffron "Join now" strip with the code and address; the next cell is the Players card; both cells keep the paper-line frame and dotted paper.
- `race-8-1920x1080.jpg`: one spare cell: the QR card, sized to whole device pixels per module, centred; the positions dock in the footer (P1-R04.3).
- `race-7-3840x2160.jpg`: 4K: the QR card and the Players card scale with the cell; type and badges legible; the card has room to spare at seven players (it grows type up to its cap, never past the cell).

## Defects found and fixed

- The saffron oval behind the QR card: host/index.html already styles `.jj-join` (the renderer's unsupported-browser card), and the new cell wrapper reused the name. Renamed to `.jj-qrcell`.

## Remaining defects

- The accepted mock puts the player list in the one spare cell and the QR in the footer at N=8; production keeps its rule (first spare cell: the QR, next: the Players card, else dock in the footer), which joins faster and matches P1-R04.3's contract. Flagged for the owner's playtest rather than changed.
- The footer itself (room line, Pause, logo) is still P1-R07's plain bar, not the accepted footer; that's R07's look.

## Not covered

- Real devices, WebKit; a live room's Players card mid-race (fixture positions only).
- A cell too small for a scannable QR ("Join at" code and address): no fixture case produced one at these sizes.
