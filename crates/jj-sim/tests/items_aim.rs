//! The boomerang auto-aims: a rival 20-40 m ahead and 10 degrees off the line is hit; one behind or outside the cone is not.
use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::utility::UtilityKind;
use jj_sim::{CarId, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use jj_types::SeatId;
use jj_types::items::ItemId;

const S: u64 = TICK_HZ as u64;

fn greybox() -> LoadedMap {
    load_json(
        include_bytes!("../../../maps/greybox-loop.json"),
        &Registry::generic(),
    )
    .unwrap()
}

fn pose(x: f32, z: f32) -> SpawnPose {
    SpawnPose {
        x,
        y: 0.3,
        z,
        heading: core::f32::consts::FRAC_PI_2,
    }
}

/// Throws forward with the rival `dist` m ahead and `deg` degrees to the side; returns whether it was hit.
fn throw(dist: f32, deg: f32, kind: UtilityKind) -> (bool, Sim, CarId) {
    let map = greybox();
    let mut sim = Sim::new(&map, &Registry::generic(), 5, VehicleProfile::cruz());
    let a = deg.to_radians();
    let poses = [pose(0.0, 0.0), pose(0.0 + dist * a.cos(), dist * a.sin())];
    let cars: Vec<CarId> = poses.iter().map(|&p| sim.spawn_car(p)).collect();
    sim.start_race(9);
    for _ in 0..(3 * S) {
        sim.step();
    }
    for (&c, &p) in cars.iter().zip(&poses) {
        sim.place_car(c, p, 0.0, [0.0; 3]);
    }
    for _ in 0..S {
        sim.step();
    }
    sim.pickup_item(cars[0], SeatId(1), ItemId::Boomerang)
        .unwrap();
    assert!(sim.utility(cars[0], kind));
    for _ in 0..(3 * S) {
        sim.step();
    }
    let hit = sim.boomerangs()[0].hits.iter().any(|h| h.car == cars[1].0);
    (hit, sim, cars[0])
}

#[test]
fn a_rival_20_to_40_m_ahead_and_10_degrees_off_is_hit() {
    let mut hits = 0;
    let mut n = 0;
    for dist in [20.0, 25.0, 30.0, 35.0, 40.0] {
        for deg in [-10.0, 0.0, 10.0] {
            let (hit, ..) = throw(dist, deg, UtilityKind::Forward);
            println!("aim {dist} m {deg} deg: hit={hit}");
            n += 1;
            hits += i32::from(hit);
            assert!(hit, "{dist} m at {deg} deg");
        }
    }
    println!("aim hit rate {hits}/{n}");
}

#[test]
fn outside_the_cone_it_flies_straight_and_misses() {
    let (hit, ..) = throw(30.0, 60.0, UtilityKind::Forward);
    assert!(!hit, "60 degrees off is outside the 30 degree cone");
    let (hit, ..) = throw(-30.0, 0.0, UtilityKind::Forward);
    assert!(!hit, "behind a forward throw is not aimed at");
}

#[test]
fn a_rear_throw_aims_at_a_rival_behind() {
    let (hit, sim, _) = throw(-30.0, 8.0, UtilityKind::Rear);
    assert!(hit);
    let replay = Sim::replay(
        &greybox(),
        &Registry::generic(),
        VehicleProfile::cruz(),
        sim.journal(),
        sim.tick(),
    );
    assert_eq!(replay.state_hash(), sim.state_hash());
}
