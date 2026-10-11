//! P1-N07c fixture tests (master §10.12): ties, late joiners, leave/return, the all-stuck deadline, the points table and
//! idempotent commits; plus random rounds checking the invariants.

use proptest::prelude::*;

use super::*;

const fn seat(n: u32) -> SeatId {
    SeatId(n)
}

fn finisher(n: u32, tick: u64, fraction: u16) -> Entrant {
    Entrant {
        seat: seat(n),
        entered: true,
        finish: Some(FinishTime { tick, fraction }),
        progress_mm: 2_000_000,
        progress_tick: tick,
        withdrawn: false,
        late: false,
    }
}

fn behind(n: u32, progress_mm: u64, progress_tick: u64) -> Entrant {
    Entrant {
        seat: seat(n),
        entered: true,
        finish: None,
        progress_mm,
        progress_tick,
        withdrawn: false,
        late: false,
    }
}

fn round(id: u32, entrants: Vec<Entrant>) -> RoundFacts {
    RoundFacts {
        round: RoundId(id),
        ruleset: Ruleset::default(),
        entrants,
    }
}

fn row(r: &RoundResult, n: u32) -> Classified {
    *r.rows.iter().find(|c| c.seat == seat(n)).unwrap()
}

// AC1: simultaneous finishes and exact ties share place and points (1, 1, 3).
#[test]
fn simultaneous_finishes_and_exact_ties_share_place_and_points() {
    let r = classify(&round(
        1,
        vec![
            finisher(3, 5000, 100),
            finisher(1, 5000, 100),
            finisher(2, 5000, 900),
            finisher(4, 5001, 0),
        ],
    ))
    .unwrap();
    // The same tick but a later crossing fraction is behind; exactly equal times share.
    assert_eq!(
        (
            row(&r, 1).place,
            row(&r, 3).place,
            row(&r, 2).place,
            row(&r, 4).place
        ),
        (Some(1), Some(1), Some(3), Some(4))
    );
    assert_eq!(
        (
            row(&r, 1).placement_points,
            row(&r, 3).placement_points,
            row(&r, 2).placement_points
        ),
        (25, 25, 15)
    );
    assert!(
        r.rows
            .iter()
            .all(|c| c.finish_bonus == DEFAULT_FINISH_BONUS)
    );
    // Seat order only orders the display.
    let order: Vec<u32> = r.rows.iter().map(|c| c.seat.0).collect();
    assert_eq!(order, vec![1, 3, 2, 4]);
    // Ties among the unfinished share too, after every finisher.
    let r = classify(&round(
        2,
        vec![
            finisher(1, 9000, 0),
            behind(2, 800_000, 4000),
            behind(3, 800_000, 4000),
            behind(4, 700_000, 100),
        ],
    ))
    .unwrap();
    assert_eq!(
        (row(&r, 2).place, row(&r, 3).place, row(&r, 4).place),
        (Some(2), Some(2), Some(4))
    );
    assert_eq!((row(&r, 2).points, row(&r, 4).points), (18, 12));
}

