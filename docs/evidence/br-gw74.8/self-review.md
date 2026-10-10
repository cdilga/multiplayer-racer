# br-gw74.8: diagnostics show real numbers and close cleanly

## Cause
Two wiring gaps, not missing code: the real room page mounted the round screens without the path source
(`bridge.hub.paths()`) or Disband's network end, so the panel had no paths at all; and the worker's room view dropped
each seat's transport endpoint, so even with paths a phone's seat read "unknown" and its connection showed again as an
unclaimed "Viewer". The panel also stayed up across screen changes.

## Defects found and fixed
- Real room: paths, Disband's `hub.end()` and the host's own numbers are passed to the round screens.
- Room view seats carry `endpoint` (an id, never the secret; null for host pads), so seats match their peers.
- The panel adds a host line: frame time and p95, and host pads' input age (p50, worst pad).
- A phase change (a screen change) closes the panel.

## Tests
- `web/tests/journeys/pt1-diagnostics.test.mjs` (Mac, Playwright Chromium, real room, phone over loopback WebRTC):
  one row for the phone, path "Direct · udp", a measured RTT, a non-zero host frame time; readying moves the room out
  of the Lobby with the panel open and it closes with nothing left; reopened in the race it fills in again.

## Looked at
- `diagnostics-lobby-1280x720.jpg`: one row (#1 Dazza, Direct · udp, 0 ms on loopback), host frame 58 ms p95 58 ms
  (software GL in headless Chromium), panel bottom-right clear of the QR and the footer.
- `diagnostics-closed-on-countdown-1280x720.jpg`: the countdown, no panel, footer button unpressed.
- `diagnostics-race-1280x720.jpg`: reopened in the race, filled in.

## Remaining defects
- Phones' input age isn't shown: their samples carry no clock the host shares, so the network half is the RTT column
  (one way is about half). Host pads' input age is shown. Recorded here rather than as a bead: a shared clock would be
  its own feature.

## Not covered
- A forced-TURN phone: needs the live TURN broker, which test servers don't have; the labels ("Relay (coturn)",
  "Relay (Cloudflare)") come from the selected pair's candidate type in the same `pathLabel`. That row is the couch
  test's (owner checklist: forced-TURN path).
