# br-8h3u.3: bigger loops, chosen by driving candidates

Owner, playtest 3 (2026-10-24): "loop the loops are too small radius". The radius is data:
`assets/profiles/loops.json` `radiusM` (each loop draws its radius from the range; its run-out is 3.6-4.4 radii and the
posted entry speed `jj_map::looping::posted_entry_mps` grows with it).

## Candidates

Each candidate ran the generated-loop bank (`crates/jj-procgen/tests/loops.rs`, release, 16 seeds x 4 biomes on the
race-prepared maps at one loop a lap). Two tests per candidate:
- `loops_appear_in_the_prepared_maps_and_every_one_validates`: which seeds get a loop.
- `every_roster_vehicle_completes_every_generated_loop_at_its_posted_speed`: every roster vehicle, bikes included, rides
  every loop on the throttle at its posted speed and must complete it upside down at the crown. A Cruz coasting in
  7 m/s under the posted speed must fall off and be put back.

Run on the Mac, local per-crate cargo, clean tree, 2026-11-01.

| candidate | radiusM | seeds with a loop (of 64) | posted entry | crown height (max) | every car round | too slow put back |
|---|---|---|---|---|---|---|
| today | 7.5-9 | 31 | 19.4-20.8 m/s | 17.9 m | yes | yes |
| A | 11-13 | 22 | 22.7-24.3 m/s | 25.9 m | yes | yes |
| **A2 (picked)** | **12-14** | **17** | **23.7-24.9 m/s** | **27.6 m** | **yes** | **yes** |
| B | 13.5-15.5 | 12 | 24.9-26.1 m/s | 30.6 m | yes | yes |
| C | 15-18 | 0 | - | - | (no loop fits any lap) | - |

**Pick: 12-14 m, about 1.6x today's.** Every candidate rides cleanly, so the real cost of size is how often a lap has a
straight long enough to carry one: run-in 45 m + run-out about 4 radii + 70 m back. At 12-14 m a loop is about 1.6x as
big as today's and stands up to 28 m tall, and about a quarter of tracks still get one. B would halve that; C fits
nowhere. Generated output changed on purpose: GENERATOR_VERSION 34, goldens and lab maps re-blessed.

## Not covered

- No TV capture of the new loop yet: eris was down, and the GPU journey (`web/tests/journeys/generated-loop.test.mjs`)
  runs there. The loop camera scales with the radius (`camera.json` `loop.outRadii`), and its fixture
  (`web/host/tests/loop-camera.test.mjs`) covers in-frame and occlusion for any loop size.
- Not owner-driven. The candidates were driven by the sim's roster rides, not by a person (Feel Lab hand drive
  pending).
