# Self-review P1-R07

Chromium (Playwright headless, software GL) on the Mac; fixture room views (`host/?roundfixture=<kind>-<n>`), not a real room. Captures: `web/host/tests/round-screens.test.mjs` (captures test). A fixture screenshot never claims a gameplay pass.

## Looked at
- `lobby-1@1080p.jpg`, `lobby-2@1080p.jpg`, `lobby-8@1080p.jpg`, `lobby-32@1080p.jpg`, `lobby-99@1080p.jpg`: cards, Ready state, QR + code + address, Start race, nothing clipped; tier drops from full (words) to seat (number + tick) by N.
- `lobby-32@4k.jpg`, `lobby-32@21x9.jpg`, `lobby-99@21x9.jpg`: same layout scales; 21:9 uses 6 columns, no overlap with the QR column.
- `lobby-8@phone.jpg`, `lobby-32@phone.jpg`, `lobby-99@phone.jpg`: portrait: head, QR row, roster, Start race under it.
- `countdown-8-3@1080p.jpg`, `countdown-8-1@1080p.jpg`, `countdown-8-3@4k.jpg`, `countdown-8-3@phone.jpg`: big saffron number over the HUD tiles.
- `race-1@1080p.jpg`, `race-2@1080p.jpg`, `race-8@1080p.jpg`, `race-32@1080p.jpg`, `race-99@1080p.jpg`, `race-8@4k.jpg`, `race-8@21x9.jpg`, `race-8@phone.jpg`, `race-32@phone.jpg`: badge + name top-left, place + lap top-right, Autopilot / Reconnecting chips, name dropped on small tiles.
- `results-1@1080p.jpg`, `results-2@1080p.jpg`, `results-8@1080p.jpg`, `results-32@1080p.jpg`, `results-99@1080p.jpg`, `results-8@4k.jpg`, `results-32@4k.jpg`, `results-32@21x9.jpg`, `results-99@21x9.jpg`, `results-8@phone.jpg`, `results-32@phone.jpg`: placings in order, top three tinted, QR with code, next-round chip, both buttons.

## Defects found and fixed
- Lobby had 95 px of dead space above the head: padding changed to vh-based.
- Results at N=32 showed one-letter names (the tier thought it had room): tiers re-cut (row / name / seat / num / tiny) with real minimum widths; names now show whenever the card can hold them, else number + points.
- Results list was a narrow centred block with a gap beside the reel: columns made fluid.
- Lobby with one player centred its card: roster left-aligned.
- Countdown showed empty "-" place pills on every tile: the place pill hides until there is a place or a lap.
- Lobby QR smaller than the column allowed: raised to 0.44 vh / 380 k.
- Test bug found by running it: the QR module count regex read the viewBox origin (0).

## Remaining defects
- The reel slot in Round complete is an ink striped placeholder with the winner card; R09 mounts the video in `[data-reel]`. Large empty ink at small N is expected until then.
- Lobby has no crane view of the track (POC br-dim.6 has one): the lobby is paper with a dotted backdrop. Needs a world camera mode (render bead). Small N leaves empty paper.
- HUD wreck countdown renders only when `seat.wreckMs` exists; `room_json` doesn't send it yet (report). Boost is sent (byte) and now drawn.
- HUD pills are plain ink-outlined slabs, not the brush-mask skin the POC uses (the kit's `.chip` mask has a minimum height too big for HUD pills).
- R04's grid overlay (not this bead): the spare-cell QR says only "Scan to join" with no room code or address (POC round 4 rule: always labelled), and its join chip overlaps tile 2 on a portrait phone (`race-8@phone.jpg`, `race-32@phone.jpg`) and wraps its address in the last cell.
- Since the last matrix (eris GPU run, `chrome.test.mjs`; all 11 tests pass at 6612ded): footer toolbar, pause flow, End/Disband/Remove confirmations, diagnostics overlay, HUD boost bar and wreck banner, pre-race HUD without place/lap, results foot that stacks when narrow. Looked at `menu-race-8@1080p/4k/phone`, `confirm-end/disband/remove@1080p`, `diagnostics-race-8@1080p/phone`, `race-8-boost-wreck@1080p`, `lobby-32-footer@1080p`, `results-8-footer@phone`, `results-8-caption@*`. Fixed after looking: footer descenders clipped (line height), footer said "racing" in Intermission (now "in the room"), phone menu's profile buttons clipped ("Auto (handheld)"), diagnostics RTT column crowded the path text. These four are fixed in source but not re-captured yet. The wreck banner is drawn from the fixture; the worker doesn't send `wreckMs` yet.
- The 1080p/4k/21:9/phone matrix images (`lobby-*`, `race-*`, `results-*`, `countdown-*` @ sizes) in this folder still pre-date the footer and the world fix; regenerate with `round-screens.test.mjs` before closing.
- `capability.ts` still says "can't host a game" (not this bead; R112 breach).

## Not covered
- No real room, WebRTC, phones or TV; real 3 m QR scan is the P1-Q02 row. Phone captures are Chromium emulation at 412x915, not a device. No WebKit run. No 4K capture of N=99. Reduced-motion variants not captured.

## Fresh-eyes comparison with the accepted POC (poc/tv, captured in docs/evidence/P1-U02.4 and P1-U02)
- Lobby vs `P1-U02.4/captures/1080p-lobby_n=32.jpg` (roster by the br-dim.6 rule, QR column): present: seat number, name, state, tier drop at N, QR + code + address on paper, Start race. Different: no crane view; state is a chip ("Ready" green, "Choosing car…") rather than the POC's tick-only tier at N=32 because 32 fits the word tier here. First look reads "lobby with everyone listed".
- Round complete vs `P1-U02.4/captures/1080p-results_n=8.jpg`: present: round heading, subtitle strip, placings with seat colour and points, QR, next-race chip, start-next and return buttons. Absent: highlight video (R09), podium cards (removed in br-dim.7 anyway), "Watch the highlights" button.
- Per-tile HUD vs `P1-U02/captures/1080p/hud_n=8.jpg`: present: badge + name top-left, ordinal place + lap top-right, chips bottom, seat-colour frame; absent: boost bar, wreck banner (no data); the lap and place share one pill (the POC stacks lap under place in the early capture, one line in the accepted rule).
- Countdown vs `countdown_n=8.jpg`: full-screen number, same saffron with ink outline; GO! shown 0.9 s.
