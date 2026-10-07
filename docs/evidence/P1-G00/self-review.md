# P1-G00 visual self-review

Captured on eris (headless Chromium, loopback WebRTC, pushed commit 392c390) with the real jj-server serving `host?hello`
and `j/<CODE>?hello`; three controllers joined. Images are in `captures/`; every one was opened and looked at.

## Looked at
- `captures/tv-1920x1080-empty.png`: room code, QR, join URL, empty field. Code and QR legible, URL wraps mid-code ("QJ / 7X").
- `captures/tv-1920x1080-three-markers.png` and `captures/tv-fullscreen.png` (real `requestFullscreen()` succeeded): three markers at the stick positions, diagnostics list three peers on the `host` path. Fullscreen is identical to the 1080p view.
- Resizes `captures/tv-resize-1280x720.png`, `captures/tv-resize-800x600.png`, `captures/tv-resize-390x844.png`, `captures/tv-resize-3840x2160.png`: layout reflows, field fills the rest, markers keep their relative positions, no horizontal scroll (scrollWidth equals innerWidth).
- Phones: `phone-a-390x844-*`, `phone-b-844x390-*` (landscape), `phone-c-320x568-*` (small): "Connected (host, 0 ms)", pad and knob fully inside the viewport, knob follows the stick; no overflow at any size (scrollWidth equals innerWidth, pad inside the viewport).

## Defects found and fixed
- The second controller's marker (#29335c) was nearly invisible on the dark TV background (every TV capture). Changed to #5bc0eb in `web/host/src/hello/hello.ts`. Not re-captured: eris runs pushed commits only, so the captures here still show the old colour.

## Remaining defects
- The TV text and QR do not scale: at 3840x2160 the QR is 94 px and the diagnostics are tiny; the 390x844 TV shows a cramped field. The hello page is an unstyled skeleton by design; the real host UI (G-DESIGN) replaces it.
- A phone doesn't show which marker is its own (no colour on the controller); the hello marker colours aren't surfaced to controllers.
- Join URL wraps mid-code.

## Not covered
- Real phone hardware or Safari/WebKit; relay (TURN) paths; more than three controllers; the pre-join and failed/ended room states on the phone; the re-captured marker colour after the fix.
