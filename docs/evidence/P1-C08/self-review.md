# P1-C08 self-review (hub route)

Captures: `c08-hub.test.mjs` with `JJ_CAPTURE_DIR` on eris (Chromium, run `cap4`, commit b972e04): hub page at 1100x700, phone with an emulated paired pad at 844x390 / 390x844 / 1920x1080. Emulated Gamepad API and key events, not hardware. The captures are committed in `docs/evidence/P1-C08/captures/` (file names below are relative to it).

## Looked at
- Hub page: heading "Hub · room XXXX" with the one-line instructions, a row per source (seat number in its colour, keyboard or gamepad icon, label, state chip, direct/relay and RTT, bytes and batches). Idle key clusters read "Press to join" with a dash for the seat.
- Identify flash: only Pad 1's row turns its colour (red) with dark text, Pad 2 stays calm.
- Phone with a paired pad: a slim tray low and centred between the sticks ("This phone" and "Pad 1", each with its number, icon and Connected chip); the strip shows the "Direct · 1 ms" badge. Landscape and portrait.

## Defects found and fixed
- The Identify flash used a class that collided with the controller's full-screen Cooee flash, so the whole screen went red: renamed `hub-flash`.
- Row icons were solid squares (markup quoting); they are now added as elements.
- The phone tray covered the sticks and the tutorial; now a slim touch-transparent list.
- Seat badges rendered "#" as "//": badge shows the plain number.
- A sixth simultaneous join stalled; sources now join one at a time and a stalled join retries after 12 s.

## Remaining defects (protocol and server gaps, reported to the lead)
- **Not one connection.** The protocol seats one endpoint with one seat (`jj-session` `Endpoint.seat`; Claim, Ready, Identify, Leave address the connection), so each hub source is its own endpoint with its own signalling stream and peer link. The AC "six seats over one connection" and the per-endpoint N08 receipt are unmet until the host supports a multi-source Claim.
- **Browser connection limit.** Because of the above, a hub page holds one stream per source and HTTP/1.1 allows six per origin, so a single page carries five sources locally (the sixth's signalling queues). The six-seat journey therefore uses two hub pages (two browser contexts). Production is HTTP/2 and should not hit this; a shared connection removes it.
- **No `/hub` server route**: the hub is `B/j/<CODE>?hub`; a real `/hub` needs a route in jj-server.
- Input age is not reported per source (only bytes and batches).
- The "six seats, each drives only its car" journey was last red on a test-harness read of the host's seat count (fixed in the test, awaiting a rerun at the time of writing); the leave/Identify and phone-plus-pad journeys pass.
- A hub source whose room ends does not reset to "left".

## Not covered
- Real pads (non-standard mappings, wheels stay on the host, C05.2), real keyboards with rollover limits, hub on a second real laptop over a LAN or TURN.
- Visual comparison against an accepted hub mock (none exists; built from the kit and the phone mock).
