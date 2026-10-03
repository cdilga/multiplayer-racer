# P1-U03.2: phone mocks rework (centre pod, car picker, gesture tutorial, identify colour, landscape first)

The owner's POC round 1 items POC1-18 to 22 (`docs/playtests/poc-2026-10-03.md`; rulings R99, R101) in the live phone
mock at `https://jammers-preview.dilger.dev/poc/phone/`, in U01.3's design language.

**Run:** `JJ_EVIDENCE_DIR=docs/evidence/P1-U03.2 node art/ui/poc/phone/check.mjs`. It covers Playwright 1.62.1's
Chromium 151 and WebKit with mobile emulation (touch, isMobile) at 375×667, 430×932 and 412×915, portrait and
landscape, over all 36 states, then captures each state in device frames (`frames/`). These are emulators, not
devices. The owner's phone check over HTTPS on the live mock happens at the review.

## Decisions (one each, with why)

| Item | What | Why |
|---|---|---|
| POC1-18 pod | Boost and the power-ups (the cone with its cooldown, and the item slot) sit in one pod at the top centre between the sticks: a 150 px centre column in landscape, a centred row above the sticks in portrait. They're out of the ACTION zone | Neither thumb leaves its stick to read them |
| POC1-19 lobby | A car picker, the most-designed screen. The car is big in a slanted panel and breaks its edge. Its name sits on a torn ink banner with an accent word, a class tag above it. Four stat bars and a line about the car follow, then arrows, swipe and a thumbnail row through §7.6's starting roster (Cruz Missile, The Gull, Laser Beam, Tri-Tonne, Land Crusher, Billy Kart). Then your name with a reroll and Ready with burst ticks. Two columns in landscape | Owner: the lobby needs the most work and must offer several cars. Only the Cruz Missile has art (R81); the others are silhouettes in your colour marked "Art to come". The stats are mock numbers; the sim measures the real ones (§7.6) |
| POC1-20 tutorial | A bigger card (up to 520 px, 34 px title) in the middle of the stick area. Each step lists its goals and ticks them as the player does them; when all are done it shows "Nice!" and moves on after 0.7 s. The steps are steer (right, then left), go and stop (up, then back), boost (ACTION right), drift (ACTION left), a wheelie (hold back until the ring fills, let go) and Identify. "Skip tutorial" is always there | Doing it is the lesson; the mapping is jj-input's (DRIVE y < −0.85 is the wheelie preload; ACTION right boost, left drift) |
| POC1-21 identify colour | A frame in the player's colour round the whole controller on every playing screen. Identify plays the TV's flash (1.5 s, the same keyframes: fast attack, long decay), "Cooee #N" in your colour over a high-exposure wash, below the strip so your number and tools never move. Reduced motion holds the wash | R99: the same flash as the TV (P1-U05.2's motion reel is the shared reference) |
| POC1-22 landscape first | Landscape is the layout. In portrait a "Turn sideways" card asks once a visit, with "Play upright anyway". The **Get set** card has one tap that asks, in order, for full screen (Fullscreen API), an orientation lock (where allowed) and a screen wake lock (Screen Wake Lock API, re-taken when the page comes back), then shows what the phone allowed. Fallbacks are stated on the card: iPhone Safari has no element full screen (Add to Home Screen hides the bars); without a wake lock the screen may dim and any tap wakes it | R101 |

## Acceptance (`check-report.json`)

| AC | Result |
|---|---|
| POC1-18: boost and power-ups centre top | `frames/race*.jpg`: the pod between the sticks. 432 layout runs with no overlaps among layout boxes (the pod is its own box) and every target at least 48 px |
| POC1-19: a roster picker with several cars; the most design effort; the new language | `frames/lobby.jpg`, `lobby_car=3.jpg`, `lobby_car=5_ready=1.jpg` at all six sizes; no horizontal scroll at any size |
| POC1-20: bigger and central; moving the sticks advances it; a skip | Chromium and WebKit both start at step 0. Steer (drag right, then left) → 1; go and stop (up, then down) → 2; boost (ACTION right) → 3. Skip closes it. `frames/tutorial*.jpg` |
| POC1-21: the identify colour always shown; the same timed high-exposure flash | `frames/identify*.jpg` (held at 150 ms in `identify_at=150`). The colour frame is on every race, lobby and settings frame. The flash never covers the strip or tools (the overlay check passes) |
| POC1-22: landscape first; tap for full screen and a wake lock; fallback stated | With stubbed APIs, both engines record the calls in order: `fullscreen`, then `wakeLock:screen`. Unstubbed, Chromium gives full screen on, sideways lock refused (headless), wake lock on. Mobile WebKit has no element full screen (as on iPhone Safari), so the card says so, and the wake lock is on. Frames: `gate.jpg`, `rotate.jpg` (portrait) |

Multi-touch still passes: 18 of 18 runs (two pointers in both engines, real CDP touch points in Chromium). No request
leaves the folder.

## Known gaps

- Only the Cruz Missile has a render. The other roster cards are placeholders until R81's models exist.
- The picker's stats are mock values; the sim's measured stats replace them (§7.6).
- The owner's real-phone check (iPhone Safari over HTTPS, Android Chrome) is at the review; WebKit here is Playwright's,
  not Safari.
