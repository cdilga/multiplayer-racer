//! `jj sim` (P1-F05a, R90): the one native surface for seeing, setting up, stepping and asserting the sim and the
//! session core. It grew from S01's scenario runner, and the scenario bank (`scenarios/*.json`) is its fixture format.
//! The fixture format and runner live in `jj-fixture`, shared with the browser host's test surface (P1-F05b); this
//! module is the file, printing and replay side.
//!
//! A fixture sets up state directly:
//! - loads a map;
//! - spawns cars on the route or at a pose with a velocity;
//! - claims seats through the seat reducer;
//! - jumps the round director to a phase through its own inputs;
//! - places cars mid-run.
//!
//! It then steps N ticks, or until a predicate, under scripted inputs. It reads state as JSON at chosen ticks, asserts
//! envelopes on the outcome signature, and replays its own journal to the same full-state hash. Every sim change goes
//! through journaled setup commands or applied-tick inputs (one sim funnel), so every run replays.
//!
//! ```json
//! { "scenario": "three-seats", "what": "…", "map": "maps/greybox-loop.json", "seed": 1, "ticks": 600,
//!   "cars": [{ "routePoint": 16, "lateral": -3 }, { "pose": { "x": 0, "y": 1, "z": 0, "headingDeg": 90 },
//!             "linvel": [0, 0, 5] }],
//!   "seats": [{ "name": "Ava", "car": 0 }], "phase": "running",
//!   "place": [{ "tick": 300, "car": 1, "pose": { "x": 0, "y": 1, "z": 0, "headingDeg": 0 } }],
//!   "inputs": [{ "car": 0, "fromTick": 0, "toTick": 600, "throttle": 1.0, "steer": 0, "brake": 0 }],
//!   "until": { "car": 0, "metric": "travel", "min": 40 },
//!   "observe": [0, 300],
//!   "expect": [{ "car": 0, "atTick": 480, "metric": "speed", "min": 0, "max": 0.05 }],
//!   "baselines": { "kinds": ["no-input", "mash", "hold"], "differ": [{ "car": 0, "metric": "travel", "by": 5 }] } }
//! ```
//! `baselines` (§7.3a, P1-S03a) re-runs the setup with every car's inputs replaced (none, mashed, the first one held);
//! each baseline must come out different in at least one `differ` metric. `--sweep field=a..b[:n]` re-runs fixtures
//! across a tuning field's range and prints one CSV row per value × car.
//! Metrics are [`jj_sim::observe::Metric`]: state now (`speed`, `upY`, `travel`…) and signature accumulators
//! (`maxSpeed`, `maxYawRateDegS`, `maxSlipDeg`, `airtimeS`, `minUpY`, `progressM`; feel: `landings`, `landingUpY`,
//! `rebounds`, `stopDistanceM`, `stopTimeS`, `routeOffsetM`, `maxRouteOffsetM`, `maxPitchDeg`, `maxRollDeg`). An
//! `expect` without `atTick` is checked at the end of the run.

mod compare;
mod replay;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde::Serialize;
use serde_json::{Value, json};

use jj_fixture::{BaselineResult, Check, Fixture, Recorded, RunOutput, profile_with};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub scenario: String,
    pub what: String,
    pub ok: bool,
    pub ticks: u64,
    pub stopped_early: bool,
    /// Full-state hash at the end, and the hash of replaying the run's journal from its bytes.
    pub state_hash: String,
    pub replay_hash: String,
    pub replay_matches: bool,
    pub tuned: Vec<String>,
    pub checks: Vec<Check>,
    /// The baseline runs (no input, mash, hold) and whether each differed from the deliberate run (§7.3a).
    pub baselines: Vec<BaselineResult>,
    /// One object per car: every outcome-signature metric at the end of the run.
    pub signature: Vec<Value>,
    /// The full state (cars and session) at each `observe` tick and at the end.
    pub observations: Vec<Value>,
    pub out: String,
    pub trace: Option<String>,
}

/// Run options from the command line.
#[derive(Clone, Debug, Default)]
pub struct Options {
    pub trace: bool,
    pub out: Option<PathBuf>,
    /// `--set key=value` vehicle-profile overrides (the TUNED run).
    pub set: Vec<(String, String)>,
}

/// Resolves a path in a fixture: relative to the working directory, else to the repo root above the fixture file.
fn resolve(fixture_file: &Path, rel: &str) -> PathBuf {
    let direct = PathBuf::from(rel);
    if direct.exists() {
        return direct;
    }
    fixture_file
        .ancestors()
        .map(|a| a.join(rel))
        .find(|p| p.exists())
        .unwrap_or(direct)
}

