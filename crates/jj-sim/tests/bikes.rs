//! br-bwju.4: bike parts use the real persistent-debris/R121 path, not car aliases.
use jj_map::{Registry, load_json};
use jj_sim::damage::{DamageEvent, PartState, WreckWhy};
use jj_sim::{Sim, SpawnPose, TICK_HZ, VehicleProfile};

fn bike() -> VehicleProfile {
    VehicleProfile::from_json(include_str!("../../../scenarios/bikes/profile.json")).unwrap()
}

#[test]
fn rider_and_wheel_damage_leave_dynamic_debris_and_a_fresh_bike() {
    let map = load_json(
        include_bytes!("../../../scenarios/damage/yard.json"),
        &Registry::generic(),
    )
    .unwrap();
    let p = bike();
    let mut sim = Sim::new(&map, &Registry::generic(), 21, p.clone());
    let car = sim.spawn_car(SpawnPose {
        x: -60.0,
        y: 0.1,
        z: -20.0,
        heading: 0.0,
    });
    for _ in 0..2 * TICK_HZ {
        sim.step();
    }
    let rider = p.part_index("rider").unwrap() as u8;
    sim.set_part_health(car, rider, 20.0);
    assert_eq!(sim.part_state(car, "rider"), Some(PartState::Loose));
    sim.set_part_health(car, rider, 0.0);
    for _ in 0..10 {
        sim.step();
    }
    assert_eq!(sim.part_state(car, "rider"), Some(PartState::Detached));
    assert!(
        sim.prop_kinds()
            .iter()
            .enumerate()
            .any(|(i, _)| sim.debris_part(i) == Some((car, "rider")))
    );
    assert_eq!(sim.race().car(car.0).unwrap().wrecks, 0);
    sim.set_part_health(car, p.wheel_part(0) as u8, 0.0);
    let grace = (p.tuning.damage.wheel_loss_respawn_s * TICK_HZ as f32).round() as u64;
    for _ in 0..grace - 2 {
        sim.step();
    }
    assert_eq!(sim.race().car(car.0).unwrap().wrecks, 0);
    for _ in 0..4 {
        sim.step();
    }
    assert_eq!(sim.race().car(car.0).unwrap().wrecks, 1);
    assert!(
        sim.part_states(car)
            .unwrap()
            .iter()
            .all(|s| *s == PartState::Intact)
    );
    assert!((sim.car_mass(car).unwrap() - p.tuning.mass).abs() < 0.01);
    assert!(sim.damage_events().iter().any(|(_, e)| matches!(
        e,
        DamageEvent::Wrecked {
            why: WreckWhy::WheelLoss,
            ..
        }
    )));
    let junk = sim.prop_kinds().len();
    for _ in 0..10 * TICK_HZ {
        sim.step();
    }
    assert_eq!(sim.prop_kinds().len(), junk);
    for i in 0..junk {
        assert_eq!(sim.debris_dynamic(i), Some(true));
    }
    let replay = Sim::replay(&map, &Registry::generic(), p, sim.journal(), sim.tick());
    assert_eq!(sim.state_hash(), replay.state_hash());
}

#[test]
fn malformed_axles_and_missing_wheel_proxies_are_rejected_before_simulation() {
    let source: serde_json::Value =
        serde_json::from_str(include_str!("../../../scenarios/bikes/profile.json")).unwrap();
    for wheels in [serde_json::json!([]), serde_json::json!([[0, 0.32, 0.8]])] {
        let mut v = source.clone();
        v["geometry"]["wheels"] = wheels;
        assert!(VehicleProfile::from_json(&v.to_string()).is_err());
    }
    let mut v = source;
    v["geometry"]["parts"].as_array_mut().unwrap().pop();
    assert!(VehicleProfile::from_json(&v.to_string()).is_err());
}

#[test]
fn raw_stick_and_named_damage_fixtures_replay_through_the_shared_harness() {
    let map = load_json(
        include_bytes!("../../../scenarios/bikes/flat-strips.json"),
        &Registry::generic(),
    )
    .unwrap();
    for source in [
        include_str!("../../../scenarios/bikes/controls.json"),
        include_str!("../../../scenarios/bikes/damage.json"),
    ] {
        let fx = serde_json::from_str(source).unwrap();
        let run = jj_fixture::run(&fx, &map, &Registry::generic(), &bike(), false).unwrap();
        assert!(run.ok(), "{:?}", run.recorded.checks);
        assert!(run.replay_matches());
    }
}

#[test]
fn a_bike_wall_collision_charges_its_own_damage_proxies_and_replays() {
    let map = load_json(
        include_bytes!("../../../scenarios/damage/yard.json"),
        &Registry::generic(),
    )
    .unwrap();
    let p = bike();
    let mut sim = Sim::new(&map, &Registry::generic(), 22, p.clone());
    let car = sim.spawn_car(SpawnPose {
        x: 15.0,
        y: 0.1,
        z: -30.0,
        heading: std::f32::consts::FRAC_PI_2,
    });
    sim.place_car(
        car,
        SpawnPose {
            x: 15.0,
            y: 0.1,
            z: -30.0,
            heading: std::f32::consts::FRAC_PI_2,
        },
        0.0,
        [25.0, 0.0, 0.0],
    );
    for _ in 0..3 * TICK_HZ {
        sim.step();
    }
    assert!(sim.damage_events().iter().any(|(_, e)| matches!(e, DamageEvent::Episode(r) if r.car == car.0 && r.damage > 0.0 && usize::from(r.part) < p.part_count())), "a real collider contact damages a bike part");
    let replay = Sim::replay(&map, &Registry::generic(), p, sim.journal(), sim.tick());
    assert_eq!(sim.state_hash(), replay.state_hash());
}
