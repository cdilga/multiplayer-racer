# P1-M03b: course graph

Date 2026-10-03, GentlePike. Bead `br-p1-m03-74i.2`. Closes on green Gitea CI (`ev:ci`).

`crates/jj-procgen/src/course/` designs a biome-agnostic closed loop from the seed's structure stream, as a sequence
of corners and straights:

1. **Turn budget.** 360° of net left-hand turning, plus whatever an optional right-hander takes back (40% of draws).
2. **Hairpins first.** One, or two in 35% of draws (140–180°, radius 13–20 m).
3. **The rest of the budget.** Filled by about round(rest / 75°) sweepers (35–95°, r 45–85 m) and medium corners
   (60–115°, r 20–35 m), scaled to fit and kept inside their ranges.
4. **Chicanes.** 0–2 of them: two opposite 25–45° arcs, net zero.
5. **Shuffle.** The order is shuffled, never with two hairpins back to back.
6. **Straights.** The 110–160 m start straight comes first (the finish sits 60 m along it, the start corridor behind it),
   then a straight after each corner.
7. **Closure.** The loop closes exactly: of every pair of straights other than the start straight, take the one whose
   adjustment keeps both ≥ 12 m with the least change (a 2×2 solve).
8. **Checks.** Length inside **700–1,100 m** (a TUNE band: laps of about 47–73 s at the 15 m/s reference speed). Any two
   parts of the road more than 60 m apart along it stay ≥ 20 m apart (no self-intersection, no overlapping roads).
9. **Failures.** A failed draw redraws from the same stream (deterministic), up to 64 times, then a conservative oval:
   never an endless reroll (master §11.2a). Each rejection's reason is counted in the report.

`jj_procgen::generate` now builds its structure this way (generator `jj.procgen.course` v2). M03a's plumbing is
unchanged: streams, assembly through `jj-map`, canonical bytes. Dressing is placed relative to the route, still a
placeholder until the biomes. M03a's golden hashes were re-blessed for v2 and match natively (Mac arm64, Linux x64
through RCH) and in WASM (`tests/wasm_parity.rs`).

`jj procgen --seed N --json` reports the course: length, corner mix, attempts, fallback and rejections.
`jj procgen --seeds A..B [--json]` runs a seed bank into `target/jj-runs/procgen-seeds-A-B/bank.json`; M03g's bot
playtests build on it.

## Acceptance → evidence

| AC | Test / evidence |
|---|---|
| 100 seeds give closed loops inside the length band with no self-intersection and a valid start corridor | `crates/jj-procgen/tests/course.rs::a_hundred_seeds_design_valid_closed_loops_and_report_the_corner_mix`. Seeds 0–99 are closed, inside 700–1,100 m, self-clear, and pass the full `jj-map` validator including the start-corridor rule. Bank: `seed-bank.json` (100/100 valid) |
| A corner-mix histogram is reported for the 100 seeds | the same test prints it; `summary.json`; `jj procgen --seeds 0..100` (the CLI test runs `--seeds 0..20`) |

## Seed bank 0..100 (`summary.json`)

| | |
|---|---|
| valid | 100 / 100, 0 oval fallbacks |
| corner mix (all courses) | 125 hairpins · 127 sweepers · 198 medium · 98 chicanes |
| length | 704–1,094 m, mean 888 m |
| attempts | mean 7.0, max 27 (of 64) |
| rejections (all attempts) | 231 corner out of range after fitting · 212 longer than the band · 75 no closing pair · 54 hairpins back to back · 30 shorter than the band · 0 self-intersection |

The most common mixes (hairpin/sweeper/medium/chicane) are 1/2/1/1, 1/1/2/2, 1/1/3/2 and 1/1/3/0; the full table is
in `summary.json`. `seeds-0-11.svg` draws twelve of them to scale.

## Runs

```
$ cargo test -p jj-procgen                                    (Mac)   course 1, procgen 5 (goldens re-blessed for v2)
$ cargo test --target wasm32-unknown-unknown -p jj-procgen --test wasm_parity   (Node)  pass
$ rch exec -- cargo clippy --locked --all-targets --no-deps -p jj-procgen -p jj-tools -- -D warnings   exit 0
$ rch exec -- cargo test --locked -p jj-procgen -p jj-tools                     all pass on Linux x64 (same goldens)
$ jj procgen --seeds 0..100                                   100/100 valid
```

## Known gaps (other beads)

- The course is flat (M03c terrain). Jumps, crests and kerbs come in M03d, biomes and their transitions in M03f, and
  scatter in M03e.
- The length band, corner ranges and clearances are TUNE until the first seed-bank bot playtests (M03g).
- The design is plan-shape only (no elevation yet). "Readable elevation, recoverable landings" belong to M03c/M03d.