pub fn run(file: &Path, opts: &Options) -> Result<Outcome, String> {
    let fx: Fixture = serde_json::from_slice(&std::fs::read(file).map_err(|e| e.to_string())?)
        .map_err(|e| format!("bad fixture: {e}"))?;
    let map_path = resolve(file, &fx.map);
    let kit = crate::find_kit(map_path.parent().unwrap_or(Path::new(".")))
        .ok_or("no assets/kit for the map")?;
    let registry = crate::load_registry(&kit).map_err(|e| e.to_string())?;
    let map = jj_map::load_json(
        &std::fs::read(&map_path).map_err(|e| format!("{}: {e}", map_path.display()))?,
        &registry,
    )
    .map_err(|r| {
        format!(
            "the map doesn't validate: {:?}",
            r.violations
                .iter()
                .map(|v| v.rule.name())
                .collect::<Vec<_>>()
        )
    })?;
    let profile = profile_with(&opts.set)?;
    let tuned: Vec<String> = opts.set.iter().map(|(k, v)| format!("{k}={v}")).collect();
    let out_dir = opts.out.clone().unwrap_or_else(|| {
        let suffix = if tuned.is_empty() { "" } else { "-tuned" };
        PathBuf::from(format!("target/jj-runs/sim-{}{suffix}", fx.scenario))
    });
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("{}: {e}", out_dir.display()))?;

    // Set up (cars journaled; seats and the director through their own inputs), step under the fixture's script,
    // replay the journal, and run the baselines (jj-fixture).
    let out = jj_fixture::run(&fx, &map, &registry, &profile, opts.trace)?;
    let ok = out.ok();
    let replay_matches = out.replay_matches();
    let RunOutput {
        ticks,
        stopped_early,
        state_hash,
        replay_hash,
        journal,
        recorded:
            Recorded {
                checks,
                signature,
                observations,
                trace,
            },
        baselines,
    } = out;
    let (scenario, what) = (fx.scenario, fx.what);
    let state_hash = jj_map::hex(&state_hash);
    let replay_hash = jj_map::hex(&replay_hash);

    let write = |name: &str, bytes: &[u8]| {
        std::fs::write(out_dir.join(name), bytes).map_err(|e| format!("{name}: {e}"))
    };
    write("journal.bin", &journal.to_bytes())?;
    let trace_path = if opts.trace {
        let mut lines = String::new();
        for row in &trace {
            lines.push_str(&row.to_string());
            lines.push('\n');
        }
        lines.push_str(
            &json!({ "summary": { "scenario": scenario, "ticks": ticks, "stateHash": state_hash,
                                   "tuned": tuned, "signature": signature } })
            .to_string(),
        );
        lines.push('\n');
        write("trace.jsonl", lines.as_bytes())?;
        Some(out_dir.join("trace.jsonl").display().to_string())
    } else {
        None
    };
    let outcome = Outcome {
        ok,
        scenario,
        what,
        ticks,
        stopped_early,
        state_hash,
        replay_hash,
        replay_matches,
        tuned,
        checks,
        baselines,
        signature,
        observations,
        out: out_dir.display().to_string(),
        trace: trace_path,
    };
    write(
        "outcome.json",
        serde_json::to_string_pretty(&outcome)
            .unwrap_or_default()
            .as_bytes(),
    )?;
    Ok(outcome)
}

fn print_human(o: &Outcome) {
    println!(
        "{} {} ({} ticks{}, state {}…, replay {}) → {}",
        if o.ok { "pass" } else { "FAIL" },
        o.scenario,
        o.ticks,
        if o.stopped_early {
            ", stopped by `until`"
        } else {
            ""
        },
        &o.state_hash[..12],
        if o.replay_matches {
            "matches"
        } else {
            "DIFFERS"
        },
        o.out
    );
    if !o.tuned.is_empty() {
        println!("  tuned: {}", o.tuned.join(" "));
    }
    if !o.checks.is_empty() {
        println!("  observed vs envelope:");
    }
    for c in &o.checks {
        let at = c.at_tick.map_or("end".to_owned(), |t| t.to_string());
        let actual = c
            .actual
            .map_or("not reached".to_owned(), |v| format!("{v:.3}"));
        println!(
            "    {} car {} @ {at:>5} {} = {actual} {} [{}, {}]",
            if c.ok { "ok " } else { "BAD" },
            c.car,
            c.metric.name(),
            if c.ok { "in" } else { "NOT in" },
            c.min,
            c.max
        );
    }
    for b in o.baselines.iter().filter(|b| !b.ok) {
        for d in &b.differ {
            let at = d.at_tick.map_or("end".to_owned(), |t| t.to_string());
            println!(
                "    BAD car {} @ {at:>5} {} = {:?} deliberate vs {:?} {:?}: not {} apart",
                d.car,
                d.metric.name(),
                d.deliberate,
                d.baseline,
                b.kind,
                d.by
            );
        }
    }
    if !o.ok {
        println!("  outcome signature at the end:");
        for s in &o.signature {
            let fields: Vec<String> = s
                .as_object()
                .into_iter()
                .flatten()
                .filter(|(k, _)| *k != "car")
                .map(|(k, v)| format!("{k} {:.3}", v.as_f64().unwrap_or(f64::NAN)))
                .collect();
            println!("    car {}: {}", s["car"], fields.join(", "));
        }
    }
}

