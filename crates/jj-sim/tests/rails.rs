//! Collision-driven W-beam compliance: native scenario sweep, journal replay and passive spring energy.
use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::damage::PartState;
use jj_sim::{CarId, DriveInput, Journal, Sim, SpawnPose, VehicleProfile};

fn registry() -> Registry {
    Registry::from_json(
        jj_map::kit::GENERIC_PIECES
            .iter()
            .map(|(id, s)| (*id, s.as_bytes()))
            .chain([(
                "wayfinding/guard-rail",
                include_bytes!("../../jj-procgen/kit/wayfinding/guard-rail.json").as_slice(),
            )]),
    )
}

fn yard() -> LoadedMap {
    load_json(
        include_bytes!("../../../scenarios/rails/yard.json"),
        &registry(),
    )
    .expect("rail yard validates")
}

#[test]
fn rail_profile_validates_and_passive_deflection_returns_without_creating_energy() {
    let p = jj_sim::rails::RailProfile::standard();
    assert!(p.validate().is_ok());
    let mut invalid = p;
    invalid.stiffness_n_per_m_per_m = f32::NAN;
    assert!(invalid.validate().is_err());
    let map = yard();
    let mut sim = Sim::new(&map, &registry(), 91, VehicleProfile::cruz());
    let before = sim.state_hash();
    assert!(sim.set_rail(0, 0.5, 0.0));
    assert_ne!(
        sim.state_hash(),
        before,
        "rail motion belongs to the full-state hash"
    );
    assert!(!sim.set_rail(99, 0.0, 0.0));
    assert!(!sim.set_rail(0, f32::NAN, 0.0));
    let initial = sim.energy_j().0;
    assert!(
        initial > 20_000.0,
        "stored spring energy is counted: {initial}"
    );
    for _ in 0..600 {
        sim.step();
        assert!(
            sim.energy_j().0 <= initial + 2.0,
            "passive spring creates no energy"
        );
        assert!(sim.rail_states()[0].displacement_m.abs() < p.travel_m + 0.01);
    }
    assert!(
        sim.rail_states()[0].displacement_m.abs() < 0.002,
        "return state: {:?}",
        sim.rail_states()
    );
    let journal = Journal::from_bytes(&sim.journal().to_bytes()).unwrap();
    let replay = Sim::replay(
        &map,
        &registry(),
        VehicleProfile::cruz(),
        &journal,
        sim.tick(),
    );
    assert_eq!(replay.state_hash(), sim.state_hash());
}

