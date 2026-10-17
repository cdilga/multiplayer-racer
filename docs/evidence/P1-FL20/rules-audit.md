# P1-FL20 (br-bbki.23): the fun-track rules against the generator, audited 2026-10-17

`docs/research/fun-tracks.md` sets 30 rules, each with a metric and target. This is where each stands in the generator
(`crates/jj-procgen`, data in `assets/profiles/`), the map validator (`crates/jj-map/src/validate.rs`) and the seed-bank
tests. It was a read-only code audit at 1b87c538 plus another session's uncommitted procgen work. **Met** means data, a
gate and a seed-bank test all exist and hit the target.

| # | Rule | Status | Where it stands |
|---|---|---|---|
| 1 | Choice cadence (gap ≤ 10 s) | missing | no decision-point counter |
| 2 | Forks per lap (≥ 2 standard, ≥ 1 sprint) | partial | `forks.perKm` density, no per-lap minimum gate |
| 3 | Fork shape | partial | `Rule::Fork` (split/merge angles, width, length); no merge funnel, no "no wall nose" |
| 4 | Commitment visible | partial | set pieces ≥ 10 s in view, gated and tested; fork split ≥ 3 s not checked |
| 5 | Risk/reward band | partial | `forks.gainS` estimated; failure cost not computed |
| 6 | Line parity (± 3 %) | partial | bots-split test at 8 % |
| 7 | Costed shortcuts | missing | nothing is boost-gated |
| 8 | Width for packs | partial | constant 12 m road; no 14-18 m flow / 16 m merge widths |
| 9 | Takedown spaces | missing | no zone detector |
| 10 | Jumps full width | **met** | `jumps.roadWide`, `Rule::JumpBypass`, rhythm and jump banks |
| 11 | Approach band, straight core | partial | core turn and ballistic band checked; "full throttle arrives in band with a margin" not |
| 12 | Airtime band (1.0-2.5 s) | missing | no airtime computation or gate |
| 13 | Landing EFH ≤ 1 m | partial | landable by construction; EFH not computed |
| 14 | Pitch skill window | partial → **fixture** | `crates/jj-procgen/tests/skill_jump.rs` (this bead, AC3); no generator check of lip pitch against landing slope |
| 15 | Global air constants | **met** | `air.json`, schema forbids per-jump overrides |
| 16 | Landing tiers | partial | tiers in data and tested; respawn cost 4-6 s not asserted |
| 17 | Run-out ≥ 2 s at v_hi | partial | `runoutM` 40-45 m, under ~56 m target, unchecked |
| 18 | Teach then test | missing | no teaching kicker |
| 19 | Distance pays (far-third zone) | missing | only the `cleanLong` airtime tier |
| 20 | Beat rhythm | partial | distinct beats and run share gated; spacing, recovery, flow length report-only |
| 21 | Opener and escalation | missing | not measured |
| 22 | Speed variance | missing | not measured |
| 23 | On-camber, drift corner | partial | banking tested; drift-corner count missing |
| 24 | Landmark density | partial | set-piece landmarks only |
| 25 | Roadside density | partial | evenness and clearance tested, not per-second density |
| 26 | Terrain first | partial | 25 m relief tested; 30 % corridor share and "set piece on its landform" not |
| 27 | Biome transitions ≥ 5 s | partial | 40 m transition (~1.6 s) |
| 28 | Variety between seeds | partial | gated at 0.92 similarity, target 0.85 |
| 29 | Every option completable | partial | forks driven on 1-3 seeds per biome, not 20 |
| 30 | Readable on a shared TV | missing | no overview-camera check |

Met: 2. Partial: 19 (R14 now has its fixture). Missing: 9.

## Split (2026-10-17)

AC2 ("those rules implemented as generator data + validators; 20 seeds per course family meet them") is more than one
session, so it moves to five child beads of br-bbki.23, by rule group: forks and choices (R1-R4, R29), risk and shortcuts
(R5-R7), jumps (R11-R13, R16-R19), lap shape (R8, R9, R20-R23) and scenery and readability (R24-R28, R30). AC3, the skill
jump fixture, is done here. AC4, the TV self-review and the owner's verdict, stays on the parent.
