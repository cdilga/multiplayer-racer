//! P1-M03d seed bank: every placed feature passes its envelope check and the map validator, in every biome's feature mix.

use std::collections::BTreeMap;

use jj_map::{Biome, FeatureKind, Map, validate};
use jj_procgen::features::{check_envelope, place};
use jj_procgen::generate;
use jj_procgen::seed::Rng;
use jj_procgen::terrain::{params, undulate};

const BIOMES: [Biome; 5] = [
    Biome::Greybox,
    Biome::Town,
    Biome::OutbackBitumen,
    Biome::OutbackDirt,
    Biome::Rocks,
];
/// The bank: a sample, not a limit (`JJ_SEEDS=N` widens it).
const DEFAULT_SEEDS: u64 = if cfg!(debug_assertions) { 20 } else { 100 };

fn seeds() -> u64 {
    std::env::var("JJ_SEEDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_SEEDS)
}

/// The seed's route with `biome`'s terrain and features applied (the generated map re-run for another biome).
fn biome_map(seed: u64, biome: Biome) -> Map {
    let mut m = generate(seed);
    undulate(&mut m, &mut Rng::stream(seed, "terrain"), &params(biome));
    place(&mut m, &mut Rng::stream(seed, "features"), biome);
    m
}

#[test]
fn every_placed_feature_passes_its_envelope_and_the_validator_across_the_seed_bank() {
    let registry = jj_procgen::registry();
    let mut tally: BTreeMap<String, usize> = BTreeMap::new();
    for seed in 0..seeds() {
        for biome in BIOMES {
            let m = biome_map(seed, biome);
            let bad = check_envelope(&m);
            assert!(bad.is_empty(), "seed {seed} {biome:?}: {bad:?}");
            let r = validate(&m, &registry);
            assert!(r.ok, "seed {seed} {biome:?}: {:?}", r.violations);
            for f in &m.features {
                *tally.entry(format!("{biome:?} {:?}", f.kind)).or_default() += 1;
            }
        }
    }
    let table = format!(
        "features placed over {} seeds x 5 biomes, every one passing check_envelope and validate:\n{tally:#?}\n",
        seeds()
    );
    println!("{table}");
    if let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") {
        std::fs::write(std::path::Path::new(&dir).join("seedbank.txt"), table).unwrap();
    }
    for kind in [
        FeatureKind::Jump,
        FeatureKind::Crest,
        FeatureKind::Whoops,
        FeatureKind::CreekDip,
    ] {
        assert!(
            tally
                .iter()
                .any(|(k, n)| k.ends_with(&format!("{kind:?}")) && *n > 0),
            "{kind:?} never placed"
        );
    }
}

/// Evidence image (only with `JJ_EVIDENCE_DIR`): the centerline height profile of a Greybox lap, with each placed
/// feature's envelope shaded and labelled by colour (jump orange, crest blue, whoops green, creek dip teal). PPM.
#[test]
fn writes_the_profile_image() {
    let Some(dir) = std::env::var_os("JJ_EVIDENCE_DIR") else {
        return;
    };
    let m = generate(2);
    let pts: Vec<(f64, f64, f64)> = m
        .route
        .points
        .iter()
        .map(|p| {
            (
                f64::from(p.x) / 1000.0,
                f64::from(p.z) / 1000.0,
                f64::from(p.y) / 1000.0,
            )
        })
        .collect();
    let (w, h) = (pts.len() * 2, 220usize);
    let (lo, hi) = pts.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |a, p| {
        (a.0.min(p.2), a.1.max(p.2))
    });
    let row = |y: f64| (h as f64 - 20.0 - (y - lo) / (hi - lo + 1e-9) * (h as f64 - 40.0)) as usize;
    let mut px = vec![[245u8, 245, 240]; w * h];
    for f in &m.features {
        let i = pts
            .iter()
            .position(|p| {
                (p.0 * 1000.0 - f64::from(f.pose.x)).abs() < 2.0
                    && (p.1 * 1000.0 - f64::from(f.pose.z)).abs() < 2.0
            })
            .unwrap();
        let len = f
            .params
            .get("lengthMm")
            .or(f.params.get("rampLengthMm"))
            .copied()
            .unwrap_or(0) as f64
            / 1000.0
            + f.params.get("landingLengthMm").copied().unwrap_or(0) as f64 / 1000.0;
        let colour = match f.kind {
            FeatureKind::Jump => [255, 200, 150],
            FeatureKind::Crest => [170, 200, 255],
            FeatureKind::Whoops => [180, 235, 180],
            _ => [150, 225, 225],
        };
        for x in i * 2..((i as f64 + len / 2.5) as usize * 2).min(w) {
            for y in 0..h {
                px[y * w + x] = colour;
            }
        }
    }
    for (i, p) in pts.iter().enumerate() {
        for x in i * 2..i * 2 + 2 {
            let y = row(p.2).min(h - 1);
            for dy in 0..3 {
                px[(y + dy).min(h - 1) * w + x] = [30, 30, 40];
            }
        }
    }
    let mut out = format!("P6\n{w} {h}\n255\n").into_bytes();
    out.extend(px.iter().flatten());
    std::fs::write(
        std::path::Path::new(&dir).join("profile-greybox-seed2.ppm"),
        out,
    )
    .unwrap();
}
