# br-nbn2 (P1-C-coach-tray): the tutorial card and the device tray at 844x390

The Launch step's longer copy (R127) makes the tutorial card tall enough that its pager dots sat on the driving
screen's device tray ('#1 This device'). The tray only repeats the strip's own badge when it holds just this device,
so it now steps aside while the card is up. With other players on the device (pads, keyboards), the card stops above
the tray instead (`web/controller/src/sources/sources.css`). `web/tests/journeys/c06-tutorial.test.mjs` asserts at the
Launch step that the card overlaps no tray row (Playwright Chromium on eris, f6133280: 5/5).

## Looked at

- `before-launch-844x390.png` (from P1-FL05): the dots touch the top of the '#1 This device' tray.
- `after-launch-844x390.png`: the same step. The tray is gone, the dots sit clear under the Launch goal, and "Tap Ready
  when you are" shows under the card with nothing touching.

## Defects found and fixed

- The dots on the tray (above).

## Remaining defects

- None seen at this size.

## Not covered

- The several-players-on-one-phone case (the card stops above the tray) is in the CSS but has no capture.
- WebKit; physical phones.
