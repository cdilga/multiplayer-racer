//! P1-M02 spike CLI (native).
//!   procgen-spike gen <seed> <biome> <undulation> <scatter> <out.json>   one map (jj.map.v1 JSON)
//!   procgen-spike bench <seeds> <out-dir>                                 every biome × candidate × seed: timing,
//!       validation, stats and the canonical-bytes fingerprint (bench.json), plus the comparison and drive maps
use std::path::Path;
use std::time::Instant;

use jj_procgen_spike::{BIOMES, SCATTERS, UNDULATIONS, Scatter, Undulation, biome_name, canonical, fnv, generate, parse_biome};

fn registry() -> jj_map::Registry {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets/kit");
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    for family in std::fs::read_dir(&dir).expect("assets/kit") {
        let family = family.unwrap().path();
        if !family.is_dir() {
            continue;
        }
        for entry in std::fs::read_dir(&family).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_some_and(|e| e == "json") {
                let id = format!("{}/{}", family.file_name().unwrap().to_string_lossy(), path.file_stem().unwrap().to_string_lossy());
                files.push((id, std::fs::read(&path).unwrap()));
            }
        }
    }
    files.sort();
    jj_map::Registry::from_json(files.iter().map(|(id, b)| (id.as_str(), b.as_slice())))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("gen") => {
            let seed: u64 = args[1].parse().unwrap();
            let b = parse_biome(&args[2]).expect("biome");
            let u = Undulation::parse(&args[3]).expect("undulation");
            let s = Scatter::parse(&args[4]).expect("scatter");
            let (map, stats) = generate(seed, b, u, s);
            std::fs::write(&args[5], serde_json::to_vec(&map).unwrap()).unwrap();
            println!("{stats:?} fnv {:016x}", fnv(&canonical(&map)));
        }
        Some("bench") => {
            let seeds: u64 = args[1].parse().unwrap();
            let out = Path::new(&args[2]);
            std::fs::create_dir_all(out.join("maps")).unwrap();
            let reg = registry();
            let mut rows = Vec::new();
            for b in BIOMES {
                for u in UNDULATIONS {
                    for s in SCATTERS {
                        for seed in 1..=seeds {
                            let t0 = Instant::now();
                            let (map, st) = generate(seed, b, u, s);
                            let gen_ms = t0.elapsed().as_secs_f64() * 1000.0;
                            let t1 = Instant::now();
                            let report = jj_map::validate(&map, &reg);
                            let val_ms = t1.elapsed().as_secs_f64() * 1000.0;
                            let canon = canonical(&map);
                            let again = canonical(&generate(seed, b, u, s).0);
                            let rules: Vec<String> = report.violations.iter().map(|v| v.rule.name().to_string()).collect();
                            rows.push(serde_json::json!({
                                "biome": biome_name(b), "undulation": u.name(), "scatter": s.name(), "seed": seed,
                                "genMs": gen_ms, "validateMs": val_ms, "ok": report.ok, "violations": rules,
                                "pieces": st.pieces, "reliefM": st.relief_m, "maxGrade": st.max_grade,
                                "nnMeanM": st.nn_mean_m, "nnCv": st.nn_cv,
                                "fnv": format!("{:016x}", fnv(&canon)), "repeatable": canon == again,
                            }));
                            // Maps for captures and drives: seed 1 of every combination.
                            if seed == 1 {
                                let name = format!("{}-{}-{}-s{seed}.json", biome_name(b), u.name(), s.name());
                                std::fs::write(out.join("maps").join(name), serde_json::to_vec(&map).unwrap()).unwrap();
                            }
                        }
                    }
                }
            }
            std::fs::write(out.join("bench-native.json"), serde_json::to_vec_pretty(&rows).unwrap()).unwrap();
            println!("{} generations → {}", rows.len(), out.display());
        }
        _ => eprintln!("usage: procgen-spike gen <seed> <biome> <undulation> <scatter> <out.json> | bench <seeds> <out-dir>"),
    }
}
