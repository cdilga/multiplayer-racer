# br-bbki.24 (P1-FL07b): air pitch follows the wheels

Owner playtest 2026-10-17: "it was easiest to just keep the throttle pinned, I expected actual physics to apply (spinning
wheel faster in air would drop rear, brake would rotate forward?)". Two causes: in the air throttle nosed the car *down*
and brake *up*, and a throttle held at takeoff was latched as neutral, so a pinned throttle let the jump's own geometry
land the car. Now (`crates/jj-sim/src/air.rs`, `assets/profiles/air.json`): throttle raises the nose (the rear drops),
brake rotates it down, and only the steer is latched at takeoff, so a pinned throttle keeps raising the nose and
over-rotates. A car on the autopilot flies neutral (bots don't flip themselves).

## Tests

- `crates/jj-sim/src/air.rs` unit tests (rch): `throttle_raises_the_nose_brake_lowers_it_steer_yaws_and_roll_levels`,
  `full_stick_reaches_the_rate_within_a_few_response_times` (nose-up at the full rate),
  `a_steer_held_at_takeoff_is_latched_but_a_held_throttle_counts`.
- Scenario bank (`crates/jj-tools/tests/scenarios.rs`, rch): the canyon-leap runs swapped to the new mapping and passing:
  `air-pitch-down` (a brake tap: clean landing), `air-pitch-up` (a throttle tap: bad landing), `air-pitch-crash`
  (throttle floored in the air: bad or crash), `air-pitch-neutral` (OK), and the new `air-pitch-pinned` (throttle pinned
  from the start through the whole flight: a bad landing or a crash, where the neutral run is OK and the feathered one is
  clean).
- jj-procgen jumps and bank (eris, clean 20568729): 6/6 and 4/4; the jumps bank's player now lifts off the throttle in
  the air (a pinned throttle over-rotates by design).
- `web/tests/journeys/fl07-landing.test.mjs` (eris, Chromium and WebKit): 2/2, the five runs judged as above and called out
  on the TV.

## Looked at

`fl07-mid.jpg` (and the single stills), side view just after each run's air input (tick 120), canyon leap:
- `air-pitch-up` (throttle tap) and `air-pitch-pinned` (pinned throttle): nose clearly up, rear wheels below the front.
- `air-pitch-down` (brake tap): the car level-to-nose-down, lined up with the landing slope.
- `air-pitch-neutral`: the take-off attitude, slightly nose-up from the kicker.
- `air-pitch-crash` (throttle floored): nose up the furthest.
`chromium-air-pitch-pinned-chase-1920x1080.jpg`: the pinned run's landing from the chase, over-rotated: the car stands on its tail with STACKED IT! over it.

## Defects found and fixed

- The autopilot's road throttle would have flipped bots over every jump; bots now fly neutral in the air.

## Remaining defects

- None seen in these runs.

## Not covered

- Physical play on a phone; the feel of the rate (100 deg/s) is for the owner's next playtest (tunable in the Feel Lab).
