# Style frames (P1-U01.2)

Painted targets for the owner's design review (P1-U04), one image per subject with related views packed together.
They show the house style; they are not mocks of the real UI (those are `../poc/`).

| Frame | What it shows |
|---|---|
| `tv-race-grid.webp` | The TV during a race with eight players: a 4 × 2 grid of live views (six chase, two bonnet cameras) with the per-tile HUD (badge, name, position, lap, boost) and nothing else on screen |
| `lobby-32.webp` | The TV lobby at 32 players: QR and room code, the roster in four columns with Ready ticks and "choosing…", the Start race button, the painted warm-up behind the chrome (superseded by R110: no warm-up behind the lobby) |
| `phone-controller.webp` | The phone controller, sideways, in a dark room (DRIVE and ACTION sticks, boost meter, HUD strip, Find my car) beside the phone lobby, upright (badge, name reroll, car still, Ready) |
| `tv-derby-overview.webp` | The derby from a fixed high camera: sixteen battered cars in a quarry bowl with nameplates, debris lying where it fell |

**Placeholders.** Every car, number badge, name, room code and wordmark in these frames is generated and a placeholder.
The real car is Spike J's Cruz Missile (`spikes/art-pipeline/J-cruze-lowpoly/`), the real badges and colours come from
`../tokens.json`, and the real wordmark is GUIDE §9. Frames don't ship.

**How they were made.** `node art/ui/frames/generate.mjs <name> [--n 3] [--suffix -x]` sends `prompts/<name>.txt` verbatim to
Meta's Muse Image (`muse-image-1.0`, `/v1/images/edits`) with H4 (`docs/plans/ux-study-2026-09-29/images/H4-host-round-results-v2.png`)
as the first reference image, plus Spike J's car render (and, for the phone, M2's controls). Each prompt is a style
lock on H4, then MASTER_PROMPTS' master block, the UI block with the H4 direction, the subject and the guards
(`art/style/MASTER_PROMPTS.md`). The key is `MUSE_API_KEY` from the environment or the repo's git-ignored `.env`.

`ledger.jsonl` records every call (prompt hash, references, size, files, cost) and refuses any call past the owner's cap of
$2.50 (250 images). Three rounds, 31 images, $0.31. Each round generated about three variants per subject and one was picked;
the alternates weren't kept in the repo, though the ledger still names them. Round 1 had no style lock and came out as a glossy
3D render in an American wild-west town. Round 2 added the lock. Round 3 answered the fresh-eyes review: 16:9 TV frames, chase
cameras behind the car, exactly 32 numbered lobby cards, flat colours on the phone, and battered derby cars with debris.

The picks (all round 3) and why:

- `tv-race-grid`: variant 2. Tiles edge to edge on navy gutters, six chase views from behind and two bonnet views with no
  cockpit; the car stripes follow each player's colour.
- `lobby-32`: variant 2. Exactly 32 cards numbered 1–32 in order. Variant 3 said "32 players can join", which reads as a cap;
  variant 1 copied H4's "Round 3 complete".
- `phone-controller`: variant 1. Flat comic colours; the lobby's car still is the faceted hatchback. Its sideways panel is
  about 1.3:1, not phone-shaped, so treat it as a layout sketch, not a style target.
- `tv-derby-overview`: variant 2. Sixteen battered cars, debris all over the floor, and minimal chrome ("Derby" and the timer).

Still wrong in the frames, from the review (`docs/evidence/P1-U01/style-frames-review.md`): the race grid has position stickers
on only five tiles; the derby has 15 nameplates for 16 cars; the lobby header says 27 ready where the cards show 25; the phone
repeats some stick labels and its sticks look like d-pads. They're placeholders for feel, not specs: the mocks in `../poc/`
carry the exact layouts.
