# br-gw74.14.1 (P1-R-relief): the chase camera rides relief without popping

`web/host/src/camera/rig.ts` `overGround` raised the chase in 0.5 m steps until the line of sight cleared, written
straight to the camera, so crests, dips and jumps made it pop. Now the least lift that clears the ground and keeps the line
of sight 0.2 m over it is solved exactly per sample; the lift aims at the most the next 0.8 s of travel needs (with 1 m
headroom), through a 0.15 s first-order aim filter and a critically damped spring (rise 6/s, settle 2.5/s), never under
the exact line-of-sight floor. Values in `assets/profiles/camera.json` (`rig.ground*`).

## Measured (camera.test.mjs 'relief…', eris, Node 26; rolling 0-8 m ground with a 3 m crest and a 4 m dip, 15 m/s)

Camera vs car vertical jerk, p99 (m/s³); hidden = frames where the ground cut the car's line of sight:

| | 60 Hz camera / car | 120 Hz camera / car | hidden |
|---|---|---|---|
| Before (0.5 m steps), 5033e773 | 107 875 / 503 (214x) | 180 397 / 504 (358x) | 0 |
| Exact lift, no smoothing | 49 690 / 503 | 49 259 / 504 | 0 |
| Spring | 19 679 / 503 | 49 259 / 504 | 0 |
| Spring + 0.5 s look-ahead | 5 273 / 503 | 6 286 / 504 | 0 |
| **Shipped** (aim filter, rise 6, headroom 1 m, look-ahead 0.8 s), 61fd83de | **535 / 503 (1.06x)** | **562 / 504 (1.11x)** | **0** |

The other camera tests on eris pass (respawn cut, undulating clearance, big air).

## Looked at

`sheet.jpg` (and `chase-t*.jpg`): generated Rocks seed 1 (`jj procgen --seed 1 --recipe rocks` at 61fd83de), a Cruz at
35 m/s over its road-wide jump, chase stills at ticks 45, 90, 135, 180, 240 (`web/host/tests/jump-capture.mjs`,
Playwright Chromium on eris). Run-up and the crest of the lip: the camera sits steadily behind, the road and lip clear.
In the air the car climbs in frame (the big-air hold). Down into the landing dip: the car and the road beyond stay in
view; the ground never covers the car.

## Defects found and fixed

- Stepped lift (the pop), then kinks wherever a different sample bound the lift, then the floor overtaking a lagging
  spring at the crest: each measured above and fixed in turn.

## Remaining defects

- None seen.

## Not covered

- The browser judder probe (`camera-judder.mjs`) drives the flat greybox, where the lift is 0; this relief case is the
  unit-level probe above. No pull-in obstacles in this run (`pullIn` still moves in one frame when dressing blocks the
  view). Phones are controllers, not cameras.
