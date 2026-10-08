# P1-C09 visual self-review (Credits and licences page)

Captured by BrownCreek (verifier) on the Mac, headless Chromium, through `web/tests/journeys/c09-credits.test.mjs` with
`JJ_CAPTURE_DIR=docs/evidence/P1-C09` against the built landing site served at `/` (4 tests pass; no off-origin request,
no horizontal overflow at any size). Chromium, not a device.

## Looked at

- `credits-tv-1920x1080.png`: title "Credits and licences" in the brush display type, a "Back to Joystick Jammers" button, then
  paper cards with saffron tabs (The team, Inspirations, Fonts) on the dotted desert backdrop. Text is large and readable.
- `credits-phone-portrait-390x844.png`: same cards in one column; nothing is cut off; the back button is reachable at the top.
- `credits-phone-landscape-844x390.png`: one column, scrolls; no overflow.
- `credits-fonts-licence-open-390x844.png`: the Fonts card with the full SIL Open Font Licence opened in a mono block.
- `credits-licences-phone-portrait-390x844.png`: reference sources with their licences, the shader-kit credit, and the
  third-party licence tables (3 browser packages, 264 Rust crates) with the "choice of licence" note.
- `credits-resized-back-1280x720.png`: after a resize from phone back to 1280x720 the layout reflows to the wide cards.

## Defects found and fixed

- The page under `/p/<id>/` loaded no script (asset links not rewritten two folders down): fixed in 1d1bf2b1 before this review;
  the journey now covers both `/` and `/p/c09/`.

## Remaining defects

- The licence text's dashed rule lines wrap on a 390 px phone (`credits-fonts-licence-open-390x844.png`); cosmetic.
- The TV capture ends mid-card because it is a viewport shot; the page scrolls (the full length is looked at on the phone shots).

## Not covered

- Real phones and iOS Safari; WebKit rendering of the page; the host-menu link's look on a TV host (the journey proves the link opens the page).
