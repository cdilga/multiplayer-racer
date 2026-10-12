//! br-2sdu.3: the generator reads its tunable values from data. The shipped data changes nothing (the goldens test pins
//! that); a tuned length band and relief show in the built track's measured length and height range.

use jj_procgen::playtest::prepare_data;
use jj_procgen::tuning::GeneratorData;

const SEEDS: std::ops::Range<u64> = 0..12;

fn set(d: &GeneratorData, fields: &[(&str, &str)]) -> GeneratorData {
    let f: Vec<(String, String)> = fields
        .iter()
        .map(|(a, b)| ((*a).into(), (*b).into()))
        .collect();
    d.with_fields(&f).unwrap()
}

/// Route height range in metres.
fn route_relief(map: &jj_map::Map) -> f64 {
    let y = map.route.points.iter().map(|p| f64::from(p.y));
    (y.clone().fold(f64::MIN, f64::max) - y.fold(f64::MAX, f64::min)) / 1000.0
}

#[test]
fn the_shipped_data_builds_the_same_tracks_as_the_untuned_generator() {
    for seed in SEEDS {
        let a = jj_procgen::playtest::prepare(seed);
        let b = prepare_data(seed, GeneratorData::shipped());
        assert_eq!(
            jj_map::canonical_bytes(&a.map),
            jj_map::canonical_bytes(&b.map),
            "seed {seed}"
        );
    }
}

#[test]
fn a_tuned_length_class_builds_tracks_inside_its_band() {
    let short = set(
        GeneratorData::shipped(),
        &[
            ("course.classes.sprint.weight", "0"),
            ("course.classes.epic.weight", "0"),
            ("course.classes.standard.lengthMinM", "1100"),
            ("course.classes.standard.lengthMaxM", "1250"),
        ],
    );
    for seed in SEEDS {
        let p = prepare_data(seed, &short);
        assert!(p.valid, "seed {seed}");
        assert!(
            (1100.0..=1250.0).contains(&p.course.length_m),
            "seed {seed}: {} m",
            p.course.length_m
        );
    }
}

#[test]
fn a_tuned_mix_draws_the_biome_counts_it_is_given() {
    let only_pairs = set(
        GeneratorData::shipped(),
        &[
            ("mix.oneBiome", "0"),
            ("mix.twoBiomes", "1"),
            ("mix.threeBiomes", "0"),
            ("mix.fourBiomes", "0"),
        ],
    );
    for seed in SEEDS {
        assert_eq!(only_pairs.draw_mix(seed).len(), 2, "seed {seed}");
    }
}

#[test]
fn a_tuned_relief_changes_the_built_height_range() {
    let mut fields: Vec<(String, String)> = Vec::new();
    for b in ["town", "rocks", "outbackDirt", "outbackBitumen"] {
        fields.push((format!("biomes.{b}.terrain.reliefM"), "40".into()));
        fields.push((format!("biomes.{b}.terrain.maxGrade"), "0.12".into()));
    }
    let tall = GeneratorData::shipped().with_fields(&fields).unwrap();
    let (mut base, mut tuned) = (0.0, 0.0);
    for seed in SEEDS {
        base += route_relief(&prepare_data(seed, GeneratorData::shipped()).map);
        tuned += route_relief(&prepare_data(seed, &tall).map);
    }
    println!(
        "mean route relief {:.1} m -> {:.1} m",
        base / 12.0,
        tuned / 12.0
    );
    // 1.4x: route relief includes crests, which the longer jumps of br-gw74.13.1 leave fewer stretches for.
    assert!(tuned > base * 1.4, "relief {base} -> {tuned}");
}
