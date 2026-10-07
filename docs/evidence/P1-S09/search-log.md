# P1-S09 search log: how the duels were found, what was tuned, what doesn't hold

The harness is `scenarios/duels/search.py` (writes fixtures to the git-ignored `scenarios/duels/scratch/`, runs
`crates/jj-sim/tests/duels.rs` on the RCH workers, reads its `RESULTS` lines). Timings were found with seeded random
search plus local refinement over each technique's parameters (150 to 300 variants a round, 4 to 7 rounds), then frozen as
literals in `scenarios/duels/make_duels.py`. The sweep CSVs in `sweeps/` are the grids behind the frozen values.
`jj sim --sweep` couldn't be used for the search itself (it sweeps a tuning field, not an input timing).

## What holds (all asserted natively in `duels.rs`, and through WASM in `web/host/tests/duels-wasm.test.mjs`)

| Duel | Ordering | Margin held |
|---|---|---|
| `wheelie-launch-duel` / `-8` | plain beats early, late and held; **well beats plain is a known gap** (below) | n/a |
| `air-control-duel` (40 degree tilt) | well 5.36 s < plain (no input) 5.59 s < over-corrected 5.96 s | 0.23 s / 0.37 s |
| `boost-placement-duel` | boost on the straight 8.43 s < same boost in the corner 9.88 s < no boost 12.03 s | 1.45 s |
| `drift-boost-chain` | drift both bends + banked boost 8.68 s < best grip line 9.09 s < plain 11.75 s; handbrake held throughout never finishes | 0.41 s |
| `drift-straight-penalty` | plain 5.98 s < drift-long 6.09 s (drift-short leaves the road) | 0.11 s |
| `drift-corner-duel` | well 9.86 s < plain 12.03 s; early handbrake spins out (DNF) | 2.2 s |
| mash | no mash script finishes ahead of the well line in any duel | (every duel has two seeded mash cars) |

## Wheelie launch: known gap, root cause and proposed mechanic fix

On the shipped profile (`wheelie_drive_gain` 0.15) a well-timed pull-release launch loses to plain full throttle: from rest
well 4.47 s against plain 4.08 s, from 8 m/s well 3.62 s against 2.90 s (`wheelie-launch-duel`, `-8`; the beat is marked
`gap`). Early, late and held releases are slower than plain too, so the rest of the ordering holds.

**Root cause.** The preload is the DRIVE stick pulled past full brake, and the sim has no idea it is a preload: in
`crates/jj-sim/src/vehicle/mod.rs` `stick()` turns a pulled-down DRIVE into full brake, and `wheel_commands` applies it
(`max_brake_force` 14 kN, about 11.7 m/s^2) for the whole pull, or reverses the car at rest. The 0.35 s the profile
requires costs a rolling car about 4 m/s, or sends a standing one backwards, while the reward is +15 % drive for 0.8 s
(about 0.7 m/s). The gesture can never repay itself, whatever the margins.

An earlier attempt raised `wheelie_drive_gain` to 1.75 (with the lift impulse cut to 850 to stay inside `wheelie-ok`).
That made the duels pass, but it is an elevenfold compensation for a cost that shouldn't be there, so it was reverted
(`sweeps/wheelie-tuning-x-hold.csv` keeps the numbers; that the lift envelope had to move with it is the sign it was
fighting the mechanic).

**Proposed fix (not applied; sim core untouched).** While a wheelie preload is pending, DRIVE pulled past full brake must
not brake or reverse the car: the preload is a held gesture, not a brake command. jj-input already knows a preload is in
progress (it measures `preload_ms` and fires `ActionKind::Wheelie` on release), so the host and the fixture harness should
tell the sim "preload active" per car each tick (a flag beside `DriveInput`, journaled with the input), and
`vehicle::stick()` should read the pulled-down stick as zero brake and zero reverse while it is set. A preload that never
completes (cancelled, released early) just ends with the flag. Then the pull costs the car only the 0.35 s it must hold,
the existing 0.15 gain pays for itself modestly, the two wheelie duels get re-measured and their `gap` removed or kept,
and the gain becomes a normal TUNE question for the owner's feel verdict. This touches `DriveInput` (the journal format),
the jj-input and host plumbing and `jj-protocol` if the flag crosses the wire, so it belongs with the S03c owner, not S09.

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
4. **`wheelie-hop-duel` is not shipped (gap, no fixture).** The map kit's lowest barrier is 40 cm, a wheel can't hop it, and
   the kerb feature is a validation record with no collider. A dynamic bar (16 to 30 cm) lying across a lane gives
   chaotic contacts: the same input in lanes 6 m apart finished or stuck in an order that changed with the lane
   (a 24 cm bar, the plain car, six lanes: 6.0 s, DNF, DNF, 6.1 s, 5.9 s, 5.8 s), so no ordering is stable.
   A flat detached door (8 cm) costs a plain car nothing (plain 5.32 s, hop 5.59 s). The acceptance asks for the hop duel
   with both; neither could be made to hold. Needs either a fixed-height static obstacle in the kit (a kerb collider) or a
   decision to drop the duel.
5. **The wheelie launch duels are gaps** until the preload stops braking (section above).
6. **`air-control-duel` needs a big tilt.** At the feel bank's 25 degrees a car landing tipped loses nothing to one that
   levelled (5.40 s against 5.41 s), so the duel launches tipped 40 degrees (no input 5.55 s, levelled 5.34 s, over-corrected
   5.96 s at 40; no input flips at 70).
7. **Cars at one pose and the racing line.** Cars placed at one pose stay ghosted against each other until they part. On a
   racing line that goes wrong (a drifting car sweeping through another's line spun it), so the autopilot duels run each car
   alone in its own fixture (`<duel>.<label>.json`); the stick duels on a straight keep one fixture with all the cars.
