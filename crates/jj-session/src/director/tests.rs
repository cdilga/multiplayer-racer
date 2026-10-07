//! The master §10.8 boundary table as reducer tests (P1-N07b), plus random sequences checking the invariants: no round
//! without eligible seats or a ready map, no second start without the first ending, nothing after Disband.

use proptest::prelude::*;

use super::*;

const A: SeatId = SeatId(1);
const B: SeatId = SeatId(2);
const C: SeatId = SeatId(3);

fn director() -> Director {
    Director::default()
}

fn join(d: &mut Director, seats: &[SeatId]) {
    for &seat in seats {
        d.apply(Input::SetEligible {
            seat,
            eligible: true,
        });
    }
}

fn ready(d: &mut Director, seat: SeatId, on: bool) -> Vec<Output> {
    let revision = d.ready_revision();
    d.apply(Input::SetReady {
        seat,
        ready: on,
        revision,
    })
}

fn elapse(d: &mut Director, ms: u32) -> Vec<Output> {
    d.apply(Input::Elapsed { ms })
}

fn requested(out: &[Output]) -> Option<PreparationId> {
    out.iter().rev().find_map(|o| match o {
        Output::PrepareRequested { id, .. } => Some(*id),
        _ => None,
    })
}

fn started(out: &[Output]) -> Option<(RoundId, PreparationId, Vec<SeatId>)> {
    out.iter().find_map(|o| match o {
        Output::RoundStarted {
            round,
            preparation,
            seats,
        } => Some((*round, *preparation, seats.clone())),
        _ => None,
    })
}

/// Everyone ready, map prepared: the director sits in Countdown with a ready-based start.
fn in_ready_countdown(seats: &[SeatId]) -> Director {
    let mut d = director();
    join(&mut d, seats);
    let mut out = Vec::new();
    for &s in seats {
        out.extend(ready(&mut d, s, true));
    }
    assert_eq!(
        d.phase(),
        Phase::Preparing,
        "an all-ready lobby starts preparing"
    );
    let id = requested(&out).expect("start requests the map");
    d.apply(Input::PrepareFinished { id, ok: true });
    assert_eq!(d.phase(), Phase::Countdown);
    d
}

/// A full round to the start of its intermission.
fn through_round(d: &mut Director) {
    assert_eq!(d.phase(), Phase::Running);
    d.apply(Input::RoundOver);
    assert_eq!(d.phase(), Phase::Finalising);
    d.apply(Input::ResultsCommitted { saved: true });
    assert_eq!(d.phase(), Phase::Intermission);
}

// AC1: a join during countdown doesn't restart it; an original seat un-readying cancels a ready-based countdown.

#[test]
fn a_join_during_countdown_does_not_restart_it_and_rides_in_the_round() {
    let mut d = in_ready_countdown(&[A, B]);
    elapse(&mut d, 1_000);
    let left = d.remaining_ms();
    let out = d.apply(Input::SetEligible {
        seat: C,
        eligible: true,
    });
    assert!(
        out.is_empty(),
        "a join emits nothing and restarts nothing: {out:?}"
    );
    assert_eq!(d.remaining_ms(), left);
    assert_eq!(
        d.cohort(),
        Some(vec![A, B]),
        "the cohort froze when the start began"
    );
    // The newcomer isn't Ready and that doesn't cancel the start either.
    assert_eq!(d.phase(), Phase::Countdown);
    let out = elapse(&mut d, 2_000);
    let (_, _, seats) = started(&out).expect("the countdown ends on time");
    assert_eq!(
        seats,
        vec![A, B, C],
        "the late joiner plays with their current selection"
    );
}

