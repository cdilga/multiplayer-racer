//! Seat reducer tests: the 0.1 seat cases re-expressed (one car per seat, stale input neutralised, retries don't
//! duplicate seats), boundary tables for Identify and Leave/Sit out, and properties over random sequences.

use std::collections::{BTreeMap, BTreeSet};

use proptest::prelude::*;

use super::*;

fn ep(k: u32) -> EndpointId {
    EndpointId(format!("c-{k}"))
}

fn secret(k: u32) -> [u8; 32] {
    let mut s = [0u8; 32];
    s[..4].copy_from_slice(&k.to_le_bytes());
    s
}

fn hello(seats: &mut Seats, conn: ConnId, k: u32) -> Vec<Output> {
    seats.apply(Input::Hello {
        conn,
        endpoint: ep(k),
        secret_hash: secret(k),
    })
}

fn claim(seats: &mut Seats, conn: ConnId, req: u32, name: &str) -> Vec<Output> {
    seats.apply(Input::Claim {
        conn,
        request: RequestId(req),
        name: name.into(),
    })
}

fn welcomed(out: &[Output]) -> Option<SeatId> {
    out.iter().find_map(|o| match o {
        Output::Welcome { seat, .. } => Some(*seat),
        _ => None,
    })
}

fn joined(seats: &mut Seats, conn: ConnId, k: u32, name: &str) -> SeatId {
    hello(seats, conn, k);
    let id = welcomed(&claim(seats, conn, 1, name)).expect("welcome");
    let t = seats.now().0 + 1;
    seats.apply(Input::Tick(Tick(t)));
    id
}

// ---- 0.1 cases (§14: server/room_seats.py, roomSeatRegistry.js, host-authority, room-seat-registry,
// ---- test_seat_input_safety): re-expressed, not ported.

#[test]
fn opening_never_claims_and_one_car_per_seat() {
    let mut s = Seats::default();
    hello(&mut s, 1, 1);
    assert_eq!(
        s.seats().count(),
        0,
        "a Hello (opening the page) claims nothing"
    );
    let id = welcomed(&claim(&mut s, 1, 1, "Dusty")).unwrap();
    assert!(
        !s.seat(id).unwrap().has_car,
        "the car arrives at the next tick boundary"
    );
    s.apply(Input::Tick(Tick(1)));
    assert!(s.seat(id).unwrap().has_car);
    assert_eq!(s.seats().filter(|x| x.has_car).count(), 1);
}

#[test]
fn retries_and_reconnects_never_duplicate_a_seat() {
    let mut s = Seats::default();
    hello(&mut s, 1, 1);
    let a = welcomed(&claim(&mut s, 1, 7, "Dusty")).unwrap();
    let b = welcomed(&claim(&mut s, 1, 7, "Dusty")).unwrap();
    let c = welcomed(&claim(&mut s, 1, 8, "Dusty")).unwrap();
    assert_eq!(
        (a, b),
        (a, c),
        "same request id or a new one: the same seat"
    );
    s.apply(Input::Disconnect { conn: 1 });
    let resumed = welcomed(&hello(&mut s, 2, 1)).expect("resume by secret welcomes the same seat");
    assert_eq!(resumed, a);
    assert_eq!(welcomed(&claim(&mut s, 2, 1, "Dusty")), Some(a));
    assert_eq!(s.seats().count(), 1);
}

#[test]
fn stale_input_is_neutralised() {
    let mut s = Seats::default();
    let id = joined(&mut s, 1, 1, "Dusty");
    assert_eq!(s.input_seat(1, SourceHandle(1)), Some(id));
    assert_eq!(
        s.input_seat(1, SourceHandle(2)),
        None,
        "a source handle that isn't the seat's"
    );
    assert_eq!(
        s.input_seat(99, SourceHandle(1)),
        None,
        "an unknown connection"
    );
    hello(&mut s, 2, 1); // a duplicate tab takes over
    assert_eq!(
        s.input_seat(1, SourceHandle(1)),
        None,
        "the fenced tab's input is dropped"
    );
    assert_eq!(s.input_seat(2, SourceHandle(1)), Some(id));
    s.apply(Input::Leave { conn: 2 });
    s.apply(Input::Tick(Tick(5)));
    assert_eq!(
        s.input_seat(2, SourceHandle(1)),
        None,
        "a seat that left has no car to drive"
    );
}

#[test]
fn a_duplicate_tab_fences_the_older_one_and_a_wrong_secret_is_refused() {
    let mut s = Seats::default();
    let id = joined(&mut s, 1, 1, "Dusty");
    let out = hello(&mut s, 2, 1);
    assert!(out.contains(&Output::Fenced { conn: 1 }), "{out:?}");
    assert_eq!(welcomed(&out), Some(id));
    assert!(
        claim(&mut s, 1, 9, "Dusty").is_empty(),
        "the fenced tab can't claim"
    );
    let spoof = s.apply(Input::Hello {
        conn: 3,
        endpoint: ep(1),
        secret_hash: secret(999),
    });
    assert_eq!(spoof, vec![Output::Refused { conn: 3 }]);
    assert_eq!(
        s.seat_of(2),
        Some(id),
        "the refused connection changed nothing"
    );
}

