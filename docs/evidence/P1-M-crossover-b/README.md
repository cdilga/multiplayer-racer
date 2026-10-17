# P1-M-crossover-b / -c (br-xlvx.10.2, br-xlvx.10.3): every course family crosses itself

Receipt (BrownHill, 2026-10-17). Built and run on the RCH workers (`--release`), GENERATOR_VERSION 26.

## Crossings per family (AC of br-xlvx.10.2)

`crossings-per-family.txt`, written by
`JJ_EVIDENCE_DIR=… cargo test -p jj-procgen --release --test crossings every_family_crosses_itself_on_one_lap_in_two_or_more`
(20 seeds per family, the four-biome recipe):

| family | laps | crossing | mean per lap | bridges | leaps |
|---|---|---|---|---|---|
| twisty | 20 | 5 | 0.25 | 5 | 0 |
| flowing | 20 | 6 | 0.30 | 6 | 0 |
| speedway | 20 | 11 | 0.60 | 11 | 1 |
| figure eight | 20 | 20 | 1.00 | 20 | 0 |

42 of 80 laps cross themselves (the bar is 1 in 2), one lap crosses twice (speedway seed 11), and both bridge and leap
crossings appear. Every lap validates.

## What makes it

- **Loop-overs** (CoralCrane's motif, course/mod.rs): a 240-270 degree left-hander whose exit straight crosses its own
  entry. A loop-over's spiral counts as one of the lap's set pieces (rhythm and `setpieces::check_minimum`); a figure
  eight's bridge does not. When the first loop-over is square enough for a leap but doesn't fit the lap, it turns just
  short of the leap angle instead (a compact bridge, ~600 m against ~1.1 km); later loop-overs are always compact.
- **Overpass leaps at crossings** (br-xlvx.10.3, `overpass::leap_crossings`): every crossing at `minCrossingDeg` (70)
  or squarer tries a leap and keeps its bridge when refused. The bridge's deck heights are put back on the ground first;
  a leap whose embankment reshapes the ground under a road it doesn't set is refused. Small features keep off a leap's
  roads and its run-in.
- The validate ladder retries the same draws with one loop-over, then none, before shorter recipes.

## Checks run (clean HEAD baseline + only these paths, RCH)

- `cargo clippy -p jj-procgen --all-targets --no-deps -- -D warnings`: clean in every file this change touches (the
  only errors are in `tests/skill_jump.rs`, new at HEAD from br-bbki.23).
- `cargo test -p jj-procgen -p jj-tools -p jj-wasm-host -p jj-wasm-procgen --release`: green except
  - `handling … pig_catcher` (quarantined br-oxy5 / br-3pwa, red at HEAD),
  - `forks bots_split_between_branch_and_road…` (red at HEAD 73836cb2 since br-4tbo's faster bots),
  - `crossings bots_lap_both_levels…`: the postie bike on the four-biome figure eight (seed 1) needs one recover
    (quarantined br-qwn9 in CI; red at HEAD on OutbackDirt seed 1 until the level check's window, fixed here);
  - the bot playtest's seed 47 (fast bot off a 30 cm crest at 40 m/s), listed as a known landing gap in `tests/bank.rs`.
- Goldens re-blessed for GENERATOR_VERSION 26 (seeds.txt, recipes.txt, lab map headers) with `JJ_BLESS=1` on RCH.