#[test]
fn an_original_seat_unreadying_cancels_a_ready_based_countdown() {
    let mut d = in_ready_countdown(&[A, B]);
    let out = ready(&mut d, B, false);
    assert!(out.contains(&Output::StartCancelled { by: B }));
    assert_eq!(d.phase(), Phase::Lobby);
    assert_eq!(d.remaining_ms(), None);
    assert!(
        started(&elapse(&mut d, 60_000)).is_none(),
        "a cancelled countdown never fires"
    );
    // Readying again starts again, on the map already prepared.
    let out = ready(&mut d, B, true);
    assert!(matches!(
        out.last(),
        Some(Output::CountdownStarted {
            policy: StartPolicy::AllReady,
            ..
        })
    ));
}

#[test]
fn a_late_joiner_unreadying_does_not_cancel_and_neither_does_unready_in_an_auto_start() {
    let mut d = in_ready_countdown(&[A]);
    join(&mut d, &[B]);
    ready(&mut d, B, true);
    let out = ready(&mut d, B, false);
    assert!(
        !out.iter()
            .any(|o| matches!(o, Output::StartCancelled { .. }))
    );
    assert_eq!(d.phase(), Phase::Countdown);

    // After the round, the intermission timer's start is Auto: un-readying can't hold it.
    elapse(&mut d, 3_000);
    through_round(&mut d);
    let id = d.preparation().unwrap().0;
    d.apply(Input::PrepareFinished { id, ok: true });
    elapse(&mut d, 60_000);
    assert_eq!(d.phase(), Phase::Countdown);
    ready(&mut d, A, true);
    assert!(ready(&mut d, A, false).is_empty());
    assert_eq!(d.phase(), Phase::Countdown);
}

#[test]
fn an_early_start_cancelled_in_intermission_returns_with_the_time_it_had_left() {
    let mut d = in_ready_countdown(&[A, B]);
    elapse(&mut d, 3_000);
    through_round(&mut d);
    let id = d.preparation().unwrap().0;
    d.apply(Input::PrepareFinished { id, ok: true });
    elapse(&mut d, 20_000);
    ready(&mut d, A, true);
    ready(&mut d, B, true);
    assert_eq!(
        d.phase(),
        Phase::Countdown,
        "everyone Ready starts the next round early"
    );
    elapse(&mut d, 1_000);
    ready(&mut d, A, false);
    assert_eq!(d.phase(), Phase::Intermission);
    assert_eq!(d.remaining_ms(), Some(40_000));
}

// AC2: End during preparation cancels the job and returns to Lobby; reroll during preparation fences the stale id.

#[test]
fn end_during_preparation_cancels_the_job_and_returns_to_lobby() {
    let mut d = director();
    join(&mut d, &[A]);
    let out = ready(&mut d, A, true);
    let id = requested(&out).unwrap();
    assert_eq!(d.phase(), Phase::Preparing);
    let out = d.apply(Input::End);
    assert!(out.contains(&Output::PrepareCancelled { id }));
    assert!(out.contains(&Output::Ended));
    assert!(
        !out.iter().any(|o| matches!(o, Output::RoundVoided { .. })),
        "no round had started"
    );
    assert_eq!(d.phase(), Phase::Lobby);
    assert!(!d.armed(), "End disarms the automatic start");
    // The old job's completion can't start anything.
    let out = d.apply(Input::PrepareFinished { id, ok: true });
    assert_eq!(out, vec![Output::StalePreparation { id }]);
    assert!(started(&elapse(&mut d, 120_000)).is_none());
    assert_eq!(d.phase(), Phase::Lobby);
}

#[test]
fn end_voids_an_unfinished_round() {
    let mut d = in_ready_countdown(&[A]);
    let (round, ..) = started(&elapse(&mut d, 3_000)).unwrap();
    let out = d.apply(Input::End);
    assert!(out.contains(&Output::RoundVoided { round }));
    assert_eq!(d.phase(), Phase::Lobby);
}

