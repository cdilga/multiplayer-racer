# P1-U06 visual self-review

Captured with a Playwright script (Chromium) against the real jj-server build (landing) and the kit test build (kit page); the
kit page and landing were each shot at the four sizes, then resized in place.

## Looked at

- `landing-phone-390x844.jpg`: Join first, brushed Join and Host buttons, kicker tags, scan button. Fine.
- `landing-phone-landscape-844x390.jpg`: both panels on one screen, brushed buttons readable.
- `landing-tv-1920x1080.jpg` and `landing-tv-4k-3840x2160.jpg`: same layout and proportions at both (TV profile scales with output height); slab outline weight matches the panel outline.
- `landing-phone-390x844-resized-844x390.jpg` and `landing-tv-1920x1080-resized-1366x768.jpg`: after a resize the buttons repaint to the new size and the profile switches (TV to desk) with no stale shapes.
- `kit-tv-1920x1080.jpg`, `kit-tv-4k-3840x2160.jpg`: every button row and state; focus rings (cobalt, saffron with chevron tab) wrap slab and shadow.
- `kit-phone-390x844.jpg`, `kit-phone-landscape-844x390.jpg`, `kit-phone-390x844-resized-844x390.jpg`, `kit-tv-1920x1080-resized-1366x768.jpg`: whole kit page: buttons, ink surface, long labels, 40 chips, seat badges up to #2048, captions (saffron, ink, teal, flat one-line, two-line clamp), the three paper QR sizes, toasts, motion tables in Full and Reduced.
- `kit-desk-full.png`, `kit-desk-reduced.png` (desk profile, full page), `qr-tv.png`, `qr-handheld.png`.
- `kit-compare.json`: per-button pixel comparison with the POC sheet (all 63 crops inside tolerance).

## Defects found and fixed

- Toasts on the kit page were invisible (paused enter animation); the kit page now shows them static.
- Quiet button pressed and disabled looked different from the sheet (missing rules); added.
- Kit page background was ink to the right of the content; page background set to paper.
- Neighbouring buttons' shadows bled into the gamepad-focus crops; grid row gap widened.
- Icon-only button row was missing from the kit (sheet has nine rows); added.

## Remaining defects

- The kit page is 1580 px wide by design (the state grid), so it scrolls sideways on a phone; it is a test page, not a shipped screen.
- Toasts, panels and roster cards still use the plain bordered style, not the brush skins (installBrushSkins builds the `row` and `panel` skins; the C/R beads apply them per screen).
- The spinner in a loading button differs in angle from the sheet's still; the compare tolerance absorbs it.

## Not covered

- Real phones and Safari/WebKit (Chromium only); gamepad focus driven by a real gamepad (forced with the class).
- The identify flash animation was not viewed in motion, only wired (opacity-free brightness tween; Reduced holds an outline).
- Hover/pressed driven by real pointer events (forced states only on the kit page; the landing buttons were not pressed).
