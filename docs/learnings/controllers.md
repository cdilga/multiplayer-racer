# Controllers: traps

## WebKit TURN URLs (br-gm11, 2026-10-11)

- Playwright 1.62.1 WebKit on Linux and macOS rejects the configured `turn:…?transport=udp` at the peer constructor,
  before ICE or signalling can run. Removing the redundant default query works: RFC 7065 already makes `turn` UDP and
  `turns` TLS over TCP. `web/shared/transport/ice.ts` canonicalizes those two defaults for creation, refresh and fallback.
- Never strip `?transport=tcp` from a `turn` URL: that would silently replace TCP with UDP. Non-default transports remain explicit.
- A passing browser launch is insufficient evidence. Check a data-channel exchange and the real controller join; WebKit evidence is not Safari evidence.
- A Lobby newcomer must dismiss the tutorial before a journey asserts manual driving or an idle takeover. Help is a menu and
  intentionally hands the car to autopilot. Mid-race newcomers get in-world prompts, with no tutorial card to dismiss.

## Pads on a joined page (P1-C13, R119)

- **Re-plug identity.** The Gamepad API has no serial number and keys pads by `gamepad.index`, so a different pad that lands on a
  freed index would otherwise resume someone else's held seat. A held seat is resumed only by a pad with the same `gamepad.id`
  (the model string); a different model is a new player on a fresh source handle. Two identical models are indistinguishable:
  the first unplugged seat of that model resumes, and Identify shows whose car it is. The re-plugged pad may land on another
  index; the match is on the model, preferring the old index.
- **An unplugged source is not a silent one.** Every source on a page shares one endpoint, and the scheduler refreshes all its
  sources at 20 Hz, so an unplugged pad keeps being sent (flagged unavailable). The host's old "silent for DROPOUT_MS" rule never
  fired for it. The host now tracks `unplugged_since_ms` per seat (first unavailable sample until an available one) and hands
  the car to the autopilot after DROPOUT_MS of that too; `room_json` carries `unpluggedMs` for the TV and the lobby card.
- **Held seats never expire.** There is no timer anywhere: the page row and the TV say "Unplugged for Ns", and Remove (or the
  host's Remove) is the only way out besides plugging back in.
- **Key clusters and text fields.** A cluster's keys (WASD, IJKL, arrows) act only outside text inputs, or typing a name would
  claim a seat. Key-ups always release.
- **A seat that left stays on the host** as presence `Left` with no car (the body stays as scenery until S04c); journeys count
  seats with `presence !== 'Left'`.
- **A laptop carrier with no touch seat** still needs the visibility handler to retry the connection: `Session.onVisibility` calls
  `link.resume()` for a session that has no seat of its own.
- **"Add a player" is a prompt, not a second touch player.** R65 / AGENTS.md: one phone is one player on its touchscreen; a second
  player on the same device is only an external pad or keyboard with its own seat. So the page's Add a player button claims
  nothing by itself: it says to press a pad button or a cluster key, and the next source's press claims the seat (the prompt then
  clears; Cancel puts it back). It is on the join card and other non-driving screens; the driving screen's slim tray only shows it
  while armed.
