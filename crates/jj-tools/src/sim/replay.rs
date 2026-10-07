//! `jj sim --replay <clip.jjclip|session.jjsession>…` (P1-F07, P1-F12): re-simulates the worlds a host saved, natively,
//! verifies every checkpoint hash the host took, reports the end-state hash and the state at the marked moment, and with
//! `--trace` writes `jj sim --trace` rows (compare them with `jj sim --compare`).

use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use serde_json::{Value, json};

use jj_fixture::clip::{Bundle, Report, replay};
use jj_sim::VehicleProfile;

/// Who is replaying: `--build`, `JJ_BUILD`, else the checkout's HEAD (12 hex digits, as the web build records it).
fn this_build(flag: &Option<String>) -> Option<String> {
    flag.clone()
        .or_else(|| std::env::var("JJ_BUILD").ok().filter(|s| !s.is_empty()))
        .or_else(|| {
            let out = Command::new("git")
                .args(["rev-parse", "--short=12", "HEAD"])
                .output()
                .ok()?;
            out.status
                .success()
                .then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned())
        })
}

fn same_build(a: &str, b: &str) -> bool {
    let n = a.len().min(b.len());
    n >= 7 && a[..n] == b[..n]
}

pub struct Options {
    pub json: bool,
    pub trace: bool,
    pub out: Option<PathBuf>,
    pub build: Option<String>,
    pub any_build: bool,
}

fn refuse(msg: String) -> Result<Report, (u8, String)> {
    Err((2, msg))
}

/// Replays one file; `Err((exit code, message))` when it can't be.
pub fn run(file: &Path, o: &Options) -> Result<(Report, PathBuf), (u8, String)> {
    let bytes = std::fs::read(file).map_err(|e| (2, format!("{}: {e}", file.display())))?;
    let bundle = Bundle::from_json(&bytes).map_err(|e| (2, format!("{}: {e}", file.display())))?;
    if !o.any_build {
        match this_build(&o.build) {
            Some(mine) if same_build(&mine, &bundle.build) => {}
            Some(mine) => {
                return refuse(format!(
                    "{}: this clip was saved by build {} and this checkout is build {mine}. A replay by another build \
                     isn't a replay: check out {} (git checkout {}) and rebuild `jj`, or pass --any-build to replay anyway \
                     (hashes will likely differ).",
                    file.display(),
                    bundle.build,
                    bundle.build,
                    bundle.build
                ))
                .map(|r| (r, PathBuf::new()));
            }
            None => {
                return refuse(format!(
                    "{}: can't tell which build this is (no git checkout); pass --build <id> (the clip's is {}) or --any-build",
                    file.display(),
                    bundle.build
                ))
                .map(|r| (r, PathBuf::new()));
            }
        }
    }
    let report = replay(
        &bundle,
        &jj_procgen::registry(),
        &VehicleProfile::cruz(),
        o.trace,
    )
    .map_err(|e| (2, format!("{}: {e}", file.display())))?;
    let stem = file
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "clip".into());
    let out = o
        .out
        .clone()
        .unwrap_or_else(|| PathBuf::from(format!("target/jj-runs/replay-{stem}")));
    std::fs::create_dir_all(&out).map_err(|e| (2, format!("{}: {e}", out.display())))?;
    let write = |name: &str, text: String| {
        std::fs::write(out.join(name), text).map_err(|e| (2, format!("{name}: {e}")))
    };
    write(
        "report.json",
        serde_json::to_string_pretty(&report).unwrap_or_default(),
    )?;
    if o.trace {
        for (w, rows) in report.worlds.iter().zip(&report.traces) {
            let name = if report.worlds.len() == 1 {
                "trace.jsonl".to_owned()
            } else {
                format!("trace-world-{}.jsonl", w.index)
            };
            let mut text = String::new();
            for r in rows {
                text.push_str(&r.to_string());
                text.push('\n');
            }
            write(&name, text)?;
        }
    }
    Ok((report, out))
}

fn print_human(file: &Path, r: &Report, out: &Path, trace: bool) {
    println!(
        "{} {} ({}, build {}, {} world{}) → {}",
        if r.ok { "pass" } else { "FAIL" },
        file.display(),
        r.format,
        r.build,
        r.worlds.len(),
        if r.worlds.len() == 1 { "" } else { "s" },
        out.display()
    );
    for w in &r.worlds {
        let bad = w.checkpoints.iter().filter(|c| !c.ok).count();
        println!(
            "  world {} {}: {} ticks, end {}…, {} checkpoint{} ({} {}){}",
            w.index,
            w.label,
            w.ticks,
            &w.end_hash[..12],
            w.checkpoints.len(),
            if w.checkpoints.len() == 1 { "" } else { "s" },
            if bad == 0 { "all" } else { "BAD" },
            if bad == 0 {
                "match".into()
            } else {
                bad.to_string()
            },
            w.track_seed
                .map(|s| format!(", track seed {s}"))
                .unwrap_or_default()
        );
        if let Some(c) = w.checkpoints.iter().find(|c| !c.ok) {
            println!(
                "    first divergence at tick {}: recorded {}…, replayed {}…",
                c.tick,
                &c.expected[..12.min(c.expected.len())],
                &c.actual[..12.min(c.actual.len())]
            );
        }
    }
    if let Some(m) = &r.mark {
        println!(
            "  marked: world {} tick {} {:?}, state {}…",
            m.world,
            m.tick,
            m.note,
            &m.state_hash[..12]
        );
    }
    if let Some(f) = &r.fault {
        println!(
            "  the host faulted in world {} at tick {}: {} (replayed up to the last tick kept)",
            f.world, f.tick, f.message
        );
    }
    if trace {
        println!("  trace rows written next to the report (jj sim --compare reads them)");
    }
}

/// `jj sim --replay …`: the file arguments are clips or sessions.
pub fn command(files: &[PathBuf], o: &Options) -> ExitCode {
    if files.is_empty() {
        eprintln!("jj sim --replay: no clip");
        return ExitCode::from(2);
    }
    if files.len() > 1 && o.out.is_some() {
        eprintln!("jj sim --replay: --out takes one clip");
        return ExitCode::from(2);
    }
    let mut all_ok = true;
    let mut reports: Vec<Value> = Vec::new();
    for f in files {
        match run(f, o) {
            Err((code, msg)) => {
                eprintln!("jj sim --replay: {msg}");
                return ExitCode::from(code);
            }
            Ok((r, out)) => {
                all_ok &= r.ok;
                if !o.json {
                    print_human(f, &r, &out, o.trace);
                }
                reports.push(
                    json!({ "file": f.display().to_string(), "out": out.display().to_string(),
                                      "report": serde_json::to_value(&r).unwrap_or_default() }),
                );
            }
        }
    }
    if o.json {
        println!(
            "{}",
            serde_json::to_string_pretty(&reports).unwrap_or_default()
        );
    }
    if all_ok {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}
