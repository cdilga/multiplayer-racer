//! Actual generated crossings, through the normal validator, sim, and journal replay.
use jj_map::{Biome, FeatureKind};
use jj_procgen::tuning::{GeneratorData, PresetName};

fn data() -> GeneratorData {
    let mut d = GeneratorData::shipped().clone();
    for p in PresetName::ALL {
        d.course
            .presets
            .set_weight(p, f64::from(p == PresetName::FigureEight));
    }
    d
}

#[test]
fn bitumen_marks_both_crossing_roads_and_keeps_upper_paint_on_the_deck() {
    let map = jj_procgen::prepare_tuned(4, &[Biome::OutbackBitumen], 8, &data()).map;
    let design = map
        .features
        .iter()
        .find_map(jj_map::bridge::BridgeDesign::of)
        .unwrap();
    let upper = jj_map::bridge::indices(&map, design.upper).unwrap();
    let paint: Vec<_> = map
        .dressing
        .iter()
        .filter(|d| d.kit_piece == "outback_bitumen/centre-line")
        .collect();
    let lower = jj_map::bridge::indices(&map, design.lower).unwrap();
    let (mut deck_marks, mut lower_marks) = (0, 0);
    // A mark belongs to the road nearest it in 3D: the deck's marks to an upper-span point (the terrain is tens of metres
    // high since P1-FL15a, so height above zero says nothing).
    let p3 = |p: &jj_map::RoutePoint, d: &jj_map::Pose| {
        i64::from(p.x - d.x).pow(2) + i64::from(p.y - d.y).pow(2) + i64::from(p.z - d.z).pow(2)
    };
    for d in &paint {
        let nearest = (0..map.route.points.len())
            .min_by_key(|&i| p3(&map.route.points[i], &d.pose))
            .unwrap();
        if upper.contains(&nearest) {
            let at = &map.route.points[nearest];
            assert_eq!(
                d.pose.y,
                at.y + (jj_procgen::lineside::ROAD_SURFACE_LIFT_M * 1000.0).round() as i32
            );
            deck_marks += 1;
        } else if lower.contains(&nearest) {
            lower_marks += 1;
        }
    }
    assert!(
        deck_marks > 0,
        "upper crossing must retain painted lane markings"
    );
    assert!(lower_marks > 0, "lower road must retain its markings too");
}

#[test]
fn dirt_seed16_bridge_has_drivable_edges_without_a_redraw() {
    let reg = jj_procgen::registry();
    let (map, _) = jj_procgen::generate_recipe(16, &[Biome::OutbackDirt]).unwrap();
    if let Ok(dir) = std::env::var("JJ_EVIDENCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            format!("{dir}/dirt-seed16.json"),
            serde_json::to_vec_pretty(&map).unwrap(),
        )
        .unwrap();
    }
    let report = jj_map::validate(&map, &reg);
    assert!(report.ok, "{:?}", report.violations);
}

#[test]
fn takeover_observation_and_tyre_grip_choose_the_physical_layer() {
    let reg = jj_procgen::registry();
    let mut raw = jj_procgen::prepare_tuned(0, &[Biome::Town], 8, &data()).map;
    let f = raw
        .features
        .iter()
        .find(|f| f.kind == FeatureKind::Bridge)
        .unwrap();
    let d = jj_map::bridge::BridgeDesign::of(f).unwrap();
    let upper = jj_map::bridge::indices(&raw, d.upper).unwrap();
    let lower = jj_map::bridge::indices(&raw, d.lower).unwrap();
    // Deliberately unlike materials at the same XZ, through the actual collider hit.
    raw.terrain.surfaces.fill(jj_map::Surface::PackedDirt);
    for p in &mut raw.route.points {
        p.surface = jj_map::Surface::PackedDirt;
    }
    for &i in &upper {
        raw.route.points[i].surface = jj_map::Surface::Tarmac;
    }
    let map = jj_map::load_canonical(&jj_map::canonical_bytes(&raw), &reg).unwrap();
    let route = jj_sim::observe::RouteGeom::new(&map.map);
    for (span, material) in [(&upper, 0), (&lower, 1)] {
        let at = span[span.len() / 2];
        let mut sim = jj_sim::Sim::new(&map, &reg, 0, jj_sim::VehicleProfile::cruz());
        let car = sim.spawn_car(jj_sim::sim::route_spawn(&map, at, 0.0, 0.3));
        for _ in 0..120 {
            sim.step();
        }
        let state = sim.car_state(car).unwrap();
        assert_eq!(state.wheels_in_contact, 4);
        assert_eq!(sim.car_surface(car), Some(material));
        let p = route.progress_xyz(
            state.position[0] as f64,
            state.position[1] as f64,
            state.position[2] as f64,
        );
        assert!(
            span.contains(&(p.route_point as usize)),
            "observation selected the other layer"
        );
        sim.set_autopilot(car, true);
        sim.step();
        assert!(
            span.contains(&(sim.autopilot_state(car).unwrap().route_point as usize)),
            "takeover selected the other layer"
        );
    }
}

