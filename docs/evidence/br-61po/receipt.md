# P1-G01 · Results button stability (br-61po)

CI 3492/browser 5 and CI 3498/browser 6 reproduced the existing 30-second Playwright click timeout.
Local measurement found the same Start node moving from x=841.3 to x=842.6 as countdown digits changed width.
The narrow results footer put the timer and Start in a flex row, so intrinsic timer width moved the button.
Fixed the timer's footprint and tabular numerals; no force-click or click-timeout change.

The real roster-churn journey holds the worker clock only during setup, then resumes live time before clicking.
This prevents software rendering from consuming the entire intermission while the test builds its churn fixture.
The click still uses ordinary Playwright actionability and its existing 30-second timeout.

Results reserve room for Keys & Pads and announcer captions. Compact footers keep QR and actions adjacent;
the QR retains whole modules with a minimum four CSS pixels per module. Portrait results use a 44/56 split,
keeping a dominant replay near half the display while two placings stay readable with a two-line caption.
A ResizeObserver refits standings when the caption changes available space.

Focused layout checks: 5 pass (`../P1-R09/results-layout.log`), including all rows at 1/2/8/32/99, stable Start
bounds for countdown values 60 through 1, and >=12px two-player text beside a 64px caption band.
The same final UI is judged in `../P1-R09/{chromium,webkit,live-check}` and its self-review.
The real two-phone one-lap round-loop journey also passes in 161.222 seconds (`round-loop.log`), including the ordinary
Start next round now click that failed in CI 3498. An earlier concurrent local run missed its 5-second Identify pulse
wait before reaching results; the isolated rerun above passes. No Identify timing or wait was changed.
Deployed Chromium/WebKit journeys on preview `v02-cc9b2c81` passed, but the image review found
375x667 WebKit standings squeezed by the denser pinned-preview QR plus captions. The same long
join URL reproduced 10.2703px text in the focused test. The 44/56 split fixes that case without
reducing the unchanged >=12px assertion or removing placings/QR/actions.

The revised focused checks pass 5/5 (`long-preview-qr/layout.log`). Revised real-controller
journeys pass Chromium (80.87s) and WebKit (18.48s), asserting >=12px rows at every viewport and
fullscreen attempt. All 32 journey images and four dense-QR live-check images were inspected
individually; the latter reserve 64px caption space without rendering caption text.
The correction is now in deployed preview v02-04a9054b, containing green CI3583. Final Chromium
and WebKit real-controller journeys pass (131.65 s / 22.84 s), keeping >=12px rows, stable Start
bounds, retained identities and round-two behavior. The deployed no-replay and dense-QR/64px-caption-reservation
live-check matrices pass before/after resize. All 40 final images were visually inspected in labelled
sheets and small-phone WebKit typography at original size; see ../P1-R09/deployed-final/ and self-review.md.
