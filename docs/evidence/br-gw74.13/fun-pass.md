# br-gw74.13 arcade fun pass: receipt

Owner 2026-10-12: harder launch, higher speed, tuned for fun rather than sim racing. MacBookPro18,3, native release
builds and the WASM host build (Node), committed tree plus this change. Measurements are sim fixtures, not a couch test.

## Before / after (crates/jj-sim/tests/fun.rs, greybox start straight, full throttle)

| Vehicle | 0-100 km/h | at 150 m | boosted 0-100 | boosted at 150 m |
|---|---|---|---|---|
| Cruz Missile before | 8.38 s | 102 km/h | 7.35 s | 103 km/h |
| Cruz Missile after | 2.97 s | 152 km/h | 1.73 s | 156 km/h |
| Tradie Ute before | never inside 150 m | 91 km/h | never | 92 km/h |
| Tradie Ute after | 3.04 s | 148 km/h | 1.97 s | 151 km/h |

The test asserts the floor: launch at least 30 % quicker (and under 4 s), at least 20 % more speed at 150 m, boost
cutting the launch by at least 20 %.

## Lap time on a standard generated track (after; br-4tbo, 2026-10-17)

`crates/jj-procgen/tests/bot_pace.rs`: three standard-class generated tracks (seeds 4, 5, 7: 1400-1518 m), one lap from
the grid. "Good" is the scripted good driver (assists Off: flat out, late hard braking, corners on 45 % of the car's own
turn, features at design speed); "bot" is the autopilot after br-4tbo. No wreck and no recovery in any run. (There is no
"before" lap: the old autopilot planned to 26 m/s whatever the car, so it measured the bot, not the car: 73-79 s.)

| Vehicle | top speed | seed 4 good / bot | seed 5 good / bot | seed 7 good / bot |
|---|---|---|---|---|
| Cruz Missile | 50.6 m/s | 61.7 / 60.5 s | 55.6 / 58.1 s | 50.8 / 55.9 s |
| Tradie Ute | 47.1 m/s | 65.0 / 66.3 s | 60.5 / 64.1 s | 55.9 / 62.1 s |
| Hawk Dash | 56.5 m/s | 61.5 / 60.5 s | 56.6 / 59.0 s | 52.5 / 57.1 s |
| Lion President | 56.5 m/s | 63.0 / 60.6 s | 56.8 / 59.1 s | 52.3 / 57.1 s |

The bikes (Postie, Pig Catcher) aren't in this table: the good driver corners on the arcade turn they don't have. Their
autopilot laps every generated biome upright (`bikes.rs`).

## What changed and why

- **Engine** (data): Cruz 7 kN → 14 kN with a 460 kW power limit (force tapers past ~33 m/s, top speed about 50 m/s);
  ute 11.5 → 23 kN, 800 kW, a little more drag (lower top speed than the Cruz, more thrust per kilo).
- **Boost is a push on the body** (code, `vehicle::boost_thrust`): it was extra engine force through the rear tyres,
  which were already traction-limited, so boost added about 1 km/h. Grounded only, power-limited, in the energy ledger.
- **Drift**: the handbrake takes 70 % of the drive off the rear while held (`drift_drive_scale`, new, data) so the rear
  swings out instead of the car powering straight; rear grip 0.35 in a drift; exit burst 1.6x, earned from a 0.15 s hold.
  R120 holds: a countersteered drift with its exit boost comes out 9 m ahead of grip through the same 90-degree corner.
- **Lower centre of mass** (`com_lower_m` 0.18, new, data): the doubled drive at the tyres lifted the nose 9 degrees on
  plain throttle (front wheels off the ground for half a second); now about 3 degrees. The deliberate wheelie still pops.
- **Catch-up** raises a trailing bot's and an assisted car's planned speed as well as its drive (it only scaled force,
  which does nothing at a planned speed).
- **Assist "Some"** plans a touch more cautiously (speed skill 0.9, line pull 0.45): a scripted novice at the new speeds
  finished 1/6 laps with it; now 6/6 with 4 crashes.
- **Ute**: bullbar (front health 200, slower front damage), tougher wheels and back.
- **Generator v19**: creek dips are 34-50 m long (a 16-24 m dip bottomed a car at 24 m/s and flipped it); jumps are
  built for 30 m/s take-offs with a 9 % landing ramp (data: `generator.json` `jumps.takeoffSpeedMps`, `landingSlope`).
  Fast cars flew past the old 16 % landing onto flat road and dug in.

## Fixtures recalibrated (each a deliberate call, listed so a reviewer can check them)

Safety rows (minUpY, wrecks, landings upright, wheels down) were never moved.

- **Scripted throttle scaled to the old drive force** (the scenario is about a manoeuvre or a surface, not the engine):
  turn-around, rejoin-route, surface-coast, surface-corner, surface-deltas, debris-pile-exit (0.6), rails corners
  (low-speed 5000, give-prevents-spinout 11000), roofs approach controller, air-control duel's post-landing drive.
- **Envelopes re-measured** (the row measures the car's own response): boost-hold speeds/boost time/meter,
  fwd-back-rest speed at 1.5 s, drift-entry-exit and jump-land speed caps, surface-corner slip/heading bands (surface order
  kept), wheelie-ok/wheelie-corner-exit air time and speeds (ordering kept), boost-line progress and boost time.
- **Retimed** (scripted windows found for the old car): boost-line second window ends at tick 1220; duels re-searched
  with `scenarios/duels/search.py` (boost on the straight 0.5-1.9 s; drift-corner flick 2.0-2.3 s + boost; drift-boost-chain
  grip and well lines; air-control "over" holds the whole flight).
- **Tests** whose setup assumed the slow car: ute throttle window 3 s; the shortcut test stops once across; the late joiner
  records protection ending during the run; the full-lock assist test skips respawn holds; assist shares read from data.
- **Damage**: the side swipes now also nick car 0's rear-left wheel and car 1's back (tail swing with the lower centre of
  mass); both listed as touched, both stay intact.
- **Hashes re-blessed**: procgen goldens (generator v19), the mixed-roster host hash (native and WASM agree).

## Known gap and not done

- **drift-boost-chain**: in the greybox's quick S-bend the best grip line ties the drift line (5.600 s vs 5.592 s); both
  are capped by the meter and the autopilot's 26 m/s plan. Recorded as a known gap in the duel (`gap`).
- ~~Bots and autopilot plan at 26 m/s~~: fixed by br-4tbo (the plan follows each car's top speed and turn).
- ~~Lap times per vehicle on a generated track~~: in the table above (2026-10-17).
- **Big/road-wide jumps, ute collisions and jump tanking**: split to br-gw74.13.1 (closed).

## Acceptance re-checked at 73836cb2 (2026-10-17)

- AC2: `crates/jj-sim/tests/feel.rs` and `web/host/tests/feel-wasm.test.mjs` (eris, WASM) pass; safety rows unchanged.
- AC3: `bank.rs` laps every mix and length class at the new speeds with 0 wrecks, 0 recoveries, 0 softlocks.
- AC4: `duels.rs` `every_duel_holds_its_ordering` (the R120 drift-exit row) passes.
- AC5: the fun levers are vehicle-profile data, live in `?tune`: `pt1-tuning.test.mjs` 6/6 on eris.
- Live tuning of `body_friction` and `com_lower_m` applies when a car next spawns, not mid-flight.
