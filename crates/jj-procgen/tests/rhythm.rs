//! The lap's rhythm and variety (P1-FL15c, R132, R136; docs/research/fun-tracks.md R10, R20, R28).
use jj_map::FeatureKind;
use jj_procgen::rhythm;
use jj_procgen::tuning::{GeneratorData, PresetName};

const FAMILIES: [PresetName; 4] = [
    PresetName::Twisty,
    PresetName::Flowing,
    PresetName::Speedway,
    PresetName::FigureEight,
];

fn seeds() -> u64 {
    std::env::var("JJ_SEEDS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(20)
}

/// The shipped generator data with only `family`'s courses drawn. A figure eight is drawn only where its minimum length
/// fits (the shipped data draws it on epic laps; on a shorter class the designer picks another family), so its sample is
/// epic laps.
fn only(family: PresetName) -> GeneratorData {
    let mut d = GeneratorData::shipped().clone();
    for f in FAMILIES {
        d.course
            .presets
            .set_weight(f, if f == family { 1.0 } else { 0.0 });
    }
    if family == PresetName::FigureEight {
        d.course.classes.sprint.weight = 0.0;
        d.course.classes.standard.weight = 0.0;
    }
    d
}

/// The narrowest jump across the road: kicker width (with its edge slopes) over the road width at the kicker.
fn narrowest_jump(map: &jj_map::Map) -> f64 {
    map.features
        .iter()
        .filter(|f| matches!(f.kind, FeatureKind::Jump | FeatureKind::SetPiece))
        .filter(|f| !f.params.contains_key("roofTarget"))
        .filter_map(|f| {
            let w =
                *f.params.get("rampWidthMm")? as f64 / 1000.0 + 2.0 * jj_map::jump::EDGE_SLOPE_M;
            let at = jj_map::jump::feature_base(map, f);
            Some(w / (f64::from(map.route.points[at].width) / 1000.0))
        })
        .fold(f64::INFINITY, f64::min)
}

/// AC1 (P1-FL15c, and P1-FL15c.1 for the figure-eights: no known gaps): 20 seeds per course family, through the game's
/// preparation: every lap carries its set pieces (two, or one under `shortLapM`), has at least three distinct beats with
/// no one beat running on for more than 40% of the lap, and no jump narrower than the road (R10; the kicker's width
/// rounds down to 10 cm).
#[test]
fn every_family_lap_carries_its_set_pieces_and_rhythm_and_full_width_jumps() {
    let d = rhythm::shipped();
    let mut bad = Vec::new();
    let mut table = String::from(
        "family seed lapS lapM pieces longestFlowS flow setPiece technical recovery\n",
    );
    for family in FAMILIES {
        let data = only(family);
        for seed in 0..seeds() {
            let p = jj_procgen::playtest::prepare_data(seed, &data);
            assert!(p.valid, "{family:?} seed {seed}: {:?}", p.attempts);
            let r = rhythm::of(&p.map);
            for problem in rhythm::problems(&r, d) {
                bad.push(format!("{family:?} seed {seed}: {problem}"));
            }
            let w = narrowest_jump(&p.map);
            if w < 0.98 {
                bad.push(format!(
                    "{family:?} seed {seed}: a jump {w:.2} of the road wide"
                ));
            }
            let share = |b: &str| r.shares.get(b).copied().unwrap_or(0.0);
            table += &format!(
                "{family:?} {seed} {:.0} {:.0} {} {:.0} {:.2} {:.2} {:.2} {:.2}\n",
                r.lap_s,
                r.lap_m,
                r.set_pieces,
                r.longest_flow_s,
                share("flow"),
                share("set-piece"),
                share("technical"),
                share("recovery")
            );
        }
    }
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(std::path::Path::new(&dir).join("rhythm.txt"), &table).unwrap();
    }
    assert!(bad.is_empty(), "{}\n{table}", bad.join("\n"));
}

