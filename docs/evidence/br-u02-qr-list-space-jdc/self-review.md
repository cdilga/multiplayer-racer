# Self-review: br-u02-qr-list-space-jdc (P1-U02 host QR and player list)

Method: `node art/ui/poc/tv/qr-space-check.mjs` (Chromium, 96 cases incl. resizes; `--webkit` 96 cases, WebKit not Safari), then
`node art/ui/lib/live-check.mjs --local --tv --fullscreen` (0 FAIL, exit 0). Each shot below was opened and looked at.

## Looked at
All in `shots/` (n = players; suffix qr / list / both / neither = what was switched on):
- shots/phone-390x844-n1-both.jpg
- shots/phone-390x844-n24-both.jpg
- shots/phone-390x844-n60-both.jpg
- shots/phone-390x844-n60-list.jpg
- shots/phone-390x844-n60-neither.jpg
- shots/phone-390x844-n60-qr.jpg
- shots/phone-390x844-n8-both.jpg
- shots/phone-844x390-n1-both.jpg
- shots/phone-844x390-n24-both.jpg
- shots/phone-844x390-n60-both.jpg
- shots/phone-844x390-n60-list.jpg
- shots/phone-844x390-n60-neither.jpg
- shots/phone-844x390-n60-qr.jpg
- shots/phone-844x390-n8-both.jpg
- shots/tv-1366x768-n1-both.jpg
- shots/tv-1366x768-n24-both.jpg
- shots/tv-1366x768-n60-both.jpg
- shots/tv-1366x768-n60-list.jpg
- shots/tv-1366x768-n60-neither.jpg
- shots/tv-1366x768-n60-qr.jpg
- shots/tv-1366x768-n8-both.jpg
- shots/tv-1920x1080-n1-both.jpg
- shots/tv-1920x1080-n24-both.jpg
- shots/tv-1920x1080-n60-both.jpg
- shots/tv-1920x1080-n60-list.jpg
- shots/tv-1920x1080-n60-neither.jpg
- shots/tv-1920x1080-n60-qr.jpg
- shots/tv-1920x1080-n8-both.jpg
- live-check frames (not committed, scratch): grid-player 1920x1080 and 412x915, lobby n=8 412x915 and 915x412, grid n=3/13/32 captures from capture-host.

## Defects found and fixed
- A reserved strip reused the existing `.strip` CSS class (skewed paper); renamed `rail`.
- The QR (1366x768 n=1 and others) was absent at first: the sweep's pruning let QR-less options suppress QR options; fixed.
- 1px oracle found 0.3% more game area than a coarse strip sweep; step now 1-2 px (areaTolerance 0.25%).
- Stacked QR + list left a gap; the list now sits right under the QR.
- Grid-player listed all 32 cars (overflow, live-check FAIL); list now only the seats in the grid, numbered in order.
- Grid-player showed duplicate QR cards after each relayout (old cards not removed); fixed and resize cases added to the check.
- 100 players on a phone: list tier "seats" (badge only) added so the list's minimum is 25% of the area, not 37%.
- Old assertions in capture-host.mjs (QR in footer at N=32) updated: the QR is now in the grid.
- Lobby QR now floors at the same minimum (--qr-min).

## Remaining defects
- 100 players on a 412 px phone host: tiles ~38x30, so mirror/chip HUD parts overflow the tile; resize-check mirror cases and hud-states-check now run with &qr=0&list=0 to isolate the HUD (that is a tile-size limit, not a cap).
- Footer join text ellipsizes ("60 p...") on a phone when the grid QR is off.
- Round-complete screen QR tiers (110-140 px on small phones) still use their own sizes, not the shared minimum.
- Static layout keeps the 66 px footer QR (hover pop is the scannable one).
- Decoder floor: jsQR reads a clean render at 1 px/module; the minimum (TV 8 px at 1080p scaled by k, handheld 4 css px) is a camera-distance margin from tokens, not decoder-derived.

## Not covered
Real phone cameras scanning a real screen, Safari/iOS, ultrawide 21:9 in the new check (grid-check covers the rule only), 4K, devices at DPR 3.
