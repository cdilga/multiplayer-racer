//! br-xlvx.8 (R125): each seed draws one to four biomes in any order (the all-four rule is withdrawn), and br-xlvx.2:
//! each seed draws a length class (sprint, standard, epic) and the course is built to its band. The 500-seed sweep
//! reports both distributions against the data's weights; every drawn mix validates. `JJ_EVIDENCE_DIR` writes
//! `sweep.txt`; `JJ_SEEDS=N` changes the size of the heavy sweep (a debug build is slow, so it samples fewer).

use std::collections::BTreeMap;

use jj_map::Biome;
use jj_procgen::biome::{check_transitions, segment_name};
use jj_procgen::playtest::{POOL, prepare_data};
use jj_procgen::tuning::{ClassName, GeneratorData};
use jj_procgen::validate::check;
use jj_procgen::{Plan, registry};

/// The distribution sweeps (cheap draws) always cover 500 seeds; the heavy prepare sweep samples fewer in debug.
const SWEEP: u64 = 500;

fn heavy_seeds() -> u64 {
    std::env::var("JJ_SEEDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(if cfg!(debug_assertions) { 40 } else { SWEEP })
}

fn pct(n: u32, of: u64) -> f64 {
    100.0 * f64::from(n) / of as f64
}

fn names(mix: &[Biome]) -> String {
    mix.iter()
        .map(|b| segment_name(*b))
        .collect::<Vec<_>>()
        .join(">")
}

fn write_evidence(report: &str) {
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("sweep.txt"), report).unwrap();
    }
}

#[test]
fn the_drawn_biome_counts_follow_the_weights_and_every_biome_appears_alone() {
    let d = GeneratorData::shipped();
    let w = d.mix.weights();
    let total: f64 = w.iter().sum();
    let mut counts = [0u32; 4];
    let mut alone: BTreeMap<String, u32> = BTreeMap::new();
    let mut first: BTreeMap<String, u32> = BTreeMap::new();
    let mut orders: std::collections::BTreeSet<String> = Default::default();
    for seed in 0..SWEEP {
        let mix = d.draw_mix(seed);
        assert!((1..=4).contains(&mix.len()), "seed {seed}");
        let mut u = mix.clone();
        u.sort();
        u.dedup();
        assert_eq!(u.len(), mix.len(), "seed {seed}: a biome twice");
        assert!(mix.iter().all(|b| POOL.contains(b)));
        counts[mix.len() - 1] += 1;
        if mix.len() == 1 {
            *alone.entry(segment_name(mix[0])).or_default() += 1;
        }
        *first.entry(segment_name(mix[0])).or_default() += 1;
        orders.insert(names(&mix));
    }
    let mut report = format!("biome count drawn over {SWEEP} seeds (weights -> measured)\n");
    for k in 0..4 {
        let want = 100.0 * w[k] / total;
        let got = pct(counts[k], SWEEP);
        report += &format!(
            "  {} biome(s): weight {want:.0} % -> {got:.1} % ({})\n",
            k + 1,
            counts[k]
        );
        assert!(
            (got - want).abs() <= 3.0,
            "{} biomes: {got:.1} % vs {want:.0} %",
            k + 1
        );
    }
    report += &format!(
        "alone: {alone:?}\nlap-start biome: {first:?}\n{} distinct ordered mixes\n",
        orders.len()
    );
    println!("{report}");
    assert_eq!(
        alone.len(),
        POOL.len(),
        "every biome appears alone: {alone:?}"
    );
    assert_eq!(first.len(), POOL.len());
    // 4 + 12 + 24 + 24 ordered mixes exist; a good share of them show up.
    assert!(orders.len() >= 40, "{} ordered mixes", orders.len());
}

