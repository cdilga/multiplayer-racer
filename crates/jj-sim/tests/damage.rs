//! The damage bank (P1-S04a, plan §6.3, §7.3a): contact episodes and part health, calibrated by scenarios.
//!
//! Every file in `scenarios/damage/` (listed in [`BANK`]) is a versioned scenario on the damage yard
//! (`scenarios/damage/yard.json`: the greybox with a wall and a barrier end standing in the free ground south of the
//! route). Cars spawn in the open, wait out their spawn protection, are placed at the scenario's poses with their
//! velocities, and run. Each scenario states its outcome envelope: the exact part states, which parts may have lost
//! health (every other part stays at full health: one hit damages only the parts it touched), the episodes that must
//! exist, how fast the contact closed, and the control checks of the §7.3a `control-after-hit` row. Every scenario also
//! replays bit for bit: the same inputs give the same full-state hash, and the journal rebuilds the same hash and the
//! same damage events.
//!
//! Calibration is by scenario, never by formula: `DamageTuning`'s `k` per part kind (`assets/profiles/cruz-missile.json`)
//! was set so these rows come out as plan §6.3 says, and the envelopes here are what keeps it there.
//!
//! `JJ_DAMAGE_EVIDENCE=1 cargo test -p jj-sim --test damage` rewrites `docs/evidence/P1-S04a/damage-bank.json` (the
//! scenario output: states, health, episodes and control metrics per scenario).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use jj_map::{LoadedMap, Registry, load_json};
use jj_sim::damage::{
    CarDamage, DamageEvent, EpisodeRecord, OtherBody, PART_NAMES, PARTS, part_index,
};
use jj_sim::{CarId, DriveInput, Journal, Sim, SpawnPose, TICK_HZ, VehicleProfile};
use serde::Deserialize;
use serde_json::{Value, json};

/// The bank, in the order the plan's table gives it, then the control rows.
const BANK: [&str; 8] = [
    "bump-4",
    "rest-60",
    "side-swipe-8",
    "wall-head-on-15",
    "t-bone-12",
    "wheel-kerb-12",
    "control-after-side-swipe",
    "control-after-t-bone",
];

