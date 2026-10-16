# P1-FL15b (br-bbki.15.2) visual self-review: set pieces stamped into the landscape

Reviewer: BrownHill, 2026-10-16. Build: shared tree on `v0.2-revamp` (P1-FL15a terrain + P1-FL15b set pieces, uncommitted at
capture time), host WASM rebuilt with `scripts/build-host-wasm.sh`, local real jj-server, frame-stepped WASM fixtures from
`web/tests/journeys/set-piece.test.mjs` (`JJ_CAPTURE_DIR` set). TV size 1920×1080, mid chase camera. Browsers: Playwright
Chromium (captures below) and Playwright WebKit (the journey also passed there; WebKit is not Safari). No phone connected.

Seeds (first seed of each recipe that places the kind): canyon leap Rocks 0, mesa drop Outback Bitumen 3, creek washout
Outback Dirt 3. Reference: `art/references/australia/generated/biome-rocks-olgas.png`.

## What I looked at, and what I saw

| Capture | Verdict |
|---|---|
| `captures/chromium-canyon-leap-air-1920x1080.jpg` | Just off the kicker over the pit, red rock walls both sides of the channel, the far rim and the landing road ahead, Olgas-style domes beyond. Reads as the reference's canyon leap. The pit's walls are jagged (2.5 m grid cells on near-vertical cliffs): reads as broken rock, acceptable, not smooth. |
| `captures/chromium-canyon-leap-side-air-1920x1080.jpg` | Car mid-air, level, over the gap. Good. |
| `captures/chromium-canyon-leap-afar-1920x1080.jpg` | 200 m before the commitment point this seed's approach is the start straight (gantry in frame) inside a gorge; the domes are visible over it. |
| `captures/chromium-creek-washout-air-1920x1080.jpg` | Over the gully, landing ahead; the dirt detour (the safe line) is visible on the right, curving round and fording the creek. Good. |
| `captures/chromium-creek-washout-side-air-1920x1080.jpg` | Car airborne over the creek bank. Good. |
| `captures/chromium-mesa-drop-air-1920x1080.jpg` | **Weak.** The frame shows the car on a raised road with a cutting ahead; the mesa's drop (2.5–4 m) is not legible from the chase camera in this frame. The mesa needs a stronger silhouette (taller plateau, steeper breakaway) to read as a mesa drop. Known gap, below. |
| `captures/*-overview-1920x1080.jpg` | **Broken, not set pieces:** the zero-car overview camera frames the field at y = 0 and ends up inside the raised P1-FL15a landforms (dome underside, flat plain). Reported to CoralCrane (their `world.ts` fix). |

## Behaviour behind the pictures (fixtures, not eyeballing)

`crates/jj-procgen/tests/setpieces.rs` (release, rch): data validates; every prepared track has at least one piece per lap on
20 seeds × 4 biomes and all three kinds are placed; the autopilot lands every placed piece on 10 seeds × 4 biomes; a car
leaving the lip too slowly falls into the pit and respawns; every piece's landmark is in the mid chase camera's view at least
10 s of the 15 s before its commitment point; every kicker and landing is a collider where the map says. The journey checks
drawn kicker/landing triangles against the native collision mesh (R90 `jumpShapes`) and WASM against native replay.

## Known gaps (stated, not hidden)

- Mesa drop reads weakly on screen (above).
- Overview camera inside the landforms (P1-FL15a/R10, not this bead).
- Bots always take the leap; choosing the detour is P1-FL16 (route choices).
- The landing is aligned by geometry (far rim about level with the lip, down-slope landing); R129's landing-aligned boost
  is not part of this bead.
