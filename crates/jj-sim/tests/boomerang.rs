//! P1-W02a: the boomerang in races, the master §9.3 set. Each case throws from a car on the greybox's main straight
//! (+x) and reads the flight and the cars back as data; every case replays bit for bit from its journal.

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::items::boomerang::{End, HIT_DV_MPS, Leg, SANGA_SCALE};
use jj_sim::race::Event;
use jj_sim::utility::UtilityKind;
use jj_sim::{CarId, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use jj_types::SeatId;
use jj_types::items::ItemId;

const GREYBOX: &[u8] = include_bytes!("../../../maps/greybox-loop.json");
const S: u64 = TICK_HZ as u64;

fn greybox() -> LoadedMap {
    load_json(GREYBOX, &Registry::generic()).unwrap()
}

/// A car at rest at `x` on the main straight's centre line (z = 0), facing +x.
fn at(x: f32, z: f32) -> SpawnPose {
    SpawnPose {
        x,
        y: 0.3,
        z,
        heading: core::f32::consts::FRAC_PI_2,
    }
}

/// A sim with the race running and every car placed and settled, the thrower (car 0) holding a boomerang.
fn setup(map: &LoadedMap, poses: &[SpawnPose]) -> (Sim, Vec<CarId>) {
    let mut sim = Sim::new(map, &Registry::generic(), 5, VehicleProfile::cruz());
    let cars: Vec<CarId> = poses.iter().map(|&p| sim.spawn_car(p)).collect();
    sim.start_race(9);
    for _ in 0..(3 * S) {
        sim.step();
    }
    for (&c, &p) in cars.iter().zip(poses) {
        sim.place_car(c, p, 0.0, [0.0; 3]);
    }
    for _ in 0..S {
        sim.step();
    }
    for &c in &cars {
        assert!(!sim.is_protected(c), "settled cars are not spawn-protected");
    }
    sim.pickup_item(cars[0], SeatId(1), ItemId::Boomerang)
        .unwrap();
    (sim, cars)
}

fn throw_and_fly(sim: &mut Sim, thrower: CarId, kind: UtilityKind, secs: u64) {
    assert!(sim.utility(thrower, kind), "the throw is accepted");
    assert_eq!(sim.boomerangs().len(), 1);
    for _ in 0..(secs * S) {
        sim.step();
    }
}

fn speed(sim: &Sim, c: CarId) -> f32 {
    let v = sim.car_state(c).unwrap().linvel;
    (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt()
}

fn replays(map: &LoadedMap, sim: &Sim) {
    let replay = Sim::replay(
        map,
        &Registry::generic(),
        VehicleProfile::cruz(),
        sim.journal(),
        sim.tick(),
    );
    assert_eq!(replay.state_hash(), sim.state_hash(), "replays bit for bit");
    assert_eq!(replay.boomerangs(), sim.boomerangs());
}

#[test]
fn hit_stationary_the_target_is_pushed_and_its_struck_part_damaged_once_per_leg() {
    let map = greybox();
    let (mut sim, cars) = setup(&map, &[at(40.0, 0.0), at(52.0, 0.0)]);
    let health = sim.part_health(cars[1]).unwrap();
    throw_and_fly(&mut sim, cars[0], UtilityKind::Forward, 3);
    let f = &sim.boomerangs()[0];
    let hits: Vec<_> = f.hits.iter().filter(|h| h.car == 1).collect();
    assert!(!hits.is_empty(), "the stationary car ahead is hit: {f:?}");
    assert!(hits.iter().filter(|h| h.leg == Leg::Out).count() <= 1);
    assert!(hits.iter().filter(|h| h.leg == Leg::Back).count() <= 1);
    assert!(hits.iter().all(|h| h.dv_mps <= 10.0));
    let after = sim.part_health(cars[1]).unwrap();
    let struck = hits[0].part as usize;
    assert!(
        after[struck] < health[struck],
        "the struck part took damage"
    );
    assert!(
        f.ended.is_some(),
        "the flight ended inside 3 s: {:?}",
        f.ended
    );
    replays(&map, &sim);
}

#[test]
fn hit_crossing_a_car_driving_across_the_arc_is_hit() {
    let map = greybox();
    let (mut sim, cars) = setup(&map, &[at(40.0, 0.0), at(56.0, -7.0)]);
    // The target crosses the straight (+z) at 10 m/s, into the boomerang's path.
    sim.place_car(
        cars[1],
        SpawnPose {
            heading: 0.0,
            ..at(56.0, -7.0)
        },
        0.0,
        [0.0, 0.0, 10.0],
    );
    throw_and_fly(&mut sim, cars[0], UtilityKind::Forward, 3);
    assert!(
        sim.boomerangs()[0].hits.iter().any(|h| h.car == 1),
        "{:?}",
        sim.boomerangs()[0]
    );
    replays(&map, &sim);
}

#[test]
fn miss_a_car_well_clear_of_the_arc_is_untouched() {
    let map = greybox();
    let (mut sim, cars) = setup(&map, &[at(40.0, 0.0), at(50.0, -9.0)]);
    let health = sim.part_health(cars[1]).unwrap();
    throw_and_fly(&mut sim, cars[0], UtilityKind::Forward, 3);
    assert!(
        sim.boomerangs()[0].hits.is_empty(),
        "{:?}",
        sim.boomerangs()[0]
    );
    assert_eq!(sim.part_health(cars[1]).unwrap(), health);
    assert!(speed(&sim, cars[1]) < 0.5);
    replays(&map, &sim);
}

#[test]
fn self_catch_the_thrower_catches_it_with_no_effect() {
    let map = greybox();
    let (mut sim, cars) = setup(&map, &[at(40.0, 0.0)]);
    let health = sim.part_health(cars[0]).unwrap();
    throw_and_fly(&mut sim, cars[0], UtilityKind::Forward, 3);
    let f = &sim.boomerangs()[0];
    assert_eq!(f.ended.map(|e| e.1), Some(End::Caught), "{f:?}");
    assert!(f.hits.is_empty());
    assert_eq!(sim.part_health(cars[0]).unwrap(), health);
    replays(&map, &sim);
}

#[test]
fn a_rear_throw_goes_back_and_returns_to_a_moving_thrower() {
    let map = greybox();
    let (mut sim, cars) = setup(&map, &[at(60.0, 0.0)]);
    sim.place_car(cars[0], at(60.0, 0.0), 0.0, [12.0, 0.0, 0.0]);
    sim.step();
    assert!(sim.utility(cars[0], UtilityKind::Rear));
    let start = sim.boomerangs()[0].position;
    assert!(start[0] < 60.0, "thrown from the back: {start:?}");
    for _ in 0..(3 * S) {
        let s = sim.car_state(cars[0]).unwrap();
        sim.set_input(
            cars[0],
            jj_sim::DriveInput {
                throttle: i16::MAX / 4,
                steer: ((s.position[2]) * 2000.0) as i16,
                ..Default::default()
            },
        );
        sim.step();
    }
    assert_eq!(
        sim.boomerangs()[0].ended.map(|e| e.1),
        Some(End::Caught),
        "{:?}",
        sim.boomerangs()[0]
    );
    replays(&map, &sim);
}

#[test]
fn vs_sanga_a_sanga_d_car_takes_a_fifth_of_the_push_and_damage() {
    let map = greybox();
    let (mut sim, cars) = setup(&map, &[at(40.0, 0.0), at(52.0, 0.0)]);
    sim.pickup_item(cars[1], SeatId(2), ItemId::Sanga).unwrap();
    assert!(
        sim.utility(cars[1], UtilityKind::Forward),
        "the target eats its sanga"
    );
    assert!(sim.sanga_state(cars[1]).is_some());
    throw_and_fly(&mut sim, cars[0], UtilityKind::Forward, 3);
    let hit = sim.boomerangs()[0]
        .hits
        .iter()
        .find(|h| h.car == 1)
        .copied()
        .expect("hit");
    assert!(
        (hit.dv_mps - HIT_DV_MPS * SANGA_SCALE).abs() < 1e-4,
        "{hit:?}"
    );
    replays(&map, &sim);
}

#[test]
fn into_debris_behind_the_target_debris_stops_it_and_shelters_the_car() {
    let map = greybox();
    // A crate wall across the straight 8 m ahead of the thrower, the target sheltering 4 m behind it.
    let (mut sim, cars) = setup(&map, &[at(40.0, 0.0), at(52.0, 0.0)]);
    for dz in [-3.0f32, -1.0, 1.0, 3.0] {
        sim.spawn_debris(
            SpawnPose {
                x: 48.0,
                y: 1.0,
                z: dz,
                heading: 0.0,
            },
            [0.4, 1.0, 1.0],
        );
    }
    for _ in 0..S {
        sim.step();
    }
    let health = sim.part_health(cars[1]).unwrap();
    throw_and_fly(&mut sim, cars[0], UtilityKind::Forward, 3);
    let f = &sim.boomerangs()[0];
    assert_eq!(f.ended.map(|e| e.1), Some(End::Stopped), "{f:?}");
    assert!(f.hits.iter().all(|h| h.car != 1), "{f:?}");
    assert_eq!(sim.part_health(cars[1]).unwrap(), health);
    replays(&map, &sim);
}

#[test]
fn into_a_wall_the_scenery_stops_it() {
    let map = greybox();
    // The hairpin's first barrier stands along x at z = -8.7 (0.9 m tall); the thrower faces it (-z) from the centre line.
    let (mut sim, cars) = setup(
        &map,
        &[SpawnPose {
            heading: core::f32::consts::PI,
            ..at(170.0, 0.0)
        }],
    );
    throw_and_fly(&mut sim, cars[0], UtilityKind::Forward, 3);
    let f = &sim.boomerangs()[0];
    assert_eq!(f.ended.map(|e| e.1), Some(End::Stopped), "{f:?}");
    assert!(
        f.position[2] > -9.5,
        "stopped at the barrier, not past it: {f:?}"
    );
    replays(&map, &sim);
}

#[test]
fn a_24_car_crowd_each_car_is_hit_at_most_once_a_leg_and_nobody_leaves_the_map() {
    let map = greybox();
    let mut poses = vec![at(30.0, 0.0)];
    for k in 0..23 {
        poses.push(at(38.0 + 6.5 * (k / 3) as f32, -4.0 + 4.0 * (k % 3) as f32));
    }
    let (mut sim, cars) = setup(&map, &poses);
    throw_and_fly(&mut sim, cars[0], UtilityKind::Forward, 3);
    let f = &sim.boomerangs()[0];
    for c in 1..24u32 {
        for leg in [Leg::Out, Leg::Back] {
            assert!(f.hits.iter().filter(|h| h.car == c && h.leg == leg).count() <= 1);
        }
    }
    assert!(!f.hits.is_empty());
    for &c in &cars {
        assert!(
            speed(&sim, c) <= 10.5,
            "car {} at {} m/s",
            c.0,
            speed(&sim, c)
        );
        assert!(
            !sim.race()
                .events()
                .iter()
                .any(|(_, e)| matches!(e, Event::Respawned { car, .. } if *car == c.0))
        );
    }
    replays(&map, &sim);
}

#[test]
fn respawn_during_flight_the_boomerang_drops() {
    let map = greybox();
    let (mut sim, cars) = setup(&map, &[at(40.0, 0.0)]);
    assert!(sim.utility(cars[0], UtilityKind::Forward));
    for _ in 0..(S / 2) {
        sim.step();
    }
    assert!(sim.recover(cars[0]));
    for _ in 0..S {
        sim.step();
    }
    assert_eq!(
        sim.boomerangs()[0].ended.map(|e| e.1),
        Some(End::Dropped),
        "{:?}",
        sim.boomerangs()[0]
    );
    replays(&map, &sim);
}

#[test]
fn cleanup_round_end_drops_flights_and_debris_keeps_moving() {
    let map = greybox();
    let (mut sim, cars) = setup(&map, &[at(40.0, 0.0)]);
    sim.spawn_debris(
        SpawnPose {
            x: 70.0,
            y: 2.0,
            z: 0.0,
            heading: 0.0,
        },
        [0.5, 0.5, 0.5],
    );
    assert!(sim.utility(cars[0], UtilityKind::Forward));
    sim.step();
    assert!(sim.end_race_now());
    sim.step();
    assert_eq!(sim.boomerangs()[0].ended.map(|e| e.1), Some(End::Dropped));
    for _ in 0..S {
        sim.step();
    }
    replays(&map, &sim);
}
