//! P1-PT-rooftop: suspension sees the visible house roof, ground grip and ordinary recovery.
use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::{DriveInput, Sim, SpawnPose, VehicleProfile};

fn registry() -> Registry {
    Registry::from_json(
        jj_map::kit::GENERIC_PIECES
            .iter()
            .map(|(id, s)| (*id, s.as_bytes()))
            .chain([(
                "town/house",
                include_bytes!("../../../assets/kit/town/house.json").as_slice(),
            )]),
    )
}

fn yard(yaw: i32) -> LoadedMap {
    let mut map: serde_json::Value =
        serde_json::from_str(include_str!("../../../maps/greybox-loop.json")).unwrap();
    map["dressing"] = serde_json::json!([{
        "kitPiece":"town/house", "pose":{"x":50000,"y":0,"z":20000,"yaw":yaw},
        "params":{"widthMm":14000,"depthMm":10000,"heightCm":280,"roofPitchDeg":24}, "collides":true
    }]);
    map["props"] = serde_json::json!([]);
    load_json(&serde_json::to_vec(&map).unwrap(), &registry())
        .unwrap_or_else(|v| panic!("{:?}", v.violations))
}

fn kicker() -> LoadedMap {
    let mut data = serde_json::to_value(yard(0).map).unwrap();
    data["features"] = serde_json::json!([{
        "kind":"jump", "pose":{"x":26000,"y":0,"z":21000,"yaw":0},
        "params":{"sharp":1,"roofTarget":0,"designSpeedMmps":15000,"rampLengthMm":8000,
            "rampWidthMm":4000,"lipHeightCm":210,"blendMm":2000}
    }]);
    // A canonical map's stored hash belongs to its original data, not this authored fixture.
    data["header"]["gameplayHash"] = serde_json::Value::Null;
    load_json(&serde_json::to_vec(&data).unwrap(), &registry())
        .unwrap_or_else(|v| panic!("{:?}", v.violations))
}

