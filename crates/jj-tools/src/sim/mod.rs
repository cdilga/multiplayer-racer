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
//!   "expect": [{ "car": 0, "atTick": 480, "metric": "speed", "min": 0, "max": 0.05 }] }
//! ```
//! Metrics are [`jj_sim::observe::Metric`]: state now (`speed`, `upY`, `travel`…) and signature accumulators
//! (`maxSpeed`, `maxYawRateDegS`, `maxSlipDeg`, `airtimeS`, `minUpY`, `progressM`). An `expect` without `atTick` is
//! checked at the end of the run.

mod compare;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde::Serialize;
use serde_json::{Value, json};

use jj_sim::{Journal, Sim};

use jj_fixture::{Check, Fixture, Harness, Recorded, profile_with};

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

    // Set up (cars journaled; seats and the director through their own inputs), then step under the fixture's script.
    let (scenario, what, ticks) = (fx.scenario.clone(), fx.what.clone(), fx.ticks);
    let mut sim = Sim::new(&map, &registry, fx.seed, profile.clone());
    let mut harness = Harness::new(fx, &map, &mut sim, opts.trace)?;
    let mut stopped_early = false;
    harness.record(&sim, ticks == 0);
    while sim.tick() < ticks {
        harness.before_step(&mut sim);
        sim.step();
        let last = sim.tick() == ticks;
        if harness.after_step(&sim, last) && !last {
            stopped_early = true;
            harness.end_here(&sim);
            break;
        }
    }
    let Recorded {
        checks,
        signature,
        observations,
        trace,
    } = harness.finish();
    // Replay the journal from its bytes: same hash, or the run isn't reproducible.
    let journal = Journal::from_bytes(&sim.journal().to_bytes()).map_err(|e| e.to_string())?;
    let replayed = Sim::replay(&map, &registry, profile, &journal, sim.tick());
    let state_hash = jj_map::hex(&sim.state_hash());
    let replay_hash = jj_map::hex(&replayed.state_hash());
    let replay_matches = state_hash == replay_hash;

    let write = |name: &str, bytes: &[u8]| {
        std::fs::write(out_dir.join(name), bytes).map_err(|e| format!("{name}: {e}"))
    };
    write("journal.bin", &sim.journal().to_bytes())?;
    let trace_path = if opts.trace {
        let mut lines = String::new();
        for row in &trace {
            lines.push_str(&row.to_string());
            lines.push('\n');
        }
        lines.push_str(
            &json!({ "summary": { "scenario": scenario, "ticks": sim.tick(), "stateHash": state_hash,
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
        ok: checks.iter().all(|c| c.ok) && replay_matches,
        scenario,
        what,
        ticks: sim.tick(),
        stopped_early,
        state_hash,
        replay_hash,
        replay_matches,
        tuned,
        checks,
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
       jj sim [--json] <fixture.json> --compare <accepted trace|run dir>   (runs CURRENT, plus TUNED with --set)
       jj sim [--json] --compare <accepted> <current> [<tuned>]          (traces or run dirs)

Each run writes target/jj-runs/sim-<scenario>/ (outcome.json, journal.bin, trace.jsonl with --trace),
replays its journal to the same full-state hash, and exits 0 when every envelope holds and the replay
matches, 1 when not (printing what it observed against the outcome signature), 2 on usage or I/O.

examples:
  jj sim scenarios/straight-throttle.json
  jj sim --json scenarios/*.json                       # the scenario bank, one JSON array
  jj sim --json crates/jj-tools/tests/fixtures/sim/three-seats.json   # 3 cars, 3 seats, 600 ticks
  jj sim --trace scenarios/straight-throttle.json      # one JSON row per tick + a summary row
  jj sim --trace --set max_engine_force=4000 scenarios/straight-throttle.json
  jj sim scenarios/straight-throttle.json --compare baselines/straight-throttle.trace.jsonl --set max_engine_force=4000
  jj sim --compare old/trace.jsonl target/jj-runs/sim-straight-throttle
";

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
            _ if comparing => compare.push(PathBuf::from(a)),
            _ => files.push(PathBuf::from(a)),
        }
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
