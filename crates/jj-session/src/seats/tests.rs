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
        source: PRIMARY_SOURCE,
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
    s.apply(Input::Leave {
        conn: 2,
        source: PRIMARY_SOURCE,
    });
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
    let mut s = Seats::default(); // 60 Hz, once per 1 s = 60 ticks
    let id = joined(&mut s, 1, 1, "Dusty"); // auto-fired at tick 0, car at tick 1
    for (tick, fires) in [
        (1, false),
        (59, false),
        (60, true),
        (61, false),
        (119, false),
        (120, true),
    ] {
        s.apply(Input::Tick(Tick(tick)));
        let out = s.apply(Input::Identify {
            conn: 1,
            source: PRIMARY_SOURCE,
        });
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
        s.apply(Input::Identify {
            conn: 1,
            source: PRIMARY_SOURCE
        })
        .contains(&Output::Identify { seat: id }),
        "and a respawn's flash doesn't use up the player's press"
    );
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
                    let out = s.apply(Input::Claim { conn, source: PRIMARY_SOURCE, request: RequestId(req), name: if blank { String::new() } else { "Dusty".into() } });
                    if welcomed(&out).is_some() {
                        claimed_endpoints.insert(s.seat(welcomed(&out).unwrap()).unwrap().endpoint.clone());
                    }
                }
                Op::Leave { conn } => { s.apply(Input::Leave { conn, source: PRIMARY_SOURCE }); }
                Op::SitOut { conn, on } => { s.apply(Input::SitOut { conn, source: PRIMARY_SOURCE, on }); }
                Op::Disconnect { conn } => { s.apply(Input::Disconnect { conn }); }
                Op::Identify { conn } => { s.apply(Input::Identify { conn, source: PRIMARY_SOURCE }); }
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

fn claim_src(seats: &mut Seats, conn: ConnId, source: u16, name: &str) -> Vec<Output> {
    seats.apply(Input::Claim {
        conn,
        source: SourceHandle(source),
        request: RequestId(1),
        name: name.into(),
    })
}

#[test]
fn one_endpoint_holds_a_seat_per_source_and_each_acts_alone() {
    let mut s = Seats::default();
    hello(&mut s, 1, 1);
    // Any number of sources over the one connection (no cap): twenty here.
    let ids: Vec<SeatId> = (2..22)
        .map(|src| welcomed(&claim_src(&mut s, 1, src, "Pad")).unwrap())
        .collect();
    assert_eq!(ids.iter().collect::<BTreeSet<_>>().len(), 20, "a seat each");
    // A repeated claim of the same source is the same seat; the phone's primary source is a seat of its own.
    assert_eq!(welcomed(&claim_src(&mut s, 1, 5, "Pad")), Some(ids[3]));
    let phone = welcomed(&claim_src(&mut s, 1, 1, "Phone")).unwrap();
    assert!(!ids.contains(&phone));
    s.apply(Input::Tick(Tick(1_000)));
    assert_eq!(s.input_seat(1, SourceHandle(7)), Some(ids[5]));
    assert_eq!(
        s.input_seat(1, SourceHandle(99)),
        None,
        "a source without a seat is stale"
    );
    // Identify, Leave and SitOut address one source's seat only.
    let out = s.apply(Input::Identify {
        conn: 1,
        source: SourceHandle(3),
    });
    assert_eq!(out, vec![Output::Identify { seat: ids[1] }]);
    s.apply(Input::Leave {
        conn: 1,
        source: SourceHandle(3),
    });
    s.apply(Input::SitOut {
        conn: 1,
        source: SourceHandle(4),
        on: true,
    });
    let out = s.apply(Input::Tick(Tick(1_001)));
    assert!(out.contains(&Output::CarWithdrawn {
        seat: ids[1],
        why: Withdraw::Left
    }));
    assert!(out.contains(&Output::CarWithdrawn {
        seat: ids[2],
        why: Withdraw::SatOut
    }));
    assert_eq!(out.len(), 2, "no other seat moved");
    assert_eq!(s.seat(ids[0]).unwrap().presence, Presence::Active);
}

#[test]
fn a_reconnect_welcomes_every_source_back_and_a_dropout_keeps_them_all() {
    let mut s = Seats::default();
    hello(&mut s, 1, 1);
    let a = welcomed(&claim_src(&mut s, 1, 2, "A")).unwrap();
    let b = welcomed(&claim_src(&mut s, 1, 3, "B")).unwrap();
    s.apply(Input::Disconnect { conn: 1 });
    assert_eq!(s.seat(a).unwrap().conn, None);
    assert_eq!(s.seat(b).unwrap().conn, None);
    let out = hello(&mut s, 2, 1);
    let back: Vec<(SeatId, SourceHandle)> = out
        .iter()
        .filter_map(|o| match o {
            Output::Welcome { seat, source, .. } => Some((*seat, *source)),
            _ => None,
        })
        .collect();
    assert_eq!(back, vec![(a, SourceHandle(2)), (b, SourceHandle(3))]);
    assert_eq!(s.seat_at(2, SourceHandle(3)), Some(b));
}
