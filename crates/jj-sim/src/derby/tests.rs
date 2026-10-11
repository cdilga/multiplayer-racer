//! The derby ledger against hand-built damage logs (the master §10.12 example, every zero-score rule, the 3 s attribution
//! expiry, ranking and the clock). The sim-level scenarios (`scenarios/derby/`, `tests/derby.rs`) run the same ledger on
//! real collisions.

use super::*;
use crate::damage::{OtherBody, Owner};

const WHEEL_FL: u8 = 7;
const FRONT: u8 = 1;

type Log = Vec<(u64, DamageEvent)>;

fn episode(
    car: u32,
    part: u8,
    other: OtherBody,
    owner: Option<Owner>,
    hp: f32,
    start: u64,
    last: u64,
) -> DamageEvent {
    DamageEvent::Episode(EpisodeRecord {
        car,
        part,
        other,
        other_owner: owner,
        impulse: 1.0,
        closing_mps: 10.0,
        start_tick: start,
        last_tick: last,
        tick: last + 6,
        damage: hp,
        health: 0.0,
    })
}

fn hit(by: u32, car: u32, part: u8, hp: f32, start: u64) -> DamageEvent {
    episode(
        car,
        part,
        OtherBody::Car { car: by },
        Some(Owner {
            car: by,
            tick: start,
        }),
        hp,
        start,
        start + 2,
    )
}

fn detached(car: u32, part: u8, by: u32) -> DamageEvent {
    DamageEvent::PartDetached {
        car,
        part,
        cause: OtherBody::Car { car: by },
        instigator: Some(by),
    }
}

fn wrecked(car: u32, why: WreckWhy, by: Option<u32>) -> DamageEvent {
    DamageEvent::Wrecked {
        car,
        why,
        cause: None,
        instigator: by,
    }
}

/// A ledger and the damage log it is fed, the way the sim feeds it: the whole log each time, read from a cursor.
struct Rig {
    l: Ledger,
    log: Log,
    cars: usize,
}

impl std::ops::Deref for Rig {
    type Target = Ledger;
    fn deref(&self) -> &Ledger {
        &self.l
    }
}

impl Rig {
    /// `cars` cars, none protected, those in `auto` on the autopilot from tick 1.
    fn new(cars: usize, auto: &[u32]) -> Self {
        let mut l = Ledger::new(0, ROUND_TICKS);
        let flags: Vec<CarFlags> = (0..cars as u32)
            .map(|c| CarFlags {
                autopilot: auto.contains(&c),
                protected: false,
            })
            .collect();
        l.update(1, &flags, &[]);
        Self {
            l,
            log: Vec::new(),
            cars,
        }
    }

    fn feed(&mut self, tick: u64, events: &[(u64, DamageEvent)]) {
        self.log.extend_from_slice(events);
        let flags: Vec<CarFlags> = (0..self.cars as u32)
            .map(|c| CarFlags {
                autopilot: self.l.autopilot_at(c, tick),
                protected: false,
            })
            .collect();
        self.l.update(tick, &flags, &self.log);
    }
}

/// The master example: 10 HP of damage on a wheel, the wheel detaching and the wreck that follows.
fn example() -> Log {
    vec![
        (100, hit(0, 1, WHEEL_FL, 10.0, 90)),
        (100, detached(1, WHEEL_FL, 0)),
        (101, wrecked(1, WreckWhy::WheelLoss, Some(0))),
    ]
}

#[test]
fn the_master_example_scores_35_points_for_a_human_and_17_5_for_the_autopilot() {
    let mut human = Rig::new(2, &[]);
    human.feed(101, &example());
    assert_eq!(human.units(0), 70_000);
    assert_eq!(human.points(0), 35.0);
    assert_eq!(human.units(1), 0);

    // The autopilot was driving at the causal action (tick 90) and handed back before the damage landed: it is the mode at
    // the action that counts, not at display time.
    let mut bot = Ledger::new(0, ROUND_TICKS);
    bot.update(80, &[CarFlags::default(); 2], &[]);
    bot.update(
        85,
        &[
            CarFlags {
                autopilot: true,
                protected: false,
            },
            CarFlags::default(),
        ],
        &[],
    );
    bot.update(95, &[CarFlags::default(); 2], &[]);
    bot.update(120, &[CarFlags::default(); 2], &example());
    assert_eq!(bot.units(0), 35_000);
    assert_eq!(bot.points(0), 17.5);
    // Each credited event was halved once: 10 000 damage units, then the detach and the wreck.
    let units: Vec<u64> = bot.events().iter().map(|e| e.units).collect();
    assert_eq!(units, vec![10_000, 5_000, 20_000]);
    assert!(bot.events().iter().all(|e| e.autopilot));
}