// AC2: late joiners and leave/return produce the specified DNF/finish records with no extra finish bonus.
#[test]
fn late_joiners_and_leave_return_produce_the_specified_records() {
    let late_finisher = Entrant {
        late: true,
        ..finisher(5, 6100, 0)
    };
    let finished_then_left = Entrant {
        withdrawn: true,
        ..finisher(2, 6000, 0)
    };
    let withdrawn = Entrant {
        withdrawn: true,
        ..behind(3, 900_000, 3000)
    };
    let returned = behind(4, 950_000, 3500); // left and came back before finalisation: one ordinary record
    let late_unfinished = Entrant {
        late: true,
        ..behind(6, 400_000, 2000)
    };
    let never = Entrant {
        entered: false,
        ..behind(7, 0, 0)
    };
    let r = classify(&round(
        1,
        vec![
            finisher(1, 5900, 0),
            finished_then_left,
            withdrawn,
            returned,
            late_finisher,
            late_unfinished,
            never,
        ],
    ))
    .unwrap();
    // A finished seat that left is still a finisher, with exactly one bonus.
    assert_eq!(
        (row(&r, 2).status, row(&r, 2).place, row(&r, 2).finish_bonus),
        (Status::Finished, Some(2), 5)
    );
    // A late joiner is classified where it actually finished, as a finisher.
    assert_eq!(
        (
            row(&r, 5).status,
            row(&r, 5).place,
            row(&r, 5).late,
            row(&r, 5).points
        ),
        (Status::Finished, Some(3), true, 15 + 5)
    );
    // Withdrawn and unfinished: DNF on its frozen progress, placement points only.
    assert_eq!(
        (
            row(&r, 3).status,
            row(&r, 3).place,
            row(&r, 3).finish_bonus,
            row(&r, 3).points
        ),
        (Status::Dnf, Some(5), 0, 10)
    );
    assert_eq!(
        (row(&r, 4).status, row(&r, 4).place),
        (Status::Unfinished, Some(4))
    );
    assert_eq!(
        (row(&r, 6).status, row(&r, 6).place, row(&r, 6).late),
        (Status::Unfinished, Some(6), true)
    );
    // Never entered: DNS, no place, zero, listed last.
    assert_eq!(
        *r.rows.last().unwrap(),
        Classified {
            seat: seat(7),
            status: Status::Dns,
            place: None,
            placement_points: 0,
            finish_bonus: 0,
            points: 0,
            late: false
        }
    );
    // Exactly one bonus per finisher and none for anyone else.
    let bonuses: u32 = r.rows.iter().map(|c| c.finish_bonus).sum();
    assert_eq!(bonuses, 3 * DEFAULT_FINISH_BONUS);
    // One seat, one record: a second record for the same seat is refused.
    let dup = round(2, vec![finisher(1, 100, 0), behind(1, 5, 5)]);
    assert_eq!(
        classify(&dup),
        Err(CommitError::DuplicateSeat { seat: seat(1) })
    );
}

// AC3: an all-stuck race at the deadline ranks unfinished entrants by legal progress (then the tick it was reached).
#[test]
fn an_all_stuck_race_ranks_by_legal_progress_then_the_tick_it_was_reached() {
    let r = classify(&round(
        1,
        vec![
            behind(1, 120_000, 900),
            behind(2, 450_000, 3000),
            behind(3, 450_000, 2500),
            behind(4, 0, 0),
            behind(5, 120_000, 900),
        ],
    ))
    .unwrap();
    let places: Vec<(u32, Option<u32>)> = r.rows.iter().map(|c| (c.seat.0, c.place)).collect();
    assert_eq!(
        places,
        vec![
            (3, Some(1)),
            (2, Some(2)),
            (1, Some(3)),
            (5, Some(3)),
            (4, Some(5))
        ]
    );
    assert!(
        r.rows
            .iter()
            .all(|c| c.status == Status::Unfinished && c.finish_bonus == 0)
    );
    assert_eq!(row(&r, 3).points, 25);
}

// AC4: the points table gives 1 point to every rank past 10 (no truncated tail) and +5 to finishers.
#[test]
fn every_rank_past_ten_gets_a_point_and_finishers_get_the_bonus() {
    let n = 40;
    let r = classify(&round(
        1,
        (1..=n)
            .map(|i| finisher(i, 1000 + u64::from(i), 0))
            .collect(),
    ))
    .unwrap();
    let pts: Vec<u32> = r.rows.iter().map(|c| c.placement_points).collect();
    assert_eq!(&pts[..10], &POINTS);
    assert!(pts[10..].iter().all(|&p| p == 1), "{pts:?}");
    assert_eq!(
        pts.len(),
        n as usize,
        "no truncated tail: every entrant is classified"
    );
    assert!(r.rows.iter().all(|c| c.points == c.placement_points + 5));
    assert_eq!(points_for_rank(11), 1);
    assert_eq!(points_for_rank(10_000), 1);
    // The bonus is the ruleset's.
    let custom = RoundFacts {
        ruleset: Ruleset { finish_bonus: 0 },
        ..round(2, vec![finisher(1, 10, 0)])
    };
    assert_eq!(classify(&custom).unwrap().rows[0].points, 25);
}

