# br-7o6n (P1-PT-finish): finishing a race, and a missed gate

Owner playtest 2026-10-17: "I finished a race with 3 laps earlier but the race didn't actually finish and I got no
feedback it was finished at all."

- **Laps:** a lap counted only through every gate in order, each within the road's half-width plus 2 m; a car that ran
  wide past one gate (or flew past it) never got it, so every later gate and the line were ignored. Now a later gate
  within `GATE_CATCH_UP_M` (120 m of route; gates stand 40-55 m apart) counts the missed ones; an infield shortcut, which
  meets the road hundreds of metres further round, still earns nothing (`crates/jj-sim/tests/race.rs`: 11/11 on RCH,
  `a_missed_gate_doesnt_strand_the_lap`, `a_gate_far_round_the_route_doesnt_count_the_ones_before_it`, the shortcut test).
- **Feedback:** `web/tests/journeys/finish-feedback.test.mjs` (Playwright Chromium on eris, ddd30413, 4 of 5 runs green;
  the one red timed out on the first run after a fresh WASM build): a real phone and a synthetic seat, one lap of the
  greybox, the phone's car driven by the autopilot.

## Looked at

- `tv-finished.png` (1920x1080): Davo's tile, big tilted "FINISHED!" above the car with a pill "1st 0:49.2"; the top
  right pill reads "1st Finished". Shazza's tile (still racing) shows "Race ends in 30 s" bottom right in the warning
  chip, and the announcer ribbon "We've got a finisher!". The car stays visible under the banner.
- `phone-racing.png` (915x412): the strip now carries "1st" and "Lap 1/1" under the connection chip (they were always
  empty: the host sent no place or lap).
- `phone-finished.png`: the saffron banner "Finished 1st! Waiting for the others" across the middle; the strip's lap reads
  "Finished".

## Defects found and fixed

- None after the first captures.

## Remaining defects

- The phone's place and lap sit small, stacked under the connection chip; readable, not loud.
- The race still waits out the full 30 s window after the last human finishes when bots remain (by the rules; the
  countdown now says so).

## Not covered

- Portrait phones and WebKit; a 3-lap race with real driving (the journey is one autopilot lap).
