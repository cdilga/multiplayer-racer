# br-xlvx.6.4: loop-the-loops in generated maps, tunable

Owner, 2026-10-17: "We can try loop the loops if the work was basically done just let me playtest and have it tunable."

## What it is

- The generator places loops as one of a lap's set pieces (GENERATOR_VERSION 26). How many a lap takes is
  `generator.loopsPerLap` (default 1; 0 turns them off), a row in the `?tune` panel's generator values; Regenerate
  track applies it. The loop's shape (radius, run-in, minimum speed) stays in `assets/profiles/loops.json`.
- A course that crosses itself (figure-8s, br-xlvx.10) takes no loop: the loop's jog moved a lower road under a bridge
  (seed 49, -0.42 m clearance).

## Tests

- `crates/jj-procgen/tests/loops.rs`: `loops_appear_in_the_prepared_maps_and_every_one_validates` (a loop on at least
  one bank seed per biome, every placed loop passes `jj_map::looping::problems` and the validator; Town 2/2, Rocks 1/2,
  OutbackDirt 1/2, OutbackBitumen 1/2), `a_bot_laps_a_generated_loop_upside_down_at_the_top`,
  `a_loop_laid_on_a_generated_straight_validates` (rch, 2026-10-17).
- `crates/jj-procgen/tests/setpieces.rs`: a loop counts as the lap's set piece; 20 seeds per biome pass.
- `web/tests/journeys/generated-loop.test.mjs` (Playwright Chromium, Mac): `jj procgen --seed 1 --recipe rocks`, a Cruz
  at 22 m/s rides the generated loop in the real host, upside down at the top more than 12 m above its run-in, out
  upright, and the WASM state hash matches native at the end.

## Looked at

- `top-chase-1920x1080.jpg`, `top-chase-1366x768.jpg`: the grid tile's chase camera at the top of the loop. The loop
  stands clear against the sky between two rock towers, the car upside down at the top, rails and chevrons on the
  run-in. It reads at once.
- `top-overview-1920x1080.jpg`, `top-overview-1366x768.jpg`: the host's overview of the whole Rocks lap.

## Defects found and fixed

- A first overview capture used an orbit camera in the car's frame, which flipped under the map while the car was
  upside down; the journey now uses the host's own overview camera.
- Set-piece bank: Town seeds 3, 6, 8, 12 had a loop and no gap-leap, and the bank only counted gap-leaps; it now counts
  the loop.

## Remaining defects

- Overview: at whole-lap scale the loop is a small shape, and the car's name label sits over it at the top. Players see
  it from the chase camera, where it reads well.

## Not covered

- WebKit; a real round with several cars through the loop (the jj-sim loop banks cover bots, br-xlvx.6.3).
- Loops on figure-8 courses (deliberately off, above).
