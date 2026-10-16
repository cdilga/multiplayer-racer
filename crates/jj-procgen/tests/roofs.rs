//! P1-PT-rooftop: actual town seed lots, canonical target identity and Rapier landings.
//! Seed 0's second lot regresses the nose strike at the old 2 m ramp-foot transition:
//! its full car must retain enough launch speed to reach the roof, with unchanged handling.
use jj_map::{Biome, canonical_bytes, load_canonical};
use jj_sim::{DriveInput, Sim, SpawnPose, VehicleProfile};

#[test]
fn town_seed_lots_are_reachable_clear_and_land_a_real_car() {
    let registry = jj_procgen::registry();
    let mut rows = Vec::new();
    let mut lots = 0;
    for seed in 0..10 {
        let map = jj_procgen::generate_recipe(seed, &[Biome::Town]).unwrap().0;
        let issues = jj_procgen::validate::check(&map, &registry);
        assert!(issues.is_empty(), "seed {seed}: {issues:?}");
        let loaded = load_canonical(&canonical_bytes(&map), &registry).unwrap();
        assert_eq!(canonical_bytes(&loaded.map), canonical_bytes(&map));
        let mut count = 0;
        for f in loaded
            .map
            .features
            .iter()
            .filter(|f| f.params.contains_key("roofTarget"))
        {
            lots += 1;
            count += 1;
            let house = &loaded.map.dressing[f.params["roofTarget"] as usize];
            assert!(jj_map::roof::problems(&loaded.map, f).is_empty());
            let mut broken = loaded.map.clone();
            broken.dressing[f.params["roofTarget"] as usize].pose.x += 60000;
            assert!(!jj_map::roof::problems(&broken, f).is_empty());
            let a = (f.pose.yaw as f32 / 100.0).to_radians();
            let (tx, tz) = (a.cos(), a.sin());
            let (bx, bz) = (f.pose.x as f32 / 1000.0, f.pose.z as f32 / 1000.0);
            let mut sim = Sim::new(&loaded, &registry, seed, VehicleProfile::cruz());
            let car = sim.spawn_grid(1)[0];
            for _ in 0..240 {
                sim.step();
            }
            let (x, z) = (bx - tx * 3.0, bz - tz * 3.0);
            sim.place_car(
                car,
                SpawnPose {
                    x,
                    z,
                    y: jj_map::jump::ground_height_m(&loaded.map.terrain, x as f64, z as f64)
                        as f32
                        + 0.1,
                    heading: std::f32::consts::FRAC_PI_2 - a,
                },
                0.0,
                [18.0 * tx, 0.0, 18.0 * tz],
            );
            let life = sim.car_life(car);
            let (mut air, mut landed, mut lip_speed) = (false, false, None);
            for _ in 0..720 {
                let c = sim.car_state(car).unwrap();
                let u = (c.position[0] - bx) * tx + (c.position[2] - bz) * tz;
                if u > 6.0 && c.wheels_in_contact == 0 {
                    air = true;
                    lip_speed.get_or_insert(c.linvel.iter().map(|v| v * v).sum::<f32>().sqrt());
                }
                landed |= air
                    && c.wheels_in_contact == 4
                    && c.up_y > 0.9
                    && jj_map::roof::height_m(house, c.position[0] as f64, c.position[2] as f64)
                        .is_some_and(|h| (c.position[1] as f64 - h).abs() < 1.0);
                sim.set_input(
                    car,
                    if air {
                        DriveInput {
                            brake: i16::MAX,
                            no_reverse: true,
                            ..Default::default()
                        }
                    } else {
                        DriveInput {
                            // About the drive force the approach was tuned with on the old 7 kN engine (br-gw74.13).
                            throttle: ((0.40 + (17.0 - c.forward_speed) * 0.1).clamp(0.0, 1.0)
                                * i16::MAX as f32) as i16,
                            ..Default::default()
                        }
                    },
                );
                sim.step();
            }
            let c = sim.car_state(car).unwrap();
            let on_roof = jj_map::roof::height_m(house, c.position[0] as f64, c.position[2] as f64)
                .is_some_and(|h| (c.position[1] as f64 - h).abs() < 1.0);
            assert!(
                air && landed && on_roof && c.wheels_in_contact == 4 && c.up_y > 0.9,
                "seed {seed} lot {count}: air={air} landed={landed} speed={lip_speed:?} final={c:?}"
            );
            assert_eq!(sim.car_life(car), life, "seed {seed}: unexpected recovery");
            assert_eq!(sim.husk_count(), 0);
            assert_eq!(sim.car_surface(car), Some(0));
            println!(
                "seed {seed} roof {count}: release {lip_speed:?} m/s, landed {:?}",
                c.position
            );
            if lots == 1
                && let (Ok(map_path), Ok(script_path)) = (
                    std::env::var("JJ_ROOF_MAP"),
                    std::env::var("JJ_ROOF_SCRIPT"),
                )
            {
                std::fs::write(
                    &map_path,
                    serde_json::to_string_pretty(&loaded.map).unwrap(),
                )
                .unwrap();
                let entries = &sim.journal().entries;
                let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../..")
                    .canonicalize()
                    .unwrap();
                let fixture_map = std::path::Path::new(&map_path)
                    .strip_prefix(&repo)
                    .unwrap_or(std::path::Path::new(&map_path));
                let inputs: Vec<serde_json::Value> = entries.iter().enumerate().map(|(i, e)| {
                        let end = entries.get(i + 1).map_or(sim.tick(), |next| next.tick);
                        serde_json::json!({"car":e.car,"fromTick":e.tick,"toTick":end,
                            "throttle":e.input.throttle as f64 / i16::MAX as f64,"steer":e.input.steer as f64 / i16::MAX as f64,
                            "brake":e.input.brake as f64 / i16::MAX as f64,"noReverse":e.input.no_reverse})
                    }).collect();
                let fixture = serde_json::json!({"scenario":"generated-roof-kicker","what":"P1-PT-rooftop: town seed 0's first real rooftop lot, full generated map and exact native/WASM replay",
                        "map":fixture_map,"seed":seed,"ticks":sim.tick(),"grid":1,
                        "place":[{"tick":240,"car":0,"pose":{"x":x,"y":jj_map::jump::ground_height_m(&loaded.map.terrain, x as f64, z as f64) as f32 + 0.1,"z":z,"headingDeg":(std::f32::consts::FRAC_PI_2-a).to_degrees()},"linvel":[18.0*tx,0,18.0*tz]}],
                        "inputs":inputs,"observe":[240,300,360,480,720,sim.tick()],"expect":[{"car":0,"metric":"husks","min":0,"max":0}]});
                std::fs::write(script_path, serde_json::to_string_pretty(&fixture).unwrap())
                    .unwrap();
            }
            let replay = Sim::replay(
                &loaded,
                &registry,
                VehicleProfile::cruz(),
                sim.journal(),
                sim.tick(),
            );
            assert_eq!(replay.state_hash(), sim.state_hash());
            rows.push(serde_json::json!({"seed":seed,"lot":count,"lipSpeedMps":lip_speed,"position":c.position,"upY":c.up_y,"wheels":c.wheels_in_contact}));
        }
        println!("town seed {seed}: {count} rooftop lots");
    }
    // 9 over this 10-seed sample (was 10): since route forks (P1-FL16a) a fork's branch takes the roadside one lot used
    // (Town seed 1: its 620 m fork, 3 lots -> 2; every other seed unchanged). More candidates (closer spacing, a farther
    // offset) find more lots, but some new ones stop on the roof with a wheel off its edge: that landing is br-amv3,
    // not this floor. 7 since P1-FL15c: Town laps draw no speedway (`familiesOffIn`: 49 s of one flow beat), and the
    // twisty streets seeds 4 and 7 draw instead have no straight long enough for their speedway's lots (1 + 3 -> 0;
    // seed 0 gains 2).
    assert!(
        lots >= 7,
        "ten town seeds must offer actual rooftop stunt access, got {lots}"
    );
    if let Ok(path) = std::env::var("JJ_ROOF_SEEDS") {
        std::fs::write(path, serde_json::to_string_pretty(&rows).unwrap()).unwrap();
    }
}

#[test]
fn roof_stunt_dimensions_are_tunable_and_invalid_values_are_refused() {
    let data = jj_procgen::tuning::GeneratorData::shipped();
    assert!(
        data.with_fields(&[("roofStunts.spacingM".into(), "0".into())])
            .is_err()
    );
    assert!(
        data.with_fields(&[("roofStunts.offsetStepM".into(), "-1".into())])
            .is_err()
    );
    assert!(
        data.with_fields(&[("roofStunts.offsetStepM".into(), "1e-300".into())])
            .is_err()
    );
    assert!(
        data.with_fields(&[("roofStunts.spacingM".into(), "240".into())])
            .is_ok()
    );
}
