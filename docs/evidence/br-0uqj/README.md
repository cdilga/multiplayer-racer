# br-0uqj listen-through (R125)

`listen-through.ogg` (Ogg Opus, 19.2 s) is the host's own master output (after the limiter) recorded while a scripted car drives the host's audio path: cruise, a drift with a countersteer and the R120 exit boost, a plain boost, a scrub, surface changes (tarmac, gravel, dirt, off-track), two jumps and a short hop. The engine, tyre, rolling, wind and effect layers all play together, as in a round.

Regenerate: `JJ_DIST=web/dist node --test web/host/tests/audio-motion.test.mjs` (the clip and this table are rewritten from the run). Chromium headless, software audio.

## What to listen for

- Tyre squeal gets louder and higher as the slide gets deeper; a scrub without the drift flag is quieter; none on loose ground beyond a hiss.
- Drift exit: a gear-drop blip then a 1.2 s exhaust roar, clearly longer and lower than the plain boost whoosh that follows later.
- Rolling noise changes character per surface: tarmac hum, gravel crunch, dirt, a low off-track rumble. A small thump marks each change.
- Jumps: take-off whoosh, engine unloads, wind arrives after 0.3 s and rises with height, landing thump bigger for the big jump. The short hop has none of these.

## Scenario phases (seconds into the clip)

| s | phase |
|---|---|
| 0.0 | cruise-tarmac |
| 1.0 | slide-light |
| 1.9 | slide-deep |
| 3.1 | straighten |
| 3.4 | exit-boost |
| 4.8 | cruise |
| 5.7 | scrub-no-drift-flag |
| 6.3 | cruise-2 |
| 7.0 | plain-boost |
| 7.8 | tarmac-fast |
| 8.3 | gravel |
| 9.3 | dirt |
| 10.2 | off-track |
| 11.1 | tarmac-back |
| 11.8 | tarmac-slow |
| 12.6 | run-up |
| 13.1 | jump-big (air 1.85 s) |
| 14.9 | after-big |
| 15.7 | jump-medium (air 1.03 s) |
| 16.8 | after-medium |
| 17.6 | hop-short (air 0.25 s) |
| 17.9 | after-hop |

## Cue timestamps (seconds into the clip, +/- 0.1)

| s | cue | reason | detail |
|---|---|---|---|
| 1.0 | drift-start | car.drift_start | level 0.85 |
| 3.1 | drift-end |  | held 2.1 s  |
| 3.5 | drift-exit-boost | car.drift_exit_boost | held 2.1 s level 0.7 |
| 7.0 | boost-whoosh | car.boost | level 0.7 |
| 8.4 | surface-gravel | car.surface_change | level 1 tarmac to gravel |
| 9.3 | surface-dirt | car.surface_change | level 1 gravel to dirt |
| 10.6 | surface-off-track | car.surface_change | level 1 dirt to off-track |
| 11.3 | surface-tarmac | car.surface_change | level 1 off-track to tarmac |
| 13.2 | takeoff-whoosh | car.takeoff | level 1 |
| 13.4 | wind-on |  |  |
| 15.0 | wind-off |  |  |
| 15.0 | landing-thud | car.landing | fall 9 m/s level 0.75 |
| 16.0 | takeoff-whoosh | car.takeoff | level 1 |
| 16.1 | wind-on |  |  |
| 16.9 | wind-off |  |  |
| 16.9 | landing-thud | car.landing | fall 5 m/s level 0.41 |
| 17.8 | takeoff-whoosh | car.takeoff | level 1 |

Steady layers (squeal, rolling, wind) have no event: their levels per phase are in `probe.json`.
