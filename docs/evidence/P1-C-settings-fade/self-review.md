# br-0lua (P1-C-settings-fade): nothing shows through the phone's Settings sheet

The sheet's "more below" fade was a `mask-image` that took its bottom 40 px down to 15 % opacity, and its background was
97 % opaque, so the Lobby's "Tap Ready when you are" banner and the device tray ghosted through. Now the sheet is fully
opaque and the fade is a sticky strip at the foot of its scroll area painted in the sheet's own navy
(`web/controller/src/app/controller.css`).

`web/tests/journeys/c07-settings-sheet.test.mjs` (Playwright Chromium and WebKit on eris, f03ef2d2, 2/2): Settings
opened over the Lobby at 844x390, 915x412, 375x667, 412x915 and 667x375; the sheet's background is opaque and it has no
mask; the toolbar's icon buttons share one row and no labelled button is squeezed.

## Looked at

- `chromium-settings-844x390.png`: landscape, the controls panel and the action column; at the bottom edge Steering and
  Sit out / Leave room fade into the sheet's navy, with no banner text behind them.
- `webkit-settings-915x412.png`: the same at 915 wide in WebKit; Sit out and Leave room fade into navy.
- `webkit-settings-375x667.png`: the smallest portrait; the Driving help row fades at the foot into navy, no tray.
- `chromium-settings-412x915.png`: portrait, the full list down to "Full screen, screen on", which fades into navy.

## Defects found and fixed

- The see-through fade and the slightly see-through sheet (above).

## Remaining defects

- At 375 and 412 wide the Controls segment wraps "Two sticks" and "One stick (old)" onto two lines inside its buttons
  (readable, a little cramped).
- On a narrow phone the toolbar is two rows by design: Ready and Identify above the six icons. Nothing wraps alone.

## Not covered

- Physical phones; Safari (WebKit here is Playwright's).
