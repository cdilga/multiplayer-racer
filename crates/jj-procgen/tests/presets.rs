//! br-xlvx.7: actual seeded corner/straight character, not preset labels alone.
use jj_procgen::{
    course,
    seed::Rng,
    tuning::{GeneratorData, PresetName},
};
use serde_json::json;

#[test]
fn preset_seed_bank_reports_geometry() {
    let mut rows = Vec::new();
    let mut means = Vec::new();
    for name in [
        PresetName::Twisty,
        PresetName::Flowing,
        PresetName::Speedway,
    ] {
        let mut data = GeneratorData::shipped().clone();
        for n in PresetName::ALL {
            data.course.presets.set_weight(n, f64::from(n == name));
        }
        data.validate().unwrap();
        let (mut fallback, mut length, mut straight, mut tight, mut chicanes) = (0, 0.0, 0.0, 0, 0);
        let (mut straight_sum, mut straight_count) = (0.0, 0);
        let mut rejects = std::collections::BTreeMap::<&str, u32>::new();
        for seed in 0..100 {
            let c = course::design_with(&mut Rng::stream(seed, "structure"), &data.course);
            assert_eq!(c.preset, name);
            // Clear of itself except where it crosses itself by design (br-xlvx.10's loop-overs).
            assert!(course::clear_except(&c.points, &c.crossings));
            let band = data.course.classes.get(c.class);
            assert!((band.length_min_m..=band.length_max_m).contains(&c.length_m));
            // On Town, unless Town never draws the family (`familiesOffIn`, P1-FL15c): then on Greybox.
            let biome = if data
                .course
                .families_off_in
                .get("town")
                .is_some_and(|fs| fs.contains(&name))
            {
                jj_map::Biome::Greybox
            } else {
                jj_map::Biome::Town
            };
            let (map, report) = jj_procgen::generate_tuned_from(
                jj_procgen::seed::Streams::new(seed),
                &[biome],
                &data,
            )
            .unwrap();
            assert_eq!(report.preset, name);
            let valid = jj_map::validate(&map, &jj_procgen::registry());
            assert!(
                valid.ok,
                "{} seed {seed}: {:?}",
                name.name(),
                valid.violations
            );
            let h = c
                .corners
                .iter()
                .filter(|c| c.kind == course::CornerKind::Hairpin)
                .count();
            let k = c
                .corners
                .iter()
                .filter(|c| c.kind == course::CornerKind::Chicane)
                .count();
            let longest = c.straights.iter().copied().fold(0.0, f64::max);
            fallback += usize::from(c.fallback);
            length += c.length_m;
            straight += longest;
            straight_sum += c.straights.iter().sum::<f64>();
            straight_count += c.straights.len();
            tight += h + k;
            chicanes += k;
            for (why, n) in &c.rejects {
                *rejects.entry(why).or_default() += n;
            }
            rows.push(json!({"preset":name,"seed":seed,"lengthM":c.length_m,"longestStraightM":longest,"straightsM":c.straights,"corners":report.corners,"hairpins":h,"chicanes":k,"fallback":c.fallback,"attempts":c.attempts}));
        }
        eprintln!(
            "{}: fallbacks {fallback}; mean longest straight {:.1} m; tight/km {:.3}; chicanes {chicanes}; rejects {rejects:?}",
            name.name(),
            straight / 100.0,
            tight as f64 / (length / 1000.0)
        );
        assert!(
            fallback <= 2,
            "{}: fallback must stay rare ({fallback}/100)",
            name.name()
        );
        means.push((
            straight_sum / straight_count as f64,
            tight as f64 / (length / 1000.0),
        ));
    }
    // Envelope margins describe observable geometry, so renaming an identical
    // generator as three families cannot pass this bank.
    assert!(
        means[2].0 >= means[0].0 * 1.35,
        "speedway straights: {means:?}"
    );
    assert!(
        means[1].0 >= means[0].0 * 1.1,
        "flowing straights: {means:?}"
    );
    assert!(
        means[0].1 >= means[1].1 * 3.0,
        "twisty tight corners/km: {means:?}"
    );
    assert!(
        means[1].1 >= means[2].1 * 5.0,
        "speedway tight corners/km: {means:?}"
    );
    if let Ok(dir) = std::env::var("JJ_EVIDENCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            format!("{dir}/presets.json"),
            serde_json::to_string_pretty(&rows).unwrap(),
        )
        .unwrap();
    }
}

#[test]
fn each_preset_autopilot_laps_each_biome_across_seeds_and_replays() {
    let mut rows = Vec::new();
    let registry = jj_procgen::registry();
    for name in [
        PresetName::Twisty,
        PresetName::Flowing,
        PresetName::Speedway,
    ] {
        let mut data = GeneratorData::shipped().clone();
        for n in PresetName::ALL {
            data.course.presets.set_weight(n, f64::from(n == name));
        }
        for biome in [
            jj_map::Biome::Town,
            jj_map::Biome::Rocks,
            jj_map::Biome::OutbackDirt,
            jj_map::Biome::OutbackBitumen,
        ] {
            for seed in 0..3 {
                let (raw, report) = jj_procgen::generate_tuned_from(
                    jj_procgen::seed::Streams::new(seed),
                    &[biome],
                    &data,
                )
                .unwrap();
                let map =
                    jj_map::load_canonical(&jj_map::canonical_bytes(&raw), &registry).unwrap();
                let profile = jj_sim::VehicleProfile::cruz();
                let mut sim = jj_sim::Sim::new(&map, &registry, seed, profile.clone());
                let car = sim.spawn_grid(1)[0];
                sim.start_race(1);
                sim.set_autopilot(car, true);
                let mut min_up = 1.0f32;
                while !sim.race().is_finished(car.0)
                    && sim.tick() < 400 * u64::from(jj_sim::TICK_HZ)
                {
                    sim.step();
                    min_up = min_up.min(sim.car_state(car).unwrap().up_y);
                }
                let race = sim.race().car(car.0).unwrap();
                eprintln!(
                    "{} {biome:?} seed {seed}: {} ticks, upY {min_up}, recoveries {}, wrecks {}",
                    name.name(),
                    sim.tick(),
                    race.recoveries,
                    race.wrecks
                );
                assert!(
                    race.finished_at.is_some(),
                    "{} {biome:?} seed {seed} stalled",
                    name.name()
                );
                assert_eq!(
                    (race.recoveries, race.wrecks),
                    (0, 0),
                    "{} {biome:?} seed {seed}",
                    name.name()
                );
                assert!(min_up > 0.5, "{} {biome:?} seed {seed} rolled", name.name());
                let replay =
                    jj_sim::Sim::replay(&map, &registry, profile, sim.journal(), sim.tick());
                assert_eq!(sim.state_hash(), replay.state_hash());
                rows.push(json!({"preset":name,"biome":biome,"seed":seed,"ticks":sim.tick(),"minUpY":min_up,"recoveries":race.recoveries,"wrecks":race.wrecks,"courseFallback":report.fallback,"stateHash":jj_map::hex(&sim.state_hash())}));
            }
        }
    }
    if let Ok(dir) = std::env::var("JJ_EVIDENCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            format!("{dir}/laps.json"),
            serde_json::to_string_pretty(&rows).unwrap(),
        )
        .unwrap();
    }
}
