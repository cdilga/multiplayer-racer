# P1-R06 visual self-review

Builds: `v0.2-revamp` at 3dc4771 (`identify-24.png`, `identify-108.png`: `web/tests/journeys/r06-identify.test.mjs`,
run `r06-k`) and 8c1851e (`tv-identify.png`, JN3 run `r06-i`). Both on eris: Linux, Playwright Chromium headless, the
host drawing through ANGLE Vulkan on the RTX 2080 Super (`JJ_CHROMIUM_GPU=1`). TV 1920x1080 (R06 journey) and
1280x720 (JN3). Cohorts: two phones over loopback WebRTC (JN3); 24 then 120 synthetic controllers fed through the
host's test surface as the same controller frames a phone sends (R06 journey).

Press-to-visible (phone's Identify press → the TV pulse up, wall clock on one machine, loopback WebRTC, five presses
3.3 s apart): GPU host 2-9 ms (`identify-gpu.json`); SwiftShader host 209-233 ms (`identify-swiftshader.json`), where
each host frame takes ~150 ms. The LAN measurement is a P1-Q02 checklist row.

## Looked at

- `tv-identify.png`: Davo's tile pulses with a thick red border and "Cooee #1" in its upper third; "#1" floats over
  his car in his tile and in Shazza's; Shazza's tile keeps its blue border.
- `identify-24.png`: 24 tiles; only #7's tile carries the pulse and "Cooee #7"; "#7" floats over the black car in
  #7's and every other tile that sees it (#8, #9, #10, #17, #18, #19, #20 …); every tile has its seat-coloured border.
- `identify-108.png`: 120 tiles (compact HUD: badge, place and lap); #108's tile (bottom-right block) shows
  "Cooee #108" inside the tile; "#108" floats over the car in the tiles behind it, sized to fit three digits.

## Defects found and fixed

- Tiles lost their seat-coloured border after any reflow, and the pulse and label had no colour: placing the HUD
  rewrote its inline style and dropped `--seat`; it goes back on every paint.
- The Cooee label sat over the number above the car: moved to the tile's upper third.
- At 120 tiles "Cooee #108" overflowed its tile: it scales with the tile's width.
- The label text used paper on every colour (unreadable on yellow or white seats): it uses the seat's "on" ink.
- JN3's presses were 1.8 s apart and the host allows one Identify per 3 s per seat (master §5.2): 3.3 s apart.

## Remaining defects

- On very small tiles (120 at 1080p) the Cooee label covers the tile's own badge row.
- The mark over the car is a flat billboard drawn over everything; it doesn't outline the car's silhouette.

## Not covered

- The phone's menu Identify: the Help card (`c06-identify-menu.test.mjs`) and the settings sheet (same journey) each send the same Identify as the tools-row button; the host receives it for that seat. Not captured as an image.

- Real phones, a real TV and a LAN: Chromium contexts on one Linux box.
- A pad's View/Select and a key cluster's Identify key reach the same `SimEvent::Identify` path (P1-C05's input
  tests); this review didn't capture them.
- Phone side of the flash: the controller's own flash is P1-C02/C03's (`phone-landscape-844x390-identify-flash` in
  JN1's captures).
