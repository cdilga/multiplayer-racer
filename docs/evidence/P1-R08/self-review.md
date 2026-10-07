# Self-review P1-R08

Chromium (Playwright) on eris, GPU (`JJ_CHROMIUM_GPU=1`), fixture room views (`host/?roundfixture=`) and real rooms with synthetic controllers (`web/tests/journeys/r08-phone-host.test.mjs`). Phone runs are viewport + deviceScaleFactor emulation, not a device; the real phone host's frame rate is a P1-Q02 row. Captures: `web/host/tests/phone-host.test.mjs`, `web/host/tests/chrome.test.mjs`.

## Looked at
- `portrait-phone-host.jpg` (412x915 DPR 2, 4 players): four stacked tiles, badge/name top-left, place+lap top-right, boost bar bottom-left, footer (Pause, code, Diagnostics) under the tiles; nothing overlaps.
- `landscape-phone-host.jpg` (915x412): 2x2 grid centred with paper side margins, footer with code, domain, count, Diagnostics and logo.
- `menu-race-8@phone.jpg`, `diagnostics-race-8@phone.jpg`: the pause menu fits the phone (list of eight with Remove), the diagnostics overlay sits above the footer.
- `lobby-8-footer@phone.jpg`, `results-8-footer@phone.jpg`: lobby and results end above the footer; Start race and Return to lobby are reachable.
- `results-8-caption@phone-landscape.jpg`: caption, QR card and buttons share the right column without overlap.
- `ultrawide-host-race-8.jpg`, `ultrawide-host-lobby-32.jpg`, `ultrawide-host-results-8.jpg` (3440x1440; the test also runs 5120x1440): captured, covered by the layout assertions.

## Defects found and fixed
- Tiles reached the bottom edge, so the footer covered the last row: caught by the "clear of the footer" assertions (phone-host, r08 journey, chrome); fixed by the lead in `render/world.ts` (grid display rect stops above `.jj-foot`). All three pass after it.
- Profile buttons in the phone menu clipped "Auto (handheld)": buttons now size to their text and wrap.
- Footer text descenders were clipped (line height 1): 1.35.

## Remaining defects
- On a phone in portrait the footer drops the count, domain and logo (too wide); the lobby head and the QR still show them.
- Desk and handheld multipliers (0.85 and 1) are starting values, not measured on real screens.
- Tiles on a 360 px phone have small HUD text (handheld floor 13/24 of TV size); needs a real-phone read in P1-Q02.

## Not covered
- Real phone frame rate; a real device's fullscreen and wake lock (the menu button exists; the API is user-gesture gated and Chromium headless grants nothing); iOS Add to Home Screen hint not captured (no iOS UA run). No WebKit run. The DPR 2/3 backing-store assertions ran in Chromium emulation, and the "cap named" branch is untested because no cap was hit.
