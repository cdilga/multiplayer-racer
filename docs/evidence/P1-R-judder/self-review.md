# P1-R-judder (br-gw74.14): camera judder, measured on a real host

**Hardware/browser:** MacBook Pro (Apple M1 Pro), Google Chrome 155.0.8059.39. 120 Hz: headed Chrome on the built-in
ProMotion display. 60 Hz: headless Chrome with the GPU (`--gpu`, Metal ANGLE), which paces frames at 60 Hz. The
software-GL headless run (15–18 fps) is not used: too slow to show judder.
**Build:** v0.2-revamp at 3a2c542b plus this change (`npm --prefix web run build`).
**Probe:** `node web/host/tests/camera-judder.mjs [--headed | --gpu --channel chrome] --out <file>`: the live host runs
`scenarios/straight-throttle.json` (full throttle down the greybox's 170 m main straight, about 32 m/s while traced), one
tile chases car 0, and `__jjRender.cameraTrace` records seat 1's camera every frame for 2.5 s. Motion is measured at each
frame's **vsync (rAF) time**, when the frame reaches the screen.

## Cause

The playback clock from 24082b4f was smooth in its unit test, but `World.frame()` read `performance.now()` when the code
ran, not the frame's rAF timestamp, and the camera rig took a second `performance.now()` later in the same frame. On a
real host, main-thread timing varies by milliseconds from frame to frame, so the world advanced by "when JS ran" while the
screen showed it at vsync: uneven motion. The fix passes rAF's timestamp into `frame(now)`, so the clock, the grid and the
camera rig step by one shared vsync time.

## Numbers (seat 1, straight, per frame)

| | rendered tick within 5 % of frame dt × 120 | camera jerk p50 / p95 / p99 / max (m/s per frame) |
|---|---|---|
| 120 Hz chase, before (2 runs) | 96.3 %, 89.7 % | 0.57 / 1.86 / 9.15 / 18.8 · 0.48 / 7.13 / 24.95 / 52.4 |
| 120 Hz chase, after (2 runs) | 100 %, 100 % | 0.22 / 0.39 / 0.49 / 0.51 · 0.16 / 0.41 / 0.67 / 0.98 |
| 120 Hz hood, before (2 runs) | 97.7 %, 94.3 % | 0.35 / 1.73 / 2.65 / 3.44 · 0.42 / 1.95 / 4.41 / 5.36 |
| 120 Hz hood, after (2 runs) | 100 %, 100 % | 0.11 / 0.40 / 0.60 / 0.67 · 0.21 / 0.39 / 0.61 / 0.62 |
| 60 Hz chase, before → after | 63.1 % → 100 % | 1.34 / 4.32 / 5.91 / 6.20 → 0.16 / 0.51 / 0.63 / 0.64 |
| 60 Hz hood, before → after | 53.7 % → 100 % | 1.74 / 6.13 / 9.77 / 16.2 → 0.20 / 0.52 / 0.69 / 0.77 |

The rendered tick never ran backwards in any run. After the fix the camera's jerk equals the car's own (the rig follows
rigidly on a straight), and what's left is the car accelerating. The hood cam's FOV kick moves at most 0.14° per frame.
Raw files: `before-*.json`, `after-*.json` here.

## What I looked at

`tp-0..2.jpg` (chase) and `fp-0..2.jpg` (hood with the mirror strip), 1920×1080, taken while the trace ran. Both draw
correctly: the car is centred in the chase view, the road runs straight ahead, and the mirror shows the road behind. No
blank panels, overlaps or broken images. Stills can't show judder, so the per-frame trace above is the evidence for
smoothness. The owner judges the feel at the couch test.

Observed, not changed here: the hood cam's view has the roof aerial standing in the left of frame (it's the car's own
mesh, visible at all speeds).

Not measured: generated tracks with relief. The chase rig's ground lift (`overGround`) raises the camera in 0.5 m
steps and the pull-in snaps, so a dip or an obstacle could still pop the chase camera. Neither occurs on this straight.
