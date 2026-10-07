# P1-C08 self-review (hub route)

Captures: `c08-hub.test.mjs` with `JJ_CAPTURE_DIR` on eris (Chromium, run `cap4`, commit b972e04): hub page at 1100x700, phone with an emulated paired pad at 844x390 / 390x844 / 1920x1080. Emulated Gamepad API and key events, not hardware. The captures are committed in `docs/evidence/P1-C08/captures/` (file names below are relative to it).

## Looked at
- Hub page: heading "Hub · room XXXX" with the one-line instructions, a row per source (seat number in its colour, keyboard or gamepad icon, label, state chip, direct/relay and RTT, bytes and batches). Idle key clusters read "Press to join" with a dash for the seat.
- `c08-hub-four-sources-*` and `captures/c08-hub-pad1-unplugged-1100x700.png`: six rows on one hub page (Keys A, Keys B, four pads) each with its number in its colour, Connected, "Direct · 3 ms" and its own bytes; with pad 1 unplugged only its row turns to the orange Unplugged chip with a dashed outline and the other five stay Connected. Resized to 390x844, 844x390 and 1920x1080 and back, all six rows stay readable.
- `B/hub` entry (`captures/c08-hub-entry-1100x700.png`, `captures/c08-hub-entry-bad-code-1100x700.png`, `captures/c08-hub-entry-then-hub-1100x700.png`): a room-code field and "Open the hub"; a bad code shows the red line and stays; the real code lands on the hub page with its Keys rows idle.
- Identify flash: only Pad 1's row turns its colour (red) with dark text, Pad 2 stays calm.
- Phone with a paired pad: a slim tray low and centred between the sticks ("This phone" and "Pad 1", each with its number, icon and Connected chip); the strip shows the "Direct · 1 ms" badge. Landscape and portrait.

## Defects found and fixed
- The Identify flash used a class that collided with the controller's full-screen Cooee flash, so the whole screen went red: renamed `hub-flash`.
- Row icons were solid squares (markup quoting); they are now added as elements.
- The phone tray covered the sticks and the tutorial; now a slim touch-transparent list.
- Seat badges rendered "#" as "//": badge shows the plain number.
- A sixth simultaneous join stalled (each source was its own connection); with one connection every source joins at once.

## Remaining defects
- **One connection (built, protocol 3).** A hub is one endpoint with a seat per source: `ControllerCmd::ForSource{source, cmd}` / `HostCmd::ForSource` wrap a source's commands and replies, `jj-session` keeps `endpoint.seats[source]`, the host wraps every message for a hub seat the same way, and the hub's sources share one `WasmEndpoint` (shared batches). The journey asserts one endpoint id, one link, six source handles, and the host's six seats on one endpoint. A phone with a paired pad rides its pads on the phone's own connection (the phone's sticks are the primary source 1). The old per-endpoint path is unchanged for phones.
- Per-source bytes are the source's records in the shared batches (13 bytes each), its input age is the age of its latest sample (`inputAgeMs`), and the endpoint's batches and bytes are on the carrier; the log line `# per source` in the journey shows them. The host's own per-endpoint N08 receipt is the existing one (the connection is one endpoint).
- The HUD (boost, host-paused) is not sent to hub sources (the state channel's HUD has no source field): a hub source shows Connected through a host pause rather than "Host paused".
- A source leaving and pressing again gets its seat back (same number): the endpoint keeps the source's seat; before the change each rejoin was a new endpoint and a new number.
- The phone-with-pad tray sits over the bottom of the tutorial card while the tutorial is open (seen in `captures/c08-phone-with-pad-phone-landscape-844x390.png`); it is touch-transparent and the tutorial is dismissable, not fixed.
- Journey status at f40ddd9 and after on eris: the four c08 journeys pass (six seats on one hub page with routing, unplug and host seat count; leave/Identify/rejoin; phone plus one paired pad; the `B/hub` entry). "Each drives only its own car" is asserted from the host's applied input (throttle > 0.5 with no autopilot for each driven source, zero or autopilot for each idle one); car travel is only logged.
- A hub source whose room ends does not reset to "left".

## Not covered
- Real pads (non-standard mappings, wheels stay on the host, C05.2), real keyboards with rollover limits, hub on a second real laptop over a LAN or TURN.
- Visual comparison against an accepted hub mock (none exists; built from the kit and the phone mock).