#[test]
fn the_length_classes_follow_the_weights_and_the_courses_are_built_to_their_bands() {
    let d = GeneratorData::shipped();
    let mut by: BTreeMap<ClassName, Vec<f64>> = BTreeMap::new();
    for seed in 0..SWEEP {
        let (_, r) = jj_procgen::generate_report(seed);
        let band = d.course.classes.get(r.class);
        assert!(
            (band.length_min_m..=band.length_max_m).contains(&r.length_m),
            "seed {seed}: {} m outside {}",
            r.length_m,
            r.class.name()
        );
        by.entry(r.class).or_default().push(r.length_m);
    }
    let total: f64 = ClassName::ALL
        .iter()
        .map(|c| d.course.classes.get(*c).weight)
        .sum();
    let mut report = format!(
        "length class over {SWEEP} seeds (weight -> measured; lap length m min / mean / max)\n"
    );
    for c in ClassName::ALL {
        let v = &by[&c];
        let k = d.course.classes.get(c);
        let want = 100.0 * k.weight / total;
        let got = pct(v.len() as u32, SWEEP);
        let mean = v.iter().sum::<f64>() / v.len() as f64;
        let (lo, hi) = (
            v.iter().copied().fold(f64::MAX, f64::min),
            v.iter().copied().fold(0.0, f64::max),
        );
        report += &format!(
            "  {:<8} band {:.0}-{:.0} m, {} laps: weight {want:.0} % -> {got:.1} % ({})  lengths {lo:.0} / {mean:.0} / {hi:.0}\n",
            c.name(),
            k.length_min_m,
            k.length_max_m,
            k.laps,
            v.len()
        );
        assert!(
            (got - want).abs() <= 5.0,
            "{}: {got:.1} % vs {want:.0} %",
            c.name()
        );
        // The designer fills the band: courses span most of it, they are not all at one length.
        assert!(
            hi - lo >= 0.5 * (k.length_max_m - k.length_min_m),
            "{}: lengths only span {lo:.0}..{hi:.0}",
            c.name()
        );
    }
    println!("{report}");
}

#[test]
fn every_drawn_mix_validates_and_runs_its_biomes_in_lap_order() {
    let d = GeneratorData::shipped();
    let n = heavy_seeds();
    let mut plans: BTreeMap<String, u32> = BTreeMap::new();
    let mut final_counts = [0u32; 4];
    let mut drawn_counts = [0u32; 4];
    let mut classes: BTreeMap<&str, (u32, f64)> = BTreeMap::new();
    let mut rows = String::from(
        "seed  class     length  plan          drawn mix (lap order, ends back in the first)\n",
    );
    for seed in 0..n {
        let mix = d.draw_mix(seed);
        let p = prepare_data(seed, d);
        assert!(p.valid, "seed {seed}: {:?}", p.attempts.last());
        let problems = check(&p.map, &registry());
        assert!(problems.is_empty(), "seed {seed}: {problems:?}");
        assert!(check_transitions(&p.map).is_empty(), "seed {seed}");
        let plan = match p.plan {
            Plan::Requested => "requested".to_owned(),
            Plan::Redrawn(k) => format!("redrawn-{k}"),
            Plan::Shorter(k) => format!("shorter-{k}"),
            Plan::Conservative => "conservative".to_owned(),
        };
        let segs: Vec<String> = p
            .map
            .route
            .segments
            .iter()
            .map(|s| s.name.clone())
            .collect();
        if matches!(p.plan, Plan::Requested | Plan::Redrawn(_)) {
            // The lap runs the drawn biomes in the drawn order and ends back in the first (one biome is one segment).
            let mut want: Vec<String> = mix.iter().map(|b| segment_name(*b)).collect();
            if want.len() > 1 {
                want.push(want[0].clone());
            }
            assert_eq!(segs, want, "seed {seed}");
        }
        let mut used = p.map.header.biomes.clone();
        used.sort();
        used.dedup();
        final_counts[used.len() - 1] += 1;
        drawn_counts[mix.len() - 1] += 1;
        let e = classes.entry(p.course.class.name()).or_default();
        e.0 += 1;
        e.1 += p.course.length_m;
        *plans.entry(plan.clone()).or_default() += 1;
        rows += &format!(
            "{seed:>4}  {:<8}  {:>6.0}  {plan:<12}  {}\n",
            p.course.class.name(),
            p.course.length_m,
            names(&mix)
        );
    }
    let mut report = format!(
        "prepared {n} seeds, every one valid\nplans {plans:?}\nbiome count drawn {drawn_counts:?}, final map {final_counts:?} (ladder drops show as the difference)\n"
    );
    for (c, (k, sum)) in &classes {
        report += &format!("  {c}: {k} tracks, mean lap {:.0} m\n", sum / f64::from(*k));
    }
    report += &format!("\n{rows}");
    println!("{}", report.lines().take(8).collect::<Vec<_>>().join("\n"));
    write_evidence(&report);
}

#[test]
fn the_track_is_a_pure_function_of_the_seed() {
    for seed in [0u64, 17, 99] {
        assert_eq!(
            jj_map::canonical_bytes(&jj_procgen::playtest::prepare(seed).map),
            jj_map::canonical_bytes(&jj_procgen::playtest::prepare(seed).map)
        );
    }
    assert_ne!(
        jj_map::canonical_bytes(&jj_procgen::playtest::prepare(1).map),
        jj_map::canonical_bytes(&jj_procgen::playtest::prepare(2).map)
    );
}
