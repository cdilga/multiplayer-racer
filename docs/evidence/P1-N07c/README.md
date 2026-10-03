# P1-N07c: results and standings

Date 2026-10-03, GentlePike. Bead `br-p1-n07c-dnb`. Closes on green Gitea CI (`ev:ci`).

`crates/jj-session/src/results/` is a pure reducer. The host builds a `RoundFacts` at finalisation (per seat:
entered, finish time with crossing fraction, the legal-progress high-water mark and its tick, withdrawn, late).
`Standings::commit` classifies the round and adds its points, in memory only (R84).

The rules come from master §10.12:

- **Order.** Finishers by finish tick, then crossing fraction. Then everyone else by legal progress (more first),
  then the tick it was reached (earlier first). Exactly equal keys share a competition rank (1, 1, 3); seat order only
  orders the display.
- **Status.**
  - A finish makes Finished, even if the seat left afterwards (Leave/return can't unfinish it or earn a second
    bonus).
  - Unfinished and withdrawn at finalisation is DNF (frozen progress, placement points only).
  - Unfinished and present is Unfinished.
  - Never entered is DNS (no place, zero, listed last).
  - One seat has one record: a duplicate seat is refused.
- **Points.** `[25, 18, 15, 12, 10, 8, 6, 4, 2, 1]`, then 1 for every later classified rank (no truncated tail). Finishers
  get the ruleset's finish bonus (+5 by default, host-configurable for the next round). Late joiners are classified
  where they actually finish.
- **Commit.** Idempotent by `RoundId`: the same facts (in any order) return `Again` and change nothing; different facts
  for a committed round are a `Conflict`.

The race supplies the two facts results need (in `jj-sim`'s race module, P1-S05's area):

- the finish line's crossing fraction within the finishing step (`finish_fraction`, 0..=65535);
- the legal-progress high-water mark with the tick it was reached (`best_progress_mm`, `best_progress_tick`).

`Race::standings` now uses the same order.

## Acceptance → tests (`cargo test -p jj-session results`)

| AC | Test |
|---|---|
| Simultaneous finishes and exact ties share place and points (1, 1, 3) | `simultaneous_finishes_and_exact_ties_share_place_and_points` (same tick and fraction share 1st with 25 each; a later fraction in the same tick is 3rd with 15; unfinished ties share too) |
| Late joiners and leave/return produce the specified DNF/finish records with no extra finish bonus | `late_joiners_and_leave_return_produce_the_specified_records` (a finisher who left stays Finished with one bonus; a late finisher is classified where it finished; withdrawn-unfinished is DNF with placement points only; a returned seat is one ordinary record; DNS last with zero; exactly one bonus per finisher; a duplicate seat record is refused) |
| An all-stuck race at the deadline ranks unfinished entrants by legal progress | `an_all_stuck_race_ranks_by_legal_progress_then_the_tick_it_was_reached` (equal progress breaks by the earlier tick; equal both share) |
| 1 point to every rank past 10 (no truncated tail) and +5 to finishers | `every_rank_past_ten_gets_a_point_and_finishers_get_the_bonus` (40 finishers: the table, then 1 each; +5 each; the bonus is the ruleset's) |
| A repeated commit for the same `RoundId` is idempotent; a conflicting payload is rejected | `a_repeated_commit_is_idempotent_and_a_conflicting_one_is_refused` (reordered same facts: `Again`, totals unchanged; changed progress: `Conflict`, nothing moves) |

Also:

- `the_session_table_adds_up_rounds_and_shares_tied_places`.
- `classification_invariants`: a proptest over 1,000 random rounds of up to 40 entrants. Everyone gets a row; places are
  competition ranks; points match the table; every classified rank scores ≥ 1; finishers lead and only they get the
  bonus; DNS scores zero with no place.
- jj-sim `tests/race.rs::finishes_carry_a_crossing_fraction_and_progress_keeps_its_high_water_mark`.

## Runs

```
$ rch exec -- cargo clippy --locked --all-targets --no-deps -p jj-session -p jj-sim -p jj-tools -- -D warnings   exit 0
$ rch exec -- cargo test --locked -p jj-session -p jj-sim -p jj-tools                   all pass (jj-session 39, race 9)
```

## Known gaps (other beads)

- Lap timing (valid timed laps; inherited progress or a recovery voids a lap's timing): no lap times are recorded yet.
- Bots' separate standings and humans-only event ranks (S12 filler bots), team rankings, Derby/Stunt/King conversion
  (D6/D8).
- Building `RoundFacts` from the sim and seats in the host, and the results screen: G01 and R07.