#[test]
fn damage_is_two_score_units_per_damage_unit_and_bonuses_are_exact_integers() {
    let mut l = Rig::new(2, &[]);
    // 0.001 HP is one damage unit: two score units.
    l.feed(50, &[(50, hit(0, 1, FRONT, 0.001, 40))]);
    assert_eq!(l.units(0), 2);
    // 2.5 HP is 2500 damage units: 5000 score units, 2.5 points.
    l.feed(60, &[(60, hit(0, 1, FRONT, 2.5, 55))]);
    assert_eq!(l.units(0), 2 + 5_000);
    assert_eq!((DETACH_UNITS, WRECK_UNITS), (10_000, 40_000));
}

#[test]
fn self_friendly_protected_and_environmental_damage_score_zero() {
    // Self: a car hit by its own debris; debris nobody pushed; a wall.
    let mut l = Rig::new(3, &[]);
    let own_debris = episode(
        1,
        FRONT,
        OtherBody::Prop { prop: 4 },
        Some(Owner { car: 1, tick: 90 }),
        5.0,
        100,
        102,
    );
    let nobody_pushed = episode(1, FRONT, OtherBody::Prop { prop: 5 }, None, 5.0, 100, 102);
    let wall = episode(1, FRONT, OtherBody::Scenery, None, 5.0, 100, 102);
    l.feed(110, &[(110, own_debris), (110, nobody_pushed), (110, wall)]);
    assert_eq!(l.units(0) + l.units(1) + l.units(2), 0);

    // Friendly fire: teammates 0 and 1; car 2 is an opponent.
    let mut t = Rig::new(3, &[]);
    t.l.set_team(0, Some(7));
    t.l.set_team(1, Some(7));
    t.feed(
        110,
        &[
            (110, hit(0, 1, FRONT, 5.0, 100)),
            (110, hit(2, 1, FRONT, 5.0, 100)),
        ],
    );
    assert_eq!((t.units(0), t.units(2)), (0, 10_000));

    // Spawn protection: damage to a protected car, and damage it deals, score nothing; once protection ends they do.
    let mut p = Ledger::new(0, ROUND_TICKS);
    p.update(
        1,
        &[
            CarFlags::default(),
            CarFlags {
                protected: true,
                autopilot: false,
            },
            CarFlags::default(),
        ],
        &[],
    );
    p.update(200, &[CarFlags::default(); 3], &[]);
    let log: Log = vec![
        (110, hit(0, 1, FRONT, 5.0, 100)),
        (110, hit(1, 2, FRONT, 5.0, 100)),
        (210, hit(1, 2, FRONT, 5.0, 205)),
    ];
    p.update(210, &[CarFlags::default(); 3], &log);
    assert_eq!(p.units(0), 0, "damage to a protected car");
    assert_eq!(
        p.units(1),
        10_000,
        "only the hit after protection ended scores"
    );
}

#[test]
fn debris_attribution_expires_three_seconds_after_the_last_instigator_impulse() {
    let debris = |hit_at: u64| {
        episode(
            1,
            FRONT,
            OtherBody::Prop { prop: 3 },
            Some(Owner { car: 0, tick: 100 }),
            1.0,
            hit_at,
            hit_at + 1,
        )
    };
    let mut l = Rig::new(2, &[]);
    // Exactly 3 s after the last impulse: still the instigator's. One tick later: environmental.
    l.feed(1000, &[(1000, debris(100 + ATTRIBUTION_TICKS))]);
    assert_eq!(l.units(0), 2_000);
    l.feed(2000, &[(2000, debris(100 + ATTRIBUTION_TICKS + 1))]);
    assert_eq!(l.units(0), 2_000, "3 s and a tick: environmental");
    assert_eq!(ATTRIBUTION_TICKS, 360);
}