/// P1-FL15c.1: a figure-eight's biome boundaries keep off its lobes' set-piece beat straights (a boundary inside one
/// left that beat "outside one biome", and seeds 5 and 12 seated one set piece). Over the 20 epic eights of AC1, every
/// beat straight lies in one biome, with the transition's half-width to spare.
#[test]
fn figure_eight_biome_boundaries_keep_off_the_beat_straights() {
    let data = only(PresetName::FigureEight);
    let mut bad = Vec::new();
    for seed in 0..seeds() {
        let p = jj_procgen::playtest::prepare_data(seed, &data);
        let pts: Vec<(f64, f64)> = p
            .map
            .route
            .points
            .iter()
            .map(|q| (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0))
            .collect();
        let (sl, _) = jj_procgen::assemble::arc_lengths(&pts);
        assert!(
            !p.course.beat_spans.is_empty(),
            "seed {seed}: an epic eight has beat straights"
        );
        // Every segment start but the lap's own is a boundary.
        for g in p.map.route.segments.iter().filter(|g| g.span.from > 0) {
            let at = sl[g.span.from as usize];
            if let Some(&(a, b)) = p.course.beat_spans.iter().find(|&&(a, b)| {
                at > a - jj_procgen::biome::TRANSITION_M / 2.0
                    && at < b + jj_procgen::biome::TRANSITION_M / 2.0
            }) {
                bad.push(format!(
                    "seed {seed}: the {} boundary at {at:.0} m is on the beat {a:.0}..{b:.0} m",
                    g.name
                ));
            }
        }
    }
    assert!(bad.is_empty(), "{bad:#?}");
}

/// AC2 (P1-FL15c): the validator rejects a course that repeats one beat for more than 40% of a lap. A lab oval with
/// no set pieces is one long flowing beat (its hairpins aside); the shipped lab scene keeps the rhythm.
#[test]
fn the_validator_rejects_a_lap_that_repeats_one_beat() {
    let d = rhythm::shipped();
    let plain = jj_procgen::generate_course(
        jj_procgen::seed::Streams::new(1),
        jj_procgen::course::lab_oval(600.0, 60.0),
        &[jj_map::Biome::Greybox],
        GeneratorData::shipped(),
        &{
            let mut p = jj_procgen::setpieces::shipped().clone();
            p.biomes.clear();
            p
        },
    )
    .unwrap()
    .0;
    let r = rhythm::of(&plain);
    let problems = rhythm::problems(&r, d);
    assert!(
        problems.iter().any(|p| p.contains("stretch"))
            && problems.iter().any(|p| p.contains("set pieces")),
        "a 600 m straight oval without set pieces: {problems:?}"
    );
}

/// AC2 (P1-FL15c, R28): over 20 seeds of the game's own mix, no two laps are more similar than `maxSeedSimilarity`
/// (route shape, corner sequence, relief, biome order, set-piece mix, rhythm, length). R28's proposed bound
/// (`targetSeedSimilarity`) is reported alongside.
#[test]
fn seeds_differ() {
    let d = rhythm::shipped();
    let fps: Vec<_> = (0..seeds())
        .map(|s| jj_procgen::variety::fingerprint(&jj_procgen::playtest::prepare(s).map))
        .collect();
    let (mut worst, mut pair, mut sum, mut n, mut over_target) = (0.0f64, (0, 0), 0.0, 0, 0);
    for i in 0..fps.len() {
        for j in i + 1..fps.len() {
            let s = jj_procgen::variety::similarity(&fps[i], &fps[j]);
            if s > worst {
                (worst, pair) = (s, (i, j));
            }
            over_target += usize::from(s > d.target_seed_similarity);
            sum += s;
            n += 1;
        }
    }
    let report = format!(
        "variety over {} seeds: max similarity {worst:.3} (seeds {} and {}), mean {:.3}; {over_target} of {n} pairs over R28's {}",
        fps.len(),
        pair.0,
        pair.1,
        sum / n as f64,
        d.target_seed_similarity
    );
    eprintln!("{report}");
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            std::path::Path::new(&dir).join("variety.txt"),
            format!("{report}\n"),
        )
        .unwrap();
    }
    assert!(worst <= d.max_seed_similarity, "{report}");
}

