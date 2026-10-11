# br-2mxa self-review: learner assists and gentle catch-up (R125)

Updated 2026-10-11 by CyanBridge. Journey: `web/tests/journeys/br-2mxa-assist.test.mjs` (Playwright Chromium and WebKit on the Mac, refreshed WASM, loopback WebRTC, real jj-server). These are browser viewports, not physical devices.
Sim fixtures: `crates/jj-sim/tests/assist.rs` with `scenarios/assist/*.json` (selected-package native test build at opt level 1, greybox loop, Cruz Missile).

## Looked at

- `phone-settings-assist-off-844x390.png`, `-some-844x390.png`, `-lots-844x390.png`: the "Driving help" row in Settings, each level selected (the highlighted segment follows the choice), landscape phone.
- `phone-settings-assist-some-390x844.png`: the same sheet in portrait.
- `tv-lplate-some-1280x720.png`, `tv-lplate-some-1920x1080.png`, `tv-lplate-lots-1280x720.png`: the host tile in the race, a white "L" plate with a red L beside the name pill.
- `tv-lplate-off-1280x720.png`: the same tile after the phone sets Off, no plate.
- Fresh Chromium versions of all the above are in `frames/` as JPGs. Every image was inspected.
- `frames/lobby-catchup-light-1280x720.jpg`: lobby Off/Light control, default Light, outside Start/QR.
- `frames/phone-tutorial-driving-help-844x390.jpg`: completion suggests Driving help; both actions fit above the device row.
- `frames/webkit-tutorial-driving-help-667x375.jpg`, `-915x412.jpg`, `-375x667.jpg`: short landscape, large landscape and upright completion; both actions readable and reachable.
- `frames/webkit-settings-assist-lots-375x667.jpg`: WebKit learner-help row, Lots selected. Final modal capture inspected: the full row stays above the device tray.

## Defects found and fixed

- First capture: the Driving help hint ran three lines in the narrow span and its last line spilled below the row's torn border (landscape and portrait). Fixed: shorter hint and the row wraps so the segmented control sits on its own line (`.assist-row` in settings.css). Re-captured; no clipping in either orientation.
- First journey run failed resizing a fullscreen phone page; the journey now exits fullscreen before each resize (same as c07).
- Completion's extra paragraph and stacked actions clipped Let's race on a short landscape phone. Copy is shorter and actions share a row; the journey checks their bounds within the coach and stick area.
- The fixed device tray appeared above Settings and obscured the lower row border. Settings now has a higher stacking level; its actions are checked with hit testing.
- Applying catch-up every host tick overwrote fixture journals and broke native/WASM parity. The lobby choice now applies once at GO and remains stable while stepping.

## Remaining / not covered

- Some and Lots show the same plate (the L); the level shows only in its tooltip. Looks fine at 1280x720 and 1920x1080; a tile in a dense 24-grid was not captured (the plate scales with the HUD unit like the name pill).
- The tutorial now suggests Driving help and opens Settings; the lobby now offers Off / Light and defaults to Light. Both choices are exercised through the real UI.
- Published-preview verification and real-device/iOS Safari were not run yet. WebKit completion and Settings checks pass separately from the Chromium race/L-plate journey.
- Driving feel with assists on was measured by the sim fixtures, not played.

## Current fixture numbers (2026-10-11, opt level 1, greybox loop 615 m, 2 laps, six seeds, scripted novice)

Novice: throttle pinned, steering 0.8 of pure pursuit plus seeded random-walk noise (amplitude 0.4), presses Recover after 3 s stuck.

| Level | Finished 2 laps | Crashes (wrecks + recoveries), 6 seeds | Mean time |
|---|---|---|---|
| Off | 0 / 6 (120 s fixture observation window) | 88 | n/a |
| Some | 6 / 6 | 18 | 88.4 s |
| Lots | 6 / 6 | 0 | 74.8 s |

Catch-up (both cars Lots, follower released 10 s behind at the 20 m/s reference, one lap): Off, gap 200 m to 370 m, lap 50.41 s; Light, gap 200 m to 349 m, lap 48.82 s. Catch-up closed 21.3 m (1.06 s at reference speed, 1.6 s of lap time) over the lap; follower force scale 1.0600, top speed 28.9 to 31.0 m/s. The leader's pose and velocity at 45 s are bit-identical with catch-up on and off, and its scale is exactly 1.0.

Flip: Lots uprights a car on its roof in 283 ticks, the plain assist in 392 (about 0.9 s sooner).
