# Self-review br-1s9h (player feedback, R142)

Captures from `web/tests/journeys/feedback.test.mjs` in the CI image on triton (Chromium on SwiftShader, Playwright
WebKit; emulated sizes, not devices), 2026-11-23. The inbox host is stubbed in the test; the sheet is the real
widget (client 1.12.0).

## Looked at
- `captures/tv-1920x1080-lobby.png`: TV, Lobby. Feedback sits in the footer strip after the room readout, clear of the
  Host menu, the room code, the caption and the logo. Nothing over the lobby.
- `captures/tv-1280x720-race.png`: laptop, a race running. Feedback is in the footer beside the logo; the tile, its
  HUD, the boost bar and the controls prompt are untouched.
- `captures/tv-1280x720-sheet.png`: the sheet over a running race. The picture is the world (not blank), ticked; the
  details list Build, Room, Phase, Mode, Round, Players, Track seed, Renderer. The round keeps running behind it.
- `captures/tv-390x844-lobby.png`: an upright phone as the host. The button fits at the right end of the strip.
- `captures/phone-844x390-sheet.png`: a joined phone, sideways, from Settings: "Include a picture of the TV (taken when
  you opened this)", Send and Cancel on screen.
- `captures/phone-webkit-375x667.png`, `captures/phone-webkit-667x375.png`, `captures/phone-chromium-320x568.png`:
  the smallest phones, both ways up: the panel fits, the buttons are 44 px and reachable, the list scrolls.

- `live/live-tv-lobby.png`, `live/live-tv-sheet.png`, `live/live-phone-sheet.png`: production (`v02-a2e16c6a`,
  https://jammers.dilger.dev/) from `tools/feedback/live-check.mjs` on triton, 2026-11-24: the footer button on the real
  Lobby, the TV's sheet with its picture, and a joined phone's sheet with "Include a picture of the TV". Both pieces
  reached the real inbox with pictures (fb_jnsrp3zm7msy from the TV, fb_mm4b295hkpkq from the phone; marked wont_do,
  note "test"). The same on the preview v02-163f8d05 (fb_5krtg6ijmq3g, fb_zrfghn4dgjfm).

## Defects found and fixed
- 390x844 host: the button ran 12 px past the right edge of the footer. The strip's gaps close up on an upright host
  and the button's padding shrinks; under 370 px wide it is hidden (phones have Send feedback in Settings).

- CI 21663 (r-resize-paint, 412x915): in a race on an upright host the button took the docked standings' room, so no
  number badge showed. The standings come first there now: Feedback steps aside while they are docked.

## Remaining defects
- none known.

## Not covered
- Real phones and a real TV (emulation only). The live check on production after the promote is in the bead's notes.
- A WebKit phone joined to a real room over WebRTC: the WebKit runs use the offline state opener, so the "TV's
  picture" row is exercised in Chromium only.
- The WebGPU backend: the picture was checked on WebGL2 (SwiftShader).