#[test]
fn reroll_during_preparation_fences_the_stale_preparation_id() {
    let mut d = director();
    join(&mut d, &[A, B]);
    ready(&mut d, A, true);
    let first = requested(&ready(&mut d, B, true)).unwrap();
    let out = d.apply(Input::Reroll);
    let second = requested(&out).unwrap();
    assert!(second > first);
    assert!(out.contains(&Output::PrepareCancelled { id: first }));
    // The superseded job finishing late can't commit.
    assert_eq!(
        d.apply(Input::PrepareFinished {
            id: first,
            ok: true
        }),
        vec![Output::StalePreparation { id: first }]
    );
    assert_eq!(d.phase(), Phase::Preparing);
    assert_eq!(d.preparation(), Some((second, false)));
    d.apply(Input::PrepareFinished {
        id: second,
        ok: true,
    });
    assert_eq!(d.phase(), Phase::Countdown);
    let (_, preparation, _) = started(&elapse(&mut d, 3_000)).unwrap();
    assert_eq!(preparation, second, "the round commits the latest pick");
}

#[test]
fn reroll_during_countdown_waits_for_the_new_map_and_keeps_the_cohort() {
    let mut d = in_ready_countdown(&[A, B]);
    let id = requested(&d.apply(Input::Reroll)).unwrap();
    assert_eq!(d.phase(), Phase::Preparing);
    assert!(
        started(&elapse(&mut d, 10_000)).is_none(),
        "no round on the superseded map"
    );
    d.apply(Input::PrepareFinished { id, ok: true });
    assert_eq!(d.cohort(), Some(vec![A, B]));
    assert_eq!(started(&elapse(&mut d, 3_000)).unwrap().1, id);
}

#[test]
fn a_failed_map_retries_once_with_the_fallback_then_settles() {
    let mut d = director();
    join(&mut d, &[A]);
    let first = requested(&ready(&mut d, A, true)).unwrap();
    let out = d.apply(Input::PrepareFinished {
        id: first,
        ok: false,
    });
    assert!(out.contains(&Output::PreparationFailed {
        id: first,
        retrying_with_fallback: true
    }));
    let fallback = requested(&out).unwrap();
    assert!(out.contains(&Output::PrepareRequested {
        id: fallback,
        fallback: true
    }));
    let out = d.apply(Input::PrepareFinished {
        id: fallback,
        ok: false,
    });
    assert!(out.contains(&Output::PreparationFailed {
        id: fallback,
        retrying_with_fallback: false
    }));
    assert!(out.contains(&Output::Settled));
    assert_eq!(d.phase(), Phase::Lobby);
}

// AC3: pause during intermission freezes the intermission timer (presentation clock).

#[test]
fn a_pause_during_intermission_freezes_its_timer() {
    let mut d = in_ready_countdown(&[A]);
    elapse(&mut d, 3_000);
    through_round(&mut d);
    let id = d.preparation().unwrap().0;
    d.apply(Input::PrepareFinished { id, ok: true });
    elapse(&mut d, 30_000);
    for reason in [Pause::Manual, Pause::HostHidden, Pause::Fault] {
        d.apply(Input::Pause { reason, on: true });
        assert!(d.timers_frozen() && d.sim_paused());
        let clock = d.now_ms();
        assert!(
            elapse(&mut d, 600_000).is_empty(),
            "{reason:?}: nothing fires while frozen"
        );
        assert_eq!(
            (d.phase(), d.remaining_ms(), d.now_ms()),
            (Phase::Intermission, Some(30_000), clock)
        );
        d.apply(Input::Pause { reason, on: false });
    }
    // Renderer and performance pauses stop the sim, not the presentation clock.
    d.apply(Input::Pause {
        reason: Pause::PerformanceStall,
        on: true,
    });
    assert!(d.sim_paused() && !d.timers_frozen());
    elapse(&mut d, 29_999);
    assert_eq!(d.phase(), Phase::Intermission);
    d.apply(Input::Pause {
        reason: Pause::PerformanceStall,
        on: false,
    });
    elapse(&mut d, 1);
    assert_eq!(d.phase(), Phase::Countdown);
}

