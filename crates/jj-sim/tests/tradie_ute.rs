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
    // 3 s, not 6: the fun-pass ute (br-gw74.13) reaches the end of the greybox's straight inside 6 s with no steering.
    for _ in 0..(3 * S) {
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

/// br-gw74.13.1 (owner 2026-10-12: "the triton needs to make use of its bigger mass when it's in collisions, survive
/// better (has a bullbar)"): a 10 m/s head-on between the ute and a Cruz on the damage yard. The ute keeps rolling
/// forward and shoves the Cruz back, and its bullbar front loses a smaller share of its health than the Cruz's front.
#[test]
fn the_ute_wins_a_head_on_with_the_cruz_and_its_bullbar_takes_less_damage() {
    let yard = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../scenarios/damage/yard.json"
    ))
    .unwrap();
    let map = load_json(yard.as_bytes(), &Registry::generic()).expect("the damage yard validates");
    let mut s = Sim::with_profiles(
        &map,
        &Registry::generic(),
        1,
        vec![VehicleProfile::cruz(), VehicleProfile::tradie_ute()],
    );
    // Spawn in the open and wait out spawn protection (as the damage bank does), then place them nose to nose.
    let wait = |x: f32| jj_sim::SpawnPose {
        x,
        y: 0.1,
        z: -20.0,
        heading: 0.0,
    };
    let (cruz, ute) = (
        s.spawn_car_as(wait(-60.0), 0),
        s.spawn_car_as(wait(-48.0), 1),
    );
    for _ in 0..(2 * S) {
        s.step();
    }
    let at = |x: f32, heading_deg: f32| jj_sim::SpawnPose {
        x,
        y: 0.05,
        z: -30.0,
        heading: heading_deg.to_radians(),
    };
    s.place_car(ute, at(20.0, 90.0), 0.0, [10.0, 0.0, 0.0]);
    s.place_car(cruz, at(26.0, 270.0), 0.0, [-10.0, 0.0, 0.0]);
    let front = jj_sim::damage::part_index("front").unwrap();
    let share = |s: &Sim, car| s.part_health(car).unwrap()[front];
    let (ute0, cruz0) = (share(&s, ute), share(&s, cruz));
    for _ in 0..(S / 2) {
        s.step();
    }
    let (u, c) = (s.car_state(ute).unwrap(), s.car_state(cruz).unwrap());
    let ute_lost = 1.0 - share(&s, ute) / ute0;
    let cruz_lost = 1.0 - share(&s, cruz) / cruz0;
    println!(
        "0.5 s after a 10 m/s head-on: ute forward {:.2} m/s, front lost {:.0} %; cruz forward {:.2} m/s, front lost {:.0} %",
        u.forward_speed,
        ute_lost * 100.0,
        c.forward_speed,
        cruz_lost * 100.0
    );
    assert!(cruz_lost > 0.0, "the hit damaged the Cruz's front");
    assert!(
        u.forward_speed > 0.5,
        "the ute keeps rolling forward: {:.2}",
        u.forward_speed
    );
    assert!(
        c.forward_speed < 0.0,
        "the Cruz is shoved back: {:.2}",
        c.forward_speed
    );
    assert!(
        u.forward_speed > c.forward_speed,
        "the ute keeps more speed"
    );
    assert!(
        ute_lost < cruz_lost,
        "the bullbar front loses less: ute {ute_lost:.2}, cruz {cruz_lost:.2}"
    );
    assert!(u.up_y > 0.9 && c.up_y > 0.9, "both stay on their wheels");
}