#[test]
#[ignore]
fn diag_rhythm() {
    let d = rhythm::shipped();
    for family in FAMILIES {
        let data = only(family);
        for seed in 0..seeds() {
            let p = jj_procgen::playtest::prepare_data(seed, &data);
            let r = rhythm::of(&p.map);
            if std::env::var_os("JJ_ATTEMPTS").is_some() && r.set_pieces < 2 {
                let (sl, _) = jj_procgen::assemble::arc_lengths(
                    &p.map
                        .route
                        .points
                        .iter()
                        .map(|q| (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0))
                        .collect::<Vec<_>>(),
                );
                eprintln!(
                    "  beats {:?} cuts {:?} pieces at {:?}",
                    p.course
                        .beat_spans
                        .iter()
                        .map(|(a, b)| (*a as i64, *b as i64))
                        .collect::<Vec<_>>(),
                    p.map
                        .route
                        .segments
                        .iter()
                        .map(|g| (g.name.clone(), sl[g.span.from as usize] as i64))
                        .collect::<Vec<_>>(),
                    p.map
                        .features
                        .iter()
                        .filter_map(|f| jj_map::setpiece::GapLeap::of(f)
                            .map(|g| sl[g.from as usize] as i64))
                        .collect::<Vec<_>>()
                );
                for a in &p.attempts {
                    eprintln!("  attempt {} {:?}: {:?}", a.draw, a.recipe, a.rejected);
                }
            }
            let mut bad = rhythm::problems(&r, d);
            bad.extend(
                rhythm::notes(&r, d)
                    .into_iter()
                    .map(|n| format!("note {n}")),
            );
            eprintln!(
                "{family:?} {seed} lap {:.0}s pieces {} flowRun {:.0}s shares {:?} jumpW {:.2} {} || plan {:?} len {:.0} fallback {} attempts {} courseRejects {:?} pieceRejects {:?}",
                r.lap_s,
                r.set_pieces,
                r.longest_flow_s,
                r.shares
                    .iter()
                    .map(|(k, v)| format!("{k}:{:.0}", v * 100.0))
                    .collect::<Vec<_>>(),
                narrowest_jump(&p.map),
                bad.join(" | "),
                p.plan,
                p.course.length_m,
                p.course.fallback,
                p.course.attempts,
                p.course.rejects,
                p.course.set_piece_rejects
            );
        }
    }
}

#[test]
#[ignore]
fn diag_variety() {
    let prepared: Vec<_> = (0..seeds()).map(jj_procgen::playtest::prepare).collect();
    for (s, p) in prepared.iter().enumerate() {
        eprintln!(
            "seed {s}: {:?} {:?} len {:.0} fallback {} plan {:?} biomes {:?}",
            p.course.preset,
            p.course.class,
            p.course.length_m,
            p.course.fallback,
            p.plan,
            p.map.header.biomes
        );
    }
    let maps: Vec<jj_map::Map> = prepared.into_iter().map(|p| p.map).collect();
    let fps: Vec<_> = maps.iter().map(jj_procgen::variety::fingerprint).collect();
    let (mut worst, mut sum, mut n) = (0.0f64, 0.0, 0);
    for i in 0..fps.len() {
        for j in i + 1..fps.len() {
            let s = jj_procgen::variety::similarity(&fps[i], &fps[j]);
            if s > worst {
                worst = s;
                eprintln!(
                    "worst so far {i}-{j}: {s:.3} {:?}",
                    jj_procgen::variety::distances(&fps[i], &fps[j])
                );
            }
            sum += s;
            n += 1;
        }
    }
    eprintln!(
        "variety: max similarity {worst:.3}, mean {:.3}",
        sum / n as f64
    );
}