#[test]
fn a_manual_pause_freezes_the_countdown_too() {
    let mut d = in_ready_countdown(&[A]);
    elapse(&mut d, 1_000);
    d.apply(Input::Pause {
        reason: Pause::Manual,
        on: true,
    });
    elapse(&mut d, 10_000);
    assert_eq!(
        (d.phase(), d.remaining_ms()),
        (Phase::Countdown, Some(2_000))
    );
    d.apply(Input::Pause {
        reason: Pause::Manual,
        on: false,
    });
    assert!(started(&elapse(&mut d, 2_000)).is_some());
}

// AC4: force-start gives not-ready seats a 10 s warning, then starts everyone with their current car.

#[test]
fn force_start_warns_not_ready_seats_for_ten_seconds_then_starts_everyone() {
    let mut d = director();
    join(&mut d, &[A, B, C]);
    ready(&mut d, A, true);
    let out = d.apply(Input::StartNow);
    assert!(out.contains(&Output::ForceStartWarning {
        seats: vec![B, C],
        ms: 10_000
    }));
    let id = requested(&out).unwrap();
    // The map takes 4 s; the countdown then runs to the end of the warning, not just 3 s.
    elapse(&mut d, 4_000);
    let out = d.apply(Input::PrepareFinished { id, ok: true });
    assert!(out.contains(&Output::CountdownStarted {
        policy: StartPolicy::Forced,
        ms: 6_000,
        cohort: vec![A, B, C]
    }));
    // Force overrides Ready: un-readying doesn't cancel it.
    ready(&mut d, A, false);
    assert!(started(&elapse(&mut d, 5_999)).is_none());
    let (_, _, seats) = started(&elapse(&mut d, 1)).expect("starts at exactly 10 s");
    assert_eq!(seats, vec![A, B, C], "nobody is left behind");
}

#[test]
fn start_now_again_skips_the_countdown_but_never_the_map() {
    let mut d = director();
    join(&mut d, &[A, B]);
    let id = requested(&d.apply(Input::StartNow)).unwrap();
    assert!(
        started(&d.apply(Input::StartNow)).is_none(),
        "the map isn't ready: force can't skip it"
    );
    assert_eq!(d.phase(), Phase::Preparing);
    let out = d.apply(Input::PrepareFinished { id, ok: true });
    assert!(
        started(&out).is_some(),
        "the skip applies the moment the map is ready"
    );
    assert!(
        !out.iter()
            .any(|o| matches!(o, Output::CountdownStarted { .. }))
    );

    let mut d = in_ready_countdown(&[A]);
    assert!(
        started(&d.apply(Input::StartNow)).is_some(),
        "in Countdown, Start now again starts at once"
    );
}

#[test]
fn the_warning_length_is_host_configurable_within_five_to_fifteen_seconds() {
    for (asked, got) in [(1_000, 5_000), (7_000, 7_000), (60_000, 15_000)] {
        let mut d = Director::new(DirectorConfig {
            force_warning_ms: asked,
            ..DirectorConfig::default()
        });
        join(&mut d, &[A]);
        let out = d.apply(Input::StartNow);
        assert!(out.contains(&Output::ForceStartWarning {
            seats: vec![A],
            ms: got
        }));
    }
}

#[test]
fn stale_ready_taps_cannot_restart_a_disarmed_lobby() {
    let mut d = in_ready_countdown(&[A]);
    let old = d.ready_revision();
    d.apply(Input::End);
    assert!(d.ready_revision() > old);
    d.apply(Input::ArmReadyStart(true));
    let out = d.apply(Input::SetReady {
        seat: A,
        ready: true,
        revision: old,
    });
    assert!(
        out.is_empty() && !d.is_ready(A),
        "a Ready from before End is stale"
    );
    assert!(
        !ready(&mut d, A, true).is_empty(),
        "a fresh Ready under the armed policy starts"
    );
}

// AC5: auto-next runs Intermission → Countdown without host input; no zero-player auto-round loop.

