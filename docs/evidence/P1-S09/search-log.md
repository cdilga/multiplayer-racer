# P1-S09 search log: how the duels were found, what was tuned, what doesn't hold

The harness is `scenarios/duels/search.py` (writes fixtures to the git-ignored `scenarios/duels/scratch/`, runs
`crates/jj-sim/tests/duels.rs` on the RCH workers, reads its `RESULTS` lines). Timings were found with seeded random
search plus local refinement over each technique's parameters (150 to 300 variants a round, 4 to 7 rounds), then frozen as
literals in `scenarios/duels/make_duels.py`. The sweep CSVs in `sweeps/` are the grids behind the frozen values.
`jj sim --sweep` couldn't be used for the search itself (it sweeps a tuning field, not an input timing).

## What holds (all asserted natively in `duels.rs`, and through WASM in `web/host/tests/duels-wasm.test.mjs`)

| Duel | Ordering | Margin held |
|---|---|---|
| `wheelie-launch-duel` / `-8` | well 3.78 / 2.53 s < plain 4.08 / 2.90 s < early < late < held (from rest / from 8 m/s) | 0.30 s / 0.37 s |
| `wheelie-hop-duel-door` | well 4.99 s < plain 5.28 s (on the launch; the door itself costs nothing, a stated `gap`) | 0.29 s |
| `air-control-duel` (40 degree tilt) | well 5.36 s < plain (no input) 5.59 s < over-corrected 5.96 s | 0.23 s / 0.37 s |
| `boost-placement-duel` | boost on the straight 8.43 s < same boost in the corner 9.88 s < no boost 12.03 s | 1.45 s |
| `drift-boost-chain` | drift both bends + banked boost 8.68 s < best grip line 9.09 s < plain 11.75 s; handbrake held throughout never finishes | 0.41 s |
| `drift-straight-penalty` | plain 5.98 s < drift-long 6.09 s (drift-short leaves the road) | 0.11 s |
| `drift-corner-duel` | well 9.86 s < plain 12.03 s; early handbrake spins out (DNF) | 2.2 s |
| mash | no mash script finishes ahead of the well line in any duel | (every duel has two seeded mash cars) |

## Wheelie launch: root cause, and the launch that repays the pull

Before: a well-timed pull-release launch lost to plain full throttle (from rest well 4.47 s against plain 4.08 s, from 8 m/s
3.62 s against 2.90 s). No bug: a speed trace of both cars shows the pull costs exactly what it should and the launch
returns almost none of it.

**Root cause: the payoff was arithmetically smaller than the price.** The preload is DRIVE pulled past full brake for at least
0.35 s (`wheelie_good_min_ms`). From rest that is 0.35 s with the car reversing a little and not accelerating (about 0.4 s
behind plain from then on); rolling, the brakes shed about 4 m/s (14 kN on 1.2 t, `stick()` reads the pull as full brake).
The only payoff was +15 % drive for 0.8 s: worth about 0.1 s. No tuning of the timing could win. Raising that constant
(`wheelie_drive_gain` 0.15 to 1.75, with the lift impulse cut to keep `wheelie-ok`'s 6 to 14 degrees) made the duels pass but
was rejected as an elevenfold compensation, and it couples the launch to the pitch the drive force causes.

**The fix: the launch repays what the pull cost** (`Sim::wheelie`, new tuning `wheelie_launch_reward`, 1.5). A good release
(preload at least 350 ms) gives the car a forward impulse at its centre (no pitch moment, authorised in the energy ledger) of
`reward x (speed the brakes shed over the first 0.4 s of the pull + what the engine would have added in that time)`. The car
keeps a 150-tick history of its forward speed to read the shed speed from. The reward is a multiple of a cost, not a
constant: reward 1 hands back exactly what the pull took (the sweep shows well and plain roughly level), 1.5 pays half as much
again for doing it right. A pull held past 0.4 s is repaid no more (spec: lift is greatest at 0.4 s) but costs more time, so late
and held releases lose; an early release (under 350 ms) gets nothing and loses. `wheelie_drive_gain` (+15 %, 0.8 s) and the lift
are unchanged; the whole S03 feel bank still passes (`wheelie-ok`, `wheelie-fail`, `brake-no-wheelie`).

| | from rest | from 8 m/s |
|---|---|---|
| plain | 4.08 s | 2.90 s |
| well (pull 0.35 s) | 3.78 s | 2.53 s |
| early (0.2 s) | 4.36 s | 3.33 s |
| late (0.9 s) / held (1.15 s) | 4.47 / 4.83 s | 3.27 / 3.58 s |

`sweeps/wheelie-launch-reward-x-hold.csv` has reward 0, 0.5, 1, 1.5 and 2 against holds from 0.2 to 1.15 s. The older
`sweeps/wheelie-tuning-x-hold.csv` is the rejected gain/lift tuning, kept as the evidence for the rejection.

Boost and drift tuning was **not** changed. Raising the drift's boost charge (0.25 to 0.45 per s) and the boost gain (0.6
to 0.9) keeps the bank passing (gain 1.0 fails `boost-line`; drain 0.25 and rear grip 0.5 or more fail `boost-hold`,
`boost-line` and `drift-entry-exit`), but none of it makes a drift line out-run a grip line in the hairpin (below), so it
isn't worth moving the S03 numbers for.

