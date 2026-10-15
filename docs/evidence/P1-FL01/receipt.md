# P1-FL01 (br-bbki.1): instant reverse; the wheelie launch fires only from a stop and hits harder (R127)

Machine: Mac (Apple Silicon), `jj` CLI debug build of the working tree; crate tests on RCH (eris). Sim only, no browser.

## What changed

- **Instant reverse.** The 900 ms launch-arm delay is gone (`launch.reverseDelayMs`, `InputThresholds::launch_reverse_delay_ms`,
  `SourceSemantics::launch_armed`, `WheelieDetector::zone_ms`, the cross-file "delay outlasts preload" test). A full pull
  reads as reverse on its first sample; the sim brakes while moving forward and reverses under `reverse_below_mps`.
  `CMD_VERSION` 1 → 2 (the input-profile command lost a field); goldens re-blessed.
- **Launch from a stop.** `wheelie_max_reverse_mps` (reversing limit) became `wheelie_max_launch_mps = 2.0` (either
  direction): at speed a pull-and-snap is just brake then throttle. 2.0 m/s leaves room for the creep back while a
  launch charges from rest (about -1 m/s after 0.45 s) and refuses the 1.4 s pull of `wheelie-fail` (sweep 1.0/1.5/2.0:
  1.0 refuses legitimate launches; 1.5 and 2.0 pass every launch fixture).
- **Harder launch.** Cruz and Ute: `wheelie_launch_reward` 1.5 → 2.0, `wheelie_drive_gain` 0.15 → 0.4.

## Measured (scratch probe: Cruz Missile at rest on the greybox; plain throttle vs pull 0.45 s + snap, both from tick 54)

| | speed 0.5 s after GO | speed 1.0 s after GO | distance after 1.0 s | max nose-up |
|---|---|---|---|---|
| plain throttle | 5.6 m/s | 10.8 m/s | 5.6 m | 0° |
| launch, before (reward 1.5, gain 0.15) | 13.0 m/s | 18.4 m/s | 13.0 m | 12.0° |
| launch, after (reward 2.0, gain 0.4) | 16.6 m/s | 21.4 m/s | 16.7 m | 14.8° |

The launch's lead over plain throttle after one second grows from 7.4 m to 11.0 m (+49 %).

## Acceptance

- AC1 instant reverse from rest: `scenarios/feel/reverse-instant.json` car 0: `forwardSpeed = -0.592` at tick 30
  (0.25 s), -4.3 m/s at the end, nose level, upright. Unit: `jj-input` `r127_a_full_pull_is_reverse_at_once_and_still_charges_the_launch`.
- AC2 moving car pulls back → brakes, then reverses, no launch: `scenarios/feel/wheelie-at-speed-refused.json` (was the
  R116 corner-exit launch): all three cars at 14 m/s, no front lift, no launch drive; `scenarios/affordances/fwd-back-rest.json`
  (floor it, then hold back: stops and reverses on every surface).
- AC3 stopped car pull-hold-snap launches; at speed it fires nothing: `reverse-instant` car 1 (12°+ nose, launch drive on),
  `wheelie-ok`, `wheelie-at-speed-refused`.
- AC4 launch impact measured before/after (table above); the values are vehicle-profile fields, so the owner menu's live
  profile section (br-2sdu) edits them.
- AC5 controller copy: the tutorial's Launch step now says "From a stop … Nail it on GO for a flying start."
  (`web/controller/src/app/tutorial.ts`); the stick aria label never mentioned the delay. The CI journeys drive real
  phone controllers (Chromium and WebKit, emulated phones, not devices) through the join path with the new input
  profile and `CMD_VERSION` 2 on both ends.
