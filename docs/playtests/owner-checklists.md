# Owner checklists: what to check at each gate

Your to-do list so nothing gets forgotten (owner, 2026-10-03). Only two gates wait for you (the design
review and Playtest 1); everything else you can try whenever a preview lands, from the preview index at
`https://jammers-preview.dilger.dev/`. Anything that fails becomes a bug bead: tell the session (or the
verifier) the row, the preview id and what you saw, and save a bug clip (Ctrl/⌘+Shift+B on the host)
when you can. Full detail for each row lives in the plan (`docs/plans/v0.2-playtest-1-plan.md`).

## 1. Design review (G-DESIGN, waits for you)

Open the gallery at `https://jammers-preview.dilger.dev/poc/` on the TV laptop and on your phone.

- [ ] Design guide: palette, the two fonts, the wordmark, app icon and the QR rule feel right.
- [ ] The component sheet covers every state you'd expect (buttons, panels, toasts, confirmations, focus for pads and keys).
- [ ] Colour-blind sheet: you can tell every pair of neighbouring players apart by colour or number.
- [ ] TV grid, from the couch with 24–32 tiles: players joining and leaving 1 → 32 → 1, and the gap cases (2, 3, 5, 7, 10, 13).
- [ ] The per-tile HUD is readable at the smallest tile; first- and third-person tiles sit well side by side.
- [ ] Lobby at 2, 8, 16 and 32 players: every player on one screen with joining/choosing/ready states, a generic track behind it (R110: no warm-up), the QR sized to the free space, and the rule for bigger rooms.
- [ ] Round complete and highlights (one merged screen, video 50–67% of the screen, UI packed right) at 8 and 32 players.
- [ ] Your host controls (Start now, End, Disband, pause, input drawer, diagnostics) stay out of the way during a race; captions don't cover anyone.
- [ ] The derby Overview reference: cars big and readable at 8, 16 and 32.
- [ ] The in-world look with the real Cruz Missile (toon, ink outlines, halftone), and each identity colour as paint next to its badge.
- [ ] The motion reel (countdown, join, Identify, wreck and respawn, phase changes, results), and its reduced-motion version.
- [ ] Phone controller on your own phone, once in a dim room: thumb reach, the two sticks, the dark-room base, every state screen.
- [ ] **Engine synth:** the Cruz Missile's engine across RPM, throttle, boost, surfaces and damage, and the scripted lap.
- [x] **Announcer voice:** approved 2026-10-06: clones of your own Aussie warm and hype recordings (FrankenTTS 0.6B fallback approved for any line the eris render can't finish). The paid FAL set (P1-A01c) isn't needed. Still give the full engine synth and the announcer's lines a listen on the TV.
- [ ] **Announcer copy** (`docs/copy/australianisms.md`, `tools/audio/cues-playtest1.tsv`): the mild minced oaths: strewth and crikey are approved, "stone the crows" dropped (owner 2026-10-04); the 26 shipped terms and the ones left out (with reasons) read right to you.
- [x] **"Room" or "game":** "room" (owner 2026-10-04, R112).
- [x] **Shader skill licence:** the vendored MIT text and note are approved (owner 2026-10-04).
- [x] **Style frames:** approved by the owner 2026-10-04 (generated). Align the real UI closer to them (phone header, banner behind the seat number).
- [ ] Record the verdict and any changes (the session writes `docs/playtests/poc-<date>.md`).

## 2. Previews as they land (never a gate)

- [ ] **D0 Hello room:** host on the TV from the index; your phone joins by QR and moves a marker; diagnostics say direct or relay.
- [ ] **D1 Free drive:** phones and a keyboard drive Cruz Missiles on the greybox; first-person and chase views; recovery works. First feel notes.
- [ ] **D2 Race:** lobby (every player on one screen; no warm-up since R110), Ready / Start now, a race, results, next round on its own; Identify from the phone's button and its menu, a pad's View/Select and a keyboard's Identify key (your number flashes big in your colour on the TV and your phone); a late joiner; a phone dropping out and back.
- [ ] **D3 Crash:** doors and wheels go loose then fly off and stay; wrecks respawn in about 2 s; husks stay; OI! and cones.
- [ ] **D4 Outback:** generated tracks through town, rocks, outback dirt and bitumen.
- [ ] **D5 Party-ready:** QR scanner, tutorial, phone as host, voice and music, engine sound, effects (dust, smoke, sparks, fire, glows),
      extra players on any joined controller (a second laptop with pads, a keyboard-only laptop, a phone with a pad, each showing how it's connected; R119, no separate hub page), removing someone
      who left, downloading a session bundle, crash and UI sounds, and the Credits page.
- [ ] **Native resolution (report whenever you play, br-dim.3 hardware):** on the TCL at 4K, 1/12/24/32 tiles at Native: the
      overlay shows 3840x2160 and no auto-lowering (or names it), frame cost noted, and the cars look crisp. On your Android:
      the host overlay's render size equals the screen's physical pixels, or it says which browser limit stopped it.

## 3. Playtest 1 (waits for you): the couch test on the pinned build

Real-device rows (from P1-Q02):

- [ ] **Join:** host from the index on the TV laptop; an iPhone and an Android join by camera QR; the TV QR scans from 3 m; the in-page scanner works on both.
- [ ] **Network:** phones on home Wi-Fi go direct; a phone on cellular joins and its path is recorded; `tools/net/turn_probe.py` allocates on `turn.dilger.dev` from a hotspot; a client-isolated Wi-Fi if handy (then decide Q-N1).
- [ ] **Controls:** two thumbs, no zoom/scroll/select; a hard left-stick swipe on an iPhone never navigates away; wake lock holds a whole race; real pads on the TV host.
- [ ] **Plug in and play (P1-C13):** join a second laptop and a phone the normal way, then keep plugging in pads and pressing key clusters: each device joins with a press, unplugging or holding its leave chord removes only it, and each shows its connection.
- [ ] **Lots of controllers (P1-C12):** more than four pads across the host and at least one joined laptop, plus two keyboards on one computer as two players (one per key cluster), all racing in one room; a fifth pad on a Chrome host tells you to plug it into a joined laptop or phone.
- [ ] **Recovery:** lock a phone 30 s mid-race → same car within 3 s; its car goes to autopilot and comes back.
- [ ] **Identity:** Identify shows on the TV within ~150 ms on the LAN.
- [ ] **Hosts:** a phone hosts a 4-player race at ≥ 30 fps with sound; a weaker laptop hosts; pacing on the TCL at 4K; a quick host check from Safari on the Mac and from a Windows PC when handy.
- [ ] **Party:** a newcomer gets through the tutorial; settings stick; a mid-race drop-in; voice, music, engines and crash sounds on the TV; remove someone who left.
- [ ] Your **G-FEEL** verdict and repair list (the session writes the round record); if you accept the feel, say so and its traces become the baseline.

(The highlight reel isn't required here; it ships whenever it lands.)

## 4. Derby and items previews (after Playtest 1, never a gate)

- [ ] **D6 Derby:** pick Derby in the lobby; a 3-minute round in the bowl; nobody escapes the bowl however hard they ram; damage points add up honestly; a late joiner scores; Grid ↔ Overview switch.
- [ ] **D7 Items:** pickups are delivery boxes with the item on them; you hold two, used in order; the boomerang flies out and back and you catch it; the sanga lets you shrug off rams and boomerangs for a few seconds.

- [ ] **D8 Extras:** fill a small game with bots (they race, ram and use items); cars tell apart by pattern as well as colour and number; a newcomer practises in their own tile while a round runs, then joins.

## 5. The full test (after Playtest 1, waits for you)

- [ ] Race and derby back to back with 6–10 people, both with items.
- [ ] Derby: containment, scoring, late joiner, Overview.
- [ ] Items: pickup order, boomerang hits and catches, sanga tanking rams, announcer calls for derby and items.
- [ ] Effects and engine sound on the TV feel right.
- [ ] Hub, host removal, highlight reel, and a session bundle replayed by a session.
- [ ] Bots fill a small group convincingly; patterns help in a big group; the practice scene helps a newcomer.
- [ ] Your verdict and the next scope (cars, maps, more items, modes) in the round record.

## 6. Release (when you say go)

- [ ] Pick the preview build and the moment to promote 0.2 to `jammers.dilger.dev` (no 0.1 games running); check the site after.
- [ ] Know the rollback: one workflow run back to the previous build.
- [ ] After about two weeks happy on 0.2, confirm retiring 0.1 (its server and deploy path).