#[test]
fn a_design_speed_kicker_lands_on_the_visible_roof_and_the_validator_rejects_an_unreachable_target()
{
    let map = kicker();
    if let Ok(path) = std::env::var("JJ_ROOF_FIXTURE") {
        std::fs::write(path, serde_json::to_string_pretty(&map.map).unwrap()).unwrap();
    }
    let mut invalid = map.map.clone();
    invalid.dressing[0].pose.x += 60000;
    invalid.header.gameplay_hash = None;
    let rejected = jj_map::validate(&invalid, &registry());
    assert!(
        rejected
            .violations
            .iter()
            .any(|v| v.rule == jj_map::Rule::RoofReach),
        "{:?}",
        rejected.violations
    );
    let mut sim = Sim::new(&map, &registry(), 21, VehicleProfile::cruz());
    let car = sim.spawn_car(SpawnPose {
        x: 10.0,
        y: 0.1,
        z: 0.0,
        heading: std::f32::consts::FRAC_PI_2,
    });
    for _ in 0..240 {
        sim.step();
    }
    sim.place_car(
        car,
        SpawnPose {
            x: 23.0,
            y: 0.1,
            z: 21.0,
            heading: std::f32::consts::FRAC_PI_2,
        },
        0.0,
        [18.0, 0.0, 0.0],
    );
    let life = sim.car_life(car);
    let mut air = false;
    let mut lip_speed = None;
    let mut landed = false;
    let mut samples = Vec::new();
    for tick in 0..720 {
        let c = sim.car_state(car).unwrap();
        if c.position[0] > 32.0 && c.wheels_in_contact == 0 {
            air = true;
            lip_speed.get_or_insert(c.linvel[0].hypot(c.linvel[1]));
        }
        landed |= air
            && c.wheels_in_contact == 4
            && (45.5..54.5).contains(&c.position[0])
            && c.position[1] > 1.9
            && c.up_y > 0.9;
        let input = if air {
            DriveInput {
                brake: i16::MAX,
                no_reverse: true,
                ..Default::default()
            }
        } else {
            DriveInput {
                // About the drive force the approach was tuned with (7 kN engine): under half the stick on the fun-pass 14 kN car.
                throttle: ((0.40 + (17.0 - c.forward_speed) * 0.1).clamp(0.0, 1.0) * i16::MAX as f32)
                    as i16,
                ..Default::default()
            }
        };
        sim.set_input(car, input);
        sim.step();
        if tick % 30 == 0 {
            samples.push((
                tick,
                c.position,
                c.forward_speed,
                c.up_y,
                c.wheels_in_contact,
            ));
        }
    }
    let c = sim.car_state(car).unwrap();
    assert!(
        lip_speed.is_some_and(|v| (14.5..15.5).contains(&v)),
        "actual design-speed release: {lip_speed:?}"
    );
    println!(
        "roof kicker {}",
        serde_json::json!({"seed":21,"designSpeedMps":15,"lipSpeedMps":lip_speed,"landed":landed,"position":c.position,"upY":c.up_y,"wheels":c.wheels_in_contact,"ticks":720,"stateHash":format!("{:?}",sim.state_hash())})
    );
    assert!(
        air && landed
            && c.wheels_in_contact == 4
            && c.position[1] > 1.9
            && (45.5..54.5).contains(&c.position[0]),
        "lip {lip_speed:?}, final {c:?}, samples {samples:?}"
    );
    assert_eq!(sim.car_life(car), life, "no wreck/recovery while landing");
    assert_eq!(sim.husk_count(), 0);
    assert_eq!(sim.car_surface(car), Some(0));
    if let Ok(path) = std::env::var("JJ_ROOF_SCRIPT") {
        let entries = &sim.journal().entries;
        let inputs: Vec<serde_json::Value> = entries.iter().enumerate().map(|(i, e)| {
            let end = entries.get(i + 1).map_or(sim.tick(), |next| next.tick);
            serde_json::json!({"car":e.car,"fromTick":e.tick,"toTick":end,
                "throttle":e.input.throttle as f64 / i16::MAX as f64,"steer":e.input.steer as f64 / i16::MAX as f64,
                "brake":e.input.brake as f64 / i16::MAX as f64,"noReverse":e.input.no_reverse})
        }).collect();
        let fixture = serde_json::json!({"scenario":"roof-kicker","what":"P1-PT-rooftop: real 15m/s release lands/stops on visible gable; exact native/WASM replay",
            "map":"scenarios/roofs/kicker-map.json","seed":21,"ticks":sim.tick(),"cars":[{"pose":{"x":10,"y":0.1,"z":0,"headingDeg":90}}],
            "place":[{"tick":240,"car":0,"pose":{"x":23,"y":0.1,"z":21,"headingDeg":90},"linvel":[18,0,0]}],
            "inputs":inputs,"observe":[240,300,360,480,720,sim.tick()],"expect":[{"car":0,"metric":"husks","min":0,"max":0}]});
        std::fs::write(path, serde_json::to_string_pretty(&fixture).unwrap()).unwrap();
    }
    let replay = Sim::replay(
        &map,
        &registry(),
        VehicleProfile::cruz(),
        sim.journal(),
        sim.tick(),
    );
    assert_eq!(replay.state_hash(), sim.state_hash());
}

#[test]
fn suspension_hits_the_gable_and_verandah_instead_of_a_full_height_box() {
    for yaw in [0, 9000, 21000] {
        let map = yard(yaw);
        let mut sim = Sim::new(&map, &registry(), 19, VehicleProfile::cruz());
        sim.step();
        let angle = -(yaw as f32 / 100.0).to_radians();
        for (z, height) in [
            (-0.11, 2.8),
            (-0.3, 2.8 * (0.6 + 0.4 * 0.2 / 0.39)),
            (0.4, 2.8 * (0.56 - 0.09 * 0.16 / 0.26)),
        ] {
            let local_z = z * 10.0;
            let (x, z) = (50.0 + angle.sin() * local_z, 20.0 + angle.cos() * local_z);
            let got = sim.ground_height(x, z, 8.0).unwrap();
            assert!(
                (got - height).abs() < 0.03,
                "yaw {yaw}: {got} vs visible roof {height}"
            );
        }
    }
}

