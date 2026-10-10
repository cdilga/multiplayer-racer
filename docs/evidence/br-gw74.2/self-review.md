# br-gw74.2 (P1-C07 bug): phone settings in short landscape

## Cause
The "Back to full screen" prompt (z-index 6) shows when full screen is lost mid-race; the settings sheet is z-index 5,
so the prompt sat over the sheet's Steering row and its dismiss X over Reset controls (the owner's screenshot). The sheet
itself already scrolled, but a row cut at the bottom edge with no cue read as broken.

## Defects found and fixed
- Any sheet over the sticks (settings, which has its own full-screen switch; cars; the scanner) hides the prompt; it
  returns when the sheet closes.
- The sheet's bottom edge fades while there's more to scroll to (`data-more`), and the fade goes at the end.

## Tests
- `web/tests/journeys/pt1-settings-short.test.mjs`: 915x412, 844x390, 740x360, 640x300 and 412x915 (Chromium,
  isMobile, DPR 2): every control is scrolled into view and must be on screen and the topmost element at its centre;
  the fade shows exactly when the sheet can scroll and goes at the end.
- `web/tests/journeys/c02b-fullscreen.test.mjs` (eris, loopback WebRTC, real room): with the prompt up mid-race,
  opening settings hides it; saving brings it back.

## Looked at
- `race-fullscreen-lost-settings-915x412.jpg`: the owner's situation (race, autopilot banner, full screen lost):
  no prompt over the sheet; the fade shows Camera distance continues below.
- `settings-915x412.jpg`, `settings-844x390.jpg`, `settings-740x360.jpg`, `settings-640x300.jpg`: two columns,
  the fade at the bottom of the scroll, nothing overlapping.
- `settings-412x915.jpg`: portrait, one column, scrolls.

## Remaining defects
- None seen.

## Not covered
- The owner's Android in Brave with its own URL bar height (the couch test); WebKit.