#[test]
#[ignore]
fn diag_jump_count() {
    let count = |d: &GeneratorData| {
        let mut n = 0;
        for biome in [
            jj_map::Biome::Greybox,
            jj_map::Biome::Rocks,
            jj_map::Biome::OutbackDirt,
            jj_map::Biome::OutbackBitumen,
        ] {
            for seed in 0..10 {
                let (map, _) = jj_procgen::generate_tuned_from(
                    jj_procgen::seed::Streams::new(seed),
                    &[biome],
                    d,
                )
                .unwrap();
                n += map
                    .features
                    .iter()
                    .filter(|f| f.kind == FeatureKind::Jump && !f.params.contains_key("roofTarget"))
                    .count();
            }
        }
        n
    };
    let base = GeneratorData::shipped().clone();
    let mut no_tech = base.clone();
    no_tech.course.technical_spacing_m = 0.0;
    let mut one_beat = base.clone();
    one_beat.course.set_piece_straights_min = 1;
    let mut neither = no_tech.clone();
    neither.course.set_piece_straights_min = 1;
    let mut dense = base.clone();
    for b in [
        &mut dense.biomes.greybox,
        &mut dense.biomes.rocks,
        &mut dense.biomes.outback_dirt,
        &mut dense.biomes.outback_bitumen,
    ] {
        b.features.jump *= 2.0;
    }
    let mut half_wide = base.clone();
    half_wide.jumps.road_wide.share = 0.5;
    eprintln!(
        "jumps: shipped {} | no technical {} | one beat {} | neither {} | jump density x2 {} | half road-wide {}",
        count(&base),
        count(&no_tech),
        count(&one_beat),
        count(&neither),
        count(&dense),
        count(&half_wide)
    );
}

#[test]
#[ignore]
fn diag_point() {
    let seed: u64 = std::env::var("JJ_SEED")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10);
    let at: usize = std::env::var("JJ_POINT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(326);
    let p = jj_procgen::validate::prepare_tuned(
        seed,
        &[jj_map::Biome::Rocks, jj_map::Biome::Town],
        8,
        GeneratorData::shipped(),
    );
    eprintln!(
        "plan {:?} biomes {:?} n {}",
        p.plan,
        p.map.header.biomes,
        p.map.route.points.len()
    );
    for f in &p.map.features {
        let base = jj_map::jump::feature_base(&p.map, f);
        let span = jj_map::setpiece::GapLeap::of(f).map(|g| (g.from, g.to));
        eprintln!(
            "feature {:?} base {base} span {span:?} params {:?}",
            f.kind,
            f.params
                .iter()
                .filter(|(k, _)| k.contains("At") || k.contains("piece"))
                .collect::<Vec<_>>()
        );
    }
    for i in at.saturating_sub(8)..(at + 8).min(p.map.route.points.len()) {
        let q = &p.map.route.points[i];
        eprintln!(
            "pt {i} ({:.1},{:.1},{:.1}) {:?} w {}",
            f64::from(q.x) / 1000.0,
            f64::from(q.y) / 1000.0,
            f64::from(q.z) / 1000.0,
            q.surface,
            q.width
        );
    }
    let registry = jj_procgen::registry();
    let map = jj_map::load_canonical(&jj_map::canonical_bytes(&p.map), &registry).unwrap();
    let mut sim = jj_sim::Sim::new(&map, &registry, seed, jj_sim::VehicleProfile::cruz());
    let car = sim.spawn_grid(1)[0];
    sim.start_race(1);
    sim.set_autopilot(car, true);
    let mut life = sim.car_life(car);
    let nearest = |x: f32, z: f32| {
        (0..p.map.route.points.len())
            .min_by_key(|&i| {
                let q = &p.map.route.points[i];
                ((f64::from(q.x) / 1000.0 - f64::from(x)).powi(2)
                    + (f64::from(q.z) / 1000.0 - f64::from(z)).powi(2)) as i64
            })
            .unwrap()
    };
    let mut last = sim.car_state(car).unwrap();
    while !sim.race().is_finished(car.0) && sim.tick() < 400 * u64::from(jj_sim::TICK_HZ) {
        sim.step();
        let st = sim.car_state(car).unwrap();
        if sim.car_life(car) != life {
            life = sim.car_life(car);
            eprintln!(
                "RESPAWN tick {} from ({:.1},{:.1},{:.1}) near pt {} v {:.1} -> pt {}",
                sim.tick(),
                last.position[0],
                last.position[1],
                last.position[2],
                nearest(last.position[0], last.position[2]),
                last.linvel.iter().map(|v| v * v).sum::<f32>().sqrt(),
                nearest(st.position[0], st.position[2])
            );
        }
        last = st;
    }
    for d in &p.map.dressing {
        let (x, z) = (f64::from(d.pose.x) / 1000.0, f64::from(d.pose.z) / 1000.0);
        if (x + 88.8).hypot(z + 76.1) < 12.0 {
            eprintln!(
                "dress {} at ({x:.1},{z:.1}) collides {}",
                d.kit_piece, d.collides
            );
        }
    }
}

