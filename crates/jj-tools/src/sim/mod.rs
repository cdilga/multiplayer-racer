//! `jj sim` (P1-F05a, R90): the one native surface for seeing, setting up, stepping and asserting the sim and the
//! session core. It grew from S01's scenario runner, and the scenario bank (`scenarios/*.json`) is its fixture format.
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
mod session;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use jj_sim::observe::{Metric, RouteGeom, SignatureTracker, observe_cars};
use jj_sim::{CarId, DriveInput, Journal, Sim, SpawnPose, VehicleProfile, route_spawn};
use jj_types::axis::{dequantise_axis, quantise_axis};

pub use session::PhaseTarget;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Fixture {
    pub scenario: String,
    pub what: String,
    pub map: String,
    pub seed: u64,
    pub ticks: u64,
    #[serde(default)]
    pub cars: Vec<CarSpec>,
    #[serde(default)]
    pub seats: Vec<SeatSpec>,
    #[serde(default)]
    pub phase: Option<PhaseTarget>,
    #[serde(default)]
    pub place: Vec<PlaceSpec>,
    /// Starts the race (countdown completion) at a tick with a lap count.
    #[serde(default)]
    pub race: Option<RaceSpec>,
    /// Recover-button presses.
    #[serde(default)]
    pub recover: Vec<RecoverSpec>,
    #[serde(default)]
    pub inputs: Vec<InputSpan>,
    #[serde(default)]
    pub until: Option<Until>,
    /// Ticks at which to record the full state (the end of the run is always recorded).
    #[serde(default)]
    pub observe: Vec<u64>,
    #[serde(default)]
    pub expect: Vec<Expect>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PoseSpec {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    #[serde(default)]
    pub heading_deg: f32,
    /// About the car's own forward axis (180 = on its roof, ±90 = on a side).
    #[serde(default)]
    pub roll_deg: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RaceSpec {
    #[serde(default = "default_laps")]
    pub laps: u32,
    #[serde(default)]
    pub at_tick: u64,
}

fn default_laps() -> u32 {
    jj_sim::race::DEFAULT_LAPS
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoverSpec {
    pub tick: u64,
    pub car: u32,
}

impl PoseSpec {
    fn spawn(self) -> SpawnPose {
        SpawnPose {
            x: self.x,
            y: self.y,
            z: self.z,
            heading: self.heading_deg.to_radians(),
        }
    }
}

/// A car on route point `routePoint` (`lateral` m to the side, `lift` m up) or at an explicit `pose`, with an optional
/// starting velocity.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CarSpec {
    #[serde(default)]
    pub route_point: Option<usize>,
    #[serde(default)]
    pub lateral: f32,
    #[serde(default = "default_lift")]
    pub lift: f32,
    #[serde(default)]
    pub pose: Option<PoseSpec>,
    #[serde(default)]
    pub linvel: Option<[f32; 3]>,
}

fn default_lift() -> f32 {
    0.6
}

/// A seat claimed through the seat reducer (Hello + Claim + a tick boundary), optionally driving car `car`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeatSpec {
    pub name: String,
    #[serde(default)]
    pub car: Option<u32>,
}

/// Teleports a car at a tick (a journaled setup command).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaceSpec {
    pub tick: u64,
    pub car: u32,
    pub pose: PoseSpec,
    #[serde(default)]
    pub linvel: [f32; 3],
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InputSpan {
    pub car: u32,
    pub from_tick: u64,
    #[serde(default)]
    pub to_tick: Option<u64>,
    #[serde(default)]
    pub throttle: f32,
    #[serde(default)]
    pub steer: f32,
    #[serde(default)]
    pub brake: f32,
}

/// Stop early once a car's metric is inside `[min, max]`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Until {
    pub car: u32,
    pub metric: Metric,
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Expect {
    pub car: u32,
    /// Checked after this tick; omitted, at the end of the run.
    #[serde(default)]
    pub at_tick: Option<u64>,
    pub metric: Metric,
    pub min: f64,
    pub max: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub car: u32,
    pub at_tick: Option<u64>,
    pub metric: Metric,
    pub min: f64,
    pub max: f64,
    pub actual: Option<f64>,
    pub ok: bool,
}

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

/// The provisional Cruz profile with `--set` overrides applied by field name (`max_engine_force=4000`).
pub fn profile_with(set: &[(String, String)]) -> Result<VehicleProfile, String> {
    let mut v =
        serde_json::to_value(VehicleProfile::provisional_cruz()).map_err(|e| e.to_string())?;
    for (k, raw) in set {
        let obj = v.as_object_mut().ok_or("the profile isn't an object")?;
        if !obj.contains_key(k) {
            let keys: Vec<&String> = obj.keys().collect();
            return Err(format!("--set: no profile field {k:?}; fields: {keys:?}"));
        }
        let val: Value = serde_json::from_str(raw).unwrap_or(Value::String(raw.clone()));
        obj.insert(k.clone(), val);
    }
    serde_json::from_value(v).map_err(|e| format!("--set: {e}"))
}

fn signature_json(car: u32, t: &SignatureTracker) -> Value {
    let mut m = serde_json::Map::new();
    m.insert("car".into(), json!(car));
    for (name, v) in t.signature() {
        m.insert(name.into(), json!(v));
    }
    Value::Object(m)
}

/// Observes the run tick by tick: signatures, envelope checks, snapshots and the trace.
struct Recorder<'a> {
    fx: &'a Fixture,
    route: &'a RouteGeom,
    trace_on: bool,
    trackers: Vec<SignatureTracker>,
    checks: Vec<Check>,
    observations: Vec<Value>,
    trace: Vec<Value>,
    /// How much of the journal earlier trace rows have reported.
    seen_setup: usize,
    seen_inputs: usize,
    seen_race: usize,
}

