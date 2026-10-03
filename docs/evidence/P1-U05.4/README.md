# P1-U05.4: Derby Overview rework (smooth, predictive, near-fixed camera; an arena designed for it)

The owner's POC round 2 items POC2-06 to 08 (`docs/playtests/poc-2026-10-03-round2.md`; ruling R107): round 0's
Overview camera made the owner motion sick. The camera is now one shared rig (`art/ui/poc/shared/overview-camera.js`),
used by the TV mock and the in-world mock, with its values in `art/ui/poc/shared/framing.json` `overview`, the TUNE
inputs for P1-R11.

**Machine and browser:** Apple M1 Pro, Chromium 151 from Playwright with the GPU flags. Re-run with
`node art/ui/poc/tv/capture-overview.mjs`, which writes `report.json`, `captures/`, the videos and
`art/ui/poc/world/overview-zones.json`.

## Decisions (one each, with why)

| Item | What | Why |
|---|---|---|
| Smooth (POC2-06) | The centre and the zoom follow critically damped springs (pan 0.9 s; zoom out 0.8 s, in 2.4 s) with speed limits (14 m/s of pan, 12 m/s of frame). Before the springs, the goal goes through a soft dead zone (2.5 m, 6% of the frame) and a 0.45 s low-pass, so the spring's acceleration never steps. There's no overshoot snap (zeroing velocity in one step was the last jerk spike) and no rotation: fixed 60° pitch and heading | Motion sickness comes from sudden acceleration (jerk) and rotation. Round 0 refitted the box round every car on every frame, so every car's wobble moved the camera |
| Predictive (POC2-07) | Each car's velocity, smoothed over 0.3 s, says where it will be 1.6 s ahead. The centre follows those predicted positions, and the frame covers both now and then, so it opens before the pack spreads | Drivers see what's coming and can correct; scale is predicted, not reactive |
| Near-fixed (POC2-08) | The centre drifts at most 12 m from the bowl's centre, and the frame shows 120 to 165 m of ground, so the smallest frame still holds the whole bowl | A camera that barely moves lets the arena be designed for it |
| The arena | Nine Olgas-style domes (Kata Tjuta's rounded red heads, seeded) stand just behind the far rim, which is the top band of every frame; quarry terraces step up on both flanks; the parked utes, shed, windmill and sign sit by the far rim. `overview-zones.json` records the ground the camera always and sometimes shows, and the zone each dressing item sits in | Generative dressing where the camera sees it; zones for P1-M10. More variety is a later bead |

## Acceptance (`report.json`)

The camera paths are compared on the **same** derby. The cars' motion is recorded once at a fixed 1/60 s step from a
seeded waypoint generator, then replayed into each rig: 30 s after a 2 s warm-up, 16:9.

| | Round 0 (refit every frame) | New rig |
|---|---|---|
| 8 cars: acceleration RMS / p95 / max (m/s²) | 99.6 / 31.0 / 1561 | **5.2 / 9.9 / 11.3** |
| 8 cars: jerk RMS / p95 / max (m/s³) | 7222 / 8092 / 93836 | **14.0 / 24.8 / 38.6** |
| 24 cars: acceleration RMS / p95 / max | 113.4 / 105.2 / 1415 | **5.2 / 9.9 / 12.9** |
| 24 cars: jerk RMS / p95 / max | 8211 / 15194 / 85369 | **13.5 / 26.0 / 36.3** |
| 8 cars: share of cars' actual positions 1.5 s later already inside the current frame | 95.9% | **100%** |
| 24 cars: the same | 97.3% (108 samples near the edge) | **100%** (0 near the edge) |

| AC | Result |
|---|---|
| POC2-06: smooth (critically damped, no rotation); jerk metric before and after | The table: jerk RMS is about 500× lower at 8 cars and about 600× lower at 24, and acceleration RMS about 20× lower. The camera never rotates (fixed pitch and heading in both rigs). Videos: `tv-overview-24-round0.webm` against `tv-overview-24-new.webm` |
| POC2-07: predictive (velocity-led look-ahead) at 8 and 24 cars | Every car's position 1.5 s later is already in frame (100% at 8 and 24, against 95.9% and 97.3%), with no car outside the frame or near its edge |
| POC2-08: the bowl designed for the near-fixed camera; dressing visible from it; zones recorded | Always in view across the whole drift and zoom envelope: all 6 quarry terraces, 3 of the 9 domes (the other 6 sometimes), the windmill, shed, sign, 4 parked utes and 3 of the 4 hay-bale groups. Ground always in view runs from 84 m beyond the centre on the far side to 44 m on the near side; ground sometimes in view from 140 m to 84 m. All in `art/ui/poc/world/overview-zones.json`. Captures: `captures/world-overview_n=8.jpg`, `_n=24.jpg`; video `world-overview-16-new.webm` |

No page errors. Debris stays dynamic and nothing caps the count: the rig takes any number of cars.

## Known gaps

- The TV mock's bowl is a greybox and doesn't carry the in-world dressing. The arena design is shown in the in-world
  mock.
- The near rim isn't always in view at the smallest frame (the always-visible ground ends 44 m from the centre on the
  near side). The rig still keeps every car in frame.
- R11 builds the real camera. These are its starting values, judged by the owner at G-DESIGN.
