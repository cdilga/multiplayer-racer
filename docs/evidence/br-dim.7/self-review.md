# Self-review br-dim.7 (round complete + highlights, one screen)

Tools: Playwright Chromium (macOS, Metal GPU), phones emulated (isMobile/hasTouch), not a real device. Measurement:
`node art/ui/poc/tv/merged-check.mjs --shots` (video share, every player shown, no overlap, no unused block over one button
row, nothing clipped; fresh load per case). Sweep: `node art/ui/lib/live-check.mjs --local --tv --fullscreen --viewports
412x915,915x412,820x1180,1366x768,1920x1080`: 270 ok, 0 FAIL (all TV states, incl. lobby/pause). `capture-rounds.mjs`: PASS.

Merged, not two states: `#results` and `#intermission` open the same screen (both asked the same of the TV; the replay is the
fun of round complete). The layout rule is data: `art/ui/poc/tv/round-layout.json` (video share per aspect band, 0.50 to 0.67).

## Looked at
Files here are `results-n<N>-<W>x<H>.jpg` (and `intermission-n8-…`, same screen).
- 1920x1080 n=1, 8, 32, 150, intermission 8: video 52 %, heading on the left, right column list/QR/chip/buttons, no podium cards.
  n=1 rows grow, gaps stay under a button row; n=8 full rows; n=32 numbered cells; n=150 tiny cells.
- 1366x768 n=1, 8, 32, 150: same layout at k=0.71; top three rich rows stay larger than the rest.
- 412x915 and 375x667 n=1, 8, 32, 150 (portrait): video full width on top (50 %), "Highlights" strip rides in the video's corner,
  banner shrunk to fit; list beside QR/chip/buttons; chip "Next in 42s" fits.
- 915x412 n=1, 8, 32, 150 (phone landscape): video left 52 %, list beside QR/chip/buttons in the right column.
- 820x1180 n=1, 8, 32, 150 (tablet portrait): video on top, columns of numbered cells below.

Images looked at: `intermission-n8-1366x768.jpg`, `intermission-n8-1920x1080.jpg`, `intermission-n8-375x667.jpg`, `intermission-n8-412x915.jpg`, `intermission-n8-820x1180.jpg`, `intermission-n8-915x412.jpg`, `results-n1-1366x768.jpg`, `results-n1-1920x1080.jpg`, `results-n1-375x667.jpg`, `results-n1-412x915.jpg`, `results-n1-820x1180.jpg`, `results-n1-915x412.jpg`, `results-n150-1366x768.jpg`, `results-n150-1920x1080.jpg`, `results-n150-375x667.jpg`, `results-n150-412x915.jpg`, `results-n150-820x1180.jpg`, `results-n150-915x412.jpg`, `results-n32-1366x768.jpg`, `results-n32-1920x1080.jpg`, `results-n32-375x667.jpg`, `results-n32-412x915.jpg`, `results-n32-820x1180.jpg`, `results-n32-915x412.jpg`, `results-n8-1366x768.jpg`, `results-n8-1920x1080.jpg`, `results-n8-375x667.jpg`, `results-n8-412x915.jpg`, `results-n8-820x1180.jpg`, `results-n8-915x412.jpg`.

## Defects found and fixed
- First pass: the top-three row's name truncated to "Du..." at n=1 (font scaled past the row width): font now capped by the row width.
- First pass: the room code and next-race chip spilled past the right edge at n=1 on TV (scaled text); the plan now rejects a scale where they don't fit.
- First pass: banner outside title-safe (tilted); heading inset. Results tag touched the video's shadow on portrait; gap added.
- Rich rows were shrunk to make the rest "row" tier at 1366x768; rich rows now keep at least 50 TV px unless the rest has nowhere else to go.
- 915x412 buttons cut off at the bottom on a fresh load only (a late measurement); a ResizeObserver re-plans until stable.
- Phone portrait: QR was 77 px; now never under 110 px (floor), and a short-phone arrangement puts the chip beside the QR.

## Remaining defects
- 150 players: the placings fall to the "tiny" tier (digits only, 8 to 9 px on TV and phone). Nothing is capped or truncated but
  it cannot be read from a couch; a 21 % screen area is not enough for 150 legible cells beside the video at its 50 % floor. Needs an owner
  call (e.g. a larger share for the list when N is huge, or paging by highlights), no bead filed yet.
- 375x667 n=1: 175 px unused block under the list (the short phone cannot stack list, QR, chip and buttons). Extra size, not in the acceptance list.
- Video captions keep the old tag style (br-dim.8 unifies them). "Skip highlight" is a mock button.

## Not covered
Real phones/tablets (emulation only), WebKit, a real full-screen toggle (live-check's resize check ran, 0 failures), the
deployed preview (local checkout only), reduced-motion.
