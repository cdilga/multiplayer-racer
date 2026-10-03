# Phone mocks (P1-U03)

The controller on real phone sizes, for the design review (G-DESIGN, Playtest-1 plan §3a). Static files
from `art/ui/` (`node art/ui/lib/serve.mjs`, then `/poc/phone/`); no three.js, no network traffic.

- **`index.html` is the live mock.** Open it on your phone: the sticks follow your thumbs (Pointer
  Events, one pointer per zone, so two thumbs drive two sticks), the boost meter, wheelie preload and cone
  cooldown react, and the **Mock ▾** button jumps to any state or turns on the overlays (`&edges=1`
  shows the 24 px edge-safe band, because iOS Safari's edge swipe goes back; `&reach=1` shows comfortable
  thumb reach). Touch hygiene follows plan §11: `touch-action: none`, no zoom, no selection, no
  pull-to-refresh, safe areas, a back-gesture guard.
- **`frames.html#<state>`** shows a state on a small iPhone (375×667), a large iPhone (430×932) and a mid
  Android (412×915), portrait and landscape, at true CSS size.
- **`check.mjs`** runs WebKit and Chromium with mobile emulation at all six sizes over every state (no
  horizontal scroll, no overlapping layout boxes, overlays never over the HUD strip or tools, every touch
  target ≥ 48 px), scripted two-finger multi-touch (pointer events in both engines, real CDP touch points
  in Chromium), the tutorial advancing on gestures, the full-screen tap asking for full screen then the
  wake lock, a request audit, and captures every state in device frames into `docs/evidence/P1-U03/`
  (`JJ_EVIDENCE_DIR` overrides; P1-U03.2's run is in `docs/evidence/P1-U03.2/`).

## Proposals (one each, with why; the owner redirects at P1-U04)

| Question | Proposal | Why |
|---|---|---|
| Base | Ink navy with cream panels and the player's colour (strip underline, Identify button, DRIVE knob), and since P1-U03.2 a frame in the player's colour round the whole screen, on every playing screen | No glare in a dark room; identity at a glance (§3a); the identify colour is always on screen (POC1-21, R99) |
| Sticks | DRIVE left, ACTION right (M2), floating by default: the base appears under your thumb inside a zone that starts 24 px from every edge | M2's controls (owner: "the controls are good"); edge swipes can't steal a drag |
| Indicators (P1-U03.2) | Boost and the power-ups (the cone and the item slot) sit together in a pod at the **top centre, between the sticks**: a centre column in landscape, a centred row above the sticks in portrait. The wheelie preload ring stays round the DRIVE base with "let go to pop it". They are indicators, not buttons (br-dim.10): flat inset wells, no outline or sticker shadow, not focusable, taps fall through; each is labelled with the action-stick direction that fires it (Boost →, ↓ Rear cone, ↑ Front slot, the style frame's words) and lights while the stick points that way | POC1-18: neither thumb leaves its stick to see them; owner round 3: players tapped them |
| Secondary buttons | Top: Identify (labelled, in your colour), camera, Recover and the menu (Identify first, then camera, Recover, Help, Settings, Leave) | Away from the thumbs; Identify is the menu's first entry (owner 2026-10-03) |
| Landscape first (P1-U03.2) | Landscape is the layout; in portrait a "Turn sideways" card asks once, with "Play upright anyway". A **Get set** card (`#gate`; once per visit on the live mock) has one tap that asks for full screen, an orientation lock and a screen wake lock, then says what the phone allowed. Fallbacks are stated: iPhone Safari has no element full screen (Add to Home Screen instead); without a wake lock the screen may dim | POC1-22, R101 |
| Lobby (P1-U03.2) | A **car picker**, the most-designed screen. The car is big in a tilted panel with its name on a torn ink banner and a class tag; stat bars and a line about it; arrows, swipe and a thumbnail row through the roster (§7.6's working names). Only the Cruz Missile has art yet; the others are silhouettes in your colour marked "Art to come". Then your name with a reroll, and Ready with burst ticks. Two columns in landscape | POC1-19, in U01.3's language |
| Overlays | The tutorial card, autopilot banner and menu sit inside the stick area; nothing ever covers your number or the tools | Identity first |
| Tutorial (P1-U03.2) | A bigger card in the middle. Each step lists its goals and ticks them as you do them; when all are done it says "Nice!" and moves on: steer (right, then left), go and stop, boost (ACTION right), drift (ACTION left), a wheelie, and Identify. "Skip tutorial" is always there | POC1-20 |
| Identify (P1-U03.2) | The TV's timed high-exposure flash (1.5 s: fast attack, long decay) in your colour, with "Cooee #N", below the strip so your number and tools stay put. Reduced motion (P1-U05.6) has no flash and no full-screen colour: the label shows over the screen as it is. It's the same tween as the TV and the motion reel (P1-U05.2) | POC1-21, R99 |
| §11 states | One card each: what's happening, the next useful action, no credentials, wording from plan §11 | Every failure names a next step |
