# Derby jumps: launches worth taking (br-bhkz.4)

Owner, 2026-11-17: "the jumps were really not good enough". The arena's jumps were hops: 12-13 degree ramps to
0.6-1.3 m lips. Arena generator 4 (`crates/jj-procgen/src/arena/`) replaces them.

Everything here is measured in the sim with the Cruz Missile (`cargo test -p jj-procgen --test arena`, natively on the
Mac, 2026-11-17). Nothing was measured in a browser or on a device. The two plan views are drawn from the map's height
grid by a script; they are not game renders.

## What is in an arena now

- **The crossover**, in every arena: two 20 degree launch ramps facing each other across the middle, joined by an 8 m
  deck, with the island's two rocks standing either side of the deck as a gate (7 m between them). Lips are 1.5-1.8 m,
  and 1.7-2.0 m on floors of 24 cars and more. A car launches off either ramp, flies the deck between the rocks and
  comes down on the far ramp's back or the floor beyond; cars from opposite ends meet in the air.
- **Table-tops**: a 20 degree launch to a 1.4-2.0 m table (scaled down where the floor is small) and a 15.6 degree ramp
  down, which is the same jump lower and longer from the other end.
- **Kickers**: 20 degrees both ways off a short deck, lips 1.2-1.6 m.
- The first two jumps stand either side of the gate; the crossover's run-ups stay clear to the field's edge.
- The floor is 3 m bigger in radius for the run-ups and landings (8 cars: 31 to 34 m; 24: 35 to 38 m; 32: 39 to 42 m).

