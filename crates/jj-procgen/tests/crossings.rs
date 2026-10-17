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
    // Only this test's gate within the 2 s the car drives (a neighbouring gate would count too).
    raw.route
        .gates
        .retain(|g| g.at == at as u32 || (g.at as usize).abs_diff(at) > 16);
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
            // A short (plain) eight has no room for its set pieces, and the ladder drops a biome before it gives up the
            // set-piece minimum (R132 over R125's random biome count, P1-FL15c): that keeps the family, so it's allowed.
            assert!(
                prepared.map.header.biomes.len() == recipe.len()
                    || matches!(prepared.plan, jj_procgen::validate::Plan::Shorter(_)),
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
    let eight = data();
    // An ordinary family's loop-over crossings (br-xlvx.10.2) as well as the figure eight's.
    let mut flowing = GeneratorData::shipped().clone();
    for p in PresetName::ALL {
        flowing
            .course
            .presets
            .set_weight(p, f64::from(p == PresetName::Flowing));
    }
    let reg = jj_procgen::registry();
    let roster = jj_sim::VehicleProfile::roster(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."),
    )
    .expect("the roster loads");
    let mut rows = Vec::new();
    let all = vec![
        Biome::Town,
        Biome::Rocks,
        Biome::OutbackDirt,
        Biome::OutbackBitumen,
    ];
    for (d, recipe) in [
        (&eight, vec![Biome::Town]),
        (&eight, vec![Biome::Rocks]),
        (&eight, vec![Biome::OutbackDirt]),
        (&eight, vec![Biome::OutbackBitumen]),
        (&eight, all.clone()),
        (&flowing, vec![Biome::Rocks]),
        (&flowing, all.clone()),
    ] {
        // Every roster vehicle (br-xlvx.10: bots of every roster vehicle lap both levels), each on its own seed of the
        // recipe so the bank covers several courses: from seed `vi % 3`, the first that crosses itself (a loop-over lap
        // crosses on most seeds, not all; the crossing-rate bank above measures that).
        for (vi, (vehicle, profile)) in roster.iter().enumerate() {
            let (seed, prepared) = (vi as u64 % 3..vi as u64 % 3 + 20)
                .map(|seed| (seed, jj_procgen::prepare_tuned(seed, &recipe, 8, d)))
                .find(|(_, p)| {
                    p.map.features.iter().any(|f| {
                        f.kind == FeatureKind::Bridge
                            || jj_map::setpiece::GapLeap::of(f).is_some_and(|g| g.lower.is_some())
                    })
                })
                .expect("a lap that crosses itself in 20 seeds");
            assert!(prepared.valid, "{recipe:?} {seed}: {:?}", prepared.attempts);
            let map =
                jj_map::load_canonical(&jj_map::canonical_bytes(&prepared.map), &reg).unwrap();
            let profile = profile.clone();
            let mut sim = jj_sim::Sim::new(&map, &reg, seed, profile.clone());
            let car = sim.spawn_grid(1)[0];
            sim.start_race(1);
            sim.set_autopilot(car, true);
            // Every crossing's two levels and where they actually cross (a bridge's or an overpass leap's).
            let crossings: Vec<[usize; 2]> = map
                .map
                .features
                .iter()
                .filter_map(|f| {
                    let (upper, lower) = if let Some(b) = jj_map::bridge::BridgeDesign::of(f) {
                        (
                            jj_map::bridge::indices(&map.map, b.upper)?,
                            jj_map::bridge::indices(&map.map, b.lower)?,
                        )
                    } else {
                        let g = jj_map::setpiece::GapLeap::of(f)?;
                        let (a, b) = g.lower?;
                        let span =
                            |from, to| jj_map::bridge::indices(&map.map, jj_map::Span { from, to });
                        (span(g.from, g.to)?, span(a, b)?)
                    };
                    let (a, b) = jj_map::bridge::crossing_point(&map.map, &upper, &lower)?;
                    Some([a, b])
                })
                .collect();
            assert!(!crossings.is_empty(), "{recipe:?} {seed}: no crossing");
            let mut seen = vec![[false; 2]; crossings.len()];
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
                let n = map.map.route.points.len();
                for (c, points) in crossings.iter().enumerate() {
                    for (level, &at) in points.iter().enumerate() {
                        // Driven: within a few route points of the crossing. A leap's upper level is flown, not driven:
                        // being over its crossing point counts.
                        let near = (p + n - at) % n <= 3 || (at + n - p) % n <= 3;
                        // On that level: a wheel down, or (a fast car hops through) within half a deck's clearance
                        // of its road's height, which the other level is not.
                        let on_level = st.wheels_in_contact > 0
                            || (st.position[1] - map.map.route.points[at].y as f32 / 1000.0).abs()
                                <= jj_map::bridge::limits::MIN_CLEARANCE_MM as f32 / 2000.0;
                        if near && (on_level || (level == 0 && p == at)) {
                            seen[c][level] = true;
                        }
                    }
                }
            }
            let race = sim.race().car(car.0).unwrap();
            eprintln!(
                "{vehicle} {recipe:?} seed {seed}: ticks {} seen {seen:?}, recoveries {}, wrecks {}",
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
            assert!(
                race.finished_at.is_some(),
                "{vehicle} {recipe:?} {seed} stalled"
            );
            assert_eq!(
                (race.recoveries, race.wrecks),
                (0, 0),
                "{vehicle} {recipe:?} {seed}"
            );
            assert!(
                seen.iter().all(|s| *s == [true, true]),
                "{vehicle} {recipe:?} {seed}: every crossing's both levels physically driven: {seen:?}"
            );
            let replay = jj_sim::Sim::replay(&map, &reg, profile, sim.journal(), sim.tick());
            assert_eq!(sim.state_hash(), replay.state_hash());
            rows.push(serde_json::json!({"vehicle":vehicle,"seed":seed,"biomes":recipe,"ticks":sim.tick(),"seen":seen,"recoveries":race.recoveries,"wrecks":race.wrecks,"hash":jj_map::hex(&sim.state_hash())}));
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

/// br-xlvx.10 (P1-M-crossover-b): every course family crosses itself. Across 20 seeds per family (the four-biome
/// recipe), the share of laps with a crossing and the mean crossings per lap are reported; at least one lap in two crosses
/// itself, some twice or more, and every one validates.
#[test]
fn every_family_crosses_itself_on_one_lap_in_two_or_more() {
    let reg = jj_procgen::registry();
    let recipe = [
        Biome::Town,
        Biome::Rocks,
        Biome::OutbackDirt,
        Biome::OutbackBitumen,
    ];
    let seeds = if cfg!(debug_assertions) { 3u64 } else { 20 };
    let (mut laps, mut crossing, mut multi, mut leaps, mut bridges) =
        (0usize, 0usize, 0usize, 0usize, 0usize);
    let mut table = String::from("family laps crossing meanPerLap bridges leaps perLap\n");
    for family in PresetName::ALL {
        let mut d = GeneratorData::shipped().clone();
        for p in PresetName::ALL {
            d.course.presets.set_weight(p, f64::from(p == family));
        }
        let per: Vec<(usize, usize)> = (0..seeds)
            .map(|seed| {
                let prepared = jj_procgen::prepare_tuned(seed, &recipe, 8, &d);
                let report = jj_map::validate::validate(&prepared.map, &reg);
                assert!(
                    prepared.valid && report.ok,
                    "{family:?} seed {seed}: {:?}",
                    report.violations
                );
                let b = prepared
                    .map
                    .features
                    .iter()
                    .filter(|f| f.kind == FeatureKind::Bridge)
                    .count();
                let l = prepared
                    .map
                    .features
                    .iter()
                    .filter(|f| jj_map::setpiece::GapLeap::of(f).is_some_and(|g| g.lower.is_some()))
                    .count();
                (b, l)
            })
            .collect();
        let (fb, fl) = per.iter().fold((0, 0), |(b, l), &(x, y)| (b + x, l + y));
        bridges += fb;
        leaps += fl;
        let per: Vec<usize> = per.iter().map(|&(b, l)| b + l).collect();
        let with = per.iter().filter(|&&x| x > 0).count();
        laps += per.len();
        crossing += with;
        multi += per.iter().filter(|&&x| x >= 2).count();
        table.push_str(&format!(
            "{} {} {with} {:.2} {fb} {fl} {per:?}\n",
            family.name(),
            per.len(),
            per.iter().sum::<usize>() as f64 / per.len() as f64
        ));
    }
    eprintln!("{table}");
    if let Ok(dir) = std::env::var("JJ_EVIDENCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(format!("{dir}/crossings-per-family.txt"), &table).unwrap();
    }
    assert!(
        2 * crossing >= laps,
        "{crossing} of {laps} laps cross themselves\n{table}"
    );
    if !cfg!(debug_assertions) {
        assert!(multi > 0, "no lap crosses itself twice or more\n{table}");
        // Both kinds appear (br-xlvx.10.3): a bridge where the roads cross shallow or a leap is refused, a leap where
        // they cross square enough.
        assert!(
            bridges > 0 && leaps > 0,
            "{bridges} bridges and {leaps} leaps\n{table}"
        );
    }
}

/// Why each square-enough crossing kept its bridge: per ordinary family, every bridge at a crossing at
/// `minCrossingDeg` or squarer, with the overpass leap's refusal.
#[test]
#[ignore]
fn diag_leap_refusals() {
    let recipe = [
        Biome::Town,
        Biome::Rocks,
        Biome::OutbackDirt,
        Biome::OutbackBitumen,
    ];
    for family in [
        PresetName::Twisty,
        PresetName::Flowing,
        PresetName::Speedway,
    ] {
        let mut d = GeneratorData::shipped().clone();
        for p in PresetName::ALL {
            d.course.presets.set_weight(p, f64::from(p == family));
        }
        for seed in 0..10 {
            let mut map = jj_procgen::prepare_tuned(seed, &recipe, 8, &d).map;
            let bridges: Vec<_> = map
                .features
                .iter()
                .enumerate()
                .filter_map(|(k, f)| jj_map::bridge::BridgeDesign::of(f).map(|b| (k, b)))
                .collect();
            for (k, b) in bridges.into_iter().rev() {
                let span = |s: jj_map::model::Span| (s.from as usize, s.to as usize);
                let bridge = map.features.remove(k);
                let r = jj_procgen::overpass::place(
                    &mut map,
                    span(b.upper),
                    span(b.lower),
                    jj_procgen::overpass::shipped(),
                );
                eprintln!(
                    "{family:?} seed {seed}: upper {:?} lower {:?}: {:?}",
                    span(b.upper),
                    span(b.lower),
                    r.as_ref().map(|_| "leap").map_err(|e| format!("{e:?}"))
                );
                map.features.insert(k, bridge);
            }
        }
    }
}

/// Why ordinary laps end without a crossing: per family, the first draw's rejections on laps that end with none
/// ("accepted" means the course itself was drawn without a loop-over).
#[test]
#[ignore]
fn diag_crossing_losses() {
    let recipe = [
        Biome::Town,
        Biome::Rocks,
        Biome::OutbackDirt,
        Biome::OutbackBitumen,
    ];
    for family in [
        PresetName::Twisty,
        PresetName::Flowing,
        PresetName::Speedway,
    ] {
        let mut d = GeneratorData::shipped().clone();
        for p in PresetName::ALL {
            d.course.presets.set_weight(p, f64::from(p == family));
        }
        let mut why: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
        for seed in 0..20u64 {
            let p = jj_procgen::prepare_tuned(seed, &recipe, 8, &d);
            let crossings = p
                .map
                .features
                .iter()
                .filter(|f| {
                    f.kind == FeatureKind::Bridge
                        || jj_map::setpiece::GapLeap::of(f).is_some_and(|g| g.lower.is_some())
                })
                .count();
            eprintln!(
                "{} {seed}: {crossings} crossings, plan {:?}, {} attempts",
                family.name(),
                p.plan,
                p.attempts.len()
            );
            if crossings == 0 {
                let first = &p.attempts[0].rejected;
                if first.is_empty() {
                    *why.entry("accepted".into()).or_default() += 1;
                }
                for r in first {
                    *why.entry(r.chars().take(60).collect()).or_default() += 1;
                }
            }
        }
        eprintln!("{}: {why:#?}", family.name());
    }
}

/// One draw's own story on ordinary laps: the course's loop-overs, the bridges and leaps laid, the set pieces placed and
/// why the rest weren't, and what the rhythm counts.
#[test]
#[ignore]
fn diag_crossing_draws() {
    let recipe = [
        Biome::Town,
        Biome::Rocks,
        Biome::OutbackDirt,
        Biome::OutbackBitumen,
    ];
    for family in [PresetName::Twisty, PresetName::Speedway] {
        let mut d = GeneratorData::shipped().clone();
        for p in PresetName::ALL {
            d.course.presets.set_weight(p, f64::from(p == family));
        }
        for seed in 0..8u64 {
            let Ok((map, r)) =
                jj_procgen::generate_tuned_from(jj_procgen::seed::Streams::new(seed), &recipe, &d)
            else {
                continue;
            };
            let bridges = map
                .features
                .iter()
                .filter(|f| f.kind == FeatureKind::Bridge)
                .count();
            let leaps = map
                .features
                .iter()
                .filter(|f| jj_map::setpiece::GapLeap::of(f).is_some_and(|g| g.lower.is_some()))
                .count();
            let rh = jj_procgen::rhythm::of(&map);
            eprintln!(
                "{} {seed}: len {:.0} corners {:?} bridges {bridges} leaps {leaps} loopOvers {:?} pieces {:?} rhythmSP {} rejects {:?} courseRejects {:?}",
                family.name(),
                r.length_m,
                r.corners,
                jj_procgen::rhythm::loop_overs(&map),
                r.set_pieces,
                rh.set_pieces,
                r.set_piece_rejects,
                r.rejects
            );
        }
    }
}

/// The course designer alone: per ordinary family, each seed's class, length, crossings and what the draws rejected.
#[test]
#[ignore]
fn diag_crossing_courses() {
    for family in [
        PresetName::Twisty,
        PresetName::Flowing,
        PresetName::Speedway,
    ] {
        let mut d = GeneratorData::shipped().clone();
        for p in PresetName::ALL {
            d.course.presets.set_weight(p, f64::from(p == family));
        }
        let mut with = 0;
        for seed in 0..20u64 {
            let mut st = jj_procgen::seed::Streams::new(seed);
            let c = jj_procgen::course::design_with(&mut st.structure, &d.course);
            with += usize::from(!c.crossings.is_empty());
            eprintln!(
                "{} {seed}: {:?} {:.0} m, {} crossings, rejects {:?}",
                family.name(),
                c.class,
                c.length_m,
                c.crossings.len(),
                c.rejects
            );
        }
        eprintln!("{}: {with}/20 courses cross", family.name());
    }
}

/// br-qwn9: the bot-lap case that wrecks (the postie bike on the Rocks figure eight, first crossing seed from 1), with
/// each assist, respawn and landing and where it happened, and the car's state every second for 5 s before it.
#[test]
#[ignore]
fn diag_postie_rocks_wreck() {
    let reg = jj_procgen::registry();
    let roster = jj_sim::VehicleProfile::roster(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."),
    )
    .expect("the roster loads");
    let (vehicle, profile) = roster
        .iter()
        .find(|(v, _)| v.as_str() == "postie-bike")
        .expect("postie")
        .clone();
    let seed = 1u64;
    let biome = if std::env::var("JJ_DIAG_DIRT").is_ok() {
        Biome::OutbackDirt
    } else {
        Biome::Rocks
    };
    let prepared = jj_procgen::prepare_tuned(seed, &[biome], 8, &data());
    for f in &prepared.map.features {
        if let Some(b) = jj_map::bridge::BridgeDesign::of(f) {
            let up = jj_map::bridge::indices(&prepared.map, b.upper).unwrap();
            let low = jj_map::bridge::indices(&prepared.map, b.lower).unwrap();
            eprintln!(
                "crossing at {:?}",
                jj_map::bridge::crossing_point(&prepared.map, &up, &low)
            );
        }
    }
    for f in &prepared.map.features {
        let near = prepared
            .map
            .route
            .points
            .iter()
            .enumerate()
            .min_by_key(|(_, q)| {
                let (dx, dz) = (i64::from(q.x - f.pose.x), i64::from(q.z - f.pose.z));
                dx * dx + dz * dz
            });
        eprintln!(
            "{vehicle}: {:?} near point {:?}",
            f.kind,
            near.map(|(i, _)| i)
        );
    }
    let map = jj_map::load_canonical(&jj_map::canonical_bytes(&prepared.map), &reg).unwrap();
    let mut sim = jj_sim::Sim::new(&map, &reg, seed, profile);
    let car = sim.spawn_grid(1)[0];
    sim.start_race(1);
    sim.set_autopilot(car, true);
    let route = jj_sim::observe::RouteGeom::new(&map.map);
    let mut seen = 0;
    let mut trail: std::collections::VecDeque<String> = Default::default();
    while !sim.race().is_finished(car.0) && sim.tick() < 400 * u64::from(jj_sim::TICK_HZ) {
        sim.step();
        let st = sim.car_state(car).unwrap();
        let p = route.progress_xyz(
            st.position[0] as f64,
            st.position[1] as f64,
            st.position[2] as f64,
        );
        if sim.tick().is_multiple_of(u64::from(jj_sim::TICK_HZ / 4)) {
            trail.push_back(format!(
                "  t {:.2} point {} lateral {:.1} y {:.2} speed {:.1} up {:.2} wheels {}",
                sim.tick() as f64 / f64::from(jj_sim::TICK_HZ),
                p.route_point,
                p.lateral_m,
                st.position[1],
                st.forward_speed,
                st.up_y,
                st.wheels_in_contact
            ));
            if trail.len() > 20 {
                trail.pop_front();
            }
        }
        let ev = sim.race().events();
        for (t, e) in &ev[seen..] {
            if !matches!(e, jj_sim::race::Event::GatePassed { .. }) {
                eprintln!(
                    "EVENT t {t} {e:?} at point {} lateral {:.1}",
                    p.route_point, p.lateral_m
                );
                if matches!(
                    e,
                    jj_sim::race::Event::AssistStarted { .. }
                        | jj_sim::race::Event::Respawned { .. }
                ) {
                    for l in &trail {
                        eprintln!("{l}");
                    }
                }
            }
        }
        seen = ev.len();
    }
}
