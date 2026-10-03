# TV mocks (P1-U02)

Live layout mocks of the shared screen for the design review (G-DESIGN, Playtest-1 plan §3a). Static
files only, served from `art/ui/` (`node art/ui/lib/serve.mjs`, then open `/poc/tv/`); no CDN, no game
code. Tiles are live three.js: Spike J's Cruz Missile (vendored by `../vendor.mjs`) driving scripted laps
on a greybox outback loop. The HUD is one DOM layer positioned over the tile viewports, the way the game
would build it, so its cost is measured (`capture.mjs --perf`). Sizes come from `art/ui/tokens.json`
in TV px at 1080p, scaled by the output height, so 1080p, 4K, 21:9 and a phone host share one layout.

Every state opens from a URL fragment (`#grid&n=7&fp=2,5`); `#` is the contents page and **H** returns
to it. `states.js` lists them all; `capture.mjs` captures each at 1080p and 4K (grid states also at
21:9 and on a portrait phone) into `docs/evidence/P1-U02/`. The round-1 rework (P1-U02.2) has its own checks:
`grid-check.mjs` (CI: every tile the same area for N = 1..40, 64, 99 on six screens) and `capture-grid.mjs` (the
rendered page, captures, HUD pills, the Cooee flash) into `docs/evidence/P1-U02.2/`.

## Proposals (one each, with why; the owner redirects at P1-U04)

| Question | Proposal | Why |
|---|---|---|
| **Grid rule** (→ P1-R04; reworked in P1-U02.2 for R95) | `grid.js` `layoutGrid`; pseudocode on the grid player (`#grid-player`): try every row count R with C = ⌈N/R⌉ columns; one tile size for all, in whole pixels, clamped to the 1.2–2.0 aspect band; keep the largest tile (ties: fewer empty cells); the C×R block is centred and filled in reading order | Every player tile has exactly the same area at any N (R95, owner round 1), and the most of it the screen allows |
| **Gaps** (N = 3, 5, 7, 10, 13, 26, 27, 32…) | The C×R − N empty cells sit at the end of the last row, each exactly a tile. The first cell (or margin) that fits a scannable QR shows the join QR (with no room for a QR, the room code and address), the next the live standings; the rest, and the margins, the dotted paper backdrop | Whole cells keep the QR at the side of the players big enough to scan (POC1-05); nothing is black and no tile is ever larger (POC1-04) |
| **Join QR during play** | A QR only where it can be ≥ 296 px at 1080p (8 px per module): big filler cells, the one-player corner, the lobby and results. Otherwise the bottom-right chip shows the room code only | A smaller QR doesn't scan from a couch (`tokens.qr`), so it would only be decoration |
| **Per-tile HUD** (→ P1-R07) | Top-left: number badge + name (12 graphemes). Top-right: position and lap on **one line**. Bottom-left: boost meter, with autopilot/reconnecting chips above it. Wreck countdown mid-tile. Bottom-centre and bottom-right stay free. Every pill is one line high (1.5 em) | The top band is sky and the bottom-centre is your car in a chase view; the road ahead stays clear (master §12.1); one-line pills (POC1-06) |
| **HUD size** (P1-U02.2) | Text is 7.5% of the tile height, from 16 px (32 tiles at 1080p: a 29 px pill on a 210 px tile) to 32 px, × the screen scale. Below about 230 × 140 px the name goes; number, place and lap stay | The owner found the 32-tile HUD too large (POC1-06): it now scales down with the tile, below the TV text minimum of 24 px, which still holds for every other TV text |
| **Identify** (P1-U02.2) | "**Cooee #7**" over a transparent, high-exposure flash in the seat colour (the 3D under it brightened ×2.2 with a seat-colour wash): fast attack, 1.4 s decay, 1.5 s in all. The tile frame and badge pulse and the car is outlined in every tile. Reduced motion: the wash held steady at 60% for the same 1.5 s, no tween or scale. The mock replays it every 3 s | R99 (owner round 1, POC1-07); the flash sits under the HUD so the pills stay readable |
| **Mixed cameras** | Third person by default; first person per seat shows the bonnet edge from the driver's side (right-hand drive) | §3a, master §6.3 |
| **Captions** (→ P1-A03) | A line about one player: a speech sticker in that player's tile under its top HUD band. A line for everyone: in the standings filler if there is one, otherwise an ink pill top-centre under the top row's HUD band | The top band's middle is sky in every view; corners are HUD |
| **Host controls** (→ P1-R07, C05) | A host puck in the bottom-right corner (the HUD-free corner): Pause, Players, Diagnostics, End round…; it shows on host input and hides 4 s later. End round vs Disband room are separate buttons in one confirmation | Out of the way during a race; destructive actions can't be hit by accident |
| **Players and controllers drawer** | Right-side drawer: each player's number, name, controller (phone, pad, keyboard, hub) and how it's connected (direct, relay, wired, hub) with Remove | Owner 2026-10-03: a small UI showing how each controller is connected; the host can remove a player |
| **Lobby** | The warm-up drive behind the QR and the roster; full cards reflow into more columns down to the legible minimum, then number + name chips with a Ready dot, then pages that turn every 6 s | Any N reads; there's never a "max players" (§3a) |
| **Results** | H4's layout without voting: highlights reel, podium, standings (columns keep room for names, then pages), "Next race starts in 42s", a full-size join QR, Hide replay / Start next round now / Return to lobby | H4 is the most authoritative reference |
| **Over-3D overlays** | On the per-player grid: an arrow at the tile edge points to your car when it's off-screen, and Identify outlines the car. Name plates over cars only on the Derby Overview and other single-shared-screen modes | R100 (POC1-14): on the grid every player has their own tile and number |
| **Derby Overview** (design reference; Full) | One shared view of the bowl framing every car at a fixed 60° pitch, never rotating; identity rings under cars; thin edge bands for the timer and damage points; the host's Grid ↔ Overview switch | Master §6.4 |

## Known gaps

- The in-world look (toon ramp, ink outlines, halftone) is P1-U05's; these tiles use plain lit materials.
- Nameplate decluttering (Overview only now) is a simple nudge; P1-R07 owns the real rule.
- The per-tile countdown (`countdown&n=8`) and the motion reel's identify are still round 0: R99 makes the 3-2-1 one
  full-screen overlay, and P1-U05.2 owns that and the reel's flash.
- The 3D is a mock: scripted laps, no physics, cars may overlap.