Plan views (terrain height as shade, rocks red, the ring is the field's edge): `plan-8.png` (8 cars), `plan-32.png`
(32 cars).

## Flights at 12, 16, 20 and 24 m/s

Every jump of the 8, 24 and 32-car bank arenas (seed 11), both ways. The speed is held to the ramp's foot, the throttle
is down on the ramp, and the car flies neutral, as a bot does (R14: the lip decides the landing). The full table is
`flights.txt` (`JJ_EVIDENCE=1` rewrites it); the test `the_jumps_fly_a_second_and_land_on_their_wheels` holds it.

| Jumps | At the foot, m/s | Flights | Off the lip, m/s | Airtime, s | Distance, m | Peak, m | Landing | Came down on |
|---|---|---|---|---|---|---|---|---|
| Crossover (lips 1.6-1.8 m) | 12 | 6 | 12.3-13.0 | 0.68-1.07 | 8-12 | 2.4-2.9 | 5 OK, 1 bad | far ramp 4, floor 2 |
| | 14 | 6 | 13.4-14.0 | 1.08-1.17 | 13-15 | 2.6-3.0 | 6 OK | floor |
| | 16 | 6 | 14.6-15.1 | 1.16-1.24 | 15-17 | 2.8-3.2 | 6 OK | floor |
| | 20 | 6 | 17.1-17.4 | 1.30-1.38 | 20-21 | 3.2-3.7 | 6 OK | floor |
| | 24 | 6 | 19.3-19.9 | 1.45-1.54 | 24-26 | 3.8-4.2 | 6 OK | floor |
| Other big jumps (lips 1.5 m+) | 12 | 3 | 12.1-13.8 | 0.98-1.04 | 11-12 | 2.3-2.6 | 1 clean, 2 OK | floor |
| | 16 | 3 | 14.5-16.3 | 1.09-1.19 | 15-16 | 2.6-3.0 | 3 OK | floor 2, another piece 1 |
| | 20 | 3 | 16.9-19.1 | 1.23-1.34 | 20-21 | 3.0-3.5 | 3 OK | floor 2, another piece 1 |
| | 24 | 3 | 19.3-20.9 | 1.33-1.49 | 25-26 | 3.3-4.0 | 3 OK | floor |
| Smaller jumps (lips 0.9-1.4 m) | 12 | 7 | 11.1-13.8 | 0.79-0.96 | 8-11 | 1.5-2.1 | 5 clean, 2 OK | floor 5, another piece 2 |
| | 16 | 7 | 13.4-16.3 | 0.93-1.09 | 12-15 | 1.8-2.5 | 1 clean, 6 OK | floor 5, another piece 2 |
| | 20 | 7 | 16.3-18.9 | 1.07-1.28 | 17-20 | 2.1-3.1 | 7 OK | floor 6, another piece 1 |
| | 24 | 7 | 18.9-21.8 | 1.22-1.43 | 23-26 | 2.6-3.6 | 6 OK, 1 bad | floor 5, bank 1, another piece 1 |

Read it as:

- **The crossover clears from 14 m/s.** At 14 m/s and up a car flies the deck, the gate and the far ramp and lands on
  the floor beyond, 1.1-1.5 s in the air. At 12 m/s it mostly comes up short, onto the far ramp's back.
- **The big jumps fly a second or more** from 12 m/s (0.98-1.04 s) to 24 m/s (1.3-1.5 s).
- **Neutral landings are OK or clean on the floor.** The two bad ones (out of 71) met a slope: one came up short on
  the crossover's far ramp (28.8 degrees), one flew 23 m at 24 m/s onto another jump. Bad costs a quarter of the car's
  speed; it keeps its wheels. No flight crashed.
- **In the 8-car bowl a 24 m/s flight off a side jump reaches the bank** (one row). It landed OK there.
- **The smaller jumps** (the ones a small floor scales down to fit) fly 0.8-1.0 s at 12-16 m/s.

Slow cars: `a_slow_car_drives_over_the_crossover` drives every sampled crossover from both ends at 4, 6, 8, 10 and
12 m/s. Each car gets over the deck and off the far ramp on its wheels.

## Why the crossover is a bridge through a gate, not a gap with the rock in it

The brief asked for ramps facing each other across the island rock, with a slower car dropping into the lane beside
the rock. Measurements ruled that shape out.

- **A peaked lip traps a stopped car.** A Cruz stopped astride a lip with no deck beyond it high-centres at every
  slope tried, down to 13 degrees (0.23). With 1.5 m of deck or more it drives off lips up to 0.36 (19.8 degrees) at
  any angle to the grid; at 0.40 it sticks with 1.5 m and 2.5 m decks; at 0.445 it sticks at some angles even with a
  4 m deck; a 0.55 face (the steepest the validator allows) sticks every time.
- **A gap needs peaked lips.** Two ramps with a lane, a rock (the kit's smallest is 6 m across) and another lane
  between them need 0.55 faces on the island side. The first trial (1.5 m lips, 17.5 m gap) needed 17 m/s off the lip
  to clear; slower cars hit the far lip nose-first, and the one traced stopped dead on it, high-centred with two
  wheels down.
- **Rounding the lips so nothing traps makes the gap about 24 m**, which needs about 19 m/s off the lip. Most cars in
  an 8-car bowl would fall short.

So the ramps are joined by a deck and the rocks stand beside it. Nothing can drop in, the lips are single 20 degree
creases with deck beyond them, and the rocks are still the jeopardy: a flight that drifts off the line clips one.

Why 20 degrees and not the 24 the brief allowed: steeper flies no longer. From the same start (14 m/s, 10 m before the
foot, throttle down, 1.5 m lip) a 0.36 ramp left the lip at 16.5 m/s and flew 1.28 s and 19 m; a 0.445 ramp left it at
13.6 m/s and flew 1.20 s and 14.5 m. The ramp's foot costs more speed than the angle gives back, and 0.445 is past
what a stopped car drives off.

No validator limit moved (`crates/jj-map/src/arena.rs` is untouched).

## Bots

A derby bot knows the island only as its two rocks. When its prey is across the island and it is in the cone before a
ramp, it now follows the crossover's line through the gate instead of going round; once on the crossover and facing
along it, it carries on over (`Gate::through` in `crates/jj-sim/src/autopilot/mod.rs`). The arena validator rejects a
rock standing in the gate.

- `derby_bots_fly_the_jumps_and_land` (13 bots, 60 s, seed 11): **18 judged jump landings by 10 of 13 bots, 8 of them
  off the crossover**; 6 clean, 11 OK, 1 bad, no crash. Before: 5 landings by 3 bots.
- `scenarios/derby/arena-jumps.json`: two bots take turns over every jump of the 8-car arena, both ways. Six flights,
  1.0-1.3 s each (the crossover 1.24 s and 1.31 s), every first landing OK. The br-7htf relaxation ("landings >= 1 for
  car 2") is removed. The fixture is two cars now, not a pair per jump: a hunter picks the nearest rival it faces, and
  with other pairs on the floor the crossover's bot chased a neighbour.
- `derby_bots_keep_off_the_rim_and_never_park` on the bigger floor: rim-parked 4.8 %, tilted 3.2 %, on the bank
  20.1 %, 137 score events a minute (the floors are 12 %, 8 %, 30 % and 110).

## A stomp is the lander's hit

`a_car_landing_on_a_rival_off_a_jump_takes_much_less_than_it_gives`: a car flies a 1.6 m table-top at 16 m/s and comes
down on a rival standing on the line, tail to the jump. **The lander lost 11.0 HP, the car under it 46.0 HP; points
46.0 to 11.0.** With the rival moved from 4 m short of the touchdown to 4 m past it the lander lost 3-19 HP and the
rival 14-49 HP.

One case went the other way when this was measured, and is fixed since (b83f481f: in a derby a hit on a rival's cabin
lands on its nearest part; `crates/jj-sim/tests/derby_hits.rs`: the car underneath 31 HP, the lander 19 HP): with the
rival standing **across** the line and the flier coming down square on its roof (1 to 4 m short of the touchdown), the
rival lost 0 HP and the lander 6-8 HP, and the points went to the rival (0 to 6.4-7.5). The roof is not a damage part,
so only the lander's side of the contact is charged. With the rival far enough on that the flier's nose meets its door
as it lands, the rule holds (lander 9-13 HP, rival 18-89 HP).

## Not verified

- No device run. The parent session looked at it in a browser: `self-review.md` beside this file.
- The WASM parity lane was run by the parent session (`cargo test --target wasm32-unknown-unknown -p jj-procgen --test
  wasm_parity`): `derby_arenas_in_wasm_match_the_native_hashes_and_meshes` passes.
- One car (the Cruz). Other roster cars' ground clearance on the lips is untested here; `derby_minute` in the arena
  tests puts a different roster car in the idle seat per seed and passes.