// ---- Boundary tables

#[test]
fn identify_rate_limit_table() {
    let mut s = Seats::default(); // 60 Hz, once per 3 s = 180 ticks
    let id = joined(&mut s, 1, 1, "Dusty"); // auto-fired at tick 0, car at tick 1
    for (tick, fires) in [
        (1, false),
        (179, false),
        (180, true),
        (181, false),
        (359, false),
        (360, true),
    ] {
        s.apply(Input::Tick(Tick(tick)));
        let out = s.apply(Input::Identify { conn: 1 });
        assert_eq!(
            out.contains(&Output::Identify { seat: id }),
            fires,
            "Identify at tick {tick}: {out:?}"
        );
    }
    s.apply(Input::Tick(Tick(400)));
    assert_eq!(
        s.apply(Input::Respawned { seat: id }),
        vec![Output::Identify { seat: id }],
        "auto-fires on respawn"
    );
    assert!(
        matches!(
            s.apply(Input::Identify { conn: 1 })[0],
            Output::IdentifyLimited {
                retry_in_ticks: 180,
                ..
            }
        ),
        "and restarts the limit"
    );
}

#[test]
fn leave_and_sit_out_take_effect_at_the_next_tick_boundary_and_keep_the_seat() {
    let mut s = Seats::default();
    let id = joined(&mut s, 1, 1, "Dusty");
    let number = s.seat(id).unwrap().number;
    // (input, car before the boundary, outputs at the boundary, presence after)
    s.apply(Input::SitOut { conn: 1, on: true });
    assert!(
        s.seat(id).unwrap().has_car,
        "sit out waits for the boundary"
    );
    assert_eq!(
        s.apply(Input::Tick(Tick(10))),
        vec![Output::CarWithdrawn {
            seat: id,
            why: Withdraw::SatOut
        }]
    );
    assert_eq!(s.seat(id).unwrap().presence, Presence::SittingOut);
    s.apply(Input::SitOut { conn: 1, on: false });
    assert_eq!(
        s.apply(Input::Tick(Tick(11))),
        vec![Output::CarAdded { seat: id }]
    );
    s.apply(Input::Leave { conn: 1 });
    assert!(s.seat(id).unwrap().has_car, "leave waits for the boundary");
    assert_eq!(
        s.apply(Input::Tick(Tick(12))),
        vec![Output::CarWithdrawn {
            seat: id,
            why: Withdraw::Left
        }]
    );
    let seat = s.seat(id).unwrap();
    assert_eq!(
        (seat.presence, seat.number),
        (Presence::Left, number),
        "the seat and its number stay (standings kept)"
    );
    // Claiming again from the same endpoint returns to the same seat.
    assert_eq!(welcomed(&claim(&mut s, 1, 2, "Dusty")), Some(id));
    assert_eq!(
        s.apply(Input::Tick(Tick(13))),
        vec![Output::CarAdded { seat: id }]
    );
}

#[test]
fn names_follow_the_rules_and_duplicates_gain_the_number() {
    let mut s = Seats::default();
    let a = joined(&mut s, 1, 1, "Dusty");
    let b = joined(&mut s, 2, 2, "dusty");
    let c = joined(&mut s, 3, 3, "   ");
    assert_eq!(s.display_name(a).unwrap(), "Dusty");
    assert_eq!(
        s.display_name(b).unwrap(),
        "dusty #2",
        "the later seat gains its number"
    );
    assert_eq!(
        s.display_name(c).unwrap(),
        "Player 3",
        "blank reverts to the default"
    );
    hello(&mut s, 4, 4);
    assert_eq!(
        claim(&mut s, 4, 1, "<script>"),
        vec![Output::ClaimRejected {
            conn: 4,
            reason: ClaimRejection::Name
        }]
    );
    assert_eq!(
        s.apply(Input::SetName {
            conn: 3,
            name: "Kev".into()
        }),
        vec![Output::NameChanged { seat: c }]
    );
    assert_eq!(s.display_name(c).unwrap(), "Kev");
}

