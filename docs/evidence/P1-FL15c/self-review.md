# P1-FL15c self-review: cohesive, varied courses (br-bbki.15.4)

Build: c19090d0, the joint FL15c + FL16a landing (GENERATOR_VERSION 24; every capture's header reads 24, all 8 maps
valid). Host: local `jj-server`, Playwright Chromium (not a TV), 1920×1080, `tools/maps/review-landscape.mjs`
with `JJ_RECIPES=mix` (each seed prepared as a race prepares it: its own biome mix, family and draws), seeds 0–7.
Numbers: `rhythm.txt` (AC1 table, 80 laps), `variety.txt` (AC2, 20 seeds), from `crates/jj-procgen/tests/rhythm.rs`.
- AC1: 78 of 80 laps (20 per family: twisty, flowing, speedway, epic figure-eight) carry their set pieces, at least
  three beats, no beat over 40% in one stretch, every jump the road's full width. The other two are stated gaps (below).
- AC2: race-prepared seeds differ: max similarity 0.889 (seeds 10 and 14), mean 0.690 over 190 pairs (gate 0.92; 1
  pair over fun-tracks R28's proposed 0.85). The validator rejects a lab oval that is one long beat.

## Looked at

- `overview-8-seeds.jpg`: the eight overviews side by side (from `captures/mix-s0-overview.jpg` to `captures/mix-s7-overview.jpg`).
- `high-8-seeds.jpg`, `low-8-seeds.jpg`, `climb-8-seeds.jpg`, `cutting-8-seeds.jpg`: the chase stills of the same
  eight seeds, one montage per camera state (each from the eight `captures/mix-s<seed>-<state>` stills, e.g. `captures/mix-s0-low.jpg`).
- `captures/mix-s5-cutting.jpg` full size (the canyon cutting on Rocks).

What they show:
- **Eight different courses.** Every overview is a different shape: a long rectangle with a hairpin tail (s2), a
  rounded flowing loop (s3), a triangle through a Rocks field (s4), a dogleg through domes (s5), a long speedway-ish
  lap with a hairpin (s6), a narrow triangle with a mesa (s7). No two read as the same layout.
- **Set pieces read from above.** The cream detour branches beside the road (the set pieces' slower line) show on
  every overview, two per lap on the longer laps, spread around the lap rather than bunched (s0, s3, s4, s6).
- **Beats in the chase stills.** Kickers that span the road ahead (high s0, s4, s6: a jump is the road's full width,
  no bypass lane), cuttings with walls both sides (cutting s0, s1, s2, s5, s7), chevron-railed technical corners
  (low s0, s2, s5, s6, s7), and Town's street straights with its sheds and power lines (high s1, climb s3).

## Defects found and fixed

- **Two set pieces bunched, leaving one long flow beat** (speedway seed 2: pieces 13 s apart, then 51 s of unbroken
  flow, 57% of the lap). After each placement, the sites at least a quarter-lap clear of every placed piece now go
  first (`setpieces::place_counted`). Seed 2 now has a 33 s longest flow stretch.
- **Town speedways** (Town-only laps drew the speedway family: 800 m straights through town, 49 s of one flow beat, 58%
  of the lap, with no street corner to break it). Town no longer draws a speedway (`generator.json`
  `course.familiesOffIn`); Town's own technical spacing is data (`technicalSpacingIn`, 0: its street corners are its
  technical beat). Tried first: Town technical clusters at 700, 900 and 1400 m. These either left the stretch at 41–58%
  or cost rooftop lots (7 of 10 seeds).
- **The canyon-leap lab scene lost its piece** once pieces had to be seen from afar: the scene asks for it by name, so
  `lab::build` places it whatever the sight (`fill_unseen`).
- **The full-throttle jump bank's "end" tilt was the worst tilt** (`end_up_y` = `min_up_y` past the jump), which made
  the 0.8 minimum a 0.9 one. It now reads the car as it leaves the jump. The case that tripped it (Greybox seed 19,
  Cruz at 40 m/s with the wheel held straight) drifts 5.2 m left and tips 27° on the landing's side slope. It doesn't
  wreck.
- **A Town lap with no junction** (Town seed 9: a fork and a set-piece beat took the only straights a side street could
  join). A side street now tries the other roadside when its drawn side is refused, and the validator redraws a
  Town-only lap left without one.
- **A straight-wheel jump run that never ended** (Rocks seed 21, Cruz at 40 m/s: it drifted 11.6 m off a bending
  landing and stayed inside the test's radius). Leaving the jump's side after landing now ends the jump.
- **Earlier in the bead** (in this commit): technical clusters, beat straights, the rhythm validator, the variety
  metric, every core jump full road width (`jumps.roadWide.share` 1.0), and the validator's ladder that keeps the
  requested biomes before dropping one.

## Remaining defects

- **Figure-eights 5 and 12 (of 20 epic) seat one set piece, not two**: a lobe's beat straight sits between arcs, so its
  landmark is rarely in view 10 s ahead, and the crossing's keep-outs reject the rest. They're stated as `KNOWN_GAPS` in
  the AC1 test, and **br-bbki.15.4.1** seats two by construction.
- **Rooftop lots: 7 over the 10 Town seeds** (was 9). Town's former speedways (seeds 4 and 7) carried lots on their
  long straights. The roofs floor is restated at 7. br-amv3 (more lot candidates) should bring the count back up.
- **Flat plains around the lap**: Town and Bitumen laps (s1, s3, s6 overviews) still sit on wide, empty, flat ground
  between the landforms. That's terrain density (FL15a, CoralCrane's area), not the course's rhythm.
- **Core jumps are rare**: two set pieces take a lap's straights, so a plain kicker turns up about once in ten laps. A
  teaching jump before the first big leap (fun-tracks R18) is a follow-up.
- Notes the rhythm validator reports but doesn't gate (`rhythm.json`): flow stretches over 20 s on most long laps,
  set pieces 13–14 s apart (target 15 s) on some eights, and a technical stretch within 4 s of a landing.

## Not covered

- **The owner's couch verdict (AC3)**: owner-gated. This bead closes `--pending` for it.
- A real TV or a GPU other than the Mac's; WebKit; the phone controller (unchanged by this bead).
- Driving the eight seeds lap by lap in the browser: the stills are fixed camera states. The laps are driven
  natively by the autopilot banks (landforms, forks, crossings).
