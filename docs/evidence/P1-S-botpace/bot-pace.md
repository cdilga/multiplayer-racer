# br-4tbo (P1-S-botpace): bots and the autopilot keep up with the arcade cars

Found in the fun pass (br-gw74.13): the autopilot planned to a fixed 26 m/s with a flat 7 m/s² of grip (tuned for the
old 7 kN car), and slowed for the tightest bend anywhere within its braking horizon as soon as it saw it. Players reach
~50 m/s, so filler bots and a locked phone's car fell far behind.

## What changed

- **The plan is data** (`assets/profiles/assist.json` `autopilot`, validated at load; `jj_sim::autopilot::SpeedPlan`):
  `turnShare` 0.3 (an arcade car corners on that share of its own `arcade.turnG` × g; `lateralGrip` 7 for the bikes),
  `skill` 0.9, `planBrake` 10 m/s², `minSpeed` 4, `topSpeedShare` 0.85, `takeoffMps` 34.
- **It scales with the vehicle:** the ceiling is `topSpeedShare` × the car's top speed from its profile
  (`VehicleProfile::top_speed_mps`, √(P / (m·c)) where power meets linear drag: Cruz 50.6, Ute 47.1, Hawk/Lion 56.5 m/s).
- **Brakes on a curve:** each point's cap is reached from the car at the planned braking (v² = cap² + 2·a·d), not
  applied as soon as the bend is in view.
- **Jumps stay landable:** on a jump's run-up and ramp the plan holds to `takeoffMps` (generated jumps are built for 36);
  on a gap leap to the top of the speed window the piece is built for (its map params; the middle of the window came off
  the lip slower still and fell short of a creek washout).

## Pace: `crates/jj-procgen/tests/bot_pace.rs`

Three standard-class generated tracks (the first three in seeds 0-199), each arcade roster car: the scripted good driver
(`tests/common/good_driver.rs`, assists Off: the yardstick `assists.rs` already used) against the autopilot, one lap from
the grid. Bar: bot within 15 % of the good driver, no wreck, no recovery. RCH (eris/devbox), debug-optimised test build.

```
vehicle          seed  lapM   top(m/s)  plan(m/s)  good(s)  bot(s)  bot/good  wrecks  recov
cruz-missile        4  1518      50.6       43.0     61.7    60.5      0.98       0      0
cruz-missile        5  1459      50.6       43.0     55.6    58.1      1.05       0      0
cruz-missile        7  1400      50.6       43.0     50.8    55.9      1.10       0      0
tradie-ute          4  1518      47.1       40.0     65.0    66.3      1.02       0      0
tradie-ute          5  1459      47.1       40.0     60.5    64.1      1.06       0      0
tradie-ute          7  1400      47.1       40.0     55.9    62.1      1.11       0      0
hawk-dash           4  1518      56.5       48.0     61.5    60.5      0.98       0      0
hawk-dash           5  1459      56.5       48.0     56.6    59.0      1.04       0      0
hawk-dash           7  1400      56.5       48.0     52.5    57.1      1.09       0      0
lion-president      4  1518      56.5       48.0     63.0    60.6      0.96       0      0
lion-president      5  1459      56.5       48.0     56.8    59.1      1.04       0      0
lion-president      7  1400      56.5       48.0     52.3    57.1      1.09       0      0
```

Before (the 26 m/s plan, same tracks): the bot took 73-79 s in every car (Cruz 78.0 / 76.2 / 73.3 s: 1.26-1.44 of the
good driver); with the per-car ceiling but the old grip and at-sight braking, 1.10-1.32; cornering on 0.35 of the
turn, 0.94-1.07 but a bank seed took a recovery and a creek washout was missed, so 0.3.

## Safety rows, unchanged bars

- Bot bank (`bank.rs`): every mix and length class laps, 0 recoveries, 0 wrecks, 0 stuck windows; the 12-seed
  playtest flags no softlock (autopilot lap / refLapMs mean 0.63, was ~0.9: bots now lap well inside the reference).
- Set pieces: the autopilot lands every placed piece at design speed, lips at ~25 m/s on the 20-28 band (RCH, with
  another session's uncommitted generator work in the tree; that work's own set-piece failures, overpass leaps, a Town
  seed with no piece, are not this change: green on eris at clean HEAD).
- Crossings `bots_lap_both_levels`: red at clean HEAD before this change (Postie bike wreck, Rocks seed 1); with it the
  Postie wreck is gone and Postie OutbackDirt seed 1 misses one level's exact crossing point with a wheel down (handed to
  the crossings bead's owner).
- Jumps, respawn, assists, bikes, lab, loops, crossings: pass. jj-sim, jj-wasm-host, jj-fixture, jj-session: all pass.
- Re-measured (they record feel, they are not requirements): `scenarios/affordances/boost-line.json` progress (kerb car
  502 m, envelope 475-525; grid car in 405-455; every baseline still beaten). Retimed: `late_join.rs`'s pack runs
  3 s / 4 s (was 6 s) so the drop-in still lands on the greybox's straight.

## Not covered

- Bikes (no arcade turn for the good driver to corner on): they plan on `lateralGrip`; their own bank laps upright.
- The drift-boost-chain duel's known gap (grip ties drift in the greybox S-bend) is the duel's own scripted lines, not
  the autopilot's plan; it is unchanged.
