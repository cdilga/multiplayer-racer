# Self-review P1-M08a

Captured by `web/tests/journeys/m08a-retry-lobby.test.mjs` on the real host page (`host?room&test=live&map=broken-no-gates`: a
dev map the validator refuses, so the preparation and the conservative retry both fail), on eris (Chromium, GPU), at TV
1920x1080 and a phone host 412x915.

## Looked at
- `self-review/tv-retry-lobby.png` (1920x1080): "No track this time" card over the Lobby with Retry (focused, primary) and Lobby;
  the two players' cards still behind it, the QR and Start race still there.
- `self-review/phone-host-retry-lobby.png` (412x915): the same card on a phone host, text wrapped, both buttons reachable.
- `self-review/tv-lobby-after.png`, `self-review/phone-host-lobby-after.png`: after Retry (fails again, card returns) and Lobby
  (card closes): both players kept, the Lobby intact.

## Defects found and fixed
1. First capture: Retry and Lobby drew as bare text (the brush skins weren't painted for buttons added after load). The screen now
   calls `paintKit` on itself; both are brushed buttons, Retry in the primary saffron.
2. The red developer banner ("Map refused: ...") also showed for a player-facing failure and sat over the footer. It now shows only
   for a dev map's refusal; a real failure is the card alone.

## Remaining defects
- In this capture the dev banner still shows, because the journey forces the failure with a dev map; a real failed generation
  doesn't show it.
- The validator's message in the card is raw ("gates route.gates: 0 gates; at least 3 ..."): fine for a developer, plain for a
  player. A friendlier line is a copy decision for the UI lane.
- No 32-player or 4K capture: the card is a fixed centred panel scaled by the round screens' `--rk`, independent of the roster.

## Not covered
- Intermission and results behind the card (the failure while on results): covered by the sim-side test that the director keeps
  the room, not captured; Playwright WebKit and a real phone host.
