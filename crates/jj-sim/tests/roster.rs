//! br-bwju.7 (R123): the vehicle is a per-car choice driven by roster data. Every car is built from and driven by its own
//! profile; a mixed roster replays bit for bit; and adding a vehicle is data only (a roster row and a profile file).

use std::path::{Path, PathBuf};

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::{CarId, DriveInput, Sim, TICK_HZ, VehicleProfile};

const GREYBOX: &str = include_str!("../../../maps/greybox-loop.json");
const S: u64 = TICK_HZ as u64;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn greybox() -> LoadedMap {
    load_json(GREYBOX.as_bytes(), &Registry::generic()).expect("the greybox validates")
}

fn roster() -> Vec<(String, VehicleProfile)> {
    VehicleProfile::roster(&root()).expect("the roster and its profiles load")
}

/// A mixed grid: the roster's vehicles round-robin over `n` cars, all driving.
fn mixed(n: usize, ticks: u64) -> (Sim, Vec<CarId>) {
    let profiles: Vec<VehicleProfile> = roster().into_iter().map(|(_, p)| p).collect();
    let k = profiles.len();
    let mut sim = Sim::with_profiles(&greybox(), &Registry::generic(), 11, profiles);
    let models: Vec<usize> = (0..n).map(|i| i % k).collect();
    let cars = sim.spawn_grid_as(&models);
    sim.start_race(1);
    for (i, &c) in cars.iter().enumerate() {
        sim.set_input(
            c,
            DriveInput {
                throttle: i16::MAX,
                steer: (i as i16 % 3 - 1) * 4000,
                ..DriveInput::default()
            },
        );
    }
    for _ in 0..ticks {
        sim.step();
    }
    (sim, cars)
}

#[test]
fn every_roster_vehicle_has_a_profile_and_an_art_folder() {
    let r = roster();
    assert!(!r.is_empty());
    for (id, _) in &r {
        assert!(
            root().join("art/vehicles").join(id).is_dir(),
            "{id}: no art/vehicles/{id}"
        );
    }
}

#[test]
fn each_car_is_built_from_and_driven_by_its_own_profile() {
    let r = roster();
    let (sim, cars) = mixed(2 * r.len(), 4 * S);
    for (i, &c) in cars.iter().enumerate() {
        let (_, want) = &r[i % r.len()];
        assert_eq!(sim.vehicle_of(c), Some(i % r.len()));
        let got = sim.profile_of(c).unwrap();
        assert_eq!(got.tuning.mass, want.tuning.mass);
        assert_eq!(got.tuning.max_engine_force, want.tuning.max_engine_force);
        // The body Rapier built has the profile's mass (a car's body takes it when it spawns).
        let mass = sim.car_mass(c).unwrap();
        assert!(
            (mass - want.tuning.mass).abs() < want.tuning.mass * 0.02,
            "car {i}: mass {mass} vs profile {}",
            want.tuning.mass
        );
    }
    // Different vehicles drive differently from the same grid inputs: not all cars of two vehicles ended alike.
    if r.len() > 1 {
        let a = sim.car_state(cars[0]).unwrap().forward_speed;
        let b = sim.car_state(cars[1]).unwrap().forward_speed;
        assert!(
            (a - b).abs() > 0.05,
            "vehicles 0 and 1 drove identically: {a} {b}"
        );
    }
}

#[test]
fn tuning_one_vehicle_changes_only_its_cars() {
    let r = roster();
    if r.len() < 2 {
        return;
    }
    let (mut sim, cars) = mixed(4, 0);
    let mut t = sim.profile_at(1).unwrap().tuning.clone();
    t.max_engine_force *= 2.0;
    sim.set_tuning_for(1, t.clone());
    for (i, &c) in cars.iter().enumerate() {
        let f = sim.profile_of(c).unwrap().tuning.max_engine_force;
        if i % r.len() == 1 {
            assert_eq!(f, t.max_engine_force);
        } else {
            assert_eq!(f, r[i % r.len()].1.tuning.max_engine_force);
        }
    }
}

#[test]
fn a_mixed_roster_replays_bit_for_bit() {
    let r = roster();
    let (sim, _) = mixed(2 * r.len() + 1, 6 * S);
    let profiles: Vec<VehicleProfile> = r.into_iter().map(|(_, p)| p).collect();
    let replayed = Sim::replay_with(
        &greybox(),
        &Registry::generic(),
        profiles,
        sim.journal(),
        sim.tick(),
    );
    assert_eq!(sim.state_hash(), replayed.state_hash());
    let again = Sim::replay_with(
        &greybox(),
        &Registry::generic(),
        VehicleProfile::roster(&root())
            .unwrap()
            .into_iter()
            .map(|(_, p)| p)
            .collect(),
        &jj_sim::Journal::from_bytes(&sim.journal().to_bytes()).unwrap(),
        sim.tick(),
    );
    assert_eq!(
        sim.state_hash(),
        again.state_hash(),
        "through the journal's bytes"
    );
}

/// Adding a vehicle is data only: a copy of the roster with one more row and its profile file builds and drives a car.
#[test]
fn a_fixture_vehicle_added_as_data_drives() {
    let dir = std::env::temp_dir().join(format!("jj-roster-fixture-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("web/shared/src")).unwrap();
    std::fs::create_dir_all(dir.join("assets/profiles")).unwrap();
    let mut roster: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root().join("web/shared/src/roster.json")).unwrap(),
    )
    .unwrap();
    for (id, _) in self::roster() {
        std::fs::copy(
            root().join(format!("assets/profiles/{id}.json")),
            dir.join(format!("assets/profiles/{id}.json")),
        )
        .unwrap();
    }
    roster["cars"].as_array_mut().unwrap().push(serde_json::json!(
        { "id": "fixture-van", "name": "Fixture Van", "cls": "Test", "blurb": "", "shape": "wagon", "stats": [1, 1, 1, 1] }
    ));
    std::fs::write(dir.join("web/shared/src/roster.json"), roster.to_string()).unwrap();
    let mut van: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root().join("assets/profiles/tradie-ute.json")).unwrap(),
    )
    .unwrap();
    van["vehicle"] = "fixture-van".into();
    van["tuning"]["mass"] = 4321.0.into();
    std::fs::write(
        dir.join("assets/profiles/fixture-van.json"),
        van.to_string(),
    )
    .unwrap();

    let all = VehicleProfile::roster(&dir).unwrap();
    let (id, p) = all.last().unwrap();
    assert_eq!(id, "fixture-van");
    let profiles: Vec<VehicleProfile> = all.iter().map(|(_, p)| p.clone()).collect();
    let mut sim = Sim::with_profiles(&greybox(), &Registry::generic(), 3, profiles);
    let car = sim.spawn_car_as(sim.grid_pose(0), all.len() - 1);
    for _ in 0..S {
        sim.step();
    }
    assert_eq!(sim.profile_of(car).unwrap().tuning.mass, p.tuning.mass);
    assert!((sim.car_mass(car).unwrap() - 4321.0).abs() < 100.0);
    let _ = std::fs::remove_dir_all(&dir);
}
