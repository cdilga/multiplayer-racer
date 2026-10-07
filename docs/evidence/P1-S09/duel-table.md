# P1-S09 duel table

Time to each duel's gate, s (DNF: never reached it in the run, or left the road by more than the gate allows). One row per
car. Produced by `cargo test --release -p jj-sim --test duels -- --nocapture` (native); `web/host/tests/duels-wasm.test.mjs`
judges the same orderings through the WASM build. Gates: wheelie-launch-duel(-8) 40 m travelled; air-control-duel 70 m
travelled; drift-straight-penalty 150 m of route; boost-placement-duel and drift-corner-duel 110 m of route (from the
hairpin's entry); drift-boost-chain 150 m of route. Orderings and margins: `scenarios/duels/orderings/`.

Roles: `plain` is the technique-free line (or, for the autopilot duels, the autopilot with nothing on its ACTION stick);
`well` the frozen well-executed technique; `early`/`late`/`held`/`over`/`botched` the botched ones; `mash-a`/`mash-b`
seeded random scripts. In `drift-corner-duel` the extra cars are `straight-boost` (the starting boost spent on the
straight) and `exit-boost` (boost spent on the exit with no drift).

| duel | car | time to gate (s) | speed at end (m/s) | wrecks |
| air-control-duel | plain | 5.59 | 23.7 | 0 |
| air-control-duel | well | 5.36 | 0.1 | 0 |
| air-control-duel | over | 5.96 | 22.7 | 0 |
| air-control-duel | mash-a | DNF | 4.0 | 0 |
| air-control-duel | mash-b | DNF | 1.0 | 0 |
| boost-placement-duel | plain | 12.03 | 16.4 | 0 |
| boost-placement-duel | straight | 8.43 | 10.3 | 0 |
| boost-placement-duel | corner | 9.88 | 12.3 | 0 |
| boost-placement-duel | mash-a | DNF | 0.2 | 0 |
| boost-placement-duel | mash-b | DNF | 1.3 | 0 |
| drift-boost-chain | plain | 11.75 | 9.2 | 0 |
| drift-boost-chain | grip | 9.09 | 9.2 | 0 |
| drift-boost-chain | well | 8.68 | 8.7 | 0 |
| drift-boost-chain | botched | DNF | 3.8 | 0 |
| drift-boost-chain | mash-a | DNF | 0.0 | 0 |
| drift-boost-chain | mash-b | DNF | 0.0 | 0 |
| drift-corner-duel | plain | 12.03 | 16.4 | 0 |
| drift-corner-duel | straight-boost | 7.97 | 10.1 | 0 |
| drift-corner-duel | exit-boost | 9.88 | 11.8 | 0 |
| drift-corner-duel | well | 9.86 | 11.1 | 0 |
| drift-corner-duel | botched | DNF | 7.7 | 0 |
| drift-corner-duel | mash-a | DNF | 0.1 | 0 |
| drift-corner-duel | mash-b | DNF | 0.0 | 0 |
| drift-straight-penalty | plain | 5.98 | 0.1 | 0 |
| drift-straight-penalty | drift-short | DNF | 9.7 | 0 |
| drift-straight-penalty | drift-long | 6.09 | 0.1 | 0 |
| drift-straight-penalty | mash-a | DNF | 3.4 | 0 |
| drift-straight-penalty | mash-b | DNF | 7.7 | 0 |
| wheelie-hop-duel-door | plain | 5.28 | 30.2 | 0 |
| wheelie-hop-duel-door | plain-clear | 5.28 | 30.2 | 0 |
| wheelie-hop-duel-door | well | 4.99 | 32.6 | 0 |
| wheelie-hop-duel-door | well-clear | 4.99 | 32.6 | 0 |
| wheelie-hop-duel-door | mash-a | DNF | 4.3 | 0 |
| wheelie-hop-duel-door | mash-b | DNF | 3.3 | 1 |
| wheelie-launch-duel-8 | plain | 2.90 | 28.1 | 0 |
| wheelie-launch-duel-8 | well | 2.53 | 29.6 | 0 |
| wheelie-launch-duel-8 | early | 3.33 | 27.1 | 0 |
| wheelie-launch-duel-8 | late | 3.27 | 27.9 | 0 |
| wheelie-launch-duel-8 | held | 3.58 | 27.1 | 0 |
| wheelie-launch-duel-8 | mash-a | 6.42 | 2.6 | 0 |
| wheelie-launch-duel-8 | mash-b | DNF | 0.9 | 0 |
| wheelie-launch-duel | plain | 4.08 | 25.3 | 0 |
| wheelie-launch-duel | well | 3.78 | 26.1 | 0 |
| wheelie-launch-duel | early | 4.36 | 24.7 | 0 |
| wheelie-launch-duel | late | 4.47 | 24.7 | 0 |
| wheelie-launch-duel | held | 4.83 | 24.0 | 0 |
| wheelie-launch-duel | mash-a | DNF | 1.4 | 0 |
| wheelie-launch-duel | mash-b | DNF | 0.9 | 0 |
