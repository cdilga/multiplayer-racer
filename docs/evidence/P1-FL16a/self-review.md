# Self-review P1-FL16a (br-bbki.16.1): route forks

Captured on the Mac (Apple M1 Pro) with `tools/maps/review-forks.mjs`: local real jj-server, Chromium (GPU), 1920×1080,
no physical TV. The maps were generated on the working tree at `4aefaed7` plus the fork work. The capture records
generator version 23; the landing commit bumps it. The cars are placed by the S02 harness, not driven. For each fork
there is a whole-course overview, a chase still 3 s before the split (29 route points, at the autopilot's ~24 m/s),
and one at the split. Recipes and seeds: Rocks 0 and 2, Town 0 and 2, Outback Dirt 0 and 2.

## Looked at

- [rocks-s0-overview.jpg](rocks-s0-overview.jpg): both forks read from the overview camera as grey gravel trails cutting
  inside the lap. The long one winds (its sine trail), the short one is a straight cut.
- [town-s0-fork0-split.jpg](town-s0-fork0-split.jpg): a packed-dirt branch peels off the outside of the bend. Its mouth
  breaks the road's white edge line, and a chevron pair (< >) stands on the gore.
- [town-s0-fork0-3s-before.jpg](town-s0-fork0-3s-before.jpg): the gore chevron pair is visible down the road.
- [outback-dirt-s2-fork0-split.jpg](outback-dirt-s2-fork0-split.jpg): on a dirt road the branch is gravel (grey), so it
  reads apart from the road. The gore pair stands at the junction.
- [rocks-s0-fork1-split.jpg](rocks-s0-fork1-split.jpg): in a canyon the gravel mouth opens to the right ahead, with the
  gore pair beside it.
- [rocks-s2-fork0-3s-before.jpg](rocks-s2-fork0-3s-before.jpg): an S-bend and a cutting hide the split from 3 s out
  (see Remaining defects).
- The other frames ([capture.json](capture.json) lists all 24) show the same: the branch reads at the split, and the
  gore pair reads from a distance wherever the road ahead is open.

## Fixtures (CI): `crates/jj-procgen/tests/forks.rs`

- **Validity:** 20 seeds × 4 biomes all validate (the `fork` rule: split 15–35°, ≥ 9 m wide, 150–600 m, merge ≤ 25°,
  grade, radius, clear of the road away from its ends, no gate inside). Forks on 46 of 80 courses.
- **The autopilot drives every branch:** one car alone, re-rolled over sim seeds until it has driven each fork both
  ways. No recoveries, no wrecks. That covers the first 3 forked seeds per biome in release.
- **Bots split, and neither way dominates:** in an 8-car pack over 2 laps, each way gets 20–80 % of the passes (the
  measured split is 50 %). The best branch and road times from split to merge stay within 8 % of each other; measured:
  12.8/13.4 s, 35.4/37.3 s, 32.9/32.8 s, 38.5/37.8 s, 38.8/38.2 s.

## Defects found and fixed

- **Branches dominated** (3–11 s faster). The gain estimate assumed 0.8 g corners, but the autopilot plans about 0.35 g,
  and it doesn't slow on loose surfaces. Recalibrated (`gripG` 0.35, `branchPace` 1.0). Shortcuts that would still save
  too much now wind until they save the middle of the band.
- **Cars wedged at the merge** (100–290 s on the branch, recoveries). The road's guard rails and chevron posts stood
  across the branch's mouth. Wayfinding is now cleared at fork mouths only (rails elsewhere stay), and the corner
  wayfinding lint treats a mouth as a junction.
- **Grade spikes at the ends.** The branch now rides the road bed's own ground until it leaves it, then ramps.
- **Roof stunts reshaped ground the branch runs on.** They now keep out of fork spans.
- **A fork could span the finish line.** It no longer can.
- **The split was unreadable from the chase camera.** Added the gore chevron pair, and the branch is now drawn over the
  road's edge paint at its mouth. Before the fix the pair pointed inward (> <); it now points apart (< >).
- **Bot choices were coin flips** (3 of 16 on one fork). Now half of any pack takes each way, and each car alternates.

## Remaining defects

- **R4 sight-line isn't guaranteed.** Behind an S-bend or a cutting, the split can be hidden 3 s out (Rocks seed 2
  fork 0). Placement doesn't check the chase eye's line of sight yet; set pieces do (`minSightS`).
- **R5 risk isn't there yet.** For the bots, forks are parity lines (R6) at the moment: the branch's cost is its winding
  trail and its loose surface. It has no jump or hazard, so no failure cost. The research's costed shortcut (R7) and
  jump line are not built.
- **The 8 % parity envelope is wider than R6's 3 %.**
- **Short laps and figure-eights** often get no fork (or set piece); the crossing exclusions eat the eligible stretch.
  That is br-bbki.16.2 / br-bbki.15.4 territory.
- **Cadence (R1)** is br-bbki.16.2: the measured longest gap between decisions is 25–96 s.

## Not covered

Physical TV, WebKit captures, a deployed preview, the owner's couch verdict, and human drivers (the parity numbers are
the autopilot's).
