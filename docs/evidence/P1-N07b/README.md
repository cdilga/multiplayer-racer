# P1-N07b: the round director

Date 2026-10-03, GentlePike. Bead `br-p1-n07b-tyc`. Closes on green Gitea CI (`ev:ci`).

`crates/jj-session/src/director/` is a pure reducer. Time arrives only as `Input::Elapsed`, and timers run on the
presentation clock, which manual, host-hidden and fault pauses stop. It runs Lobby → Preparing → Countdown → Running →
Finalising → Intermission → Countdown…, plus End and Disband. Its rules come from master §10.6 and §10.8:

- **Start policy.** The armed ready-based start fires when every eligible seat is Ready (and there is at least one).
  **Start now** warns not-ready seats for 10 s (configurable, clamped to 5–15 s), then starts everyone. Pressing it
  again skips the countdown but never the map.
- **Cohort and Ready.** The start cohort freezes when the start begins. An original seat un-readying cancels a
  ready-based start and returns to Lobby, or to Intermission with its remaining time. Ready is scoped to a revision,
  which clears at round start, intermission start, End and settle, so old Ready taps are ignored.
- **Preparation.** Every request takes a new `PreparationId`, and a completion for any other id is stale. A failed map
  retries once with the conservative fallback, then settles in Lobby.
- **Round end.** Finalising times out to an *unsaved* intermission rather than spinning forever.
- **Empty party.** With nobody eligible there's no zero-player round: the party settles in Lobby and disarms.
- **Driving.** `driving()` gives Lobby free-drive (the warm-up), Racing while a round runs, and Held otherwise.

## Acceptance → tests (`cargo test -p jj-session director`)

| AC | Tests |
|---|---|
| A join during countdown doesn't restart it; an original seat un-readying cancels a ready-based countdown | `a_join_during_countdown_does_not_restart_it_and_rides_in_the_round`, `an_original_seat_unreadying_cancels_a_ready_based_countdown`, `a_late_joiner_unreadying_does_not_cancel_and_neither_does_unready_in_an_auto_start`, `an_early_start_cancelled_in_intermission_returns_with_the_time_it_had_left` |
| End during preparation cancels the job and returns to Lobby; reroll during preparation fences the stale `PreparationId` | `end_during_preparation_cancels_the_job_and_returns_to_lobby`, `end_voids_an_unfinished_round`, `reroll_during_preparation_fences_the_stale_preparation_id`, `reroll_during_countdown_waits_for_the_new_map_and_keeps_the_cohort`, `a_failed_map_retries_once_with_the_fallback_then_settles` |
| Pause during intermission freezes the intermission timer (presentation clock) | `a_pause_during_intermission_freezes_its_timer` (manual, hidden and fault freeze it; renderer and performance pauses stop only the sim), `a_manual_pause_freezes_the_countdown_too` |
| Force-start gives not-ready seats a 10 s warning, then starts everyone with their current car | `force_start_warns_not_ready_seats_for_ten_seconds_then_starts_everyone` (starts at exactly 10 s, nobody left behind, un-readying doesn't cancel it), `start_now_again_skips_the_countdown_but_never_the_map`, `the_warning_length_is_host_configurable_within_five_to_fifteen_seconds`, `stale_ready_taps_cannot_restart_a_disarmed_lobby` |
| Auto-next runs Intermission → Countdown without host input; no zero-player auto-round loop | `the_party_runs_itself_round_after_round` (4 rounds, no host input), `a_map_still_preparing_when_intermission_ends_shows_preparing_then_counts_down`, `an_emptied_party_settles_in_lobby_and_never_auto_starts`, `everyone_leaving_during_a_start_settles_instead_of_starting`, `finalising_never_spins_forever`, `lobby_is_free_drive_and_disband_is_terminal` |

`invariants_hold_for_random_sequences` (proptest, 1,000 random sequences of up to 200 inputs per run) checks:

- no round starts with zero seats;
- no round starts on a map that wasn't ready, or was cancelled;
- no second round starts before the first ends;
- round ids increase;
- Countdown always has a ready map;
- nothing happens after Disband.

The first draft's invariant wrongly required Running alone while a round was open. The minimal case proptest found
(Finalising) is kept in `proptest-regressions/`.

## Runs

```
$ cargo test -p jj-session                          (Mac, per-crate)   32 passed; the property test re-run 6 more times, all ok
$ rch exec -- cargo clippy --locked --all-targets --no-deps -p jj-session -- -D warnings   exit 0
$ rch exec -- cargo test --locked -p jj-session     32 passed
```

## Known gaps (other beads)

- Voting and its close deadline, replay visibility, finite events (EventEnd) and the 30-minute idle End (§10.8).
- Mapping to the wire `RoomPhase`/`PauseReason`, the 10 s banner and vibration on phones, and the host buttons: these
  come with the browser wiring (G01) and phase UI (R07).
- The behaviour in the running game is proven when N07c/G01 wire the director to the host (anti-narrowing clause). This
  bead proves the reducer.