#[test]
fn a_wreck_pays_once_per_life_and_flips_are_credited_only_within_three_seconds() {
    // A hit, then the car flips 2.9 s later: the wreck pays the hitter. A second wreck with no new hit pays nothing.
    let mut l = Rig::new(2, &[]);
    l.feed(
        900,
        &[
            (100, hit(0, 1, FRONT, 1.0, 98)),
            (100 + 348, wrecked(1, WreckWhy::Flipped, Some(0))),
            (900, wrecked(1, WreckWhy::Flipped, Some(0))),
        ],
    );
    assert_eq!(l.units(0), 2_000 + WRECK_UNITS);
    // Last impulse at 1002, flip a tick past 3 s later: too late.
    let mut late = Rig::new(2, &[]);
    late.feed(
        2000,
        &[
            (1000, hit(0, 1, FRONT, 1.0, 1000)),
            (
                1002 + ATTRIBUTION_TICKS + 1,
                wrecked(1, WreckWhy::OutOfBounds, Some(0)),
            ),
        ],
    );
    assert_eq!(
        late.units(0),
        2_000,
        "a wreck over 3 s after the last hit is the environment's"
    );
    // Self-inflicted and environmental wrecks pay nobody.
    let mut own = Rig::new(2, &[]);
    own.feed(
        500,
        &[
            (500, wrecked(1, WreckWhy::OutOfBounds, None)),
            (501, wrecked(0, WreckWhy::Flipped, None)),
        ],
    );
    assert_eq!(own.units(0) + own.units(1), 0);
}

#[test]
fn loosening_and_damage_to_a_gone_part_pay_nothing() {
    let mut l = Rig::new(2, &[]);
    let loose = DamageEvent::PartLoose {
        car: 1,
        part: FRONT,
        cause: OtherBody::Car { car: 0 },
        instigator: Some(0),
    };
    l.feed(50, &[(50, hit(0, 1, FRONT, 0.0, 40)), (50, loose)]);
    assert_eq!(l.units(0), 0);
}

#[test]
fn equal_raw_scores_share_a_rank_and_a_late_joiner_ranks_from_arrival() {
    let mut l = Rig::new(2, &[]);
    // Cars 0 and 1 trade equal hits; car 2 arrives at tick 5000 and scores once.
    l.feed(
        100,
        &[
            (100, hit(0, 1, FRONT, 4.0, 90)),
            (100, hit(1, 0, FRONT, 4.0, 90)),
        ],
    );
    assert_eq!((l.rank_of(0), l.rank_of(1)), (1, 1));
    l.cars = 3;
    l.feed(5000, &[]);
    assert_eq!(l.rows().iter().find(|r| r.car == 2).unwrap().arrived, 5000);
    l.feed(5100, &[(5100, hit(2, 0, FRONT, 1.0, 5090))]);
    // Car 0 took a hit worth nothing to it, car 2 scored 2000 units, cars 0 and 1 have 8000 each: ranks 1, 1, 3.
    assert_eq!(
        l.rows().iter().map(|r| r.rank).collect::<Vec<_>>(),
        vec![1, 1, 3]
    );
    assert_eq!(l.units(2), 2_000);
}

#[test]
fn the_clock_counts_game_ticks_and_the_final_tick_still_counts() {
    let mut l = Ledger::new(100, 1000);
    l.update(101, &[CarFlags::default(); 2], &[]);
    assert_eq!(l.time_left_ticks(101), 999);
    assert!(!l.over(1099));
    assert!(l.over(1100));
    // Events up to and including the limit tick count; later ones don't. Events before the start don't either.
    let log: Log = vec![
        (50, hit(0, 1, FRONT, 1.0, 40)),
        (1100, hit(0, 1, FRONT, 1.0, 1095)),
        (1101, hit(0, 1, FRONT, 1.0, 1096)),
    ];
    l.update(1101, &[CarFlags::default(); 2], &log);
    assert_eq!(l.units(0), 2_000);
    assert_eq!(ROUND_TICKS, 180 * 120);
}
