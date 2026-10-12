# br-gw74.13.1 (P1-S-fun.1): big air, road-wide jumps and a tough ute

Owner 2026-10-12: "jumps should launch cars far bigger! we need road wide jumps to be ultra fun!", and the Triton
should use its mass in collisions, survive better (bullbar) and tank huge jumps.

**Where measured:** native release builds of the sim on eris through RCH (`cargo test --release -p jj-procgen --test
jumps`, `-p jj-sim --test tradie_ute`), generator v21, ten seeds × four jump biomes (greybox, rocks, outback dirt,
outback bitumen). These are sim fixtures, not a couch test. Raw rows: `jump-runs-before.txt` (generator v20, autopilot
bank only) and `jump-runs.txt` (v21: the autopilot bank, then the full-throttle player runs).

## What changed

- **Road-wide jumps** (data: `generator.json` `jumps.roadWide`: share 0.5, ramp slope 0.24–0.28). The ramp, table and
  landing span the road's flat width (side slopes inside the corridor), with longer, steeper ramps (9–12 m, lips
  1.5–3.0 m against 1.1–2.1 m for line jumps). The map carries `roadWide = 1`, and the validator exempts exactly those
  jumps from the bypass-lane rule (an engineering rule from P1-M01, not a ruling). The generator's own check knows both
  envelopes.
- **Tables and landings built for 36 m/s take-offs** (data: `takeoffSpeedMps` 30 → 36). A Cruz at full throttle reaches
  the lip at 33–35 m/s. At 30 m/s design it came down at the table's far edge and pitched over.
- **The landing ramp's foot is sized for the take-off speed** (code, `LIMITS.jump_foot_accel_mps2` = 6 m/s²). The foot
  used the road's curvature budget, which was set for 25 m/s. At 33 m/s that was 13 m/s² of extra load: the suspension
  bottomed out and the chassis dug into the road where the jump ends, and the car lost 9 m/s in two ticks and rolled
  (traced tick by tick on greybox seed 1, jump 0). The foot's blend is now about 19 m instead of 7.5 m.
- **Generator v21**, goldens re-blessed (`seeds.txt`, `recipes.txt`). Tracks now carry 56 jumps over the 40-track
  sample against 68 before: each envelope is longer. That is fewer, bigger jumps, as R124 asks.

## Air: before and after (Cruz)

Autopilot bank (the autopilot plans to 26 m/s and slows to it before the lip, so its flights barely grow with speed):

| run-up | before: line jumps (68) | after: line (19) | after: road-wide (37) |
|---|---|---|---|
| 15 m/s | 0.82 s, 14.9 m | 0.86 s, 15.8 m | 1.09 s, 19.3 m |
| 26 m/s | 0.96 s, 19.9 m | 0.99 s, 20.5 m | 1.24 s, 24.7 m |
| 30 m/s | 0.98 s, 20.7 m | 1.01 s, 21.4 m | 1.25 s, 25.2 m (max 1.33 s) |

A player at full throttle (new test `players_at_full_throttle_land_every_jump_line_and_road_wide`; mean flight, max in
brackets; speed at the lip in the second column):

| car, run-up | lip speed | line jumps | road-wide jumps |
|---|---|---|---|
| Cruz 30 m/s | 26.6–27.5 m/s | 1.22 s, 29.8 m | 1.46 s, 33.4 m |
| Cruz 35 m/s | 29.1–30.3 m/s | 1.40 s, 36.9 m | 1.61 s, 39.7 m |
| Cruz 40 m/s | 31.7–33.4 m/s | 1.58 s, 45.2 m | **1.79 s, 47.3 m (max 1.95 s, 52.6 m)** |
| Ute 30 m/s | 27.0–28.0 m/s | 1.23 s, 29.4 m | 1.49 s, 33.2 m |
| Ute 35 m/s | 29.7–31.0 m/s | 1.36 s, 35.7 m | 1.64 s, 39.6 m (max 1.81 s, 45.5 m) |

All 280 player runs and all 224 autopilot runs land on their wheels with no recovery: lowest upY 0.98 in any player
run. The bot bank (`tests/bank.rs`) laps every seed with zero wrecks with road-wide jumps in the mix.

## The ute

- **Lands the biggest jumps upright**: every road-wide jump (3.0 m lips) at 30 and 35 m/s run-ups, lowest upY 1.00.
- **Head-on with a Cruz** (new test `the_ute_wins_a_head_on_with_the_cruz_and_its_bullbar_takes_less_damage`, damage
  yard, 10 m/s each): 0.5 s later the ute is still rolling forward at 1.38 m/s while the Cruz is shoved back at
  −2.25 m/s. The ute's bullbar front lost 34 % of its health; the Cruz's front lost 100 % (detached). No tuning change
  was needed: the parent fun pass's mass and bullbar already do it, and the test now holds it.

## Calls a reviewer should check

- **Relief tests loosened slightly.** `relief.rs` now asks rocks relief to grow at least 1.9× (was 2×; measured 1.97×) and
  `tuning.rs` asks for 1.4× (was 1.5×; measured 1.47×). Both measure the route's height, which includes crests, and the
  longer jumps leave fewer stretches for crests. The terrain's own relief is unchanged (a rerun with the old jump data
  passes the rocks test).
- **Grade check in `biome.rs`** exempts a jump's whole length (ramp + table + landing), not a fixed 80 m from its pose:
  the landing ramp of a 36 m/s jump reaches past 80 m.
- The full-throttle player runs hold the wheel straight, so they're judged on the jump and 10 m past it. Beyond that the
  reserved landing is plain road that may bend gently, which the autopilot runs (which steer) cover to the exit.

## Not done here

- Visual self-review: `self-review.md`. The geometry draws right, but big air doesn't read as big air in the chase or
  overview cameras: br-gw74.13.1.1.
- Huge gap jumps and jumps over another part of the track stay with br-xlvx.5.
