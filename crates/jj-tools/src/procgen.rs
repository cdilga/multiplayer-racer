//! `jj procgen --seed N [--json] [--out <dir>]` (P1-M03a): generates the seed's map, validates it against the kit
//! registry and dumps the map (JSON and canonical bytes) and the validator report to `target/jj-runs/procgen-<seed>/`
//! (or `--out`). Exit 0 valid, 1 the generated map fails validation, 2 usage or I/O.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

const USAGE: &str = "usage: jj procgen --seed <u64> [--json] [--out <dir>]";

pub fn command(args: &[String]) -> ExitCode {
    let mut json = false;
    let mut seed: Option<u64> = None;
    let mut out: Option<PathBuf> = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--json" => json = true,
            "--seed" => seed = it.next().and_then(|s| s.parse().ok()),
            "--out" => out = it.next().map(PathBuf::from),
            _ => {
                eprintln!("jj procgen: unexpected {a:?}\n{USAGE}");
                return ExitCode::from(2);
            }
        }
    }
    let Some(seed) = seed else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    let registry = match crate::find_kit(Path::new(".")) {
        Some(dir) => match crate::load_registry(&dir) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("jj procgen: reading the registry at {}: {e}", dir.display());
                return ExitCode::from(2);
            }
        },
        None => jj_map::Registry::generic(),
    };

    let map = jj_procgen::generate(seed);
    let report = jj_map::validate(&map, &registry);
    let canonical = jj_map::canonical_bytes(&map);
    let hash = jj_map::hex(&jj_map::gameplay_hash(&map));
    let out = out.unwrap_or_else(|| PathBuf::from(format!("target/jj-runs/procgen-{seed}")));
    let summary = serde_json::json!({
        "seed": seed,
        "generator": map.header.generator,
        "ok": report.ok,
        "gameplayHash": hash,
        "routePoints": map.route.points.len(),
        "gates": map.route.gates.len(),
        "refLapMs": map.header.ref_lap_ms,
        "dressing": map.dressing.len(),
        "props": map.props.len(),
        "out": out.display().to_string(),
        "violations": report.violations,
    });
    let written = std::fs::create_dir_all(&out)
        .and_then(|()| {
            std::fs::write(
                out.join("map.json"),
                serde_json::to_vec_pretty(&map).unwrap_or_default(),
            )
        })
        .and_then(|()| std::fs::write(out.join("map.bin"), &canonical))
        .and_then(|()| {
            std::fs::write(
                out.join("report.json"),
                serde_json::to_vec_pretty(&summary).unwrap_or_default(),
            )
        });
    if let Err(e) = written {
        eprintln!("jj procgen: writing {}: {e}", out.display());
        return ExitCode::from(2);
    }
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&summary).unwrap_or_default()
        );
    } else if report.ok {
        println!(
            "seed {seed}: ok ({} route points, {} gates, gameplay hash {hash}) → {}",
            map.route.points.len(),
            map.route.gates.len(),
            out.display()
        );
    } else {
        println!("seed {seed}: {} problem(s)", report.violations.len());
        for v in &report.violations {
            println!("  {:<18} {:<24} {}", v.rule.name(), v.at, v.detail);
        }
    }
    if report.ok {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}
