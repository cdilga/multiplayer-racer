//! The `jj` CLI for agents and developers: sim, procgen and validate, with JSON output.
//!
//! ```text
//! jj validate [--json] [--kit <dir>] <file>…   validate maps (jj.map.v1, against the kit-piece registry), vehicle
//!                                               sidecars (*.asset.json, jj.vehicle.v1, with their LOD GLBs) and
//!                                               vehicle profiles (jj.vehicle-profile.v1, against their sidecar)
//! jj sim [--json] [--trace] [--set k=v] <fixture.json>…   set up, step, observe, assert and replay (`jj sim --help`)
//! jj sim --compare <accepted> <current> [<tuned>]           ACCEPTED | CURRENT | TUNED trace table
//! jj procgen --seed N [--json] [--out <dir>]   generate, validate and dump a seed's map
//! jj vehicle sync <profile.json>…               derive a vehicle profile's geometry from its baked sidecar
//! jj vehicle tune <patch.json> [--check]        write an owner tuning export into its vehicle profile
//! jj --version
//! ```
//! Exit: 0 everything valid, 1 a file failed validation, 2 usage or I/O.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

mod procgen;
mod sim;
mod vehicle;

const USAGE: &str = "usage: jj validate [--json] [--kit <dir>] <file>…\n       jj sim [--json] [--trace] [--set <field>=<value>]… <fixture.json>… (jj sim --help)\n       jj procgen --seed <u64> [--json] [--out <dir>]\n       jj vehicle sync <profile.json>…\n       jj vehicle tune <patch.json> [--check]\n       jj --version";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("validate") => validate(&args[1..]),
        Some("sim") => sim::command(&args[1..]),
        Some("procgen") => procgen::command(&args[1..]),
        Some("vehicle") => vehicle::command(&args[1..]),
        Some("--version") | Some("version") => {
            println!("jj {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Some("-h") | Some("--help") | None => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Some(other) => {
            eprintln!("jj: unknown command {other:?}\n{USAGE}");
            ExitCode::from(2)
        }
    }
}

/// Loads every `<family>/<name>.json` under `dir` as the kit-piece registry.
fn load_registry(dir: &Path) -> std::io::Result<jj_map::Registry> {
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    for family in std::fs::read_dir(dir)? {
        let family = family?.path();
        if !family.is_dir() {
            continue;
        }
        for entry in std::fs::read_dir(&family)? {
            let path = entry?.path();
            if path.extension().is_some_and(|e| e == "json") {
                let id = format!(
                    "{}/{}",
                    family.file_name().unwrap_or_default().to_string_lossy(),
                    path.file_stem().unwrap_or_default().to_string_lossy()
                );
                files.push((id, std::fs::read(&path)?));
            }
        }
    }
    files.sort();
    Ok(jj_map::Registry::from_json(
        files
            .iter()
            .map(|(id, bytes)| (id.as_str(), bytes.as_slice())),
    ))
}

/// The nearest `assets/kit` above `start` (so `jj validate` works from anywhere in the repo).
fn find_kit(start: &Path) -> Option<PathBuf> {
    let start = start.canonicalize().ok()?;
    start
        .ancestors()
        .map(|a| a.join("assets").join("kit"))
        .find(|p| p.is_dir())
}

