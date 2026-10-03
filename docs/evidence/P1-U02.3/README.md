# P1-U02.3: TV footer toolbar, host menu, pause flow, global captions

The owner's POC round 1 items POC1-08 to 11 (`docs/playtests/poc-2026-10-03.md`; rulings R96, R97) on the live mock
at `https://jammers-preview.dilger.dev/poc/tv/`. The first reference for the footer is Physical Soccer's host screen,
which the owner sent on 2026-10-03 (saved as `art/ui/refs/owner-2026-10-03/ps-host-footer.jpg`). Its pattern: an ink
band with the QR, room code and player count, team counts, Pause, Fullscreen and Menu. Its menu and pause panels live
inside the frame. We borrowed the idea, no code. The pause flow follows the language of `tv-pause-menu.jpg` through
U01.3's primitives.

**Run:** `node art/ui/poc/tv/capture-host.mjs` writes `report.json` and `captures/`: 22 states at 1080p and five at
21:9 and 4K. Chromium 151.0.7922.34 from Playwright, channel chromium with the GPU flags, on the Mac. This is
Chromium, not Safari and not the TV.

## Decisions (one each, with why)

| Item | What | Why |
|---|---|---|
| Footer (POC1-08) | An 88 px ink band under the grid, the grid filling the screen above it. Left to right: the join (a small QR when no spare cell holds the big one, **ROOM ROO7**, the address, the player count); the race readouts (race and lap, leader, clock) or a global caption; the logo; **Pause**; Fullscreen; the host menu | Physical Soccer's proven band. Nothing in it covers a tile |
| QR (POC1-08, R97) | In dynamic mode a full-size QR (360 px at 1080p) goes in a spare cell when one fits. Otherwise a small one sits in the footer: hovering or focusing it shows the full-size one for 10 s and pauses the game | A small QR doesn't scan from the couch; it points at the big one |
| Host menu (POC1-09) | The puck is gone. The menu button swaps the footer's middle for Players, Diagnostics, Layout (dynamic or static) and Settings… in place, and the logo steps aside. Nothing covers or reflows a tile | Pause is top-level; the menu costs the race nothing |
| Full-screen submenus (POC1-09/10) | Settings, Players and controllers, End round and Disband are in the pause flow, which pauses first. The pause card has a torn "Race paused" banner; "On this TV" and "This room" settings; Resume with burst ticks; then Players and controllers, End round… and Disband room… with their consequences named. The submenus are the players list (sit out, remove), End round (back to the lobby, numbers kept) and Disband (danger strip, keep playing is the default focus). The footer stays, and Pause becomes Resume | Owner: settings, End round and Disband live in the pause flow, restyled like `tv-pause-menu.jpg` |
| Diagnostics (POC1-10) | The footer grows upward with one line per player (path, round trip, input age, loss) and the renderer's numbers. The grid reflows above it and the race carries on | No diagnostics over player tiles |
| Captions (POC1-11) | Global only. Dynamic puts the line in a spare cell when one is free after the QR and the standings. Otherwise, and always when static, it's a saffron pill in the middle of the footer | R96: one place for everyone's line, never one player's tile |
| Dynamic vs static (POC1-11) | A host setting, in the footer menu and the pause card. Dynamic moves the QR, standings and captions into spare cells when they fit. Static keeps them in the footer and leaves spare cells to the backdrop | Both mocked and switchable (`&layout=static`, or click Layout) |

The mock's controls work: Pause, Resume, the menu, Layout, Diagnostics, the QR hover and the pause card's buttons all
navigate, so the owner can click through on the live POC.

## Acceptance

| AC | Result (`report.json`) |
|---|---|
| POC1-08: the footer carries pause and host controls, readouts, the logo, the room code with the domain; the QR around the player screens if it fits, else in the footer; hovering enlarges it and pauses | Footer at N = 8, 24, 32 and 99 (1080p) and at 21:9 and 4K: ROO7, `jammers.dilger.dev · N players`, Pause, Fullscreen, Host menu and the logo, with every tile above the band. N = 3 dynamic: the QR is in a spare cell and not the footer. N = 3 static and N = 32: the QR is in the footer. `qr-hover&n=32`: a 360 px QR (scannable, at least 296 px) and the world paused. |
| POC1-09: the puck is gone; its functions are in the footer menu; Pause is top-level; full-screen submenus pause first | No `.puck` in any state. `menu&n=8`: Players, Diagnostics, Dynamic/Static and Settings… in the footer, game running. Pause is in every footer. `paused&n=8` and the players, end and disband submenus: world paused, card shown, footer button reads Resume. |
| POC1-10: no diagnostics over tiles; the footer expands while playing; settings, End round and Disband in the pause flow, styled after `tv-pause-menu.jpg` | `diagnostics&n=8` and `&n=32`: footer 202 and 372 TV px tall, game running, no element over a tile. Pause card and submenus: `captures/paused_*.jpg`. |
| POC1-11: captions global (footer or a spare cell); dynamic vs static, both mocked and switchable | `captions&n=13` (dynamic) puts the caption in a spare cell. `captions&n=8&layout=static`, and `captions&n=8` (its one spare cell takes the standings), put it in the footer. No caption sits on a tile in any state. |
| Required check: nothing but the countdown and the Identify flash overlays a tile | In all 32 captured states, every element outside a tile that meets a tile is a failure while the world runs. The only exception is an element owned by that tile (the off-screen "your car" arrow, `data-own`). 0 failures. The check does detect coverage: in the paused states, where covering is allowed, it counts 8 elements (QR hover), 56 (pause card) and 41 (players list) over tiles. |

## Changes elsewhere

- **U02.2's grid** now fills the screen above the footer. `capture-grid.mjs` counts the footer band as covered and
  passes again (32 tiles: 268 × 192 at 1080p). `grid-check.mjs` (CI) is unchanged: the kernel takes any rectangle.
- **Removed states** (round 0): the host puck (`host`), the End round modal (`host-end`) and the right-side drawer
  (`input-drawer`). Their content now lives in the footer menu and the pause flow.
- **Buttons and cards** in the TV mock take U01.3's corners (`--r-button`, `--r-panel`).

## Known gaps

- The race readouts are mock data (the leader comes from the scripted laps; the clock counts from page load).
- Static mode leaves spare cells as plain backdrop. A painted art card there is U02.4's (warm-up and lobby art).
- The countdown (`countdown&n=8`) is still per tile. R99 makes it one full-screen flash, which is U05.2's job.
