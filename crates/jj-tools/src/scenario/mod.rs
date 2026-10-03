//! The bootstrap scenario runner (P1-S01): JSON fixtures under `scenarios/` set up a map, cars and scripted inputs,
//! run the sim for a number of ticks and check outcome envelopes (ranges, never exact floats). P1-F05a grows this into
//! the shared introspection surface and `jj sim`.
//!
//! ```json
//! { "scenario": "idle-settle", "what": "…", "map": "maps/greybox-loop.json", "seed": 1, "ticks": 480,
//!   "cars": [{ "routePoint": 16, "lateral": 0, "lift": 0.6 }],
//!   "inputs": [{ "car": 0, "fromTick": 0, "toTick": 720, "throttle": 1.0, "steer": 0, "brake": 0 }],
//!   "expect": [{ "car": 0, "atTick": 480, "metric": "speed", "min": 0, "max": 0.05 }] }
//! ```
//! Metrics: `speed` (|v|, m/s), `forwardSpeed`, `upY`, `height` (chassis y, m), `travel` (horizontal distance from the
//! spawn, m), `lateralDrift` (distance from the spawn's heading line, m), `headingChangeDeg`, `wheelsInContact`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use jj_sim::{CarId, CarState, DriveInput, Sim, SpawnPose, VehicleProfile, route_spawn};
use jj_types::axis::quantise_axis;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scenario {
    pub scenario: String,
    pub what: String,
    pub map: String,
    pub seed: u64,
    pub ticks: u64,
    pub cars: Vec<CarSpec>,
    #[serde(default)]
    pub inputs: Vec<InputSpan>,
    pub expect: Vec<Expect>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CarSpec {
    pub route_point: usize,
    #[serde(default)]
    pub lateral: f32,
    #[serde(default = "default_lift")]
    pub lift: f32,
}

fn default_lift() -> f32 {
    0.6
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Metric {
    Speed,
    ForwardSpeed,
    UpY,
    Height,
    Travel,
    LateralDrift,
    HeadingChangeDeg,
    WheelsInContact,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Expect {
    pub car: u32,
    pub at_tick: u64,
    pub metric: Metric,
    pub min: f64,
    pub max: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub car: u32,
    pub at_tick: u64,
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
    /// Full-state hash at the end (an outcome signature; compared within a build, not across builds).
    pub state_hash: String,
    pub checks: Vec<Check>,
}

fn metric(m: Metric, s: &CarState, spawn: &SpawnPose) -> f64 {
    let (dx, dz) = (
        f64::from(s.position[0] - spawn.x),
        f64::from(s.position[2] - spawn.z),
    );
    let (hx, hz) = (
        f64::from(spawn.heading.sin()),
        f64::from(spawn.heading.cos()),
    );
    let v = s.linvel;
    match m {
        Metric::Speed => f64::from((v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt()),
        Metric::ForwardSpeed => f64::from(s.forward_speed),
        Metric::UpY => f64::from(s.up_y),
        Metric::Height => f64::from(s.position[1]),
        Metric::Travel => dx.hypot(dz),
        Metric::LateralDrift => (dx * hz - dz * hx).abs(),
        Metric::HeadingChangeDeg => {
            let d = f64::from(s.heading - spawn.heading);
            d.sin().atan2(d.cos()).abs().to_degrees()
        }
        Metric::WheelsInContact => f64::from(s.wheels_in_contact),
    }
}

/// Resolves a path in a scenario: relative to the working directory, else to the repo root above the scenario file.
fn resolve(scenario_file: &Path, rel: &str) -> PathBuf {
    let direct = PathBuf::from(rel);
    if direct.exists() {
        return direct;
    }
    scenario_file
        .ancestors()
        .map(|a| a.join(rel))
        .find(|p| p.exists())
        .unwrap_or(direct)
}

pub fn run(file: &Path) -> Result<Outcome, String> {
    let sc: Scenario = serde_json::from_slice(&std::fs::read(file).map_err(|e| e.to_string())?)
        .map_err(|e| format!("bad scenario: {e}"))?;
    let map_path = resolve(file, &sc.map);
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

    let mut sim = Sim::new(&map, &registry, sc.seed, VehicleProfile::provisional_cruz());
    let spawns: Vec<SpawnPose> = sc
        .cars
        .iter()
        .map(|c| route_spawn(&map, c.route_point, c.lateral, c.lift))
        .collect();
    for s in &spawns {
        sim.spawn_car(*s);
    }
    let mut checks: Vec<Check> = sc
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
        .collect();
    let evaluate = |sim: &Sim, checks: &mut Vec<Check>| {
        for c in checks.iter_mut().filter(|c| c.at_tick == sim.tick()) {
            if let (Some(state), Some(spawn)) =
                (sim.car_state(CarId(c.car)), spawns.get(c.car as usize))
            {
                let v = metric(c.metric, &state, spawn);
                c.actual = Some(v);
                c.ok = v >= c.min && v <= c.max;
            }
        }
    };
    evaluate(&sim, &mut checks);
    while sim.tick() < sc.ticks {
        let t = sim.tick();
        for car in 0..spawns.len() as u32 {
            let span =
                sc.inputs.iter().rev().find(|i| {
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
        evaluate(&sim, &mut checks);
    }
    Ok(Outcome {
        scenario: sc.scenario,
        what: sc.what,
        ok: checks.iter().all(|c| c.ok),
        ticks: sim.tick(),
        state_hash: jj_map::hex(&sim.state_hash()),
        checks,
    })
}

/// `jj scenario [--json] <file>…`
pub fn command(args: &[String]) -> std::process::ExitCode {
    let json = args.iter().any(|a| a == "--json");
    let files: Vec<&String> = args.iter().filter(|a| *a != "--json").collect();
    if files.is_empty() {
        eprintln!("usage: jj scenario [--json] <scenario.json>…");
        return std::process::ExitCode::from(2);
    }
    let mut all_ok = true;
    let mut outcomes = Vec::new();
    for f in files {
        match run(Path::new(f)) {
            Err(e) => {
                eprintln!("jj scenario: {f}: {e}");
                return std::process::ExitCode::from(2);
            }
            Ok(o) => {
                all_ok &= o.ok;
                if !json {
                    println!(
                        "{} {} ({} ticks, state {}…)",
                        if o.ok { "pass" } else { "FAIL" },
                        o.scenario,
                        o.ticks,
                        &o.state_hash[..12]
                    );
                    for c in &o.checks {
                        let actual = c.actual.map_or("n/a".to_owned(), |v| format!("{v:.3}"));
                        println!(
                            "  {} car {} @ {:>5} {:?} = {actual} in [{}, {}]",
                            if c.ok { "ok " } else { "BAD" },
                            c.car,
                            c.at_tick,
                            c.metric,
                            c.min,
                            c.max
                        );
                    }
                }
                outcomes.push(o);
            }
        }
    }
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&outcomes).unwrap_or_default()
        );
    }
    if all_ok {
        std::process::ExitCode::SUCCESS
    } else {
        std::process::ExitCode::from(1)
    }
}