pub const HELP: &str = "jj sim: load a fixture, set up cars, seats and the round phase, step, read state as JSON, replay.

usage: jj sim [--json] [--trace] [--out <dir>] [--set <field>=<value>]… <fixture.json>…
       jj sim --sweep <field>=<from>..<to>[:<steps>] [--set …] <fixture.json>…   (one CSV row per value × car)
       jj sim --replay [--json] [--trace] [--out <dir>] [--build <id>|--any-build] <clip.jjclip|session.jjsession>…
       jj sim [--json] <fixture.json> --compare <accepted trace|run dir>   (runs CURRENT, plus TUNED with --set)
       jj sim [--json] --compare <accepted> <current> [<tuned>]          (traces or run dirs)

Each run writes target/jj-runs/sim-<scenario>/ (outcome.json, journal.bin, trace.jsonl with --trace),
replays its journal to the same full-state hash, and exits 0 when every envelope holds and the replay
matches, 1 when not (printing what it observed against the outcome signature), 2 on usage or I/O.

--replay re-simulates what a host saved (a bug clip, F07, or a session recording, F12): every world from its map bytes, seed
and journal, checking each full-state hash the host took, and printing the end hash and the state at the marked moment.
A clip from another build is refused (check that build out, or --any-build); --trace writes trace.jsonl rows per world.

