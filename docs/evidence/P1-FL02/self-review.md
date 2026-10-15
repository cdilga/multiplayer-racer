# Self-review P1-FL02 (gated start callouts, R127)

Captured by `web/tests/journeys/fl02-gated-start.test.mjs` (`JJ_CAPTURE_DIR`), Playwright Chromium with the Mac's native GPU
(`JJ_CHROMIUM_GPU=native`): four real phone pages (915x412 landscape, touch emulation, not a real phone) over loopback WebRTC
to a real host page at 1920x1080 on the local build. Not the preview deploy, not WebKit.

## Looked at
- `tv-countdown.jpg`, 1920x1080, force-started countdown (D not ready): four tiles, cars held on the grid, big countdown numeral, no callout yet. Checked nothing is clipped or covered.
- `tv-early.jpg`, 1920x1080, Davo snapped in the countdown: red "EARLY! NO LAUNCH" billboard over Davo's car, visible in all four tiles (every tile that sees the car), readable at TV distance, sits clear of the countdown numeral.
- `tv-launch.jpg`, 1920x1080, just after GO: amber "PERFECT START!" over Shazza, teal "LAUNCH!" over Mick; no callout over Bazza (did nothing). Nameplates overlap callouts only where cars are bunched (see Remaining).
- `phone-countdown.jpg`, 915x412, countdown: the existing "Get ready" banner is NOT visible (see Remaining).
- `phone-early.jpg`, 915x412, Davo: red "EARLY! NO LAUNCH" in the gap between the sticks, readable, clear of tools and the device tray.
- `phone-b-outcome.jpg`, 915x412, Shazza: amber "PERFECT START!" (test accepts Perfect or Launch for this phone; it was Perfect in every local run).
- `phone-launch.jpg`, 915x412, Mick (snapped about 0.7 s after GO): teal "LAUNCH!".
- `phone-none.jpg`, 915x412, Bazza: no banner, nothing changed, as intended.

## Defects found and fixed
1. First pass: a car launching past another player's camera put a giant "LAUNCH" billboard over that whole tile (`tv-launch` Davo tile). Fix: `LaunchCallouts.fit(camera)` sizes each callout per tile camera (constant on-screen size from 9 to 40 m, shrinking closer); re-captured, the same moment now shows a small callout.
2. First pass: the phone's callout never showed. The landscape round banner sits at `bottom: 10px`, exactly under the bottom device tray (`.hub-tray`, z-index 8), so it was hidden. Fix: a launch callout (`[data-launch]`) sits mid-screen between the sticks above the tray (z-index 9).
3. First TV pass had the Early billboard 7 m wide and cut off by the finish banner; sizing in (1) fixed that.

## Remaining defects
- The existing countdown line "Get ready: N" / "Go!" is hidden behind the device tray in landscape (`phone-countdown.jpg`). Pre-existing, in the round banner and tray CSS (IvoryGorge, br-bbki.13). Not fixed here; needs a bead.
- During a countdown cars creep forward under zero input: about 4 m over a 9.6 s force-start countdown, about 0.7 m/s at the end, same for every car including the one that did nothing (`FL02 travel over the countdown`). The sim holds a car by zeroing its input, so slope or settling rolls it. Needs a bead for the sim owner (WhiteStream).
- Callouts overlap nameplates and each other when cars are bunched on the grid at GO (tv-launch bottom tiles). Readable, but busy.
- `web/tests/journeys/c07-landscape-short.test.mjs` fails in this tree with "844x390: tools run off the screen". It concerns the tools row (IvoryGorge's in-flight button work), not the banner.

## Not covered
- Real phones, iOS Safari/WebKit, the 412x915 portrait and 375x667 phones (only 915x412 landscape was captured), and a laptop 1366x768.
- Before/after a full-screen toggle and resize.
- The deployed preview (local build only).
- First-person camera tiles (all captures were chase tiles).
