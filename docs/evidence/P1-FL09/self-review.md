# P1-FL09 (br-bbki.9) visual self-review: the canyon leap lab scene

Reviewer: BrownHill, 2026-10-17. Build: `v0.2-revamp` at 4aefaed7 (contains the scene, 95c823d9 / b2bf0c64), run on eris
through `scripts/remote/eris.sh --run fl09-captures`: host WASM rebuilt, local real jj-server, the committed fixtures
`scenarios/lab/canyon-leap{,-short}.json` on `maps/lab/canyon-leap.json`, frame-stepped through
`web/tests/journeys/lab-scenes.test.mjs` with `JJ_CAPTURE_DIR`. Playwright Chromium (eris has no WebKit; the journey runs
both where both are installed). TV size 1920×1080, mid chase camera. No phone connected. Reference:
`art/references/australia/generated/biome-rocks-olgas.png`.

## Looked at

| Capture | What I saw |
|---|---|
| `captures/chromium-canyon-leap-overview-1920x1080.jpg` | The scene from above: an oval through Olgas domes, the canyon leap on the back straight (kicker, the pit cut across the road, the landing) with the dirt detour looping round it on the outside. The leap reads as the scene's centre piece. |
| `captures/chromium-canyon-leap-approach-1920x1080.jpg` | One second after the spawn, entering the rock channel: walls both sides, the landing road climbing away beyond the gap, a dome on the skyline, the detour to the right. The Olgas reference's composition (a road between rock walls, the jump ahead). |
| `captures/chromium-canyon-leap-air-1920x1080.jpg` | Just off the lip: the pit under the car, rock walls both sides, the far rim and landing ahead. |
| `captures/chromium-canyon-leap-side-air-1920x1080.jpg` | Side angle mid-air: the car level over the gap. |
| `captures/chromium-canyon-leap-short-air-1920x1080.jpg` | The too-slow run at the lip: the car dropping toward the pit short of the far rim (the fixture then counts one wreck and the respawn). |
| `captures/chromium-canyon-leap-short-approach-1920x1080.jpg`, `captures/chromium-canyon-leap-short-side-air-1920x1080.jpg`, `captures/chromium-canyon-leap-short-overview-1920x1080.jpg` | The same views for the short run; nothing different to note. |

## Defects found and fixed

- The short run first stalled on the kicker (a car coasting at 9 m/s from 4 m before the kicker's foot never reached
  the lip): runs are now placed relative to the lip and the short run holds a third of the throttle from 40 m back.
- The short run then wrecked twice (respawned, drove into the pit again on held throttle): the fixture stops at the
  first wreck (`until`).
- The fixtures were first written under `scenarios/feel/` (reserved by another worker); the lab scenes have their own
  `scenarios/lab/` in the scenario bank.

## Remaining defects

- The pit's walls are jagged (2.5 m grid cells on near-vertical cliffs), as in the generated canyon leaps (P1-FL15b).
- The "approach" frame is one second in, so it shows the channel entrance rather than the leap from the far straight.

## Not covered

- **Loading the scene from the Feel Lab** (AC1's first half) needs the scene picker, P1-FL03.1 (br-bbki.19), which
  doesn't exist yet. The scene is data (`assets/lab/scenes.json`) and `jj lab canyon-leap` builds it, ready for the
  picker.
- No phone or real TV; Chromium only on eris.
