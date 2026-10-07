//! `jj procgen --seed N [--json] [--out <dir>]` (P1-M03a): generates the seed's map, validates it against the kit
//! registry and dumps the map (JSON and canonical bytes) and the validator report to `target/jj-runs/procgen-<seed>/`
//! (or `--out`). The report includes the course design (P1-M03b): length, corner mix, attempts and rejections.
//!
//! `jj procgen --seeds A..B [--json]` (P1-M03b seed bank): every seed in `A..B`, one summary row each, plus the corner
//! mix histogram, written to `target/jj-runs/procgen-seeds-A-B/bank.json`.
//!
//! Exit 0 valid, 1 a generated map fails validation, 2 usage or I/O.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

const USAGE: &str = "usage: jj procgen --seed <u64> [--recipe <biome,biome,..>] [--json] [--out <dir>]\n       jj procgen --seeds <from>..<to> [--recipe <biome,..>] [--json]\n  a recipe lists biomes in lap order (greybox, town, rocks, outback-dirt, outback-bitumen); the lap ends back in the first";

fn course_json(r: &jj_procgen::Report) -> serde_json::Value {
    serde_json::json!({
        "lengthM": (r.length_m * 10.0).round() / 10.0,
        "corners": r.corners,
        "attempts": r.attempts,
        "fallback": r.fallback,
        "rejects": r.rejects,
    })
}

/// The seed bank: every seed in `from..to`, a summary row each and the corner-mix histogram.
/// The fallback ladder's outcome for the report: `requested`, `redrawn-N`, `shorter-N` or `conservative`.
fn plan_name(p: &jj_procgen::Plan) -> String {
    match p {
        jj_procgen::Plan::Requested => "requested".into(),
        jj_procgen::Plan::Redrawn(d) => format!("redrawn-{d}"),
        jj_procgen::Plan::Shorter(k) => format!("shorter-{k}"),
        jj_procgen::Plan::Conservative => "conservative".into(),
    }
}

fn parse_recipe(list: &str) -> Option<Vec<jj_map::Biome>> {
    list.split(',')
        .map(|n| serde_json::from_value(serde_json::Value::String(n.trim().into())).ok())
        .collect()
}

fn bank(
    from: u64,
    to: u64,
    json: bool,
    registry: &jj_map::Registry,
    recipe: &[jj_map::Biome],
) -> ExitCode {
    let mut rows = Vec::new();
    let mut histogram: std::collections::BTreeMap<&str, u32> = std::collections::BTreeMap::new();
    let (mut ok, mut fallbacks, mut attempts) = (0u64, 0u32, 0u64);
    let mut plans: std::collections::BTreeMap<String, u32> = std::collections::BTreeMap::new();
    for seed in from..to {
        let prepared = jj_procgen::prepare(seed, recipe);
        let (map, r) = (prepared.map, prepared.course);
        let v = jj_map::validate(&map, registry);
        let good = v.ok && prepared.valid;
        *plans.entry(plan_name(&prepared.plan)).or_default() += 1;
        ok += u64::from(good);
        fallbacks += u32::from(r.fallback);
        attempts += u64::from(r.attempts);
        for (k, n) in &r.corners {
            *histogram.entry(k).or_default() += n;
        }
        rows.push(serde_json::json!({
            "seed": seed,
            "ok": good,
            "plan": plan_name(&prepared.plan),
            "attempts": prepared.attempts.len(),
            "gameplayHash": jj_map::hex(&jj_map::gameplay_hash(&map)),
            "course": course_json(&r),
            "violations": v.violations,
        }));
    }
    let n = to.saturating_sub(from);
    let summary = serde_json::json!({
        "seeds": [from, to],
        "valid": ok,
        "fallbacks": fallbacks,
        "plans": plans,
        "meanAttempts": if n > 0 { attempts as f64 / n as f64 } else { 0.0 },
        "cornerMix": histogram,
        "rows": rows,
    });
    let out = PathBuf::from(format!("target/jj-runs/procgen-seeds-{from}-{to}"));
    if let Err(e) = std::fs::create_dir_all(&out).and_then(|()| {
        std::fs::write(
            out.join("bank.json"),
            serde_json::to_vec_pretty(&summary).unwrap_or_default(),
        )
    }) {
        eprintln!("jj procgen: writing {}: {e}", out.display());
        return ExitCode::from(2);
    }
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&summary).unwrap_or_default()
        );
    } else {
        println!(
            "seeds {from}..{to}: {ok}/{n} valid, {fallbacks} fallbacks, mean attempts {:.1}",
            summary["meanAttempts"].as_f64().unwrap_or(0.0)
        );
        println!("corner mix: {histogram:?} in {}", out.display());
    }
    if ok == n {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}