#[test]
fn the_party_runs_itself_round_after_round() {
    let mut d = in_ready_countdown(&[A, B]);
    let mut rounds = Vec::new();
    rounds.push(started(&elapse(&mut d, 3_000)).unwrap().0);
    for _ in 0..3 {
        let out = d.apply(Input::RoundOver);
        assert!(out.contains(&Output::RoundFinalising {
            round: *rounds.last().unwrap()
        }));
        let out = d.apply(Input::ResultsCommitted { saved: true });
        let id = requested(&out).expect("the next map prepares during the results");
        assert_eq!(d.driving(), Driving::Held, "no driving during Intermission");
        elapse(&mut d, 25_000);
        d.apply(Input::PrepareFinished { id, ok: true });
        let out = elapse(&mut d, 35_000);
        assert!(out.contains(&Output::CountdownStarted {
            policy: StartPolicy::Auto,
            ms: 3_000,
            cohort: vec![A, B]
        }));
        let (round, preparation, _) =
            started(&elapse(&mut d, 3_000)).expect("no host input needed");
        assert_eq!(preparation, id);
        rounds.push(round);
    }
    assert_eq!(rounds, vec![RoundId(1), RoundId(2), RoundId(3), RoundId(4)]);
}

#[test]
fn a_map_still_preparing_when_intermission_ends_shows_preparing_then_counts_down() {
    let mut d = in_ready_countdown(&[A]);
    elapse(&mut d, 3_000);
    through_round(&mut d);
    let id = d.preparation().unwrap().0;
    elapse(&mut d, 60_000);
    assert_eq!(
        d.phase(),
        Phase::Preparing,
        "a visible Preparing phase waits for the map"
    );
    d.apply(Input::PrepareFinished { id, ok: true });
    assert_eq!(d.phase(), Phase::Countdown);
}

#[test]
fn an_emptied_party_settles_in_lobby_and_never_auto_starts() {
    let mut d = in_ready_countdown(&[A, B]);
    elapse(&mut d, 3_000);
    // Everyone leaves mid-round: the round finishes, the intermission plays out, then the party settles.
    d.apply(Input::SetEligible {
        seat: A,
        eligible: false,
    });
    d.apply(Input::SetEligible {
        seat: B,
        eligible: false,
    });
    assert_eq!(d.phase(), Phase::Running);
    through_round(&mut d);
    let id = d.preparation().unwrap().0;
    d.apply(Input::PrepareFinished { id, ok: true });
    let out = elapse(&mut d, 60_000);
    assert!(out.contains(&Output::Settled));
    assert_eq!(d.phase(), Phase::Lobby);
    for _ in 0..100 {
        assert!(started(&elapse(&mut d, 60_000)).is_none());
    }
    assert!(
        d.apply(Input::StartNow).is_empty(),
        "Start now with nobody seated does nothing"
    );
    // Someone joining an empty, disarmed lobby waits for the host.
    join(&mut d, &[C]);
    ready(&mut d, C, true);
    assert_eq!(d.phase(), Phase::Lobby);
}

#[test]
fn everyone_leaving_during_a_start_settles_instead_of_starting() {
    let mut d = in_ready_countdown(&[A]);
    let out = d.apply(Input::SetEligible {
        seat: A,
        eligible: false,
    });
    assert!(out.contains(&Output::Settled));
    assert!(started(&elapse(&mut d, 10_000)).is_none());
}

#[test]
fn finalising_never_spins_forever() {
    let mut d = in_ready_countdown(&[A]);
    let (round, ..) = started(&elapse(&mut d, 3_000)).unwrap();
    d.apply(Input::RoundOver);
    let out = elapse(&mut d, 5_000);
    assert!(out.contains(&Output::IntermissionStarted {
        round,
        ms: 60_000,
        unsaved: true
    }));
}