// AC5: a repeated commit for the same RoundId is idempotent; a conflicting payload is rejected.
#[test]
fn a_repeated_commit_is_idempotent_and_a_conflicting_one_is_refused() {
    let mut s = Standings::default();
    let facts = round(
        7,
        vec![
            finisher(1, 100, 0),
            finisher(2, 120, 0),
            behind(3, 5_000, 50),
        ],
    );
    let Ok(Committed::New(first)) = s.commit(&facts) else {
        panic!("first commit")
    };
    let totals: Vec<SeatTotal> = [1, 2, 3].map(|n| s.total(seat(n))).to_vec();
    // The same facts, even in another order, change nothing.
    let mut shuffled = facts.clone();
    shuffled.entrants.reverse();
    assert_eq!(s.commit(&shuffled), Ok(Committed::Again(first.clone())));
    assert_eq!([1, 2, 3].map(|n| s.total(seat(n))).to_vec(), totals);
    // Different facts for a committed round are refused, and the standings stay put.
    let mut changed = facts.clone();
    changed.entrants[2].progress_mm = 6_000;
    assert_eq!(
        s.commit(&changed),
        Err(CommitError::Conflict { round: RoundId(7) })
    );
    assert_eq!(s.round(RoundId(7)), Some(&first));
    assert_eq!(
        s.total(seat(1)),
        SeatTotal {
            points: 30,
            rounds: 1,
            finishes: 1,
            wins: 1
        }
    );
}

#[test]
fn the_session_table_adds_up_rounds_and_shares_tied_places() {
    let mut s = Standings::default();
    s.commit(&round(
        1,
        vec![finisher(1, 100, 0), finisher(2, 110, 0), behind(3, 10, 5)],
    ))
    .unwrap();
    s.commit(&round(
        2,
        vec![
            finisher(2, 100, 0),
            finisher(1, 110, 0),
            Entrant {
                entered: false,
                ..behind(3, 0, 0)
            },
        ],
    ))
    .unwrap();
    let table = s.table();
    // Seats 1 and 2: 25+5 + 18+5 = 53 each, tied; seat 3: 15 then DNS.
    assert_eq!(
        table
            .iter()
            .map(|r| (r.seat.0, r.place, r.total.points))
            .collect::<Vec<_>>(),
        vec![(1, 1, 53), (2, 1, 53), (3, 3, 15)]
    );
    assert_eq!(
        s.total(seat(3)).rounds,
        1,
        "a DNS round doesn't count as raced"
    );
}

fn arb_entrant() -> impl Strategy<Value = Entrant> {
    (
        1u32..30,
        any::<bool>(),
        prop::option::of((0u64..50, 0u16..4)),
        0u64..20,
        0u64..20,
        any::<bool>(),
        any::<bool>(),
    )
        .prop_map(
            |(s, entered, finish, progress, tick, withdrawn, late)| Entrant {
                seat: seat(s),
                entered: entered || finish.is_some(),
                finish: finish.map(|(tick, fraction)| FinishTime { tick, fraction }),
                progress_mm: progress * 1000,
                progress_tick: tick,
                withdrawn,
                late,
            },
        )
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 1_000, ..ProptestConfig::default() })]

    #[test]
    fn classification_invariants(raw in prop::collection::vec(arb_entrant(), 0..40)) {
        let mut seen = BTreeSet::new();
        let entrants: Vec<Entrant> = raw.into_iter().filter(|e| seen.insert(e.seat)).collect();
        let r = classify(&round(1, entrants.clone())).unwrap();
        prop_assert_eq!(r.rows.len(), entrants.len(), "everyone gets a row");
        let classified: Vec<&Classified> = r.rows.iter().filter(|c| c.status != Status::Dns).collect();
        // Places are competition ranks: start at 1, never skip ahead of the row index, ties share.
        for (i, c) in classified.iter().enumerate() {
            let p = c.place.unwrap();
            prop_assert!(p >= 1 && p as usize <= i + 1);
            prop_assert_eq!(c.placement_points, points_for_rank(p));
            prop_assert!(c.placement_points >= 1, "no classified rank scores zero");
            prop_assert_eq!(c.finish_bonus, if c.status == Status::Finished { 5 } else { 0 });
        }
        // Every finisher is ahead of every non-finisher.
        let first_behind = classified.iter().position(|c| c.status != Status::Finished).unwrap_or(classified.len());
        prop_assert!(classified[first_behind..].iter().all(|c| c.status != Status::Finished));
        prop_assert!(r.rows.iter().filter(|c| c.status == Status::Dns).all(|c| c.points == 0 && c.place.is_none()));
    }
}

// Derby (P1-S10): ranked by raw points.

fn scorer(n: u32, units: u64) -> DerbyEntrant {
    DerbyEntrant {
        seat: seat(n),
        entered: true,
        units,
        withdrawn: false,
        late: false,
    }
}