#[test]
fn driving_under_a_bridge_gate_cannot_count_as_passing_it() {
    for height in [3.4, 6.5] {
        check_bridge_gate(height);
    }
}

fn check_bridge_gate(height: f64) {
    let reg = jj_procgen::registry();
    let mut tuning = data();
    tuning.course.crossing.deck_height_m = height;
    tuning.course.crossing.clearance_mm = 3000;
    let mut raw = jj_procgen::prepare_tuned(0, &[Biome::Town], 8, &tuning).map;
    let f = raw
        .features
        .iter()
        .find(|f| f.kind == FeatureKind::Bridge)
        .unwrap();
    let d = jj_map::bridge::BridgeDesign::of(f).unwrap();
    let ix = jj_map::bridge::indices(&raw, d.upper).unwrap();
    let at = ix[ix.len() / 2];
    for g in &mut raw.route.gates {
        g.finish = false;
    }
    if let Some(g) = raw.route.gates.iter_mut().find(|g| g.at == at as u32) {
        g.finish = true;
    } else {
        raw.route.gates.push(jj_map::Gate {
            at: at as u32,
            finish: true,
        });
    }
    raw.route.start.at = at as u32;
    let map = jj_map::load_canonical(&jj_map::canonical_bytes(&raw), &reg).unwrap();
    let anchor = jj_sim::sim::route_spawn(&map, at, 0.0, 0.3);
    let (dx, dz) = (libm::sinf(anchor.heading), libm::cosf(anchor.heading));
    for (upper, expected) in [(true, 1), (false, 0)] {
        let (x, z) = (anchor.x - 2.0 * dx, anchor.z - 2.0 * dz);
        let y = if upper {
            anchor.y
        } else {
            jj_procgen::terrain::ground_height_m(&map.map.terrain, x as f64, z as f64) as f32 + 0.3
        };
        let mut sim = jj_sim::Sim::new(&map, &reg, 0, jj_sim::VehicleProfile::cruz());
        let pose = jj_sim::journal::SpawnPose {
            x,
            y,
            z,
            heading: anchor.heading,
        };
        let car = sim.spawn_car(pose);
        sim.place_car(car, pose, 0.0, [6.0 * dx, 0.0, 6.0 * dz]);
        sim.start_race(1);
        for _ in 0..120 {
            sim.step();
        }
        assert_eq!(
            sim.race().car(car.0).unwrap().gates_passed,
            expected,
            "upper={upper}"
        );
    }
}

#[test]
fn generated_crossing_bank_validates_without_flattening_or_discarding_the_family() {
    let d = data();
    let reg = jj_procgen::registry();
    let mut rows = Vec::new();
    for recipe in [
        vec![Biome::Town],
        vec![Biome::Rocks],
        vec![Biome::OutbackDirt],
        vec![Biome::OutbackBitumen],
        vec![
            Biome::Town,
            Biome::Rocks,
            Biome::OutbackDirt,
            Biome::OutbackBitumen,
        ],
    ] {
        for seed in 0..20 {
            let prepared = jj_procgen::prepare_tuned(seed, &recipe, 8, &d);
            assert!(
                prepared.valid,
                "seed {seed} {recipe:?}: {:?}",
                prepared.attempts
            );
            assert_eq!(prepared.course.preset, PresetName::FigureEight);
            assert_eq!(
                prepared.map.header.biomes.len(),
                recipe.len(),
                "seed {seed} lost a biome: {:?}",
                prepared.attempts
            );
            assert!(
                prepared
                    .map
                    .features
                    .iter()
                    .any(|f| f.kind == FeatureKind::Bridge)
            );
            let loaded =
                jj_map::load_canonical(&jj_map::canonical_bytes(&prepared.map), &reg).unwrap();
            let bad = jj_procgen::validate::check(&loaded.map, &reg);
            assert!(bad.is_empty(), "seed {seed} {recipe:?}: {bad:?}");
            rows.push(serde_json::json!({"seed":seed,"biomes":recipe,"lengthM":prepared.course.length_m,"plan":format!("{:?}",prepared.plan),"hash":jj_map::hex(&jj_map::gameplay_hash(&loaded.map))}));
            if seed == 0
                && recipe == vec![Biome::Town]
                && let Ok(dir) = std::env::var("JJ_EVIDENCE_DIR")
            {
                std::fs::create_dir_all(&dir).unwrap();
                std::fs::write(
                    format!("{dir}/crossing-town-seed0.json"),
                    serde_json::to_vec_pretty(&loaded.map).unwrap(),
                )
                .unwrap();
            }
        }
    }
    if let Ok(dir) = std::env::var("JJ_EVIDENCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            format!("{dir}/crossing-bank.json"),
            serde_json::to_vec_pretty(&rows).unwrap(),
        )
        .unwrap();
    }
}