#[test]
fn an_unprotected_car_lands_stays_on_the_roof_and_drives_off() {
    let map = yard(0);
    let mut sim = Sim::new(&map, &registry(), 20, VehicleProfile::cruz());
    let car = sim.spawn_car(SpawnPose {
        x: 50.0,
        y: 0.1,
        z: 0.0,
        heading: std::f32::consts::FRAC_PI_2,
    });
    for _ in 0..240 {
        sim.step();
    }
    assert!(!sim.is_protected(car));
    sim.place_car(
        car,
        SpawnPose {
            x: 50.0,
            y: 2.6,
            z: 21.0,
            heading: std::f32::consts::FRAC_PI_2,
        },
        (2.8_f32 * 0.4 / 3.9).atan(),
        [0.0; 3],
    );
    let life = sim.car_life(car);
    sim.set_input(
        car,
        DriveInput {
            brake: i16::MAX,
            no_reverse: true,
            ..Default::default()
        },
    );
    for _ in 0..480 {
        sim.step();
    }
    let landed = sim.car_state(car).unwrap();
    assert_eq!(landed.wheels_in_contact, 4);
    assert!(landed.position[1] > 1.9 && landed.up_y > 0.9);
    assert_eq!(sim.car_life(car), life);
    assert_eq!(sim.husk_count(), 0);
    assert_eq!(
        sim.car_surface(car),
        Some(0),
        "roof is ground grip over off-track terrain"
    );
    sim.set_input(
        car,
        DriveInput {
            throttle: i16::MAX,
            ..Default::default()
        },
    );
    let mut left = false;
    let mut samples = Vec::new();
    for t in 0..600 {
        sim.step();
        let c = sim.car_state(car).unwrap();
        left |= c.position[0] > 59.0 && c.position[1] < 1.0;
        if t % 60 == 0 {
            samples.push((
                t,
                c.position,
                c.forward_speed,
                c.wheels_in_contact,
                sim.car_life(car),
            ));
        }
    }
    assert!(
        left,
        "car drives off the edge under its own input: {samples:?}"
    );
    // Ordinary off-course recovery: stop on the ground, wait its normal eligibility window, then
    // press Recover. No special roof-respawn path or teleport to a made-up roof anchor.
    sim.set_input(
        car,
        DriveInput {
            brake: i16::MAX,
            no_reverse: true,
            ..Default::default()
        },
    );
    for _ in 0..600 {
        sim.step();
    }
    assert!(sim.recover(car));
    sim.step(); // Replay applies setup commands before the next stepped tick.
    assert_eq!(sim.car_life(car), life.map(|n| n + 1));
    assert!(sim.is_protected(car));
    let at = sim.car_state(car).unwrap().position;
    assert!(
        at[2].abs() < 2.0 && at[1] < 1.0,
        "normal road anchor {at:?}"
    );
    let replay = Sim::replay(
        &map,
        &registry(),
        VehicleProfile::cruz(),
        sim.journal(),
        sim.tick(),
    );
    assert_eq!(replay.state_hash(), sim.state_hash());
}

#[test]
fn respawn_clearance_keeps_the_full_house_footprint_after_roof_decomposition() {
    use jj_sim::placement::{Rect, overlaps};
    let map = yard(0);
    let mut sim = Sim::new(&map, &registry(), 22, VehicleProfile::cruz());
    // Direct R90 setup puts the original anchor above a house. The normal recovery service must
    // still reject its whole footprint, including the verandah and space below the ridge.
    let car = sim.spawn_car(SpawnPose {
        x: 50.0,
        y: 3.5,
        z: 20.0,
        heading: std::f32::consts::FRAC_PI_2,
    });
    sim.place_car(
        car,
        SpawnPose {
            x: 70.0,
            y: 0.1,
            z: 0.0,
            heading: std::f32::consts::FRAC_PI_2,
        },
        0.0,
        [0.0; 3],
    );
    for _ in 0..480 {
        sim.step();
    }
    assert!(sim.recover(car));
    let house = Rect {
        x: 50.0,
        z: 20.0,
        heading: 0.0,
        half_w: 7.0,
        half_l: 5.0,
    };
    assert!(
        !overlaps(&sim.footprint(car).unwrap(), &house),
        "the whole footprint, not just the separate walls/roof panels"
    );
    sim.step();
    let replay = Sim::replay(
        &map,
        &registry(),
        VehicleProfile::cruz(),
        sim.journal(),
        sim.tick(),
    );
    assert_eq!(replay.state_hash(), sim.state_hash());
}