pub fn command(args: &[String]) -> ExitCode {
    let mut json = false;
    let mut seed: Option<u64> = None;
    let mut seeds: Option<(u64, u64)> = None;
    let mut out: Option<PathBuf> = None;
    let mut recipe = vec![jj_map::Biome::Greybox];
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--json" => json = true,
            "--seed" => seed = it.next().and_then(|s| s.parse().ok()),
            "--seeds" => {
                seeds = it
                    .next()
                    .and_then(|s| s.split_once(".."))
                    .and_then(|(a, b)| Some((a.parse().ok()?, b.parse().ok()?)))
            }
            "--out" => out = it.next().map(PathBuf::from),
            "--recipe" => match it.next().and_then(|l| parse_recipe(l)) {
                Some(r) => recipe = r,
                None => {
                    eprintln!("jj procgen: --recipe needs known biome names\n{USAGE}");
                    return ExitCode::from(2);
                }
            },
            _ => {
                eprintln!("jj procgen: unexpected {a:?}\n{USAGE}");
                return ExitCode::from(2);
            }
        }
    }
    let registry = match crate::find_kit(Path::new(".")) {
        Some(dir) => match crate::load_registry(&dir) {
            // Until P1-R10's `assets/kit/wayfinding/` lands, the checked-in kit has no wayfinding family, which every
            // generated route uses: validate against procgen's registry (the generic kit plus stand-ins) instead.
            Ok(r) if r.get("wayfinding/chevron-post").is_some() => r,
            Ok(_) => jj_procgen::registry(),
            Err(e) => {
                eprintln!("jj procgen: reading the registry at {}: {e}", dir.display());
                return ExitCode::from(2);
            }
        },
        None => jj_procgen::registry(),
    };
    if let Some((from, to)) = seeds {
        return bank(from, to, json, &registry, &recipe);
    }
    let Some(seed) = seed else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };

    let prepared = jj_procgen::prepare(seed, &recipe);
    let (map, course) = (prepared.map, prepared.course);
    let report = jj_map::validate(&map, &registry);
    let ok = report.ok && prepared.valid;
    let canonical = jj_map::canonical_bytes(&map);
    let hash = jj_map::hex(&jj_map::gameplay_hash(&map));
    let out = out.unwrap_or_else(|| PathBuf::from(format!("target/jj-runs/procgen-{seed}")));
    let summary = serde_json::json!({
        "seed": seed,
        "generator": map.header.generator,
        "ok": ok,
        "plan": plan_name(&prepared.plan),
        "attempts": prepared.attempts.iter().map(|a| serde_json::json!({
            "biomes": a.recipe.len(), "draw": a.draw, "rejected": a.rejected,
        })).collect::<Vec<_>>(),
        "gameplayHash": hash,
        "routePoints": map.route.points.len(),
        "gates": map.route.gates.len(),
        "refLapMs": map.header.ref_lap_ms,
        "dressing": map.dressing.len(),
        "props": map.props.len(),
        "course": course_json(&course),
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
    } else if ok {
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
    if ok {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}