impl Recorder<'_> {
    /// What changed the sim since the previous row: the journal's setup commands and input changes, and the race's events
    /// (gates, laps, assist, respawns, the race end; P1-S05), each with its tick. Contacts and detaches join later (S04).
    fn events(&mut self, sim: &Sim) -> Vec<Value> {
        let j = sim.journal();
        let mut events: Vec<Value> = j.setup[self.seen_setup..]
            .iter()
            .map(|(at, setup)| json!({ "at": at, "setup": setup }))
            .collect();
        events.extend(j.entries[self.seen_inputs..].iter().map(|e| {
            json!({ "at": e.tick, "input": { "car": e.car, "throttle": dequantise_axis(e.input.throttle),
                                             "steer": dequantise_axis(e.input.steer),
                                             "brake": dequantise_axis(e.input.brake) } })
        }));
        (self.seen_setup, self.seen_inputs) = (j.setup.len(), j.entries.len());
        let race = sim.race().events();
        events.extend(
            race[self.seen_race..]
                .iter()
                .map(|(at, e)| json!({ "at": at, "race": e })),
        );
        self.seen_race = race.len();
        events
    }

    /// Records the state after a tick (`end`: the last one); returns whether the `until` predicate holds.
    fn record(&mut self, sim: &Sim, session: &session::Session, end: bool) -> bool {
        let cars = observe_cars(sim, self.route);
        for (t, o) in self.trackers.iter_mut().zip(&cars) {
            t.update(o);
        }
        let tick = sim.tick();
        self.check(tick, end);
        if end || self.fx.observe.contains(&tick) {
            self.observations
                .push(json!({ "tick": tick, "cars": cars, "session": session.observe() }));
        }
        if self.trace_on {
            let events = self.events(sim);
            self.trace
                .push(json!({ "tick": tick, "cars": cars, "events": events }));
        }
        self.fx.until.as_ref().is_some_and(|u| {
            self.trackers
                .get(u.car as usize)
                .and_then(|t| t.metric(u.metric))
                .is_some_and(|v| u.min.is_none_or(|m| v >= m) && u.max.is_none_or(|m| v <= m))
        })
    }

    /// `until` stopped the run at this tick: it's the end, so check the end-of-run envelopes and snapshot it.
    fn end_here(&mut self, sim: &Sim, session: &session::Session) {
        let tick = sim.tick();
        self.check(tick, true);
        if !self.fx.observe.contains(&tick) {
            self.observations.push(
                json!({ "tick": tick, "cars": observe_cars(sim, self.route), "session": session.observe() }),
            );
        }
    }

    fn check(&mut self, tick: u64, end: bool) {
        for c in self
            .checks
            .iter_mut()
            .filter(|c| c.at_tick == Some(tick) || (end && c.at_tick.is_none()))
        {
            if let Some(t) = self.trackers.get(c.car as usize) {
                c.actual = t.metric(c.metric);
                c.ok = c.actual.is_some_and(|v| v >= c.min && v <= c.max);
            }
        }
    }
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
    let route = RouteGeom::new(&map.map);
    let tuned: Vec<String> = opts.set.iter().map(|(k, v)| format!("{k}={v}")).collect();
    let out_dir = opts.out.clone().unwrap_or_else(|| {
        let suffix = if tuned.is_empty() { "" } else { "-tuned" };
        PathBuf::from(format!("target/jj-runs/sim-{}{suffix}", fx.scenario))
    });
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("{}: {e}", out_dir.display()))?;

    // Set up: cars (journaled), seats and the director (through their own inputs).
    let mut sim = Sim::new(&map, &registry, fx.seed, profile.clone());
    let mut spawns = Vec::new();
    for (i, c) in fx.cars.iter().enumerate() {
        let pose = match (c.pose, c.route_point) {
            (Some(p), _) => p.spawn(),
            (None, Some(rp)) => route_spawn(&map, rp, c.lateral, c.lift),
            (None, None) => return Err(format!("cars[{i}] needs routePoint or pose")),
        };
        let id = sim.spawn_car(pose);
        let roll = c.pose.map_or(0.0, |p| p.roll_deg.to_radians());
        if c.linvel.is_some() || roll != 0.0 {
            sim.place_car(id, pose, roll, c.linvel.unwrap_or([0.0; 3]));
        }
        spawns.push(pose);
    }
    let mut session = session::Session::new(&fx.seats)?;
    if let Some(phase) = fx.phase {
        session.jump(phase)?;
    }

    let mut rec = Recorder {
        fx: &fx,
        route: &route,
        trace_on: opts.trace,
        trackers: spawns
            .iter()
            .map(|&s| SignatureTracker::new(s, &route))
            .collect(),
        checks: fx
            .expect
            .iter()
            .map(|e| Check {
                car: e.car,
                at_tick: e.at_tick,
                metric: e.metric,
                min: e.min,
                max: e.max,
                actual: None,
                ok: false,
            })
            .collect(),
        observations: Vec::new(),
        trace: Vec::new(),
        seen_setup: 0,
        seen_inputs: 0,
        seen_race: 0,
    };
    let mut stopped_early = false;
    rec.record(&sim, &session, fx.ticks == 0);
    while sim.tick() < fx.ticks {
        let t = sim.tick();
        if let Some(r) = fx.race.as_ref().filter(|r| r.at_tick == t) {
            sim.start_race(r.laps);
        }
        for p in fx.place.iter().filter(|p| p.tick == t) {
            sim.place_car(
                CarId(p.car),
                p.pose.spawn(),
                p.pose.roll_deg.to_radians(),
                p.linvel,
            );
        }
        for r in fx.recover.iter().filter(|r| r.tick == t) {
            sim.recover(CarId(r.car));
        }
        for car in 0..spawns.len() as u32 {
            let span =
                fx.inputs.iter().rev().find(|i| {
                    i.car == car && i.from_tick <= t && i.to_tick.is_none_or(|end| t < end)
                });
            let input = span.map_or(DriveInput::default(), |i| DriveInput {
                throttle: quantise_axis(i.throttle),
                steer: quantise_axis(i.steer),
                brake: quantise_axis(i.brake.max(0.0)),
            });
            sim.set_input(CarId(car), input);
        }
        sim.step();
        session.step(sim.tick());
        let last = sim.tick() == fx.ticks;
        if rec.record(&sim, &session, last) && !last {
            stopped_early = true;
            rec.end_here(&sim, &session);
            break;
        }
    }
    let Recorder {
        trackers,
        checks,
        observations,
        trace,
        ..
    } = rec;
    // Replay the journal from its bytes: same hash, or the run isn't reproducible.
    let journal = Journal::from_bytes(&sim.journal().to_bytes()).map_err(|e| e.to_string())?;
    let replayed = Sim::replay(&map, &registry, profile, &journal, sim.tick());
    let state_hash = jj_map::hex(&sim.state_hash());
    let replay_hash = jj_map::hex(&replayed.state_hash());
    let replay_matches = state_hash == replay_hash;
    let signature: Vec<Value> = trackers
        .iter()
        .enumerate()
        .map(|(i, t)| signature_json(i as u32, t))
        .collect();

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
            &json!({ "summary": { "scenario": fx.scenario, "ticks": sim.tick(), "stateHash": state_hash,
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
        scenario: fx.scenario,
        what: fx.what,
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