fn derby_round(id: u32, entrants: Vec<DerbyEntrant>) -> DerbyFacts {
    DerbyFacts {
        round: RoundId(id),
        entrants,
    }
}

#[test]
fn a_derby_ranks_by_raw_points_with_ties_sharing_and_the_race_table_without_a_finish_bonus() {
    let r = classify_derby(&derby_round(
        1,
        vec![
            scorer(1, 70_000),
            scorer(2, 70_000),
            scorer(3, 35_000),
            scorer(4, 0),
            scorer(5, 69_999),
        ],
    ))
    .unwrap();
    let places: Vec<(u32, Option<u32>, u32)> = r
        .rows
        .iter()
        .map(|c| (c.seat.0, c.place, c.points))
        .collect();
    // 35 points twice share first (25 each), then 34.99 third (15), 17.5 fourth (12), nothing fifth (10): 1, 1, 3, 4, 5.
    assert_eq!(
        places,
        vec![
            (1, Some(1), 25),
            (2, Some(1), 25),
            (5, Some(3), 15),
            (3, Some(4), 12),
            (4, Some(5), 10)
        ]
    );
    assert!(
        r.rows
            .iter()
            .all(|c| c.finish_bonus == 0 && c.status == Status::Finished)
    );
}

#[test]
fn every_derby_rank_past_ten_gets_one_point_and_there_is_no_cap() {
    let entrants: Vec<DerbyEntrant> = (1..=40).map(|n| scorer(n, u64::from(1000 - n))).collect();
    let r = classify_derby(&derby_round(1, entrants)).unwrap();
    assert_eq!(r.rows.len(), 40);
    assert_eq!(row(&r, 1).points, 25);
    assert_eq!(row(&r, 10).points, 1);
    assert_eq!((row(&r, 11).points, row(&r, 40).points), (1, 1));
}

#[test]
fn a_late_joiner_ranks_on_raw_points_alone_and_a_seat_that_left_keeps_what_it_scored() {
    let mut late = scorer(3, 40_000);
    late.late = true;
    let mut gone = scorer(2, 20_000);
    gone.withdrawn = true;
    let never = DerbyEntrant {
        seat: seat(4),
        entered: false,
        units: 0,
        withdrawn: true,
        late: false,
    };
    let r = classify_derby(&derby_round(1, vec![scorer(1, 30_000), gone, late, never])).unwrap();
    // The late joiner scored more in less time and wins: no normalisation for time on the clock.
    assert_eq!((row(&r, 3).place, row(&r, 3).late), (Some(1), true));
    assert_eq!(
        (row(&r, 1).place, row(&r, 1).status),
        (Some(2), Status::Finished)
    );
    assert_eq!(
        (row(&r, 2).place, row(&r, 2).status, row(&r, 2).points),
        (Some(3), Status::Dnf, 15)
    );
    assert_eq!(
        (row(&r, 4).place, row(&r, 4).status, row(&r, 4).points),
        (None, Status::Dns, 0)
    );
}

#[test]
fn a_derby_commit_is_idempotent_conflicts_with_other_facts_and_never_counts_as_a_race_finish() {
    let mut s = Standings::default();
    let facts = derby_round(1, vec![scorer(1, 10), scorer(2, 5)]);
    assert!(matches!(s.commit_derby(&facts).unwrap(), Committed::New(_)));
    assert!(matches!(
        s.commit_derby(&facts).unwrap(),
        Committed::Again(_)
    ));
    assert_eq!(
        s.total(seat(1)),
        SeatTotal {
            points: 25,
            rounds: 1,
            finishes: 0,
            wins: 1
        }
    );
    // Other facts for the committed round, or the same round as a race, are refused.
    assert!(matches!(
        s.commit_derby(&derby_round(1, vec![scorer(1, 5), scorer(2, 10)])),
        Err(CommitError::Conflict { .. })
    ));
    assert!(matches!(
        s.commit(&round(1, vec![finisher(1, 1, 0)])),
        Err(CommitError::Conflict { .. })
    ));
    assert!(matches!(
        classify_derby(&derby_round(2, vec![scorer(1, 1), scorer(1, 2)])),
        Err(CommitError::DuplicateSeat { .. })
    ));
    assert_eq!(s.total(seat(1)).points, 25);
}
