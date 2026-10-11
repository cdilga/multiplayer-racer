# P1-G01 · Results button stability (br-61po)

CI 3492/browser 5 and CI 3498/browser 6 reproduced the existing 30-second Playwright click timeout.
Local measurement found the same Start node moving from x=841.3 to x=842.6 as countdown digits changed width.
The narrow results footer put the timer and Start in a flex row, so intrinsic timer width moved the button.
Fixed the timer's footprint and tabular numerals; no force-click or click-timeout change.

The real roster-churn journey holds the worker clock only during setup, then resumes live time before clicking.
This prevents software rendering from consuming the entire intermission while the test builds its churn fixture.
The click still uses ordinary Playwright actionability and its existing 30-second timeout.

Results reserve room for Keys & Pads and announcer captions. Compact footers keep QR and actions adjacent;
the QR retains whole modules with a minimum four CSS pixels per module. Portrait results use a 46/54 split,
keeping a dominant replay near half the display while two placings stay readable with a two-line caption.
A ResizeObserver refits standings when the caption changes available space.

Focused layout checks: 5 pass (`../P1-R09/results-layout.log`), including all rows at 1/2/8/32/99, stable Start
bounds for countdown values 60 through 1, and >=12px two-player text beside a 64px caption band.
The same final UI is judged in `../P1-R09/{chromium,webkit,live-check}` and its self-review.
The real two-phone one-lap round-loop journey also passes in 161.222 seconds (`round-loop.log`), including the ordinary
Start next round now click that failed in CI 3498. An earlier concurrent local run missed its 5-second Identify pulse
wait before reaching results; the isolated rerun above passes. No Identify timing or wait was changed.
CI and deployed visual review remain pending; this is local evidence, not a close receipt.
