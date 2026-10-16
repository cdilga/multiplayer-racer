# P1-FL15b (br-bbki.15.2) visual self-review: set pieces stamped into the landscape

Reviewer: BrownHill, 2026-10-16. Build: `f48de9bf` on `v0.2-revamp` (P1-FL15a terrain + P1-FL15b set pieces, joint commit
`82cb97f9`), run on eris through `scripts/remote/eris.sh --run fl15b-captures` (host WASM rebuilt with
`scripts/build-host-wasm.sh`, local real jj-server, frame-stepped WASM fixtures from `web/tests/journeys/set-piece.test.mjs`
with `JJ_CAPTURE_DIR` set). TV size 1920×1080, mid chase camera. Browsers: Playwright Chromium on eris (all assertions and the
`chromium-*` captures below); Playwright WebKit on the Mac at `82cb97f9` plus the uncommitted journey (all assertions passed,
`webkit-*` captures, overview before its fix; WebKit is not Safari; eris has no WebKit installed). No phone connected.

Seeds (first seed of each recipe that places the kind): canyon leap Rocks 0, mesa drop Outback Bitumen 3, creek washout
Outback Dirt 3. Reference: `art/references/australia/generated/biome-rocks-olgas.png`.

## Looked at

| Capture | Verdict |
|---|---|
| `captures/chromium-canyon-leap-air-1920x1080.jpg` | Just off the kicker over the pit, red rock walls both sides of the channel, the far rim and the landing road ahead, Olgas-style domes beyond. Reads as the reference's canyon leap. The pit's walls are jagged (2.5 m grid cells on near-vertical cliffs): reads as broken rock, acceptable, not smooth. |
| `captures/chromium-canyon-leap-side-air-1920x1080.jpg` | Car mid-air, level, over the gap. Good. |
| `captures/chromium-canyon-leap-afar-1920x1080.jpg` | 200 m before the commitment point this seed's approach is the start straight (gantry in frame) inside a gorge; the domes are visible over it. |
| `captures/chromium-creek-washout-air-1920x1080.jpg` | Over the gully, landing ahead; the dirt detour (the safe line) is visible on the right, curving round and fording the creek. Good. |
| `captures/chromium-creek-washout-side-air-1920x1080.jpg` | Car airborne over the creek bank. Good. |
| `captures/chromium-mesa-drop-air-1920x1080.jpg` | Just off the lip on a raised plateau road: the ground falls away both sides, the run-out climbs a cutting ahead, a flat-topped mesa on the horizon. Reads as a drop off a mesa, but the plateau is low (2.5–4 m) on the flattest biome (Bitumen); a taller breakaway would read stronger. Known gap, below. |
| `captures/chromium-canyon-leap-overview-1920x1080.jpg`, `captures/chromium-mesa-drop-overview-1920x1080.jpg`, `captures/chromium-creek-washout-overview-1920x1080.jpg` | Whole course framed from above (fixed: the zero-car overview now follows no car, as `tools/maps/review-landscape.mjs` does). Canyon leap (Rocks 0): the leap on the left straight between domes with its detour alongside. Mesa drop and creek washout: the detour loops off the road beside each piece are visible from the overview. |
| `captures/webkit-canyon-leap-air-1920x1080.jpg` and the other `webkit-` captures | Same views in WebKit (Mac); the overview frames there predate the fix and show the camera inside a dome. |

## Behaviour behind the pictures (fixtures, not eyeballing)

`crates/jj-procgen/tests/setpieces.rs` (release, rch): data validates; every prepared track has at least one piece per lap on
20 seeds × 4 biomes and all three kinds are placed; the autopilot lands every placed piece on 10 seeds × 4 biomes; a car
leaving the lip too slowly falls into the pit and respawns; every piece's landmark is in the mid chase camera's view at least
10 s of the 15 s before its commitment point; every kicker and landing is a collider where the map says. The journey checks
drawn kicker/landing triangles against the native collision mesh (R90 `jumpShapes`) and WASM against native replay.

## Defects found and fixed

- Overview captures showed the camera inside a dome (the zero-car overview still followed a car slot): the journey now
  calls `setFollow(null)` for the overview, as the landscape review tool does; recaptured.
- The kicker's flat top ran the full road width, so its side slopes climbed the canyon wall and the front edge's normal
  turned into a wall: cars stopped dead at the ramp's foot. Flat top = road − 2 × edge slope.
- The approach ease started flat where a 12 % terrain climb met it (a crest the autopilot flipped on at 25 m/s): approach
  and run-out are now C1 Hermites from the terrain's height and grade.
- A far rim below the take-off ground gave a ~20° descent onto a 9° landing: the far rim now sits about level with the lip.
- The pit started at the lip, sinking the kicker's last sections into the bilinear ground: it now starts 1.5 cells past.

## Remaining defects

- Mesa drop reads weakly on screen: the plateau is low (2.5–4 m) on the flattest biome.
- The pit walls are jagged (2.5 m grid cells on near-vertical cliffs): reads as broken rock, not smooth.

## Not covered

- Bots always take the leap; choosing the detour is P1-FL16 (route choices).
- The landing is aligned by geometry (far rim about level with the lip, down-slope landing); R129's landing-aligned boost
  is not part of this bead.
- No phone or real TV: Playwright at 1920×1080 only. WebKit overview frames predate the overview fix.
