# br-zhuw (P1-G-lobby-short): the host lobby on a short screen

The lobby's strip under the roster (each host-pad or key seat's car picker and its controls legend) didn't shrink, and the
lobby clips its overflow: at 915x412 the pickers and the KEYS legend ran under the footer bar, and in portrait the second
picker's line ran under Start race. The strip now takes at most half the roster column and scrolls there. And the
announcer's welcome caption ("Welcome, mate! Scan the code, pick your car and give it a burl.") covered lobby text in
WebKit: the lobby now stops above the caption's painted height while it shows (the announcer's `--jj-caption-space`, as
the results screen already did). Both in `web/host/src/round/round.css`.

`web/tests/journeys/owner-lobby-settings.test.mjs` (Playwright Chromium and WebKit on eris, b6aa6ba8, 2/2) now asserts at
412x915, 915x412, 375x667, 1920x1080 and 1366x768: the strip ends above the footer and clear of Start race, scrolling
brings each picker's top and bottom into view, and the caption covers no lobby hint, picker or roster card.

## Looked at

- `webkit-lobby-915x412.jpg`: the three roster cards, the #1 picker (Car 2 of 6, Tradie Ute, Use vehicle, Ready) and the
  top of the KEYS A legend, all above the footer; the rest scrolls inside the strip. QR, Start race and its hints on the
  right.
- `chromium-lobby-412x915.jpg`: portrait: QR, the roster, both pickers, then Start race and its hints below them with
  nothing overlapping.
- `webkit-lobby-375x667.jpg`: the smallest portrait: the roster in two columns, the #2 picker in the strip (scrolled
  there by the previous size's check; #1 is above it), Start race clear below.
- `chromium-lobby-1366x768.jpg`: laptop: unchanged, both pickers and the KEYS A and PAD legends whole above the footer.

## Defects found and fixed

- The strip running under the footer and into Start race; the caption over lobby text (above).

## Remaining defects

- At 915x412 the strip is short: a picker and its legend need a scroll to see together.
- No caption showed while these captures were taken (it's on a timer); the caption check runs whenever one is up.

## Not covered

- Physical devices; Safari (WebKit here is Playwright's).