## Gaps and findings the owner should see

1. **Drifting does not out-corner a good grip line (known gap, asserted).** With the cars on their own steering
   (random search over brake point, brake strength, throttle and steering for a grip line; handbrake timing, length, counter
   steer and boost for a drift line, a few thousand trials each), the best grip line through the greybox hairpin at 18 m/s
   entry (6.2 s to 125 m) beat the best drift line (7.0 s) by 0.8 s. The Cruz Missile's grip is high (friction slip 2.0),
   so the hairpin barely asks the grip car to brake, and a drift only loosens the rear: it scrubs speed and doesn't
   tighten the path. Under every tuning the S03 rows allow (charge to 0.45 per s, boost gain to 0.9, rear grip 0.35 to 0.4)
   the gap stayed 0.1 to 0.9 s. A steering-lock bonus while the drift is on (a new `drift_steer_gain` tuning, prototyped
   and removed) got the drift line to a tie, not a win. To make the drift pay as the owner asked, the sim needs a mechanic
   or a looser S03 envelope (drift-entry-exit's 25 to 60 degree slip and 0.12 to 0.35 charge), which is a feel decision, not
   a number to nudge. The shipped drift duels isolate the technique instead: every car on the autopilot's line, only the
   ACTION stick differing.
2. **`drift-corner-duel`: the drift's charge adds nothing in the corner (known gap, asserted by a `gap` on the beat).**
   Well (drift through the corner, boost on the exit) 9.86 s ties exit-boost (the same boost with no drift) at 9.88 s; the
   best straight-boost line (7.97 s) beats both. The beat `well` over `exit-boost` by 0.2 s is marked `gap` and must keep
   failing until the corner pays. Drift timings are also knife-edge: of the 15 drift timings in
   `sweeps/drift-corner-timing.csv`, 7 finish and only the frozen one (9.86 s) beats plain (12.03 s; the rest spin out or
   finish in 12.6 to 13.9 s), and the frozen line finishes on 4 of 6 seeds.
3. **Drifting on a straight charges boost** (the `well` line first found for the corner sat on the straight: handbrake held
   1.3 s at 18 m/s with the autopilot's small steering noise, boost spent after, 7.05 s against 7.57 s for boost alone).
   The corner window in the frozen duels rules it out; the sim itself doesn't (`drift_charge_min_slip_deg` 10 degrees and
   5 m/s are the only conditions). Worth a decision.
4. **`wheelie-hop-duel-door` ships; a kerb duel doesn't (gap).** A flat detached door is the part's own proxy (0.11 x 1.04 x
   0.98 m) lying on its side. Each car has a lane of free ground (the map's 9 x 6 m building dressing was in the way of two
   lanes; the duel yard drops it, after which identical cars in different lanes give identical times). The door is no obstacle:
   plain 5.28 s with it and 5.28 s without, the hopper 4.99 s either way. So `well` beats `plain` by 0.29 s on the launch, not on the
   hop, and the beat "the clear lane beats the doored lane" is a stated `gap`. A kerb needs a bar of 12 to 30 cm across the lane:
   the map kit's lowest barrier is 40 cm, a dynamic bar gives chaotic contacts (the same input in lanes 6 m apart finished or
   stuck in an order that changed with the lane: bar half-heights 8, 12 and 15 cm, plain 5.6 to 7.3 s and DNF), so no ordering is
   stable. Needs a fixed-height static obstacle in the kit (a kerb collider) or a decision to drop the kerb half.
5. **The wheelie launch duels hold** (section above); the margins are 0.30 s from rest and 0.37 s from 8 m/s.
6. **`air-control-duel` needs a big tilt.** At the feel bank's 25 degrees a car landing tipped loses nothing to one that
   levelled (5.40 s against 5.41 s), so the duel launches tipped 40 degrees (no input 5.55 s, levelled 5.34 s, over-corrected
   5.96 s at 40; no input flips at 70).
7. **Cars at one pose and the racing line.** Cars placed at one pose stay ghosted against each other until they part. On a
   racing line that goes wrong (a drifting car sweeping through another's line spun it), so the autopilot duels run each car
   alone in its own fixture (`<duel>.<label>.json`); the stick duels on a straight keep one fixture with all the cars.