fn validate(args: &[String]) -> ExitCode {
    let mut json = false;
    let mut kit: Option<PathBuf> = None;
    let mut files: Vec<PathBuf> = Vec::new();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--json" => json = true,
            "--kit" => match it.next() {
                Some(d) => kit = Some(PathBuf::from(d)),
                None => {
                    eprintln!("jj validate: --kit needs a directory\n{USAGE}");
                    return ExitCode::from(2);
                }
            },
            _ => files.push(PathBuf::from(a)),
        }
    }
    if files.is_empty() {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    }
    let mut registry: Option<jj_map::Registry> = None;
    let mut all_ok = true;
    let mut results = Vec::new();
    for file in &files {
        let bytes = match std::fs::read(file) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("jj validate: {}: {e}", file.display());
                return ExitCode::from(2);
            }
        };
        // Vehicle sidecars (`*.asset.json`, jj.vehicle.v1): the GLBs it names are read next to it.
        if file.to_string_lossy().ends_with(".asset.json") {
            let dir = file.parent().unwrap_or(Path::new(".")).to_path_buf();
            let report = match jj_contracts::vehicle::parse_sidecar(&bytes) {
                Err(r) => r,
                Ok(s) => jj_contracts::vehicle::validate(&s, |f| std::fs::read(dir.join(f)).ok()),
            };
            all_ok &= report.ok;
            if json {
                results.push(serde_json::json!({
                    "file": file.display().to_string(),
                    "kind": "vehicle",
                    "ok": report.ok,
                    "tris": report.tris,
                    "violations": report.violations,
                }));
            } else if report.ok {
                println!(
                    "{}: ok (jj.vehicle.v1, triangles per LOD {:?})",
                    file.display(),
                    report.tris
                );
            } else {
                println!("{}: {} problem(s)", file.display(), report.violations.len());
                for v in &report.violations {
                    println!("  {:<20} {:<28} {}", v.rule.name(), v.at, v.detail);
                }
            }
            continue;
        }
        // Vehicle profiles (jj.vehicle-profile.v1): the geometry must still match the sidecar it was derived from.
        if serde_json::from_slice::<serde_json::Value>(&bytes).is_ok_and(|v| {
            v.get("profile").and_then(|p| p.as_str()) == Some(jj_sim::profile::PROFILE)
        }) {
            let problems = match vehicle::check(file) {
                Ok(p) => p,
                Err(e) => vec![e],
            };
            all_ok &= problems.is_empty();
            if json {
                results.push(serde_json::json!({
                    "file": file.display().to_string(),
                    "kind": "vehicle-profile",
                    "ok": problems.is_empty(),
                    "violations": problems,
                }));
            } else if problems.is_empty() {
                println!(
                    "{}: ok ({}, in sync with its sidecar)",
                    file.display(),
                    jj_sim::profile::PROFILE
                );
            } else {
                println!("{}: {} problem(s)", file.display(), problems.len());
                for p in &problems {
                    println!("  {p}");
                }
            }
            continue;
        }
        // Maps (jj.map.v1), against the kit-piece registry (loaded once, on the first map).
        if registry.is_none() {
            let Some(dir) = kit
                .clone()
                .or_else(|| find_kit(file.parent().unwrap_or(Path::new("."))))
            else {
                eprintln!(
                    "jj validate: no assets/kit found above {}; pass --kit <dir>",
                    file.display()
                );
                return ExitCode::from(2);
            };
            match load_registry(&dir) {
                Ok(r) => registry = Some(r),
                Err(e) => {
                    eprintln!(
                        "jj validate: reading the registry at {}: {e}",
                        dir.display()
                    );
                    return ExitCode::from(2);
                }
            }
        }
        let (report, hash) =
            match jj_map::load_json(&bytes, registry.as_ref().expect("loaded above")) {
                Ok(loaded) => (jj_map::Report::of(vec![]), Some(jj_map::hex(&loaded.hash))),
                Err(report) => (report, None),
            };
        all_ok &= report.ok;
        if json {
            results.push(serde_json::json!({
                "file": file.display().to_string(),
                "kind": "map",
                "ok": report.ok,
                "gameplayHash": hash,
                "violations": report.violations,
            }));
        } else if report.ok {
            println!(
                "{}: ok (jj.map.v1, gameplay hash {})",
                file.display(),
                hash.unwrap_or_default()
            );
        } else {
            println!("{}: {} problem(s)", file.display(), report.violations.len());
            for v in &report.violations {
                println!("  {:<18} {:<24} {}", v.rule.name(), v.at, v.detail);
            }
        }
    }
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&results).unwrap_or_default()
        );
    }
    if all_ok {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}
