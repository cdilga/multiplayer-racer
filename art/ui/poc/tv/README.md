# TV mocks (P1-U02)

Live layout mocks of the shared screen for the design review (G-DESIGN, Playtest-1 plan §3a). Static
files only, served from `art/ui/` (`node art/ui/lib/serve.mjs`, then open `/poc/tv/`); no CDN, no game
code. Tiles are live three.js: Spike J's Cruz Missile (vendored by `../vendor.mjs`) driving scripted laps
on a greybox outback loop. The HUD is one DOM layer positioned over the tile viewports, the way the game
would build it, so its cost is measured (`capture.mjs --perf`). Sizes come from `art/ui/tokens.json`
in TV px at 1080p, scaled by the output height, so 1080p, 4K, 21:9 and a phone host share one layout.

Every state opens from a URL fragment (`#grid&n=7&fp=2,5`); `#` is the contents page and **H** returns
to it. `states.js` lists them all; `capture.mjs` captures each at 1080p and 4K (grid states also at
21:9 and on a portrait phone) into `docs/evidence/P1-U02/`.

## Proposals (one each, with why; the owner redirects at P1-U04)

| Question | Proposal | Why |
|---|---|---|
| **Grid rule** (→ P1-R04) | `grid.js` `layoutGrid`; pseudocode on the grid player (`#grid-player`): try every row count, balanced rows with fuller rows on top, each tile clamped to the 1.2–2.0 aspect band and centred in its row; score by total tile area, then the smallest tile | Gameplay area first, then own-car readability (master §6.2); gap cases fall out of the same rule |
| **Gaps** (N = 2, 3, 5, 7, 10, 13) | Short rows are centred with wider tiles; the largest leftover cell shows the join QR, the next the live standings, the rest a dotted paper backdrop | Nothing is ever black (§3a) |
| **Join QR during play** | A QR only where it can be ≥ 296 px at 1080p (8 px per module): big filler cells, the one-player corner, the lobby and results. Otherwise the bottom-right chip shows the room code only | A smaller QR doesn't scan from a couch (`tokens.qr`), so it would only be decoration |
| **Per-tile HUD** (→ P1-R07) | Top-left: number badge + name (12 graphemes). Top-right: position and lap. Bottom-left: boost meter, with autopilot/reconnecting chips above it. Wreck countdown mid-tile. Bottom-centre and bottom-right stay free | The top band is sky and the bottom-centre is your car in a chase view; the road ahead stays clear (master §12.1) |
| **HUD size** | Scales with tile height but never below 24 px text (cap height 16.8 px) at 1080p | Legible from 3 m at 32 tiles (measured, `cap-height` in `capture-report.json`) |
| **Identify** | Thick pulsing seat-colour frame on the tile, the badge pulses, a "#7 THAT'S YOU!" sticker over the car, and an outline on the car in every tile | Master §5.2 |
| **Mixed cameras** | Third person by default; first person per seat shows the bonnet edge from the driver's side (right-hand drive) | §3a, master §6.3 |
| **Captions** (→ P1-A03) | A line about one player: a speech sticker in that player's tile under its top HUD band. A line for everyone: in the standings filler if there is one, otherwise an ink pill top-centre under the top row's HUD band | The top band's middle is sky in every view; corners are HUD |
| **Host controls** (→ P1-R07, C05) | A host puck in the bottom-right corner (the HUD-free corner): Pause, Players, Diagnostics, End round…; it shows on host input and hides 4 s later. End round vs Disband room are separate buttons in one confirmation | Out of the way during a race; destructive actions can't be hit by accident |
| **Players and controllers drawer** | Right-side drawer: each player's number, name, controller (phone, pad, keyboard, hub) and how it's connected (direct, relay, wired, hub) with Remove | Owner 2026-10-03: a small UI showing how each controller is connected; the host can remove a player |
| **Lobby** | The warm-up drive behind the QR and the roster; full cards reflow into more columns down to the legible minimum, then number + name chips with a Ready dot, then pages that turn every 6 s | Any N reads; there's never a "max players" (§3a) |
| **Results** | H4's layout without voting: highlights reel, podium, standings (columns keep room for names, then pages), "Next race starts in 42s", a full-size join QR, Hide replay / Start next round now / Return to lobby | H4 is the most authoritative reference |
| **Over-3D overlays** | Nameplates (badge + 8-grapheme name) over other cars, nudged up when they overlap; an arrow at the tile edge points to your car when it's off-screen | Find each other and yourself without covering the road |
| **Derby Overview** (design reference; Full) | One shared view of the bowl framing every car at a fixed 60° pitch, never rotating; identity rings under cars; thin edge bands for the timer and damage points; the host's Grid ↔ Overview switch | Master §6.4 |

## Known gaps

- The in-world look (toon ramp, ink outlines, halftone) is P1-U05's; these tiles use plain lit materials.
- Nameplate decluttering is a simple nudge; P1-R07 owns the real rule.
- The 3D is a mock: scripted laps, no physics, cars may overlap.