#[test]
fn lobby_holds_every_car_unless_free_drive_and_disband_is_terminal() {
    // R110: no car drives in the Lobby; free drive is G04's dev/test mode only.
    assert_eq!(director().driving(), Driving::Held);
    let free = Director::new(DirectorConfig {
        lobby_free_drive: true,
        ..DirectorConfig::default()
    });
    assert_eq!(free.driving(), Driving::FreeDrive);
    let mut d = director();
    join(&mut d, &[A]);
    let out = d.apply(Input::Disband);
    assert!(out.contains(&Output::Disbanded));
    assert_eq!(d.phase(), Phase::Disbanded);
    assert!(d.apply(Input::StartNow).is_empty());
    assert!(ready(&mut d, A, true).is_empty());
}

// Random sequences: the invariants hold whatever the host, phones and jobs do.

fn arb_input() -> impl Strategy<Value = Input> {
    let seat = (1u32..=4).prop_map(SeatId);
    prop_oneof![
        4 => (0u32..20_000).prop_map(|ms| Input::Elapsed { ms }),
        3 => (seat.clone(), any::<bool>()).prop_map(|(seat, eligible)| Input::SetEligible { seat, eligible }),
        // Revision 0..4: some taps are current, some stale.
        4 => (seat, any::<bool>(), 0u32..4).prop_map(|(seat, ready, revision)| Input::SetReady { seat, ready, revision }),
        2 => Just(Input::StartNow),
        1 => any::<bool>().prop_map(Input::ArmReadyStart),
        1 => Just(Input::Reroll),
        3 => (1u32..8, prop::bool::weighted(0.85)).prop_map(|(id, ok)| Input::PrepareFinished { id: PreparationId(id), ok }),
        2 => Just(Input::RoundOver),
        1 => any::<bool>().prop_map(|saved| Input::ResultsCommitted { saved }),
        1 => (0usize..5, any::<bool>()).prop_map(|(i, on)| Input::Pause {
            reason: [Pause::Manual, Pause::HostHidden, Pause::RendererUnavailable, Pause::PerformanceStall, Pause::Fault][i],
            on,
        }),
        1 => Just(Input::End),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 1_000, ..ProptestConfig::default() })]

    #[test]
    fn invariants_hold_for_random_sequences(inputs in prop::collection::vec(arb_input(), 1..200), disband_at in 0usize..250) {
        let mut d = director();
        let mut ready_maps: BTreeSet<PreparationId> = BTreeSet::new();
        let mut cancelled: BTreeSet<PreparationId> = BTreeSet::new();
        let mut round_open = false;
        let mut last_round = 0;
        for (i, input) in inputs.into_iter().enumerate() {
            let input = if i == disband_at { Input::Disband } else { input };
            let finishing = match &input {
                Input::PrepareFinished { id, ok: true } => d.preparation().filter(|p| p.0 == *id && !p.1).map(|p| p.0),
                _ => None,
            };
            let disbanded = d.phase() == Phase::Disbanded;
            let out = d.apply(input);
            if disbanded {
                prop_assert!(out.is_empty(), "outputs after Disband: {out:?}");
            }
            if let Some(id) = finishing {
                ready_maps.insert(id);
            }
            for o in &out {
                match o {
                    Output::PrepareCancelled { id } => { cancelled.insert(*id); }
                    Output::RoundStarted { round, preparation, seats } => {
                        prop_assert!(!seats.is_empty(), "a zero-player round");
                        prop_assert!(ready_maps.contains(preparation) && !cancelled.contains(preparation),
                            "round on an unready or cancelled map {preparation:?}");
                        prop_assert!(!round_open, "a second round started before the first ended");
                        prop_assert!(round.0 > last_round);
                        last_round = round.0;
                        round_open = true;
                    }
                    Output::IntermissionStarted { .. } | Output::RoundVoided { .. } => round_open = false,
                    _ => {}
                }
            }
            // Ended without voiding only outside a round.
            if out.contains(&Output::Ended) { round_open = false; }
            prop_assert_eq!(matches!(d.phase(), Phase::Running | Phase::Finalising), round_open);
            prop_assert!(d.phase() != Phase::Countdown || d.preparation().is_some_and(|p| p.1), "Countdown without a ready map");
        }
    }
}