#[test]
#[ignore]
fn diag_eight() {
    let seed: u64 = std::env::var("JJ_SEED")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(1);
    let p = jj_procgen::playtest::prepare_data(seed, &only(PresetName::FigureEight));
    eprintln!(
        "plan {:?} preset {:?} biomes {:?} len {:.0} rejects {:?}",
        p.plan, p.course.preset, p.map.header.biomes, p.course.length_m, p.course.set_piece_rejects
    );
    for f in &p.map.features {
        eprintln!(
            "feature {:?} bridge {:?}",
            f.kind,
            jj_map::bridge::BridgeDesign::of(f).map(|d| (
                d.upper.from,
                d.upper.to,
                jj_map::bridge::indices(&p.map, d.upper).map(|v| v.len())
            ))
        );
    }
    let r = rhythm::of(&p.map);
    for sp in &r.spans {
        eprintln!(
            "span {:?} {}..{} {:.1}s",
            sp.beat, sp.from, sp.to, sp.seconds
        );
    }
}

#[test]
#[ignore]
fn diag_town_lot() {
    let seed: u64 = std::env::var("JJ_SEED")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let (map, _) = jj_procgen::generate_recipe(seed, &[jj_map::Biome::Town]).unwrap();
    let n = map.route.points.len();
    for f in &map.features {
        let base = jj_map::jump::feature_base(&map, f);
        let q = &map.route.points[base];
        let d = (f64::from(q.x) / 1000.0 + 73.0).hypot(f64::from(q.z) / 1000.0 - 101.9);
        eprintln!(
            "feature {:?} base {base}/{n} d {d:.0} span {:?} roof {}",
            f.kind,
            jj_map::setpiece::GapLeap::of(f).map(|g| (g.from, g.to)),
            f.params.contains_key("roofTarget")
        );
    }
}

#[test]
#[ignore]
fn diag_town_lots() {
    let count = |d: &GeneratorData| {
        (0..10u64)
            .map(|seed| {
                let (map, _) = jj_procgen::generate_tuned_from(
                    jj_procgen::seed::Streams::new(seed),
                    &[jj_map::Biome::Town],
                    d,
                )
                .unwrap();
                map.features
                    .iter()
                    .filter(|f| f.params.contains_key("roofTarget"))
                    .count()
            })
            .sum::<usize>()
    };
    let base = GeneratorData::shipped().clone();
    let mut no_forks = base.clone();
    no_forks.forks.per_km = 0.0;
    let mut no_pieces = base.clone();
    no_pieces.set_pieces = false;
    let mut one_beat = base.clone();
    one_beat.course.set_piece_straights_min = 1;
    let mut neither = no_forks.clone();
    neither.set_pieces = false;
    eprintln!(
        "lots: shipped {} | no forks {} | no pieces {} | one beat {} | no forks no pieces {}",
        count(&base),
        count(&no_forks),
        count(&no_pieces),
        count(&one_beat),
        count(&neither)
    );
}

#[test]
#[ignore]
fn diag_town_streets() {
    let count = |m: &jj_map::Map| {
        m.dressing
            .iter()
            .filter(|d| d.kit_piece == "town/side-street")
            .count()
    };
    for seed in 0..10 {
        let shipped = GeneratorData::shipped().clone();
        let mut no_forks = shipped.clone();
        no_forks.forks.per_km = 0.0;
        let mut no_pieces = shipped.clone();
        no_pieces.course.set_piece_straights_min = 0;
        no_pieces.course.set_piece_straights_per_km = 0.0;
        let town = [jj_map::Biome::Town];
        let run = |d: &GeneratorData| {
            let p = jj_procgen::validate::prepare_tuned(
                seed,
                &town,
                jj_procgen::validate::MAX_DRAWS,
                d,
            );
            (count(&p.map), p.course.preset, p.course.length_m as i64)
        };
        eprintln!(
            "town {seed}: shipped {:?} | no forks {:?} | no beat straights {:?}",
            run(&shipped),
            run(&no_forks),
            run(&no_pieces)
        );
    }
}

