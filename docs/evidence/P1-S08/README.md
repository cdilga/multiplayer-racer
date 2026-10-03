# P1-S08: ACTION utilities, the "OI!" flash and cones

Date 2026-10-04, GentlePike. Bead `br-p1-s08-c51`. Closes on green Gitea CI (`ev:ci`).

The ACTION stick's up and down now do something before weapons exist (plan §7.6, R60):

- **Up: the "OI!" flash.** A harmless cue. The sim records `UtilityEvent::Oi`, the host turns it into
  `SimEvent::Oi { seat }`, and the R-tasks render the headlight flash and the comic "OI!" over the car. Cooldown
  0.5 s of game time.
- **Down: drop a traffic cone.** It lands 1.5 m behind the rear bumper, standing on the road at rest. It's a light
  dynamic prop (a cone 0.7 m tall, 0.36 m across, 8 kg) that stays for the round like every prop (R58), and cars push
  it and drive over it. It's `UtilityEvent::Cone`, `SimEvent::ConeDropped { seat, debris }`, and a debris record of
  kind 1 in the snapshot (the record's reserved word is now its kind: 0 debris, 1 cone). Cooldown 2.5 s of game time:
  a rule cadence, not a count cap.
- **On purpose only.** jj-input already decides what a deliberate entry is: the dominant axis past 0.75, hysteresis,
  and a neutral re-arm, so holding up fires once. A pointer cancel neutralises without firing. The host applies a
  controller's `Action` once per id (resends do nothing) and detects host pads with its own source machine; fixtures
  with stick spans run the same machine.
- **In the sim** it's one journaled command, `Sim::utility(car, kind)` (`Setup::Utility`). It's refused while that
  utility's cooldown runs, while the car is held, or once it has finished. It replays, and the cooldowns and counts
  are in the state hash.
- **Introspection.** Each observation's `action` carries `oi` and `cones` (fired over the round). The metrics are
  `oiFired` and `conesDropped`, and the fixture's debris observations name each prop's `kind`.

The rules are TUNE values in `crates/jj-sim/src/utility/mod.rs` (`rules`); the owner's playtest decides them (Q-A3:
OI! and cones as the placeholder defaults to yes).

## Acceptance → tests

| AC | Test / scenario |
|---|---|
| Forward sector entry fires OI! once per entry; rear entry drops one cone | `scenarios/affordances/utility-intent.json`: a flick up then down fires one OI! and drops one cone (checked right after each), and holding up for 1.5 s fires once. Host path: `a_controllers_utilities_apply_once_and_reach_main_as_events_and_a_cone_in_the_snapshot` (`jj-wasm-host`): a phone's `Action`s (one resent twice) apply once each, a host pad's flick fires once, and main gets two `Oi`s, one `ConeDropped` and a kind-1 debris record. Sim: `each_utility_fires_once_and_its_cooldown_refuses_in_game_time` |
| Cooldowns (0.5 s / 2.5 s game time) hold; cones persist and are pushable | `scenarios/affordances/utility-cooldown.json`: flicks at 0, 0.3 and 0.7 s give two OI!s, and at 0.9, 1.9 and 3.5 s give two cones (the second of each is refused inside its cooldown). Sim tests: `each_utility_fires_once_and_its_cooldown_refuses_in_game_time`; `a_cone_lands_behind_the_bumper_on_the_ground_and_stays_for_the_round` (behind the car, on the road, and still within 5 cm of where it fell 60 s later); `a_car_driving_into_a_cone_pushes_it_and_is_not_wrecked` |
| A cancelled touch fires nothing (§7.3a `utility-intent`) | `utility-intent.json`: car 2 pushes ACTION most of the way up and down without reaching the sector, and car 3's touch heads up and is cancelled (a pointer cancel span) and then sits on the exact up/right diagonal. Neither fires. Baselines: without input or without the ACTION stick, nothing fires |
| The §7.3b `cone-defence` duel holds: a follower hitting a dropped cone loses a little time and is never wrecked | `scenarios/duels/cone-defence.json`: two cars on the autopilot's line at 20 m/s, 20 m apart. The leader drops a cone and the follower hits it, knocking it about 9 m along the road. Against the same run without the ACTION stick, the follower ends 0.30 m behind (about 15 ms at 20 m/s; the duel asks for at least 0.1 m and at most 4 m), stays upright (up ≥ 0.93) and isn't wrecked. The leader isn't slowed |

All three scenarios run in the bank (`cargo test -p jj-tools --test scenarios`, which now includes `scenarios/duels/`)
and replay to the same state hash. Their output is `runs.json` (`jj sim --json`).

## Notes

- **Spawn protection ghosts props.** A protected car collides only with the world, so a car in its first 1.5 s drives
  straight through a cone. The duel waits out the protection and then places its cars. In a round that's the rule
  working as intended: a car that just dropped in can't be blocked by a cone.
- **The cone's cost is its mass**, and that's the tuning lever. A 4.5 kg cone cost the follower 0.08 m; 8 kg costs
  about 0.3 m with a visible jolt. A playtest may want more; it shouldn't become a scripted slowdown.
- Out of scope, per the bead: the OI! pop and the cone's model on the host (R-tasks, from these events and snapshot
  records) and tutorial prompts (C06).
