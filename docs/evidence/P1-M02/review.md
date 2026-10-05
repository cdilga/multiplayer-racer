# P1-M02 fresh-eyes review

Reviewer: fresh-context Sonnet 5.5 subagent, 2026-10-05

## Checked
report.md against bench-native.json, bench-wasm.json, host-run.json (python3 recompute), and the four compare-*.jpg sheets.
I did not read spikes/procgen/src/lib.rs, so "the candidates are what the report says" rests on the report and the sheets only.

## Recomputed (all match the report)
- 288 rows native and 288 in WASM. Repeatable 288/288, ok 288/288, violations 0, native-vs-WASM fnv mismatches 0.
- Worst native gen+validate 47.3 ms. WASM (Node) worst gen 144.1 ms. host-run: Chromium 1x 89.1, 4x 373.3, 6x 566.5 ms.
- nnCv poisson/blue/cluster: town .243/.311/.760, rocks .165/.230/.717, dirt .090/.183/.702, bitumen .249/.303/.684.
- Relief noise/route: town 3.0/4.0, rocks 10.6/9.9, dirt 4.9/4.7, bitumen 1.9/3.9.
- Max grade, mean over seeds: noise 2.8/12.6/4.1/1.2 %, route 5.6 % everywhere. Max over seeds: noise 3.7/16.2/5.2/1.5 %, route 6.1 % everywhere.
- Drive table matches host-run.json.

## Verdict: agrees with caveats
The numbers are accurate. The recommendation follows, with the following caveats.

1. The grade row compares seed-mean to seed-max. The report's "6.1 %" is the max over seeds (the mean is 5.6 %), and "16.2 %" is also a max (the mean is 12.6 %). Say "max over seeds" in the table header.
2. Route grade is 6.1 % in every biome, so the data never exercises a per-biome max-grade parameter. Route is also steeper than noise in town, dirt and bitumen (6.1 vs 3.7, 5.2, 1.5). Only rocks justifies it. The report's "about the same relief" holds for rocks and dirt only. Route gives 2x the relief in bitumen (3.9 vs 1.9 m) and 1.3x in town.
3. The bitumen drive ran on route+blue, but the drive table is headed "recommended candidates" and the recommendation is Poisson. The recommended bitumen map was not driven. The report's "Poisson at a larger radius gives the same look" is also untested (no such run or image).
4. Poisson vs blue is confounded: blue uses Poisson's count, so nnCv .25 vs .30 shows little. The nnCv numbers do support dropping blue, but not the "pick per biome" logic (cluster for town and rocks is a look judgement, backed by nnCv .7 and the sheets).
5. Timing: native is gen+validate, but the WASM figures are gen only (the validator was not timed in WASM). The Chromium figure is from 16 maps, not 288. The throttle stand-in for a phone is already disclosed.
6. Determinism evidence is one machine (arm64 macOS; Node V8 and Chromium). "libm-only keeps native = WASM" is shown, not proven. x86 and Safari/JSC are untested. Say so as the M03 receipt's job.
7. Images: the route and noise rows differ little from flat at this high-angle view. Relief is only visible on rocks (dark off-map edge undulates). Route rows show faint pale smudges around the road on dirt and bitumen, probably the 40 m blend. Not mentioned in the report and worth a look in M03c.
8. Images: the road stair-step is clearly visible in all four sheets (the report does flag it). Rocks and dirt biomes also show the off-map plain's colour against the biome ground, a different layout from the report's "plain below zero" fix; it looks resolved.
9. Rocks stand-ins (generic/box-building) read as houses, so the sheet cannot judge the "outcrops like the Olgas" claim. Cluster's town and rocks choice is by nnCv and grouping only, not by how it looks.