#[test]
#[ignore]
fn diag_eight_spans() {
    for seed in [5u64, 12, 1] {
        let p = jj_procgen::playtest::prepare_data(seed, &only(PresetName::FigureEight));
        let pts: Vec<(f64, f64)> = p
            .map
            .route
            .points
            .iter()
            .map(|q| (f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0))
            .collect();
        let (sl, total) = jj_procgen::assemble::arc_lengths(&pts);
        let at = |i: u32| sl[i as usize] as i64;
        eprintln!(
            "seed {seed} plan {:?} len {:.0} (course {:.0}) start {} beats {:?}",
            p.plan,
            total,
            p.course.length_m,
            at(p.map.route.start.at),
            p.course
                .beat_spans
                .iter()
                .map(|(a, b)| (*a as i64, *b as i64))
                .collect::<Vec<_>>(),
        );
        eprintln!(
            "  segments {:?}",
            p.map
                .route
                .segments
                .iter()
                .map(|g| (g.name.clone(), at(g.span.from), at(g.span.to)))
                .collect::<Vec<_>>()
        );
        for f in &p.map.features {
            if let Some(g) = jj_map::setpiece::GapLeap::of(f) {
                eprintln!("  piece {:?} {}..{}", g.kind, at(g.from), at(g.to));
            }
            if let Some(d) = jj_map::bridge::BridgeDesign::of(f) {
                eprintln!(
                    "  bridge upper {}..{} lower {}..{}",
                    at(d.upper.from),
                    at(d.upper.to),
                    at(d.lower.from),
                    at(d.lower.to)
                );
            }
        }
    }
}

/// The WASM regression guard's sample (`wasm_parity.rs`: 24 race seeds) measured natively: draws per seed (deterministic,
/// so this says before a WASM run whether a change keeps the guard) and wall time (br-cxqk).
#[test]
#[ignore]
fn diag_prepare_cost() {
    let mut ms = Vec::new();
    let counts: Vec<usize> = (0..24u64)
        .map(|seed| {
            let t = std::time::Instant::now();
            let n = jj_procgen::playtest::prepare(seed).attempts.len();
            ms.push(t.elapsed().as_millis());
            n
        })
        .collect();
    let mean = counts.iter().sum::<usize>() as f64 / counts.len() as f64;
    eprintln!(
        "draws worst {}, mean {mean:.2}: {counts:?}",
        counts.iter().max().unwrap()
    );
    eprintln!(
        "native ms worst {}, mean {:.0}: {ms:?}",
        ms.iter().max().unwrap(),
        ms.iter().sum::<u128>() as f64 / ms.len() as f64
    );
}

/// Why the guard sample's draws are rejected (br-cxqk): each rejection's leading words, counted over 24 race seeds.
#[test]
#[ignore]
fn diag_prepare_rejects() {
    let mut why: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    for seed in 0..24u64 {
        for a in jj_procgen::playtest::prepare(seed).attempts {
            for r in a.rejected {
                let key: String = r.chars().take(70).collect();
                *why.entry(key).or_default() += 1;
            }
        }
    }
    let mut v: Vec<_> = why.into_iter().collect();
    v.sort_by_key(|x| std::cmp::Reverse(x.1));
    for (k, n) in v {
        eprintln!("{n:4}  {k}");
    }
}

/// One guard seed's whole ladder (`JJ_SEEDS`, default 10): each attempt's recipe, draw and rejections.
#[test]
#[ignore]
fn diag_prepare_ladder() {
    let seed: u64 = std::env::var("JJ_SEEDS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10);
    let p = jj_procgen::playtest::prepare(seed);
    eprintln!("seed {seed} plan {:?}", p.plan);
    for a in &p.attempts {
        eprintln!("  {:?} draw {} {:?}", a.recipe, a.draw, a.rejected);
    }
}
