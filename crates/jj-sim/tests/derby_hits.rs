//! The derby's hit rules (assets/profiles/derby.json, br-bhkz.1; owner 2026-11-17: "easier to intuit how you can damage
//! other cars more without damaging your own car"). In a derby the car that does the hitting wins the hit, and only
//! rivals hurt you:
//!
//! - a ram at speed into a standing car costs the rammer `strikerTake` of what the same hit costs it in a race, and the
//!   rammed car all of it, so the rammer scores several times what the rammed car scores off it;
//! - a head-on at equal speeds costs both alike;
//! - a wall met alone costs `junkTake` of its damage; a wall a rival's hit shoved the car into costs all of it, and is
//!   the rival's points;
//! - a race is untouched.
//!
//! The yard (`scenarios/damage/yard.json`) is the damage bank's flat pad with a 3 m wall at x = 39.

use std::path::Path;

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::damage::{BACK, DamageEvent, EpisodeRecord, FRONT, OtherBody};
use jj_sim::derby::ScoreKind;
use jj_sim::{CarId, Sim, SpawnPose, TICK_HZ, VehicleProfile};

const S: u64 = TICK_HZ as u64;
const EAST: f32 = core::f32::consts::FRAC_PI_2;

fn yard() -> LoadedMap {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scenarios/damage/yard.json");
    load_json(&std::fs::read(path).expect("yard"), &Registry::generic()).expect("yard validates")
}

/// Two cars in the yard, settled and out of spawn protection, in a derby or not.
fn two_cars(map: &LoadedMap, derby: bool) -> Sim {
    let mut sim = Sim::new(map, &Registry::generic(), 1, VehicleProfile::cruz());
    for i in 0..2 {
        sim.spawn_car(SpawnPose {
            x: -60.0 + 12.0 * i as f32,
            y: 0.1,
            z: -20.0,
            heading: 0.0,
        });
    }
    if derby {
        sim.start_derby(120 * S);
    }
    for _ in 0..(4 * S) {
        sim.step();
    }
    assert!(!sim.is_protected(CarId(0)) && !sim.is_protected(CarId(1)));
    sim
}

fn pose(x: f32, z: f32, heading: f32) -> SpawnPose {
    SpawnPose {
        x,
        y: 0.05,
        z,
        heading,
    }
}

fn run(sim: &mut Sim, seconds: f32) {
    for _ in 0..(seconds * TICK_HZ as f32) as u64 {
        sim.step();
    }
}

fn episodes(sim: &Sim) -> Vec<EpisodeRecord> {
    sim.damage_events()
        .iter()
        .filter_map(|(_, e)| match e {
            DamageEvent::Episode(r) => Some(*r),
            _ => None,
        })
        .collect()
}

/// The health `car` has lost over all its parts.
fn lost(sim: &Sim, car: u32) -> f32 {
    episodes(sim)
        .iter()
        .filter(|r| r.car == car)
        .map(|r| r.damage)
        .sum()
}

/// Car 1 drives east at `speed` into the right-hand side of car 0, parked facing north (the damage bank's T-bone).
fn t_bone(sim: &mut Sim, speed: f32) {
    sim.place_car(CarId(0), pose(60.0, -30.0, 0.0), 0.0, [0.0; 3]);
    sim.place_car(CarId(1), pose(56.25, -29.66, EAST), 0.0, [speed, 0.0, 0.0]);
    run(sim, 1.0);
}

#[test]
fn a_ram_costs_the_rammer_a_third_and_the_rammed_car_all_of_it() {
    let map = yard();
    // 9 m/s: hard enough to count on every part it touches, soft enough that no part's health runs out and hides a loss.
    let (mut race, mut derby) = (two_cars(&map, false), two_cars(&map, true));
    t_bone(&mut race, 9.0);
    t_bone(&mut derby, 9.0);
    let (rammed_race, rammer_race) = (lost(&race, 0), lost(&race, 1));
    let (rammed, rammer) = (lost(&derby, 0), lost(&derby, 1));
    eprintln!(
        "T-bone at 9 m/s: race rammed {rammed_race:.1} / rammer {rammer_race:.1} HP; derby rammed {rammed:.1} / rammer {rammer:.1} HP"
    );
    assert!(
        rammer_race > 10.0 && rammed_race > 10.0,
        "the race's hit is a real one"
    );
    // The rammed car stood still: it brought none of the closing speed, so it pays in full.
    assert!(
        (rammed / rammed_race - 1.0).abs() < 0.1,
        "the rammed car loses what it loses in a race: {rammed:.1} vs {rammed_race:.1}"
    );
    let take = derby.derby_rules().striker_take;
    assert!(
        (rammer / rammer_race - take).abs() < 0.08,
        "the rammer keeps strikerTake ({take}) of its race damage: {rammer:.1} vs {rammer_race:.1}"
    );
    assert!(
        rammer * 3.0 < rammed,
        "the hit is the rammer's: {rammer:.1} vs {rammed:.1}"
    );
    // The ledger follows the damage: the rammer scores several times what the rammed car scores off it.
    let ledger = derby.derby().expect("a derby");
    assert!(
        ledger.points(1) > 3.0 * ledger.points(0),
        "points: rammer {} vs rammed {}",
        ledger.points(1),
        ledger.points(0)
    );
}

