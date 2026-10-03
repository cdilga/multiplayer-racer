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
  in Chromium), a request audit, and captures every state in device frames into `docs/evidence/P1-U03/`.

## Proposals (one each, with why; the owner redirects at P1-U04)

| Question | Proposal | Why |
|---|---|---|
| Base | Ink navy with cream panels and the player's colour (strip underline, Identify button, DRIVE knob) | No glare in a dark room; identity at a glance (§3a) |
| Sticks | DRIVE left, ACTION right (M2), floating by default: the base appears under your thumb inside a zone that starts 24 px from every edge | M2's controls (owner: "the controls are good"); edge swipes can't steal a drag |
| Indicators | Boost meter and the cone's ready/cooldown in the ACTION zone's top band; the wheelie preload ring around the DRIVE base with "let go to pop it" | Next to the sticks, never under the thumbs (§11) |
| Secondary buttons | Top: Identify (labelled, in your colour), camera, Recover and the menu (Identify first, then camera, Recover, Help, Settings, Leave) | Away from the thumbs; Identify is the menu's first entry (owner 2026-10-03) |
| Landscape | The HUD strip carries the tools; the sticks get the full height | Most players turn the phone sideways to drive |
| Lobby | Your number and name, the car still (no 3D on controllers), name field with a reroll, a big Ready; two columns in landscape so Ready never scrolls away | One thumb, one decision |
| Overlays | The tutorial card, autopilot banner and menu sit inside the stick area; nothing ever covers your number or the tools | Identity first |
| §11 states | One card each: what's happening, the next useful action, no credentials, wording from plan §11 | Every failure names a next step |