#[test]
fn bots_lap_both_levels_without_recovery_and_replay_exactly() {
    let d = data();
    let reg = jj_procgen::registry();
    let mut rows = Vec::new();
    for recipe in [
        vec![Biome::Town],
        vec![Biome::Rocks],
        vec![Biome::OutbackDirt],
        vec![Biome::OutbackBitumen],
        vec![
            Biome::Town,
            Biome::Rocks,
            Biome::OutbackDirt,
            Biome::OutbackBitumen,
        ],
    ] {
        for seed in 0..3 {
            let prepared = jj_procgen::prepare_tuned(seed, &recipe, 8, &d);
            assert!(prepared.valid, "{recipe:?} {seed}: {:?}", prepared.attempts);
            let map =
                jj_map::load_canonical(&jj_map::canonical_bytes(&prepared.map), &reg).unwrap();
            let profile = jj_sim::VehicleProfile::cruz();
            let mut sim = jj_sim::Sim::new(&map, &reg, seed, profile.clone());
            let car = sim.spawn_grid(1)[0];
            sim.start_race(1);
            sim.set_autopilot(car, true);
            let bridge = map
                .map
                .features
                .iter()
                .find(|f| f.kind == FeatureKind::Bridge)
                .unwrap();
            let shape = jj_map::bridge::BridgeDesign::of(bridge).unwrap();
            let upper = jj_map::bridge::indices(&map.map, shape.upper).unwrap();
            let lower = jj_map::bridge::indices(&map.map, shape.lower).unwrap();
            let mut seen = [false; 2];
            let route = jj_sim::observe::RouteGeom::new(&map.map);
            while !sim.race().is_finished(car.0) && sim.tick() < 400 * u64::from(jj_sim::TICK_HZ) {
                sim.step();
                let st = sim.car_state(car).unwrap();
                let p = route
                    .progress_xyz(
                        st.position[0] as f64,
                        st.position[1] as f64,
                        st.position[2] as f64,
                    )
                    .route_point as usize;
                for (i, span) in [&upper, &lower].iter().enumerate() {
                    if p == span[span.len() / 2] && st.wheels_in_contact > 0 {
                        seen[i] = true;
                    }
                }
            }
            let race = sim.race().car(car.0).unwrap();
            eprintln!(
                "{recipe:?} seed {seed}: ticks {} seen {seen:?}, recoveries {}, wrecks {}",
                sim.tick(),
                race.recoveries,
                race.wrecks
            );
            if race.finished_at.is_none() {
                eprintln!(
                    "uncompleted crossing: gates {}, last {:?}; car {:?}; autopilot {:?}",
                    race.gates_passed,
                    race.last_gate,
                    sim.car_state(car),
                    sim.autopilot_state(car)
                );
            }
            assert!(race.finished_at.is_some(), "{recipe:?} {seed} stalled");
            assert_eq!((race.recoveries, race.wrecks), (0, 0), "{recipe:?} {seed}");
            assert_eq!(seen, [true, true], "both crossing layers physically driven");
            let replay = jj_sim::Sim::replay(&map, &reg, profile, sim.journal(), sim.tick());
            assert_eq!(sim.state_hash(), replay.state_hash());
            rows.push(serde_json::json!({"seed":seed,"biomes":recipe,"ticks":sim.tick(),"seen":seen,"recoveries":race.recoveries,"wrecks":race.wrecks,"hash":jj_map::hex(&sim.state_hash())}));
        }
    }
    if let Ok(dir) = std::env::var("JJ_EVIDENCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            format!("{dir}/crossing-laps.json"),
            serde_json::to_vec_pretty(&rows).unwrap(),
        )
        .unwrap();
    }
}