examples:
  jj sim --replay docs/evidence/BUG-1/bug.jjclip --trace
  jj sim scenarios/straight-throttle.json
  jj sim --json scenarios/*.json                       # the scenario bank, one JSON array
  jj sim --json crates/jj-tools/tests/fixtures/sim/three-seats.json   # 3 cars, 3 seats, 600 ticks
  jj sim --trace scenarios/straight-throttle.json      # one JSON row per tick + a summary row
  jj sim --trace --set max_engine_force=4000 scenarios/straight-throttle.json
  jj sim scenarios/straight-throttle.json --compare baselines/straight-throttle.trace.jsonl --set max_engine_force=4000
  jj sim --compare old/trace.jsonl target/jj-runs/sim-straight-throttle
  jj sim --sweep max_steer_rad=0.35..0.75:5 scenarios/affordances/authority.json > sweep.csv
";

/// `--sweep field=from..to[:steps]`: a tuning field stepped evenly from `from` to `to` (both included).
struct Sweep {
    field: String,
    values: Vec<f64>,
}

impl Sweep {
    fn parse(s: &str) -> Result<Self, String> {
        let bad = || format!("--sweep {s:?}: expected <field>=<from>..<to>[:<steps>]");
        let (field, range) = s.split_once('=').ok_or_else(bad)?;
        let (range, steps) = range.split_once(':').unwrap_or((range, "5"));
        let (a, b) = range.split_once("..").ok_or_else(bad)?;
        let (a, b): (f64, f64) = (a.parse().map_err(|_| bad())?, b.parse().map_err(|_| bad())?);
        let steps: usize = steps.parse().map_err(|_| bad())?;
        if steps < 2 {
            return Err(format!("--sweep {s:?}: at least 2 steps"));
        }
        // Rounded to 6 decimals so 0.35..0.75:5 reads 0.45, not 0.44999999999999996.
        let values = (0..steps)
            .map(|i| ((a + (b - a) * i as f64 / (steps - 1) as f64) * 1e6).round() / 1e6)
            .collect();
        Ok(Self {
            field: field.to_owned(),
            values,
        })
    }
}

/// One CSV row per fixture × value × car: the swept value, whether the run held its envelopes, and every
/// outcome-signature metric at its end (the tuning loop of §13b.1; S03).
fn sweep_csv(files: &[PathBuf], opts: &Options, sw: &Sweep) -> Result<String, String> {
    let mut rows: Vec<(String, f64, Value, bool)> = Vec::new();
    let mut metrics: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for f in files {
        for &v in &sw.values {
            let mut o = opts.clone();
            o.set.push((sw.field.clone(), format!("{v}")));
            o.out = Some(PathBuf::from(format!(
                "target/jj-runs/sweep-{}-{v}",
                sw.field
            )));
            let out = run(f, &o).map_err(|e| format!("{}: {e}", f.display()))?;
            for sig in out.signature {
                metrics.extend(
                    sig.as_object()
                        .into_iter()
                        .flatten()
                        .map(|(k, _)| k.clone())
                        .filter(|k| k != "car"),
                );
                rows.push((out.scenario.clone(), v, sig, out.ok));
            }
        }
    }
    let mut csv = format!("scenario,{},car,ok", sw.field);
    for m in &metrics {
        csv.push(',');
        csv.push_str(m);
    }
    csv.push('\n');
    for (scenario, v, sig, ok) in rows {
        csv.push_str(&format!("{scenario},{v},{},{ok}", sig["car"]));
        for m in &metrics {
            csv.push(',');
            if let Some(x) = sig[m.as_str()].as_f64() {
                csv.push_str(&format!("{x:.4}"));
            }
        }
        csv.push('\n');
    }
    Ok(csv)
}

/// `jj sim …`
pub fn command(args: &[String]) -> ExitCode {
    let mut json_out = false;
    let mut opts = Options::default();
    let mut compare: Vec<PathBuf> = Vec::new();
    let mut files: Vec<PathBuf> = Vec::new();
    let mut it = args.iter();
    let usage = |msg: &str| {
        eprintln!("jj sim: {msg}\n\n{HELP}");
        ExitCode::from(2)
    };
    let mut comparing = false;
    let mut replaying = false;
    let mut build: Option<String> = None;
    let mut any_build = false;
    let mut sweep: Option<Sweep> = None;
    while let Some(a) = it.next() {
        match a.as_str() {
            "-h" | "--help" => {
                println!("{HELP}");
                return ExitCode::SUCCESS;
            }
            "--json" => json_out = true,
            "--trace" => opts.trace = true,
            "--out" => match it.next() {
                Some(d) => opts.out = Some(PathBuf::from(d)),
                None => return usage("--out needs a directory"),
            },
            "--set" => match it.next().and_then(|kv| kv.split_once('=')) {
                Some((k, v)) => opts.set.push((k.to_owned(), v.to_owned())),
                None => return usage("--set needs <field>=<value>"),
            },
            "--compare" => comparing = true,
            "--replay" => replaying = true,
            "--any-build" => any_build = true,
            "--build" => match it.next() {
                Some(b) => build = Some(b.clone()),
                None => return usage("--build needs a commit id"),
            },
            "--sweep" => match it.next().map(|s| Sweep::parse(s)) {
                Some(Ok(s)) => sweep = Some(s),
                Some(Err(e)) => return usage(&e),
                None => return usage("--sweep needs <field>=<from>..<to>[:<steps>]"),
            },
            _ if comparing => compare.push(PathBuf::from(a)),
            _ => files.push(PathBuf::from(a)),
        }
    }
    if replaying {
        return replay::command(
            &files,
            &replay::Options {
                json: json_out,
                trace: opts.trace,
                out: opts.out.clone(),
                build,
                any_build,
            },
        );
    }
    if comparing {
        return compare::command(&files, &compare, &opts, json_out);
    }
    if files.is_empty() {
        return usage("no fixture");
    }
    if files.len() > 1 && opts.out.is_some() {
        return usage("--out takes one fixture");
    }
    if let Some(sw) = sweep {
        return match sweep_csv(&files, &opts, &sw) {
            Ok(csv) => {
                print!("{csv}");
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("jj sim --sweep: {e}");
                ExitCode::from(2)
            }
        };
    }
    let mut all_ok = true;
    let mut outcomes = Vec::new();
    for f in &files {
        match run(f, &opts) {
            Err(e) => {
                eprintln!("jj sim: {}: {e}", f.display());
                return ExitCode::from(2);
            }
            Ok(o) => {
                all_ok &= o.ok;
                if !json_out {
                    print_human(&o);
                }
                outcomes.push(o);
            }
        }
    }
    if json_out {
        println!(
            "{}",
            serde_json::to_string_pretty(&outcomes).unwrap_or_default()
        );
    }
    if all_ok {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}
