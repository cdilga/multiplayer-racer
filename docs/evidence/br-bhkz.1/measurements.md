# Derby hit rules: what a bot derby does, before and after (br-bhkz.1)

Owner, 2026-11-17: the derby "wasn't that much fun, and the strategies to actually win wasn't at all clear. I seemed to
die more somehow."

**What was measured.** Six Cruz Missiles on a six-car bowl (floor radius 31 m), all on the autopilot (paces 800, 800,
900, 1000, 900, 1000), a 3-minute derby, seeds 1, 2 and 3. No items in play (a sim-only run: the host hands out the
boxes). `cargo test -p jj-procgen --test derby_probe -- --ignored --nocapture`, native, Apple Silicon Mac, 2026-11-17.
A measurement of the sim, not of people playing: bots drive more evenly than players do.

| | Before (1ed87f60) | After (assets/profiles/derby.json: strikerTake 0.3, junkTake 0.25, shoveWindowS 1.5) |
|---|---|---|
| Wrecks a round (6 cars) | 30, 26, 28 | 13, 15, 15 |
| One car is wrecked every | 38 s | 75 s |
| Wrecks nobody caused | 5, 4, 8 | 1, 1, 1 |
| Damage from junk and walls, share of all damage | 51 %, 39 %, 42 % | 19 %, 23 %, 23 % |
| Damage from rivals, HP | 5800, 6246, 6697 | 5178, 5461, 6156 |
| Damage from junk and walls, HP | 6036, 4433, 5325 | 1249, 1846, 2117 |
| Points, lowest to highest car | 555-745, 365-815, 484-787 | 389-605, 412-728, 523-769 |

Every wreck, before and after, is a wheel loss (R121: a wheel off is a wreck 2 s later). Before, the wheels took more
damage from junk on the floor (detached parts, husks) than from rivals: 2423 HP against 2222 on seed 1.

**One hit, in the yard** (`crates/jj-sim/tests/derby_hits.rs`): a 9 m/s T-bone into a standing car's doors costs the
rammed car 68 HP in a race and in a derby; it costs the rammer 34 HP in a race and 10 HP in a derby. A 6 + 6 m/s head-on
costs both 34 HP. An 8 m/s drive into the wall alone costs a quarter of the race's damage; a car rear-ended into the same
wall takes the wall's damage in full and the rammer scores it.

**Not measured.** People. Whether 15 wrecks a round feels right is the playtest's call; `strikerTake` and `junkTake` are
the two numbers to move.
