//! br-bwju.2: the Tradie Ute (the owner's Triton, R123) drives in the round loop: it spawns on the grid, settles at its
//! design ride height, laps the greybox under autopilot without wrecks, and its profile is heavier and torquier than the
//! Cruz's with a lower top speed (all of it profile data).

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::{DriveInput, Sim, TICK_HZ, VehicleProfile};

const GREYBOX: &str = include_str!("../../../maps/greybox-loop.json");
const S: u64 = TICK_HZ as u64;

fn greybox() -> LoadedMap {
    load_json(GREYBOX.as_bytes(), &Registry::generic()).expect("the greybox validates")
}

#[test]
fn the_ute_profile_is_heavier_and_torquier_than_the_cruz() {
    let (u, c) = (VehicleProfile::tradie_ute(), VehicleProfile::cruz());
    assert!(u.tuning.mass > c.tuning.mass * 1.4);
    assert!(
        u.tuning.max_engine_force / u.tuning.mass > c.tuning.max_engine_force / c.tuning.mass,
        "more thrust per kilo off the line"
    );
    assert!(
        u.tuning.linear_damping > c.tuning.linear_damping,
        "a lower top speed"
    );
    assert!(u.wheelbase() > c.wheelbase());
    assert!(u.geometry.wheel_radius > c.geometry.wheel_radius);
}

#[test]
fn the_ute_settles_on_its_wheels_at_the_design_ride_height() {
    let map = greybox();
    let mut s = Sim::new(&map, &Registry::generic(), 3, VehicleProfile::tradie_ute());
    let car = s.spawn_grid(1)[0];
    for _ in 0..(3 * S) {
        s.step();
    }
    let st = s.car_state(car).unwrap();
    assert!(st.position.iter().all(|v| v.is_finite()));
    assert!(st.up_y > 0.99, "upright: {}", st.up_y);
    assert!(
        st.forward_speed.abs() < 0.1,
        "at rest: {}",
        st.forward_speed
    );
}

#[test]
fn the_ute_laps_the_greybox_under_autopilot_without_a_wreck_and_no_faster_than_the_cruz() {
    let map = greybox();
    let lap_time = |profile: VehicleProfile| {
        let mut s = Sim::new(&map, &Registry::generic(), 5, profile);
        let car = s.spawn_grid(1)[0];
        s.start_race(3);
        s.set_autopilot(car, true);
        while !s.race().is_finished(car.0) && s.tick() < 400 * S {
            s.step();
        }
        let rc = s.race().car(car.0).unwrap();
        assert!(rc.finished_at.is_some(), "three laps in {} s", s.tick() / S);
        assert_eq!(
            (s.race().laps_completed(car.0), rc.wrecks),
            (3, 0),
            "unaided"
        );
        s.tick() / S
    };
    let (ute, cruz) = (
        lap_time(VehicleProfile::tradie_ute()),
        lap_time(VehicleProfile::cruz()),
    );
    println!("three laps: ute {ute} s, cruz {cruz} s");
    assert!(
        ute >= cruz,
        "the ute is no faster round the loop than the Cruz ({ute} vs {cruz})"
    );
}

#[test]
fn the_ute_responds_to_throttle() {
    let map = greybox();
    let mut s = Sim::new(&map, &Registry::generic(), 9, VehicleProfile::tradie_ute());
    let car = s.spawn_grid(1)[0];
    s.start_race(3);
    for _ in 0..(6 * S) {
        s.set_input(
            car,
            DriveInput {
                throttle: i16::MAX,
                ..Default::default()
            },
        );
        s.step();
    }
    assert!(s.car_state(car).unwrap().forward_speed > 8.0);
}
