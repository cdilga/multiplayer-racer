# br-8qen (P1-R-foldable): host and controller on an unfolded foldable

Owner 2026-10-18: test the "passport size" foldables, a visual check at those sizes and not a design target. An unfolded
Galaxy Z Fold or Pixel Fold reports about 673x841 CSS px portrait and 841x673 landscape.

What runs at both sizes now, in Playwright Chromium and WebKit on eris (a41d3a6c, all passing):

- `web/tests/journeys/r-foldable-host.test.mjs` (new): a real room races with 1, then 2, 3 and 4 seats (each drops in
  mid-race). At both sizes it checks a tile per seat, tiles on the canvas and not overlapping, every tile's HUD on screen
  and no sideways scroll. Then the race finishes and the results screen's rows and buttons are on screen at both sizes.
- `owner-lobby-settings`: the lobby layout checks (strip above the footer and clear of Start race, every picker
  reachable, the caption over no lobby text) and every host-menu section.
- `fl13-buttons`: the Buttons layout in every state (five 48 px buttons, none overlapping the strip, the pod or the steer
  stick, all on screen).
- `c07-settings-sheet`: the opaque Settings sheet and the toolbar on one row.
- `c06-coach-portrait` (673x841): the tutorial card leaves the sticks' homes and the pad in sight.

## Looked at

- `chromium-race-1-tiles-841x673.jpg`, `webkit-race-2-tiles-673x841.jpg`, `webkit-race-3-tiles-841x673.jpg`,
  `chromium-race-4-tiles-673x841.jpg`: one tile fills the screen. Two stack in portrait. Three take a 2x2 with the join
  card in the fourth cell. Four make a 2x2. Every tile has its badge, name, place and lap, and its boost bar. The footer
  roster fits at three; at four in portrait it runs to the right edge.
- `chromium-results-673x841.jpg`, `chromium-results-841x673.jpg`: the four rows, QR and code, the next-race countdown,
  Start next round now and Return to lobby, all whole. In landscape the winner card sits low in the hero panel, with
  empty stripes above it.
- `webkit-lobby-673x841.jpg`, `chromium-lobby-841x673.jpg`: in portrait the QR is above the roster, then the picker
  strip and Start race. In landscape the roster and the strip are on the left, with QR and Start race on the right. Each
  strip is shown scrolled to the picker the check last brought into view.
- `webkit-673x841-held-steer-gas-boost.png`: the Buttons layout in portrait with steer, gas and boost held. Every button
  is clear of the others. The space above the pad is empty.
- `chromium-841x673-tutorial.png`, `webkit-coach-dual-673x841.png`: the tutorial card in landscape is in the middle,
  over the top of the steer zone and clear of the stick. In portrait it is at the top, over the strip.
- `webkit-settings-673x841.png`: the Settings sheet, opaque, at its 455 px width in the middle, with the fade at the
  bottom.

## Defects found and fixed

- None at these sizes. The foldable sizes now sit in the journeys' size lists, so a layout change that breaks them fails
  CI.

## Remaining defects

- With four tiles in portrait, the footer roster reaches the right edge, and the leader's entry is cut at the edge.
- In landscape on the results screen, the winner card sits at the bottom of a mostly empty hero panel. It reads, but the
  panel's space is wasted.
- In `chromium-race-1-tiles-841x673.jpg`, taken in the first second of the race, a second car's front faces the camera
  just ahead of Racer 1. The capture comes from the start grid. I did not look into it further: it is a camera moment,
  not a layout question.

## Not covered

- Physical foldables (no Fold or Pixel Fold here). These are Playwright viewports at DPR 1, not the devices' ~2.6.
- Safari: WebKit here is Playwright's.
- The fold hinge or "tabletop" posture (CSS viewport segments).
