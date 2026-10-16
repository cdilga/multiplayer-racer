# P1-FL06 (br-bbki.6): assists carry the stability on the arcade handling (R128)

The arcade controller (P1-FL04.2, R138) lets go on purpose: a throttle punch swings the Ute's tail, and an over-driven
corner slides wide. The learner assists (br-2mxa, R125) now carry the stability, and they stay input-side: they edit the
player's stick before the vehicle path and add no force.

- **Slide catch** (`assets/profiles/assist.json`: `levels.*.slideCatch`, `slide`).
  - It reads the arcade controller's drift angle (`ArcadeState.angle_deg`, while the car is on its wheels).
  - Past `slide.startDeg` (8°), it gives a share of the steering to a counter-steer, rising to the full share at
    `fullDeg` (25°). The counter-steer is the drift angle over 25°, against the slide.
  - It eases the throttle toward `liftTo` (0.4), below the power slide's hold.
  - In the arcade controller, steering against a slide is what catches it, so this is the learner's own catch, done
    for them.
- **Lots** catches slides (`slideCatch` 1.0). Its steer-to-line and brake assist bring the car back to the road.
- **Some** damps slides (`slideCatch` 0.5). Half the steering goes to the catch, so a slide held at full lock lets go.
- **Off** is the raw car.
- **The line pull still never fights a full-lock stick.** The slide catch is the stated exception, and it only ever
  steers against the slide (`assists_never_fight_a_full_lock_input`).

Measured on the Mac (aarch64, native release build, `cargo test`), shared tree on 2026-10-17.

## AC1: the same over-driven corner at each level (`scenarios/assist/over-driven.json`)

`crates/jj-sim/tests/assist.rs`, `an_over_driven_corner_spins_off_and_stays_on_the_road_with_lots`.

The setup: the greybox loop's hairpin, flat out, with a 0.1 s lift and a stab of full lock toward the line at the bend.
The road's half-width is 7 m, and the hairpin exits 117 m from the start line. Each figure is over 15 s.

| Car | Level | Max slip | Off the line by | Progress |
|---|---|---|---|---|
| Cruz Missile | Off | 98° (spun) | 8.8 m (off the road) | 102 m (stuck in the hairpin) |
| Cruz Missile | Some | 13° | 3.6 m | 219 m |
| Cruz Missile | Lots | 13° | 3.6 m | 222 m |
| Tradie Ute | Off | 83° (spun) | 8.2 m (off the road) | 97 m |
| Tradie Ute | Some | 35° | 3.6 m | 216 m |
| Tradie Ute | Lots | 12° | 3.6 m | 223 m |

Envelopes:
- **Off:** slip ≥ 60° and ≥ 7 m off the line.
- **Some:** slip ≤ 45° and on the road.
- **Lots:** slip ≤ 20°, on the road, and ≥ 150 m (round the hairpin).

The power slide (`a_power_slide_is_held_off_damped_with_some_and_caught_with_lots`): the Tradie Ute punches the throttle
at full lock from 6 m/s and holds it for 2.5 s.

| Level | Max slip | Sliding (slip > 10°) |
|---|---|---|
| Off | 34° | 2.08 s (held: the RWD tail, R138) |
| Some | 17° | 1.86 s (damped to half) |
| Lots | 7° | 0 s (caught before it starts) |

Envelopes:
- **Off:** ≥ 25° and ≥ 1.5 s.
- **Some:** ≤ 0.7 × Off's slip.
- **Lots:** ≤ 10° and ≤ 0.1 s.

Every run replays from its journal to the same full-state hash.

## AC2: skill still shows (`crates/jj-procgen/tests/assists.rs`)

The setup: the Feel Lab's canyon-leap scene (`maps/lab/canyon-leap.json`), two laps, the same good driver at Off and at
Lots. The driver is scripted:
- pure pursuit on the route line, flat out;
- braking at 12 m/s² for the corner speed of 45 % of the car's `turn_g`;
- the leap inside its 20–28 m/s window, and the crest at 25 m/s.

| Car | Off | Lots |
|---|---|---|
| Cruz Missile | 72.80 s | 86.12 s |
| Tradie Ute | 78.43 s | 86.72 s |
| Hawk Dash | 74.48 s | 85.94 s |
| Lion President | 74.51 s | 85.93 s |

There were no wrecks or recoveries in any run. Lots' brake assist plans corners for 9 m/s² at 0.9 × speed skill, which
holds a good driver back on every car.

The 45 % share is the fastest clean one for the Cruz: 0.35 gave 76.4 s, and 0.45 gave 72.8 s. From 0.55 the car runs
wide into the scene's rock walls and loses a minute.

The autopilot is not a fair "good driver" here. It is a cautious bot that Lots' auto-throttle speeds up: 101.6 s at Lots
against 113.7 s at Off.

## AC3: the phone sets each level; the host shows the L-plate

`web/tests/journeys/br-2mxa-assist.test.mjs`, unchanged, on a host worker rebuilt with the slide catch
(`scripts/build-host-wasm.sh`), in local Playwright Chromium and WebKit: pass 2/2.
- The phone sets Off, Some and Lots.
- The host carries the level per seat.
- The tile shows the L-plate (Some, then Lots live in the race), and loses it at Off.

## Known gaps

- The bikes have no arcade controller (no drift angle), so the slide catch never acts on them. Their Some and Lots keep
  the line pull, brake assist and flip help.
- The feel of the catch (start angle, share, lift) is data for the owner's couch test.