#[test]
fn a_head_on_at_equal_speeds_costs_both_alike() {
    let map = yard();
    let mut sim = two_cars(&map, true);
    // Nose to nose, 6 m/s each (12 m/s closing), a little off the wall.
    sim.place_car(CarId(0), pose(-10.0, -30.0, EAST), 0.0, [6.0, 0.0, 0.0]);
    sim.place_car(CarId(1), pose(-4.6, -30.0, -EAST), 0.0, [-6.0, 0.0, 0.0]);
    run(&mut sim, 1.0);
    let (a, b) = (lost(&sim, 0), lost(&sim, 1));
    eprintln!("head-on at 6 + 6 m/s: {a:.1} and {b:.1} HP");
    assert!(
        a > 5.0 && b > 5.0,
        "both noses took the hit: {a:.1}, {b:.1}"
    );
    assert!(
        (a / b).max(b / a) < 1.35,
        "neither car is the striker: {a:.1} vs {b:.1}"
    );
    let fronts = episodes(&sim)
        .iter()
        .filter(|r| r.part as usize == FRONT && matches!(r.other, OtherBody::Car { .. }))
        .count();
    assert!(fronts >= 2, "nose met nose");
}

/// What the front loses to the wall, as a share of the race's `k x impulse`, over the wall's episodes on `car`.
fn wall_share(sim: &Sim, car: u32, k: f32) -> (f32, Vec<EpisodeRecord>) {
    let hits: Vec<EpisodeRecord> = episodes(sim)
        .into_iter()
        .filter(|r| r.car == car && r.other == OtherBody::Scenery && r.part as usize == FRONT)
        .collect();
    let (damage, full): (f32, f32) = hits
        .iter()
        .fold((0.0, 0.0), |(d, f), r| (d + r.damage, f + k * r.impulse));
    (damage / full.max(1e-6), hits)
}

#[test]
fn a_wall_met_alone_costs_a_quarter_and_scores_nobody() {
    let map = yard();
    let k = VehicleProfile::cruz().tuning.damage.k_front;
    let mut sim = two_cars(&map, true);
    // 8 m/s nose-first into the wall's face (x = 39), from 0.5 m off it.
    sim.place_car(CarId(0), pose(36.2, -30.0, EAST), 0.0, [8.0, 0.0, 0.0]);
    run(&mut sim, 1.0);
    let (share, hits) = wall_share(&sim, 0, k);
    let junk = sim.derby_rules().junk_take;
    assert!(!hits.is_empty(), "the nose met the wall");
    assert!(
        (share - junk).abs() < 0.02,
        "a wall met alone costs junkTake ({junk}) of its damage: {share:.3}"
    );
    assert!(
        hits.iter().all(|r| r.other_owner.is_none()),
        "nobody shoved it"
    );
    assert_eq!(sim.derby().unwrap().points(1), 0.0, "and nobody scores it");

    // The same wall in a race costs all of it.
    let mut race = two_cars(&map, false);
    race.place_car(CarId(0), pose(36.2, -30.0, EAST), 0.0, [8.0, 0.0, 0.0]);
    run(&mut race, 1.0);
    let (share, hits) = wall_share(&race, 0, k);
    assert!(
        !hits.is_empty() && (share - 1.0).abs() < 0.02,
        "a race is untouched: {share:.3}"
    );
}

#[test]
fn a_car_rammed_into_the_wall_pays_in_full_and_the_rammer_scores_it() {
    let map = yard();
    let k = VehicleProfile::cruz().tuning.damage.k_front;
    let mut sim = two_cars(&map, true);
    // Car 0 stands nose to the wall, 0.6 m off it; car 1 runs into its tail at 16 m/s and drives it into the wall.
    sim.place_car(CarId(0), pose(36.1, -30.0, EAST), 0.0, [0.0; 3]);
    sim.place_car(CarId(1), pose(30.9, -30.0, EAST), 0.0, [16.0, 0.0, 0.0]);
    run(&mut sim, 1.5);
    let (share, hits) = wall_share(&sim, 0, k);
    assert!(!hits.is_empty(), "car 0's nose met the wall");
    assert!(
        hits.iter().all(|r| r.other_owner.map(|o| o.car) == Some(1)),
        "the wall hit names the car that shoved it: {hits:?}"
    );
    // In full, unless the bumper's health ran out first.
    let front_gone = sim.part_health(CarId(0)).unwrap()[FRONT] <= 0.0;
    assert!(
        front_gone || (share - 1.0).abs() < 0.02,
        "a shove into the wall bites in full: {share:.3}"
    );
    // The rammer's points include the wall's damage on car 0's nose, beside its own hit on the tail.
    let ledger = sim.derby().unwrap();
    let scored = |part: usize| {
        ledger.events().iter().any(|e| {
            e.scorer == 1
                && e.victim == 0
                && e.part == Some(part as u8)
                && matches!(e.kind, ScoreKind::Damage { .. })
        })
    };
    assert!(scored(BACK), "the rammer scores its hit on the tail");
    assert!(scored(FRONT), "and the wall's damage on the nose");
    // And it replays bit for bit.
    let replay = Sim::replay(
        &map,
        &Registry::generic(),
        VehicleProfile::cruz(),
        sim.journal(),
        sim.tick(),
    );
    assert_eq!(
        replay.state_hash(),
        sim.state_hash(),
        "the shove replays exactly"
    );
}