/// Where spawned cars wait out their protection, in the open, before the scenario places them.
const WAIT_X: f32 = -60.0;
const WAIT_Z: f32 = -20.0;
/// Spawn protection is 1.5 s; two seconds is enough for cars this far apart.
const WAIT_TICKS: u64 = 2 * TICK_HZ as u64;

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Scenario {
    scenario: String,
    what: String,
    map: String,
    seed: u64,
    cars: Vec<CarSpec>,
    /// Ticks to run after the cars are placed.
    ticks: u64,
    #[serde(default)]
    inputs: Vec<InputSpan>,
    expect: Expect,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CarSpec {
    x: f32,
    z: f32,
    /// Degrees about +y; 0 faces +z, 90 faces +x.
    heading_deg: f32,
    linvel: [f32; 3],
}

/// Controls in the sim's own convention (positive steer turns left), held from `fromTick` to `toTick` (ticks since the
/// cars were placed).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InputSpan {
    car: u32,
    from_tick: u64,
    #[serde(default)]
    to_tick: Option<u64>,
    #[serde(default)]
    throttle: f32,
    #[serde(default)]
    steer: f32,
    #[serde(default)]
    brake: f32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Expect {
    /// Per car (`"0"`, `"1"`…): the parts that aren't intact. Every part not listed must be intact.
    #[serde(default)]
    states: BTreeMap<String, BTreeMap<String, String>>,
    /// The only parts allowed to have lost any health; all others stay exactly at full health.
    damaged_only: Vec<PartRef>,
    /// Health bounds for particular parts.
    #[serde(default)]
    health: Vec<HealthRange>,
    /// Episodes that must have been recorded (any one matching each entry).
    #[serde(default)]
    episodes: Vec<EpisodeExpect>,
    /// How many episode records the whole run may produce.
    #[serde(default)]
    max_episodes: Option<usize>,
    /// The sim tick of the first episode's first qualifying contact (a guard that the contact still lands where the
    /// scenario's timing and control checks expect it).
    #[serde(default)]
    hit_tick: Option<[u64; 2]>,
    /// The fastest closing speed over the episodes, m/s.
    #[serde(default)]
    closing_mps: Option<[f32; 2]>,
    /// §7.3a `control-after-hit` checks.
    #[serde(default)]
    control: Vec<ControlCheck>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct PartRef {
    car: u32,
    part: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct HealthRange {
    car: u32,
    part: String,
    min: f32,
    max: f32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EpisodeExpect {
    car: u32,
    part: String,
    /// `car:<n>`, `prop` or `scenery`.
    other: String,
}

/// A metric of a car, `after_hit` ticks (a range for a change over a window) after the first qualifying contact.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ControlCheck {
    car: u32,
    /// `upY`, `wheelsInContact`, `yawRateDegS` (|yaw rate|), `speed`, or `headingChangeDeg` (|change| over a window).
    metric: String,
    /// One tick after the hit, or the window's two ends.
    after_hit: Vec<u64>,
    min: f64,
    max: f64,
    /// Against the same run with the scripted steering removed, this metric must differ by at least this much:
    /// deliberate steering is what moves the car, not the hit (it can turn it more, or arrest a spin).
    #[serde(default)]
    differs_from_no_steer_by: Option<f64>,
}

/// What a car looked like after one tick.
#[derive(Clone, Copy, Debug)]
struct Frame {
    up_y: f64,
    wheels: f64,
    yaw_rate_deg_s: f64,
    speed: f64,
    heading_deg: f64,
}

struct Run {
    sim: Sim,
    /// Sim tick of the first frame (the tick the cars were placed at).
    placed_at: u64,
    /// `frames[car][tick - placed_at]`, after each step, with the placement state first.
    frames: Vec<Vec<Frame>>,
}

fn map_for(sc: &Scenario) -> LoadedMap {
    let bytes = std::fs::read(repo().join(&sc.map)).expect("the scenario's map");
    load_json(&bytes, &Registry::generic()).expect("the map validates")
}

fn frame(sim: &Sim, car: CarId) -> Frame {
    let s = sim.car_state(car).expect("car");
    Frame {
        up_y: f64::from(s.up_y),
        wheels: f64::from(s.wheels_in_contact),
        yaw_rate_deg_s: f64::from(s.angvel[1].abs()).to_degrees(),
        speed: f64::from(
            (s.linvel[0] * s.linvel[0] + s.linvel[1] * s.linvel[1] + s.linvel[2] * s.linvel[2])
                .sqrt(),
        ),
        heading_deg: f64::from(s.heading).to_degrees(),
    }
}

fn input_at(sc: &Scenario, car: u32, t: u64, no_steer: bool) -> DriveInput {
    let mut input = DriveInput::default();
    for s in sc
        .inputs
        .iter()
        .filter(|s| s.car == car && t >= s.from_tick && s.to_tick.is_none_or(|e| t < e))
    {
        let q = |v: f32| (v.clamp(-1.0, 1.0) * 32767.0) as i16;
        input = DriveInput {
            throttle: q(s.throttle),
            steer: if no_steer { 0 } else { q(s.steer) },
            brake: q(s.brake.max(0.0)),
            ..Default::default()
        };
    }
    input
}

fn run_scenario(sc: &Scenario, map: &LoadedMap, no_steer: bool) -> Run {
    let mut sim = Sim::new(map, &Registry::generic(), sc.seed, VehicleProfile::cruz());
    for i in 0..sc.cars.len() {
        sim.spawn_car(SpawnPose {
            x: WAIT_X + 12.0 * i as f32,
            y: 0.1,
            z: WAIT_Z,
            heading: 0.0,
        });
    }
    for _ in 0..WAIT_TICKS {
        sim.step();
    }
    for i in 0..sc.cars.len() {
        assert!(
            !sim.is_protected(CarId(i as u32)),
            "{}: car {i} still protected",
            sc.scenario
        );
    }
    for (i, c) in sc.cars.iter().enumerate() {
        sim.place_car(
            CarId(i as u32),
            SpawnPose {
                x: c.x,
                y: 0.05,
                z: c.z,
                heading: c.heading_deg.to_radians(),
            },
            0.0,
            c.linvel,
        );
    }
    let placed_at = sim.tick();
    let mut frames: Vec<Vec<Frame>> = (0..sc.cars.len())
        .map(|i| vec![frame(&sim, CarId(i as u32))])
        .collect();
    for t in 0..sc.ticks {
        for i in 0..sc.cars.len() {
            sim.set_input(CarId(i as u32), input_at(sc, i as u32, t, no_steer));
        }
        sim.step();
        for (i, f) in frames.iter_mut().enumerate() {
            f.push(frame(&sim, CarId(i as u32)));
        }
    }
    Run {
        sim,
        placed_at,
        frames,
    }
}

fn episodes(sim: &Sim) -> Vec<EpisodeRecord> {
    sim.damage_events()
        .iter()
        .filter_map(|(_, e)| match e {
            DamageEvent::Episode(r) => Some(*r),
            _ => None,
        })
        .collect()
}

fn other_matches(want: &str, got: OtherBody) -> bool {
    match got {
        OtherBody::Car { car } => want == format!("car:{car}"),
        OtherBody::Prop { .. } => want == "prop",
        OtherBody::Scenery => want == "scenery",
    }
}

fn metric(run: &Run, car: u32, name: &str, at: &[u64], hit: u64) -> f64 {
    let frames = &run.frames[car as usize];
    let idx = |t: u64| ((hit + t).saturating_sub(run.placed_at) as usize).min(frames.len() - 1);
    let f = frames[idx(at[0])];
    match name {
        "upY" => f.up_y,
        "wheelsInContact" => f.wheels,
        "yawRateDegS" => f.yaw_rate_deg_s,
        "speed" => f.speed,
        "headingChangeDeg" => {
            let d = (frames[idx(at[1])].heading_deg - f.heading_deg).to_radians();
            d.sin().atan2(d.cos()).abs().to_degrees()
        }
        other => panic!("unknown control metric {other}"),
    }
}

/// Checks a run against its scenario's envelopes; returns the problems.
fn check(sc: &Scenario, run: &Run, map: &LoadedMap) -> Vec<String> {
    let mut bad = Vec::new();
    let sim = &run.sim;
    let eps = episodes(sim);
    let ex = &sc.expect;
    for car in 0..sc.cars.len() as u32 {
        let states = sim.part_states(CarId(car)).expect("car");
        let health = sim.part_health(CarId(car)).expect("car");
        let want: BTreeMap<&str, &str> = ex
            .states
            .get(&car.to_string())
            .map(|m| m.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect())
            .unwrap_or_default();
        for (i, name) in PART_NAMES.iter().enumerate() {
            let expected = want.get(name).copied().unwrap_or("intact");
            if states[i].name() != expected {
                bad.push(format!(
                    "car {car} {name}: {} (health {:.1}), expected {expected}",
                    states[i].name(),
                    health[i]
                ));
            }
        }
        let full = CarDamage::new(&VehicleProfile::cruz().tuning.damage).start;
        for (i, name) in PART_NAMES.iter().enumerate().skip(1) {
            let start = full[i];
            let allowed = ex
                .damaged_only
                .iter()
                .any(|p| p.car == car && p.part == *name);
            if !allowed && health[i] != start {
                bad.push(format!(
                    "car {car} {name} took damage ({:.2} of {start}) but this hit didn't touch it",
                    health[i]
                ));
            }
            if allowed && health[i] >= start {
                bad.push(format!(
                    "car {car} {name} was meant to be hit but is at full health"
                ));
            }
        }
    }
    for h in &ex.health {
        let i = part_index(&h.part).expect("part name");
        let v = sim.part_health(CarId(h.car)).expect("car")[i];
        if !(h.min..=h.max).contains(&v) {
            bad.push(format!(
                "car {} {} health {v:.1} not in [{}, {}]",
                h.car, h.part, h.min, h.max
            ));
        }
    }
    for e in &ex.episodes {
        let i = part_index(&e.part).expect("part name") as u8;
        if !eps
            .iter()
            .any(|r| r.car == e.car && r.part == i && other_matches(&e.other, r.other))
        {
            bad.push(format!(
                "no episode: car {} {} <- {}",
                e.car, e.part, e.other
            ));
        }
    }
    if let Some(n) = ex.max_episodes
        && eps.len() > n
    {
        bad.push(format!("{} episodes, at most {n} expected", eps.len()));
    }
    let first_hit = eps.iter().map(|r| r.start_tick).min();
    if let Some([lo, hi]) = ex.hit_tick {
        match first_hit {
            Some(t) if (lo..=hi).contains(&(t - run.placed_at)) => {}
            other => bad.push(format!(
                "first hit at {:?} ticks after placement, expected [{lo}, {hi}]",
                other.map(|t| t - run.placed_at)
            )),
        }
    }
    if let Some([lo, hi]) = ex.closing_mps {
        let c = eps.iter().map(|r| r.closing_mps).fold(0.0, f32::max);
        if !(lo..=hi).contains(&c) {
            bad.push(format!("closing speed {c:.2} m/s not in [{lo}, {hi}]"));
        }
    }
    if !ex.control.is_empty() {
        let hit = first_hit.expect("a control check needs a hit");
        let baseline = ex
            .control
            .iter()
            .any(|c| c.differs_from_no_steer_by.is_some())
            .then(|| run_scenario(sc, map, true));
        for c in &ex.control {
            let v = metric(run, c.car, &c.metric, &c.after_hit, hit);
            if !(c.min..=c.max).contains(&v) {
                bad.push(format!(
                    "car {} {} {:?} ticks after the hit = {v:.2}, not in [{}, {}]",
                    c.car, c.metric, c.after_hit, c.min, c.max
                ));
            }
            if let (Some(by), Some(b)) = (c.differs_from_no_steer_by, &baseline) {
                let base = metric(b, c.car, &c.metric, &c.after_hit, hit);
                if (v - base).abs() < by {
                    bad.push(format!(
                        "car {} {}: {v:.2} with steering vs {base:.2} without, expected them to differ by at least {by}",
                        c.car, c.metric
                    ));
                }
            }
        }
    }
    bad
}

/// The scenario's output as data (the evidence file and the failure message).
fn output(sc: &Scenario, run: &Run) -> Value {
    let sim = &run.sim;
    let cars: Vec<Value> = (0..sc.cars.len() as u32)
        .map(|c| {
            let health = sim.part_health(CarId(c)).expect("car");
            let states = sim.part_states(CarId(c)).expect("car");
            let parts: Vec<Value> = (1..PARTS)
                .map(|i| json!({ "part": PART_NAMES[i], "health": health[i], "state": states[i].name() }))
                .collect();
            json!({ "car": c, "parts": parts })
        })
        .collect();
    let events: Vec<Value> = sim
        .damage_events()
        .iter()
        .map(|(at, e)| json!({ "at": at, "damage": e }))
        .collect();
    json!({
        "scenario": sc.scenario,
        "what": sc.what,
        "ticks": sc.ticks,
        "stateHash": jj_map::hex(&sim.state_hash()),
        "cars": cars,
        "events": events,
    })
}

fn load(name: &str) -> Scenario {
    let path = repo().join(format!("scenarios/damage/{name}.json"));
    serde_json::from_slice(
        &std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display())),
    )
    .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

#[test]
fn the_damage_bank_holds_its_envelopes_and_replays_bit_for_bit() {
    let mut failures = Vec::new();
    let mut evidence = Vec::new();
    for name in BANK {
        let sc = load(name);
        assert_eq!(sc.scenario, name, "the file names its scenario");
        let map = map_for(&sc);
        let run = run_scenario(&sc, &map, false);
        let bad = check(&sc, &run, &map);
        if std::env::var("JJ_DAMAGE_TRACE").is_ok_and(|v| v == name) {
            for (car, frames) in run.frames.iter().enumerate() {
                for (i, f) in frames.iter().enumerate().step_by(10) {
                    eprintln!("{name} car {car} +{i}: {f:?}");
                }
            }
        }
        if !bad.is_empty() {
            failures.push(format!(
                "{name}: {}\n    {}",
                bad.join("; "),
                output(&sc, &run)["events"]
            ));
        }
        // The same inputs again give the same state, and the journal rebuilds it, damage and all.
        let again = run_scenario(&sc, &map, false);
        if again.sim.state_hash() != run.sim.state_hash() {
            failures.push(format!("{name}: two runs differ"));
        }
        let journal = Journal::from_bytes(&run.sim.journal().to_bytes()).expect("journal bytes");
        let replayed = Sim::replay(
            &map,
            &Registry::generic(),
            VehicleProfile::cruz(),
            &journal,
            run.sim.tick(),
        );
        if replayed.state_hash() != run.sim.state_hash() {
            failures.push(format!("{name}: the journal replay differs"));
        }
        if format!("{:?}", replayed.damage_events()) != format!("{:?}", run.sim.damage_events()) {
            failures.push(format!("{name}: the replay's damage events differ"));
        }
        evidence.push(output(&sc, &run));
    }
    if std::env::var_os("JJ_DAMAGE_EVIDENCE").is_some() {
        let dir = repo().join("docs/evidence/P1-S04a");
        std::fs::create_dir_all(&dir).expect("evidence dir");
        std::fs::write(
            dir.join("damage-bank.json"),
            serde_json::to_string_pretty(&evidence).expect("json") + "\n",
        )
        .expect("write evidence");
    }
    assert!(
        failures.is_empty(),
        "damage bank:\n  {}",
        failures.join("\n  ")
    );
}
