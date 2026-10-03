# Self-review br-u02-grid-visual-phone-d4g (P1-U02 bug: grid visual layout broken on a phone viewport)

The TV grid (`art/ui/poc/tv/#grid`) on phone-sized hosts and a TV. Checked with the new
`node art/ui/poc/tv/grid-phone-check.mjs`: Playwright Chromium and WebKit (Playwright's build, not Safari) with mobile
emulation (touch, DPR 2.625) at 360x800, 390x844 and 412x915 in portrait and landscape, and 1920x1080, for 1, 4, 12, 24
and 40 players: 70 cases, all pass (`grid-phone-check.json`). Per case: no two tiles intersect, every HUD box is inside its
tile, tiles and empty cells stay in the grid area, the grid covers 90.4-99.3% of the usable viewport (>= 90%), and the
footer's host controls are wholly on screen. Also run: `grid-check.mjs` (252 layouts), `hud-states-check.mjs` (1705
tiles), `resize-check.mjs`. Emulation only; the owner saw the bug on an Android phone in Brave.

## Looked at
Every case's screenshot, as contact sheets (rows: Chromium, WebKit; columns: 1, 4, 12, 24, 40 players):
- `sheet-360x800.jpg`, `sheet-390x844.jpg`, `sheet-412x915.jpg`: phone portrait. Tiles one or two or more per row,
  HUD inside every tile, the footer's Pause, Fullscreen and Menu all on screen, the room line ellipsised.
- `sheet-800x360.jpg`, `sheet-844x390.jpg`, `sheet-915x412.jpg`: phone landscape: the grid fills the width, the footer
  keeps its readouts where they fit.
- `sheet-1920x1080.jpg`: the TV, unchanged layout.

## Defects found and fixed
- The page's tile and grid geometry already passed this bead's matrix before this change (the same check run on the
  pre-change files: 70/70 for overlap, HUD-inside and coverage). What the matrix didn't measure was broken: on every
  portrait phone the footer pushed Fullscreen and Menu off the right edge (and Pause too at 360 wide), so a phone host
  couldn't reach full screen or the menu; the page hides overflow, so no check noticed. The new footer-controls assertion
  fails 30 cases on the old files and none now. The host controls never shrink; the join line (ellipsis) and the wordmark
  give way first; on a narrow footer Pause/Resume shows its icon (label kept for screen readers).
- Loop 2: the middle readouts (race, leader, clock) showed as clipped fragments ("eader", "e · Lap") on narrow footers.
  A readout now shows whole or not at all, re-fitted when it or the space changes size (late fonts, resizes).
- Loop 3: the readout band was shorter than the Leader pill (which holds a badge), clipping its bottom border; fixed.
- Android Chromium (Brave included) may boost text sizes by itself; the page now opts out (`text-size-adjust: 100%`),
  since the HUD is sized to its tiles.
- From br-dim.2 (same files): every viewport change (browser bars, rotation, full screen) now re-lays out the grid and
  the world together, and the HUD at small tiles was fixed in br-dim.5.

## Remaining defects
- In WebKit the footer's join QR renders as a black square at phone sizes (it's about 24 CSS px there, too small to scan
  in any browser). QR sizing is br-u02-qr-list-space-jdc; noted there.
- With one player in portrait the single tile is a landscape-shaped box with the standings and the join card above and
  below it: the grid rule's playable aspect band at work, not a bug, but it may be what read as "a small box in a big
  blank area". The owner's call at G-DESIGN.

## Not covered
- The owner's phone (Android, Brave). The device-only symptoms (tiles drawn twice, the whole grid in a small box)
  didn't reproduce in emulation before or after; the fixes target the likely causes (viewport changes without a resize
  event, text boosting, footer overflow). The owner re-checks on the phone at G-DESIGN.
