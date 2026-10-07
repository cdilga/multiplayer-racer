# Self-review P1-M03g

## Looked at
- `seed-bank.txt`: 100 seeds of the four-biome recipe; every one valid; the plan per seed and the reason each earlier
  rung was rejected (almost all "no straight for boundary N"). Checked that no seed is silently rerolled and that the one
  conservative seed and the four shorter ones are listed.
- `bot-playtest.txt`: per seed the autopilot's laps (three laps on seeds 0-2, one on the rest), spread, stuck windows,
  recoveries, wrecks, out-of-bounds ticks and lap time over `refLapMs`; softlocks flagged: none. Read down the whole
  table for odd rows (none: all stuck/recovery/wreck/OOB columns are zero; lap/ref 0.94-1.30).
- `wasm-timing.md`: the receipt (hardware, runtime, build, numbers, what is not measured).
- `timing-per-seed.png`: the browser receipt's per-seed chart (24 seeds, unthrottled and 6x CPU throttle, against the 1.5 s laptop and
  4 s phone-host stand-in lines). Looked at it: every orange (6x) bar sits under the 4 s line (worst about 1.9 s, seed 23), every blue
  (unthrottled) bar under 0.31 s, the chart's axes and legend are readable, no seed is missing.

## Defects found and fixed
- A first draft counted "softlock" only as not finishing; it now also flags any second-long stuck window and any recovery.
- The WASM timing test printed nothing on success, so a receipt was impossible; it now reports through its assertion
  message when `JJ_WASM_BUDGET_MS=0`.

## Remaining defects
- (Closed) Chromium at 6x CPU throttle is now measured: worst 1885 ms against the 4 s stand-in (`browser-timing.json`).
- `scenarios/procgen/` is not a runner scenario (the runner takes one fixed map); the bank is a Rust test.

## Not covered
- No image or host render in this bead's evidence (it is tables and a timing receipt): the bank doesn't look at the
  tracks; the earlier beads' captures do. No phone/TV matrix; the real phone-host time is a P1-Q02 row.
