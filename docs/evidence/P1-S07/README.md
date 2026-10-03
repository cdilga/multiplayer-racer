# P1-S07: autopilot

Date 2026-10-03, GentlePike. Bead `br-p1-s07-2cc`. Closes on green Gitea CI (`ev:ci`).

`crates/jj-sim/src/autopilot/` is a visible, deliberately weak driver, wired into `Sim` (R45: controller loss never
pauses the room):

- **Pure pursuit** on the centerline. The look-ahead is max(6 m, 0.8 s × speed), and steering is the pursuit
  curvature turned into a wheel angle through the Cruz's wheelbase. Route tracking only searches forward from the last
  point, so the loop's other stretches can't pull it across.
- **Speed.** `0.7 × √(7 m/s² / κ)` from the sharpest curvature within stopping distance plus the look-ahead, clamped to
  4–26 m/s. Cool-down laps go at 0.6 of that.
- **Noise.** Seeded and slow: its own RNG stream per car, ±0.04 of steering, a new target every 0.25 s.
- **Self-recovery.** Under 1 m/s for 3 s, it presses Recover. That's derived from the state, so it isn't journaled, and
  replays reproduce it.
- **Control.** `Sim::set_autopilot(car, on)` is journaled; the session decides when (G03).
  - Handback blends the applied controls from the autopilot's last output to the player's input over 0.25 s, starting
    at a tick boundary.
  - `autopilot::is_deliberate` is the test for fresh deliberate input: an axis moved ≥ 0.25. A heartbeat or a noisy
    axis isn't deliberate.
- **Finished cars** switch to cool-down autopilot, so they coast, ghosted, and the S05 gap is closed.
- **Introspection.** `Sim::autopilot_state` and each observation's `autopilot` field carry mode, route point, target
  point, look-ahead, target speed, stuck ticks and its steer/throttle/brake. Observations and traces now report the
  controls actually applied (`Sim::applied_input`): the player's, the autopilot's, a blend, or none while held.

## Acceptance → tests (`cargo test -p jj-sim --test autopilot`)

| AC | Test / scenario |
|---|---|
| Autopilot completes three laps of the greybox without help | `the_autopilot_completes_three_laps_unaided_then_cools_down` (seeds 5, 6, 7: three legal laps, 0 wrecks, 0 recoveries, then still moving in cool-down). Bank: `scenarios/autopilot-three-laps.json`. Laps of 51.7 / 49.4 / 49.4 s against the greybox's 40 s reference lap, so weak as intended (`runs.json`) |
| Handback on fresh deliberate input at a tick boundary with no jolt (measured in the signature) | `handback_blends_at_a_tick_boundary_with_no_jolt`, released in the autopilot's first hard corner. The applied steering moves in equal steps to the player's over 30 ticks, then is exactly theirs. The largest per-tick yaw-rate and speed changes during the handback stay within the autopilot's own before it. `a_heartbeat_or_a_noisy_axis_is_not_deliberate`. Trace: below |
| Self-recovers after being stuck 3 s; its state is introspectable | `it_recovers_itself_after_being_stuck_3_s_and_its_state_is_introspectable` (boxed in by four immovable debris blocks: Recover fires at 3 s, not before, and it stays on autopilot; the target sits about one look-ahead ahead; target speed within its bounds) |

Also `autopilot_takeovers_and_handbacks_replay_to_the_same_hash`.

### Handback in a corner (`jj sim --trace`, seed 5, released at tick 1018: 6.5 m/s, yaw −22°/s)

| tick | applied steer | yaw rate °/s | forward speed m/s |
|---|---|---|---|
| 1012 | −0.313 | −23.98 | 6.53 |
| 1018 | −0.286 | −21.91 | 6.53 |
| 1024 | −0.238 | −18.40 | 6.54 |
| 1030 | −0.181 | −14.07 | 6.57 |
| 1036 | −0.124 | −9.74 | 6.61 |
| 1042 | −0.067 | −5.37 | 6.66 |
| 1048 | −0.010 | −0.94 | 6.72 |
| 1051 | 0.000 | −0.01 | 6.75 |

The largest yaw-rate change per tick is 3.06 °/s in the half second before the handback (the autopilot's own
corrections) and 0.75 °/s during it. Speed rises smoothly as the player's light throttle takes over. Full samples are
in `runs.json`.

## Runs

```
$ rch exec -- cargo clippy --locked --all-targets --no-deps -p jj-sim -p jj-tools -- -D warnings   exit 0
$ rch exec -- cargo test --locked -p jj-sim -p jj-tools        all pass (autopilot 5, placement 7, race 9, bank 7 scenarios)
$ rch exec -- cargo check --locked --target wasm32-unknown-unknown -p jj-wasm-host -p jj-sim        exit 0
```

## Known gaps (other beads)

- Freshness timers and handback triggers (dropout: 250 ms stale → neutral, 2 s → autopilot; idle: 15 s → a 3 s cue →
  autopilot) and the visible badge in the UI: G03 wires them end to end.
- Seed-bank bot playtests over generated maps (stuck windows, lap spread): M03g.
- The pursuit and speed numbers are TUNE. A real track's bends, jumps and surfaces may need the look-ahead and grip
  retuned (S03/M03g).
