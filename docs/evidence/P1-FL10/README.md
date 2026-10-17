# P1-FL10 (br-bbki.10): the hairpin and its dirt cut-through (R131, R134)

A tarmac hairpin with a packed-dirt cut across its apex. The cut is shorter and saves time, but it's loose: driven on
less grip, a car slides on it. It reads on the TV as a dirt track across the infield.

## The cut family (`forks.cut`)

Route forks (P1-FL16a) are shortcuts across a meander: 150–600 m long, splitting at 15–35°, and 4 m clear of the rest of
the road. They can't make a short chord across a hairpin's apex. Probing lab ovals (bends of 30–55 m radius, straights of
180–300 m, four seeds each), none got a fork. The refusals were the saving (`gain>hi`), the radius, the length and the
start corridor. So the fork feature gains a second family, built with CoralCrane (FL16's owner):

- **`jj-map` fork `cut` 1** has its own shape rules (`fork::cut_limits`): splits at 30–80°, rejoins at up to 80°, runs
  25–160 m, turns as tight as 9 m, and only its 25 m ends meet the road. The rest of a fork applies unchanged: the
  same Hermite line (`path_of`), bed, paving and checks (`fork::problems`). The feature carries `cut` only when it is
  one, so every meander fork's params are as before.
- **`jj-procgen` `forks.cut`** (`CutData`; absent from `generator.json`, so off) lays cuts at `perKm` of eligible
  road. Each is a chord across the inside of a bend that turns at least `bendDeg`, splitting and rejoining `leadM` either
  side.
  - Each candidate's saving, at `branchPace` of the road's pace, sits inside `gainS`.
  - The cut goes through the same commit as a fork: paved looser than the road it leaves, its ground stamped, then it,
    every fork before it and every set piece re-checked.
- **Meander forks are untouched.** With cuts off, the placer takes the same path and draws the same random numbers.
  - The commit step is now a shared function, called with the same arguments.
  - The other lab maps (canyon leap, off-road climb) re-bless byte for byte.

## The lab scene (`assets/lab/scenes.json` `hairpin-cut`; AC1, AC2)

- **The scene:** outback bitumen, seed 1, straights of 200 m, bends of 40 m.
- **The cut** (`maps/lab/hairpin-cut.json`): one chord across the first hairpin, route points 77 to 133. It splits at
  72.9°, rejoins at 64.4°, is 9.1 m wide and about 80 m long, and is packed dirt off the tarmac. It skips 140 m of road.
- **Cut settings:** gain band 1–9 s at `branchPace` 0.62, packed dirt's grip against tarmac's.
  - A hairpin round the road is slow, so cutting its apex saves 4–8 s on the estimate. That's more than a meander fork's
    1–3 s band (R5).
  - The scene is where the owner judges whether the trade-off is fair. Generated courses lay no cuts until FL16 sets their
    rate and band.
- `tests/lab.rs` `the_hairpin_cut_is_shorter_and_looser_than_the_road_it_skips` asserts one cut, no other fork, under
  60% of the skipped road's length, packed dirt off tarmac, and a clean contract.

The runs (`scenarios/lab/hairpin-cut-*.json`, in the scenario bank). The autopilot takes a fork's branch by a seeded bit,
so the cut and road runs differ only in sim seed:

| Run | What | Envelope | Measured |
|---|---|---|---|
| `hairpin-cut-lap` | the autopilot laps the scene | a full lap (700 m), no wreck or recovery | 700 m in 4850 ticks |
| `hairpin-cut-take` | from 150 m before the split at 15 m/s, it takes the cut (sim seed 1) | 260–320 m along the road at 1500 ticks; slip ≥ 8° | **287 m**, slip **11.3°** |
| `hairpin-cut-road` | the same start, round the tarmac (sim seed 4) | 180–230 m at 1500 ticks; slip ≤ 4° | **205 m**, slip **1.5°** |

The cut's car is 82 m of road further on at the same moment, and slid on the dirt: 11.3° of slip against 1.5° on the
tarmac.

## On the TV (AC3)

`web/tests/journeys/fl10-hairpin.test.mjs` passes 2/2 locally, in Playwright Chromium and WebKit, on a rebuilt host
worker. It runs the take and road fixtures in the real worker and renderer; each ends inside its fixture's progress
envelope, on its wheels. The captures and their review are in `self-review.md`.

**From the Feel Lab:** the scene is in the Feel Lab's scene data. Loading a scene into a running room is P1-FL03.1
(br-bbki.19).

## Known gaps

- **Generated courses get no cuts yet.** `forks.cut` is absent from `generator.json`. Their rate, band and pace are
  FL16's call (br-bbki.16), once the owner has driven this scene.
- **The autopilot doesn't judge the cut.** It takes it on its seeded alternation (R29), as it does any fork, so half a
  pack cuts whatever the gain.
