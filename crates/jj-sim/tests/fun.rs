//! br-gw74.13 (owner 2026-10-12, arcade fun pass): launch and speed for every roster vehicle, measured on the greybox
//! loop scaled 8x so its start straight is 1.4 km of flat tarmac. Full throttle from the grid, a light heading hold
//! keeps the car on the straight. Prints the numbers the receipt quotes; asserts the fun floor the pass set.

use std::path::{Path, PathBuf};

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::{DriveInput, Sim, TICK_HZ, VehicleProfile};

const GREYBOX: &str = include_str!("../../../maps/greybox-loop.json");
const DT: f32 = 1.0 / TICK_HZ as f32;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The greybox loop with its grid at the start of the 175 m first straight.
fn straight() -> LoadedMap {
    let mut v: serde_json::Value = serde_json::from_str(GREYBOX).unwrap();
    v["route"]["start"]["at"] = 0.into();
    load_json(
        serde_json::to_vec(&v).unwrap().as_slice(),
        &Registry::generic(),
    )
    .expect("the greybox validates")
}

/// Full throttle down the straight from the grid: (seconds to 100 km/h, m/s at 150 m, seconds to 150 m).
fn launch(map: &LoadedMap, profile: &VehicleProfile, boost: bool) -> (f32, f32, f32) {
    let mut sim = Sim::with_profiles(map, &Registry::generic(), 3, vec![profile.clone()]);
    let car = sim.spawn_grid_as(&[0])[0];
    sim.start_race(1);
    let x0 = sim.car_state(car).unwrap().position[0];
    let mut to_100 = f32::INFINITY;
    for i in 1..=(20 * TICK_HZ) {
        let s = sim.car_state(car).unwrap();
        // Hold the straight's heading (+x) and its centre line (z = 0).
        let err = (s.heading - std::f32::consts::FRAC_PI_2 + std::f32::consts::PI)
            .rem_euclid(std::f32::consts::TAU)
            - std::f32::consts::PI;
        let steer =
            ((-err * 3.0 + s.position[2] * 0.05) * 20_000.0).clamp(-12_000.0, 12_000.0) as i16;
        sim.set_input(
            car,
            DriveInput {
                throttle: i16::MAX,
                steer,
                boost,
                ..DriveInput::default()
            },
        );
        sim.step();
        let s = sim.car_state(car).unwrap();
        let t = i as f32 * DT;
        if to_100.is_infinite() && s.forward_speed >= 100.0 / 3.6 {
            to_100 = t;
        }
        if s.position[0] - x0 >= 150.0 {
            return (to_100, s.forward_speed, t);
        }
    }
    panic!("never reached 150 m");
}

/// Before the fun pass (the committed profiles at 79d206ab, measured by this test): (vehicle, 0-100 km/h s, km/h at 150 m).
/// The Tradie Ute never reached 100 km/h inside 150 m.
const BEFORE: [(&str, f32, f32); 2] = [
    ("cruz-missile", 8.38, 102.0),
    ("tradie-ute", f32::INFINITY, 91.0),
];

#[test]
fn every_vehicle_launches_hard_and_gets_fast() {
    let map = straight();
    for (name, profile) in VehicleProfile::roster(&root()).unwrap() {
        let (to_100, v150, t150) = launch(&map, &profile, false);
        let (b100, bv150, bt150) = launch(&map, &profile, true);
        println!(
            "{name}: 0-100 km/h {to_100:.2} s, 150 m in {t150:.2} s at {:.0} km/h; boosted 0-100 {b100:.2} s, 150 m in {bt150:.2} s at {:.0} km/h",
            v150 * 3.6,
            bv150 * 3.6
        );
        // The pass's floor (owner 2026-10-12): launch at least 30 % quicker, speed down the straight at least 20 % higher,
        // and boost is worth having off the line.
        if let Some(&(_, before_100, before_150)) = BEFORE.iter().find(|(n, ..)| *n == name) {
            assert!(
                to_100.is_finite() && to_100 <= (before_100 * 0.7).min(4.0),
                "{name}: 0-100 in {to_100:.2} s"
            );
            assert!(
                v150 * 3.6 >= before_150 * 1.2,
                "{name}: {:.0} km/h at 150 m",
                v150 * 3.6
            );
        }
        assert!(
            b100 <= to_100 * 0.8,
            "{name}: boost shortens the launch ({b100:.2} vs {to_100:.2} s)"
        );
    }
}
