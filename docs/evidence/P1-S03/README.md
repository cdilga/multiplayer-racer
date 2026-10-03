# P1-S03a: the Cruz Missile from its sidecar, drive basics, the feel bank

Child `.1` of P1-S03. Drift and boost are `.2` (S03b); the wheelie is `.3` (S03c).

## The car

`assets/profiles/cruz-missile.json` (`jj.vehicle-profile.v1`) has two halves:

- **Geometry**, derived from the baked V02 sidecar (`art/vehicles/cruz-missile/cruz-missile.asset.json` and its
  LOD0 GLB) by `jj vehicle sync`:
  - the intact body's collider proxies (153 hull points, 2.28 × 1.52 × 4.55 m);
  - the wheel pivots (±0.85 m track, ±1.34 m axles);
  - wheel radius 0.40 m;
  - the `com` anchor (0, 0.55, 0).
- **Tuning**, hand-set feel.

`jj validate` re-derives the geometry and fails if the bake has moved on (CI: the rust job). The sim's body frame is the
sidecar's vehicle space. The provisional profile is gone.

Drive basics live in `crates/jj-sim/src/vehicle/`:
- DRIVE x steers, with lock falling off with speed.
- Up throttles; down brakes, and reverses below 1 m/s.
- Per-surface grip multiplies tyre friction (tarmac 1.0, packed dirt 0.8, gravel 0.7, rock 0.9, off-track 0.6).
- Air control: DRIVE y pitches and DRIVE x rolls while no wheel touches.

Body roll uses the profile's `roll_influence`, put back over Rapier's private 0.1 (see `docs/learnings/sim.md`).

## The bank (Mac run, 2026-10-03)

`crates/jj-sim/tests/feel.rs` runs it natively; `web/host/tests/feel-wasm.test.mjs` runs it through the host's WASM
build in Node, via jj-wasm-host's test surface. Each scenario has several cars, one per starting state.

Columns:
- **Envelopes:** checks held.
- **Baselines:** the same setup re-run with no input, mashed input or the first input held. ✓ means it came out
  different from the deliberate run.
- **Replay:** the journal replays to the same full-state hash.
- **Native = WASM:** the full-state hash from native `jj sim` (darwin/arm64) equals jj-wasm-host's in Node 26.10.0.

| Scenario | Cars | Envelopes | Baselines | Replay | Native = WASM |
|---|---|---|---|---|---|
| `feel/air-level` | 2 | 10/10 | no-input ✓, mash ✓, hold ✓ | ✓ | `6fadff1fa215` ✓ |
| `feel/idle-settle` | 2 | 16/16 | no-input ✓, mash ✓ | ✓ | `b6d5193ba9d1` ✓ |
| `feel/jump-land` | 3 | 21/21 | no-input ✓, mash ✓, hold ✓ | ✓ | `716cb8274342` ✓ |
| `feel/progressive-brake` | 4 | 12/12 | no-input ✓, mash ✓, hold ✓ | ✓ | `c3c64da4a947` ✓ |
| `feel/slalom` | 2 | 10/10 | no-input ✓, mash ✓, hold ✓ | ✓ | `0b983794a30f` ✓ |
| `feel/surface-deltas` | 4 | 8/8 | no-input ✓, mash ✓ | ✓ | `b507222c41ca` ✓ |
| `affordances/fwd-back-rest` | 5 | 25/25 | no-input ✓, mash ✓, hold ✓ | ✓ | `a5b72e4aa77b` ✓ |
| `affordances/brake-stop` | 4 | 13/13 | no-input ✓, mash ✓, hold ✓ | ✓ | `df8103f8deba` ✓ |
| `affordances/turn-around` | 3 | 9/9 | no-input ✓, mash ✓, hold ✓ | ✓ | `3c9f5541c58d` ✓ |
| `affordances/unstick-wall` | 3 | 9/9 | no-input ✓, mash ✓, hold ✓ | ✓ | `3154ecaa138a` ✓ |
| `affordances/authority` | 3 | 6/6 | no-input ✓, mash ✓, hold ✓ | ✓ | `a549f746ea39` ✓ |
| `affordances/rejoin-route` | 3 | 6/6 | no-input ✓, mash ✓, hold ✓ | ✓ | `66c4bddafa3e` ✓ |

`slalom`, `air-level` and `jump-land` are both §7.3 scenarios and §7.3a affordance rows, so they run all three baselines.
The other feel scenarios run no-input and mash, as their AC asks.

What the bank shows (TUNE numbers, judged at G-FEEL):

- **Suspension.**
  - Dropped 0.6 m, the car settles with at most one rebound, at its design pose (within 4 cm).
  - Driven, it squats, dives and rolls visibly: 2.9° pitch and 4.1° roll at about 6 m/s.
  - Leaving a lip at 10, 15 and 20 m/s, it lands once, level within 0.97, and drives on.
- **Brake and reverse.**
  - Stops from 10, 20 and 30 m/s in 6.3, 18.9 and 36.6 m with a progressive press; 21.5 m from 20 m/s while turning.
  - Half brake from 20 m/s takes 26.1 m.
  - Holding the stick down then reverses.
- **Steering.**
  - The slalom yaws 56–67°/s and ends back on line.
  - Authority (heading change from full lock in 0.5 s): 19.4° at 5 m/s, 24.0° at 15 m/s, 14.1° at 30 m/s.
- **Surfaces.** At 15 m/s on full lock for 1 s, heading change is 57° on tarmac, 50° on rock, 44° on dirt and 38° on
  gravel.
- **Affordances:**
  - Forward and back from rest on all five surfaces, with no hop or wheelie.
  - A three-point turn inside the road (155–176°, centre within 6 m of the line).
  - Backing out of a nose-in barrier: 1.2 m clear in 1 s.
  - Rejoining the road from either verge, and from 30° off, within 4 s.
  - Levelling a 25° tilt in the air.

## Sweep

`jj sim --sweep max_steer_rad=0.35..0.75:5 scenarios/affordances/authority.json` writes one CSV row per value × car:
the value, whether the run held its envelopes, and every outcome-signature metric
(`sweep-max_steer_rad-authority.csv`).

The sweep shows lock only matters at low speed. Heading change in 0.5 s at 5 m/s rises from 14.2° to 22.2° across the
range. At 15 and 30 m/s it stays near 24° and 14°: there the tyres' grip, not the lock, sets the turn.
