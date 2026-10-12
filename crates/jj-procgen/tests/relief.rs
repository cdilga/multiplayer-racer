//! br-xlvx.4: measured route relief and grade distributions, followed by real autopilot lap/replay acceptance.
#![cfg(not(target_arch = "wasm32"))]

use jj_map::{Biome, Map, canonical_bytes, load_canonical};
use jj_procgen::{seed::Streams, tuning::GeneratorData};
use jj_sim::{Sim, TICK_HZ, VehicleProfile};

fn seeds() -> u64 {
    std::env::var("JJ_SEEDS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(12)
}

fn previous() -> GeneratorData {
    GeneratorData::shipped()
        .with_fields(&[
            ("biomes.rocks.terrain.reliefM".into(), "10".into()),
            ("biomes.rocks.terrain.groundReliefM".into(), "10".into()),
            ("biomes.rocks.terrain.wavelengthM".into(), "80".into()),
            ("biomes.rocks.terrain.maxGrade".into(), "0.06".into()),
            ("biomes.rocks.terrain.maxCurvature".into(), "0.004".into()),
        ])
        .unwrap()
}

fn metrics(map: &Map) -> (f64, f64, f64, f64) {
    let lo = map.route.points.iter().map(|p| p.y).min().unwrap();
    let hi = map.route.points.iter().map(|p| p.y).max().unwrap();
    let mut grades: Vec<f64> = (0..map.route.points.len())
        .map(|i| {
            let a = &map.route.points[i];
            let b = &map.route.points[(i + 1) % map.route.points.len()];
            let run = libm::hypot(f64::from(b.x - a.x), f64::from(b.z - a.z));
            f64::from(b.y - a.y).abs() / run
        })
        .collect();
    grades.sort_by(f64::total_cmp);
    (
        (hi - lo) as f64 / 1000.0,
        grades[grades.len() / 2],
        grades[grades.len() * 95 / 100],
        *grades.last().unwrap(),
    )
}

#[test]
fn height_and_grade_distribution_by_biome() {
    let n = seeds();
    let shipped = GeneratorData::shipped();
    let previous = previous();
    let (mut old, mut new) = (0.0, 0.0);
    let mut rows = String::from("seed biome build reliefM p50GradePct p95GradePct maxGradePct\n");
    for seed in 0..n {
        for b in [
            Biome::Town,
            Biome::Rocks,
            Biome::OutbackDirt,
            Biome::OutbackBitumen,
        ] {
            for (name, data) in [("previous", &previous), ("shipped", shipped)] {
                let (m, _) =
                    jj_procgen::generate_tuned_from(Streams::new(seed), &[b], data).unwrap();
                let (h, p50, p95, max) = metrics(&m);
                if b == Biome::Rocks {
                    if name == "previous" {
                        old += h;
                    } else {
                        new += h;
                    }
                }
                rows += &format!(
                    "{seed} {b:?} {name} {h:.2} {:.3} {:.3} {:.3}\n",
                    p50 * 100.0,
                    p95 * 100.0,
                    max * 100.0
                );
            }
        }
    }
    // About double (1.9x): route height includes crests, and the longer jumps built for 36 m/s take-offs (br-gw74.13.1)
    // leave fewer stretches for them, a few percent of measured relief; the terrain's own relief is unchanged.
    assert!(
        new > old * 1.9,
        "rocks mean relief must about double: {old}->{new}"
    );
    println!("{rows}");
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("height-grades.txt"), rows).unwrap();
    }
}

#[test]
fn rocks_autopilot_laps_without_stall_rollover_or_recovery_and_replays() {
    let registry = jj_procgen::registry();
    let mut rows = String::from(
        "seed biomes reliefM lapTicks minUp longestSlowTicks recoveries wrecks replay\n",
    );
    let first = std::env::var("JJ_SEED_FROM")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let old = previous();
    let data = if std::env::var_os("JJ_PREVIOUS").is_some() {
        &old
    } else {
        GeneratorData::shipped()
    };
    for seed in first..seeds() {
        for recipe in [&[Biome::Rocks][..], &[Biome::Rocks, Biome::Town][..]] {
            let p = jj_procgen::validate::prepare_tuned(seed, recipe, 8, data);
            assert!(p.valid, "seed{seed} {recipe:?}: {:?}", p.attempts);
            assert!(
                p.map.header.biomes.len() == recipe.len()
                    && recipe.iter().all(|b| p.map.header.biomes.contains(b)),
                "do not silently drop a requested biome: {:?} vs {recipe:?}",
                p.map.header.biomes
            );
            let map = load_canonical(&canonical_bytes(&p.map), &registry).unwrap();
            let profile = VehicleProfile::cruz();
            let mut sim = Sim::new(&map, &registry, seed, profile.clone());
            let car = sim.spawn_grid(1)[0];
            sim.start_race(1);
            sim.set_autopilot(car, true);
            let (mut min_up, mut slow, mut longest) = (1.0f32, 0u64, 0u64);
            while !sim.race().is_finished(car.0) && sim.tick() < 400 * u64::from(TICK_HZ) {
                sim.step();
                let st = sim.car_state(car).unwrap();
                min_up = min_up.min(st.up_y);
                if sim.tick() > 3 * u64::from(TICK_HZ)
                    && !sim.race().is_held(car.0, sim.tick())
                    && st.forward_speed.abs() < 1.0
                {
                    slow += 1;
                    longest = longest.max(slow);
                    if slow == u64::from(TICK_HZ) {
                        let at = (0..p.map.route.points.len())
                            .min_by(|&a, &b| {
                                let distance = |i: usize| {
                                    let q = &p.map.route.points[i];
                                    (f64::from(q.x) / 1000.0 - f64::from(st.position[0])).powi(2)
                                        + (f64::from(q.z) / 1000.0 - f64::from(st.position[2]))
                                            .powi(2)
                                };
                                distance(a).total_cmp(&distance(b))
                            })
                            .unwrap();
                        eprintln!(
                            "slow-window seed{seed} {recipe:?} tick{} route{at}: {st:?}; route {:?}",
                            sim.tick(),
                            p.map.route.points[at]
                        );
                    }
                } else {
                    slow = 0;
                }
            }
            let rc = sim.race().car(car.0).unwrap();
            rows += &format!(
                "{seed} {recipe:?} {:.2} {} {min_up:.3} {longest} {} {} ",
                metrics(&p.map).0,
                sim.tick(),
                rc.recoveries,
                rc.wrecks
            );
            eprintln!("{}", rows.lines().last().unwrap());
            assert!(
                rc.finished_at.is_some(),
                "seed{seed} {recipe:?} never lapped"
            );
            assert_eq!(
                (rc.recoveries, rc.wrecks),
                (0, 0),
                "seed{seed} {recipe:?} must finish unaided"
            );
            assert!(min_up > 0.5, "seed{seed} {recipe:?} rolled: {min_up}");
            assert!(
                longest < u64::from(TICK_HZ),
                "seed{seed} {recipe:?} stalled for {longest} ticks"
            );
            let replay = Sim::replay(&map, &registry, profile, sim.journal(), sim.tick());
            assert_eq!(sim.state_hash(), replay.state_hash(), "seed{seed} replay");
            rows += "matches\n";
        }
    }
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("rocks-laps.txt"), rows).unwrap();
    }
}