#[test]
fn bolted_neighbours_spread_a_setup_deflection_and_return_passively() {
    let map = load_json(
        include_bytes!("../../../scenarios/rails/corner-map.json"),
        &registry(),
    )
    .unwrap();
    let mut sim = Sim::new(&map, &registry(), 92, VehicleProfile::cruz());
    assert!(sim.set_rail(7, 0.5, 0.0));
    let initial = sim.energy_j().0;
    let mut neighbour_peak = 0.0_f32;
    for _ in 0..600 {
        sim.step();
        assert!(
            sim.energy_j().0 <= initial + 2.0,
            "bolted springs create no energy"
        );
        let states = sim.rail_states();
        neighbour_peak = neighbour_peak.max(states[6].displacement_m.abs());
        assert!(
            states
                .iter()
                .all(|r| r.displacement_m.abs() < r.travel_m + 0.01)
        );
    }
    assert!(
        neighbour_peak > 0.01,
        "a join spreads the displacement into its neighbour"
    );
    assert!(
        sim.rail_states()
            .iter()
            .all(|r| r.displacement_m.abs() < 0.002)
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
fn speed_angle_sweep_moves_the_rail_without_losing_car_parts() {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Sweep {
        speeds_mps: Vec<f32>,
        angles_deg: Vec<f32>,
        ticks: u32,
        boost_entry_mps: f32,
        travel_tolerance_m: f32,
        min_measured_deflection_m: f32,
    }
    let bank: Sweep =
        serde_json::from_str(include_str!("../../../scenarios/rails/contact-sweep.json")).unwrap();
    let map = yard();
    let mut rows = Vec::new();
    for speed in bank.speeds_mps {
        for &degrees in &bank.angles_deg {
            let seed = 10_000 + (speed as u64) * 100 + degrees as u64;
            let mut sim = Sim::new(&map, &registry(), seed, VehicleProfile::cruz());
            let car = sim.spawn_car(SpawnPose {
                x: -60.0,
                y: 0.1,
                z: -20.0,
                heading: 0.0,
            });
            for _ in 0..240 {
                sim.step();
            }
            assert!(!sim.is_protected(car));
            let a = degrees.to_radians();
            // The rail runs along +x at z=-20. Approach its centre from the -z side.
            let velocity = [speed * a.cos(), 0.0, speed * a.sin()];
            let half = VehicleProfile::cruz().chassis_half();
            let normal_extent = half[0] * a.cos() + half[2] * a.sin();
            let gap = 0.02;
            sim.place_car(
                car,
                SpawnPose {
                    x: -40.0 - gap / a.tan(),
                    y: 0.05,
                    z: -20.0 - 0.15 - normal_extent - gap,
                    heading: (90.0 - degrees).to_radians(),
                },
                0.0,
                velocity,
            );
            let full = sim.part_health(car).unwrap();
            let life = sim.car_life(car);
            if speed == bank.boost_entry_mps {
                sim.set_input(
                    car,
                    DriveInput {
                        throttle: i16::MAX,
                        boost: true,
                        ..Default::default()
                    },
                );
            }
            let mut peak = 0.0_f32;
            let mut boosting = false;
            for _ in 0..bank.ticks {
                sim.step();
                boosting |= sim.action_state(car).unwrap().boosting;
                peak = peak.max(sim.rail_states()[0].displacement_m.abs());
                assert!(
                    peak < sim.rail_states()[0].travel_m + bank.travel_tolerance_m,
                    "seed {seed}, speed {speed}, angle {degrees}: travel {peak}"
                );
                assert_eq!(
                    sim.part_health(car).unwrap(),
                    full,
                    "seed {seed}: rail costs no health"
                );
                assert!(
                    sim.part_states(car)
                        .unwrap()
                        .iter()
                        .all(|s| *s == PartState::Intact),
                    "seed {seed}: intact"
                );
                assert_eq!(
                    sim.car_life(car),
                    life,
                    "seed {seed}: no rail-induced wreck or recovery"
                );
                assert_eq!(sim.husk_count(), 0, "seed {seed}: no wreck");
            }
            let replay = Sim::replay(
                &map,
                &registry(),
                VehicleProfile::cruz(),
                sim.journal(),
                sim.tick(),
            );
            assert_eq!(replay.state_hash(), sim.state_hash(), "seed {seed}: replay");
            assert!(
                peak > bank.min_measured_deflection_m,
                "seed {seed}, speed {speed}, angle {degrees}: the sweep must hit the rail, not miss it"
            );
            if speed == bank.boost_entry_mps {
                assert!(
                    boosting,
                    "seed {seed}: the full-boost sample actually boosts"
                );
            }
            rows.push(serde_json::json!({"seed": seed, "speedMps": speed, "angleDeg": degrees, "peakDeflectionM": peak,
                "position": sim.car_state(CarId(0)).unwrap().position, "boosting": boosting,
                "parts": sim.part_health(car), "husks": sim.husk_count()}));
        }
    }
    assert!(
        rows.iter()
            .any(|r| r["peakDeflectionM"].as_f64().unwrap() > 0.02),
        "collision must actually move a rail"
    );
    if let Ok(path) = std::env::var("JJ_RAIL_RECEIPT") {
        std::fs::write(path, serde_json::to_string_pretty(&rows).unwrap() + "\n").unwrap();
    }
}

#[test]
fn compliant_corner_and_low_speed_use_have_intact_replayable_outcomes() {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Corner {
        name: String,
        seed: u64,
        speed_mps: f32,
        throttle: i16,
        steer: i16,
        release_tick: u32,
        ticks: u32,
        max_speed_mps: f32,
    }
    let bank: Vec<Corner> =
        serde_json::from_str(include_str!("../../../scenarios/rails/corners.json")).unwrap();
    let mut rows = Vec::new();
    for case in bank {
        for mode in ["compliant", "rigid", "absent"] {
            let mut map_data: serde_json::Value =
                serde_json::from_slice(include_bytes!("../../../scenarios/rails/corner-map.json"))
                    .unwrap();
            if mode == "absent" {
                map_data["dressing"] = serde_json::json!([]);
            }
            let map = load_json(&serde_json::to_vec(&map_data).unwrap(), &registry()).unwrap();
            let mut sim = Sim::new(&map, &registry(), case.seed, VehicleProfile::cruz());
            if mode == "rigid" {
                for r in sim.rail_states() {
                    sim.set_rail_fixed(r.dressing, true);
                }
            }
            let car = sim.spawn_car(SpawnPose {
                x: -70.0,
                y: 0.1,
                z: -30.0,
                heading: 0.0,
            });
            for _ in 0..240 {
                sim.step();
            }
            sim.place_car(
                car,
                SpawnPose {
                    x: -58.0,
                    y: 0.05,
                    z: -42.0,
                    heading: std::f32::consts::FRAC_PI_2,
                },
                0.0,
                [case.speed_mps, 0.0, 0.0],
            );
            let health = sim.part_health(car).unwrap();
            let life = sim.car_life(car);
            let mut peak = 0.0_f32;
            let mut peak_speed = 0.0_f32;
            let mut exit = None;
            for tick in 0..case.ticks {
                sim.set_input(
                    car,
                    DriveInput {
                        throttle: case.throttle,
                        steer: if tick < case.release_tick {
                            case.steer
                        } else {
                            0
                        },
                        ..Default::default()
                    },
                );
                sim.step();
                let c = sim.car_state(car).unwrap();
                peak_speed = peak_speed.max(c.forward_speed.abs());
                peak = sim
                    .rail_states()
                    .iter()
                    .map(|r| r.displacement_m.abs())
                    .fold(peak, f32::max);
                assert_eq!(
                    sim.part_health(car).unwrap(),
                    health,
                    "{} {mode}: intact health",
                    case.name
                );
                assert_eq!(
                    sim.car_life(car),
                    life,
                    "{} {mode}: no recovery/wreck",
                    case.name
                );
                assert_eq!(sim.husk_count(), 0);
                if c.position[2] > -10.0 && exit.is_none() {
                    exit = Some((tick, c.position, c.heading, c.forward_speed));
                }
            }
            let replay = Sim::replay(
                &map,
                &registry(),
                VehicleProfile::cruz(),
                sim.journal(),
                sim.tick(),
            );
            assert_eq!(
                replay.state_hash(),
                sim.state_hash(),
                "{} {mode}: exact journal replay",
                case.name
            );
            let completed =
                exit.is_some_and(|(_, p, h, _)| (-34.0..=-26.0).contains(&p[0]) && h.abs() < 0.25);
            let row = serde_json::json!({"case":case.name,"mode":mode,"exit":exit,"completed":completed,"peakDeflectionM":peak,"peakSpeedMps":peak_speed,
                "position":sim.car_state(car).unwrap().position,"heading":sim.car_state(car).unwrap().heading});
            println!("corner {row}");
            if mode == "compliant" {
                assert!(
                    peak > 0.025,
                    "{}: uses the rail, rather than missing it",
                    case.name
                );
                assert!(
                    completed,
                    "{}: leaves the 90-degree corner facing along its road: {row}",
                    case.name
                );
                assert!(
                    peak_speed <= case.max_speed_mps,
                    "{}: actual low-speed/design-speed envelope: {row}",
                    case.name
                );
            } else if case.name == "give-prevents-spinout" {
                assert!(
                    !completed,
                    "comparison must fail on the same scripted inputs: {row}"
                );
                if mode == "rigid" {
                    assert!(
                        exit.is_some_and(|(_, p, h, _)| p[0] < -34.0 && h < -0.8),
                        "rigid rail spins the car away from the exit: {row}"
                    );
                }
            }
            rows.push(row);
        }
    }
    if let Ok(path) = std::env::var("JJ_RAIL_CORNER_RECEIPT") {
        std::fs::write(path, serde_json::to_string_pretty(&rows).unwrap() + "\n").unwrap();
    }
}