#[test]
fn any_number_of_seats_gets_stable_distinct_numbers() {
    let mut s = Seats::default();
    let n = 10_000u32;
    for k in 0..n {
        hello(&mut s, u64::from(k), k);
        claim(&mut s, u64::from(k), 1, "");
    }
    s.apply(Input::Tick(Tick(1)));
    let numbers: BTreeSet<u32> = s.seats().map(|x| x.number.0).collect();
    assert_eq!(numbers.len(), n as usize);
    assert_eq!(
        (numbers.first().copied(), numbers.last().copied()),
        (Some(1), Some(n)),
        "1..=N, nothing truncated, past 99"
    );
    assert_eq!(
        s.seats().filter(|x| x.has_car).count(),
        n as usize,
        "every seat has its car"
    );
    let seat_13 = s.seats().find(|x| x.number.0 == 13).unwrap();
    assert_eq!(
        seat_13.colour.rgb, IDENTITY_PALETTE[0],
        "colours cycle the palette; the number keeps cars apart"
    );
    assert_eq!(s.display_name(seat_13.id).unwrap(), "Player 13");
}

// ---- Properties over random sequences

#[derive(Clone, Debug)]
enum Op {
    Hello {
        conn: u64,
        ep: u32,
        wrong_secret: bool,
    },
    Claim {
        conn: u64,
        req: u32,
        blank: bool,
    },
    Leave {
        conn: u64,
    },
    SitOut {
        conn: u64,
        on: bool,
    },
    Disconnect {
        conn: u64,
    },
    Identify {
        conn: u64,
    },
    Tick,
}

fn op() -> impl Strategy<Value = Op> {
    let conn = 0u64..24;
    prop_oneof![
        (conn.clone(), 0u32..8, prop::bool::weighted(0.1)).prop_map(|(conn, ep, wrong_secret)| {
            Op::Hello {
                conn,
                ep,
                wrong_secret,
            }
        }),
        (conn.clone(), 0u32..4, any::<bool>()).prop_map(|(conn, req, blank)| Op::Claim {
            conn,
            req,
            blank
        }),
        conn.clone().prop_map(|conn| Op::Leave { conn }),
        (conn.clone(), any::<bool>()).prop_map(|(conn, on)| Op::SitOut { conn, on }),
        conn.clone().prop_map(|conn| Op::Disconnect { conn }),
        conn.prop_map(|conn| Op::Identify { conn }),
        Just(Op::Tick),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 1_000, ..ProptestConfig::default() })]

    #[test]
    fn one_car_per_seat_no_phantoms_stable_numbers(ops in proptest::collection::vec(op(), 1..200)) {
        let mut s = Seats::default();
        let mut tick = 0u64;
        let mut claimed_endpoints: BTreeSet<EndpointId> = BTreeSet::new();
        let mut numbers: BTreeMap<SeatId, SeatNumber> = BTreeMap::new();
        let mut endpoint_of_conn: BTreeMap<u64, u32> = BTreeMap::new();
        for op in ops {
            match op {
                Op::Hello { conn, ep: k, wrong_secret } => {
                    let secret_hash = if wrong_secret { secret(k + 1000) } else { secret(k) };
                    let out = s.apply(Input::Hello { conn, endpoint: ep(k), secret_hash });
                    if !out.contains(&Output::Refused { conn }) { endpoint_of_conn.entry(conn).or_insert(k); }
                }
                Op::Claim { conn, req, blank } => {
                    let out = s.apply(Input::Claim { conn, request: RequestId(req), name: if blank { String::new() } else { "Dusty".into() } });
                    if welcomed(&out).is_some() {
                        claimed_endpoints.insert(s.seat(welcomed(&out).unwrap()).unwrap().endpoint.clone());
                    }
                }
                Op::Leave { conn } => { s.apply(Input::Leave { conn }); }
                Op::SitOut { conn, on } => { s.apply(Input::SitOut { conn, on }); }
                Op::Disconnect { conn } => { s.apply(Input::Disconnect { conn }); }
                Op::Identify { conn } => { s.apply(Input::Identify { conn }); }
                Op::Tick => { tick += 1; s.apply(Input::Tick(Tick(tick))); }
            }
            // No phantom seats: exactly one seat per endpoint that was welcomed after a claim, and never two.
            let seat_endpoints: Vec<&EndpointId> = s.seats().map(|x| &x.endpoint).collect();
            let unique: BTreeSet<&EndpointId> = seat_endpoints.iter().copied().collect();
            prop_assert_eq!(unique.len(), seat_endpoints.len(), "an endpoint with two seats");
            prop_assert_eq!(unique.len(), claimed_endpoints.len(), "a seat nobody claimed, or a claim without a seat");
            // One car per seat, only for active seats.
            for x in s.seats() {
                prop_assert!(!x.has_car || x.presence == Presence::Active);
                // Numbers never change and are never shared.
                let n = *numbers.entry(x.id).or_insert(x.number);
                prop_assert_eq!(n, x.number);
            }
            let distinct: BTreeSet<u32> = s.seats().map(|x| x.number.0).collect();
            prop_assert_eq!(distinct.len(), s.seats().count());
            // Only an endpoint's live connection drives its seat.
            for conn in 0u64..24 {
                if let Some(id) = s.input_seat(conn, SourceHandle(1)) {
                    prop_assert_eq!(s.seat(id).unwrap().conn, Some(conn));
                }
            }
        }
    }
}
