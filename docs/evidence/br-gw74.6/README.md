# br-gw74.6 (R122): no dives or roll-overs in turns

## Cause
`roll_influence` 0.6. Rapier's raycast vehicle keeps roll at Bullet's fixed 0.1; the sim adds the rest per wheel to give
visible lean (docs/learnings/sim.md). Six times Rapier's roll, with `friction_slip` 2.0 grip and a hull only 0.115 m
off the ground at rest, rolled the body onto its sill in hard turns and over. Shown in data by the handling bank: the
hull's lowest point against the heightfield (clearance) and the car's up axis, per run.

## Change (profile data, `assets/profiles/cruz-missile.json`)
- `roll_influence` 0.6 → 0.12.
- `drift_rear_grip` 0.35 → 0.31: with less roll, drifting down a straight cost almost nothing; this keeps it slower than
  driving straight (the S09 duel, margin now one tick, 1/60 s, as times are tick-quantised). R120's drift rework
  (br-gw74.4) retunes drift as a whole.

## The bank (`crates/jj-procgen/tests/handling.rs`)
- Generated roads, seeds 1-6, every 40th route point, 15/25/35 m/s, full throttle with full lock held, a full-lock
  flick, and straight (the road alone). `handling-bank.txt` is the table.

  | profile | runs | dives (chassis > 5 mm into the ground, on the road) | grazes (< 2 cm) | roll-overs in turns |
  |---|---|---|---|---|
  | before (0.6) | 513 | 13 | 323 | 53 |
  | after (0.12) | 513 | 0 | 9 | 0 |

- Flat ground (surface-strips: tarmac, packed dirt, gravel, rock), 10-35 m/s × 25/50/100 % lock × step/ramp ×
  throttle/brake: before, worst roll 84° (a flip at 35 m/s, full lock, tarmac); after, 12.6° (a spin under locked brakes
  at 35 m/s on the fourth strip) and the chassis never touches.

## Other checks
- All 82 `jj sim` scenarios: the same as before except two envelopes rewritten with reasons: `idle-settle` (roll
  2.5-10° → 0.5-10°: the car leans about 1° now) and `control-after-t-bone` (the T-bone now hits the doors and front
  wheel, not the front panel). The 9 files `jj sim` refuses are the damage and crash banks' own format, run by their
  Rust tests, unchanged.
- Crate tests (jj-sim incl. damage and duels banks, jj-procgen, jj-fixture, jj-tools, jj-wasm-host, jj-session,
  jj-protocol): 216 passed through RCH.
- `jj validate assets/profiles/cruz-missile.json`: ok.

## Known gaps
- The road itself flips a car taking some crests or jumps at 35 m/s going straight (seed 1 point 80): that's the jump's
  landing envelope, br-gw74.7.
- Nine on-road grazes (within 2 cm, never under) remain at full lock at 25-35 m/s; no flip follows any of them.
- The debris-pile escape is chaotic in `roll_influence` (see docs/learnings/sim.md).
- Feel is judged at the couch test (G-FEEL); the tuning menu (br-2sdu.1) can move both numbers live.
