//! The sim fixture format and its runner (R90): set a state up directly, step it, read it as JSON, assert envelopes.
//! P1-F05a built it for `jj sim`; it lives here so the browser host's test surface (P1-F05b, `jj-wasm-host` with the
//! `testing` feature) runs the very same setup and stepping, and so gets the same full-state hash for the same fixture.
//!
//! A [`Fixture`] is the scenario-bank JSON (`scenarios/*.json`; its shape is documented in `jj sim --help`). A
//! [`Harness`] owns everything about a run except the [`Sim`]: the fixture's scripted events and inputs, its seats and
//! round phase, and the recorder (outcome signatures, envelope checks, observations, the trace). The caller owns the
//! loop, so `jj sim` and the browser host can each step it their own way:
//!
//! ```text
//! let mut h = Harness::new(fixture, &map, &mut sim, trace)?;   // cars, grid, seats, phase
//! h.record(&sim, false);
//! loop { h.before_step(&mut sim); sim.step(); if h.after_step(&sim, last) { … } }
//! let recorded = h.finish();
//! ```

pub mod clip;
pub mod run;
pub mod session;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use jj_map::LoadedMap;
use jj_sim::observe::{Metric, RouteGeom, SignatureTracker, observe_cars};
use jj_sim::{CarId, DriveInput, Sim, SpawnPose, VehicleProfile, route_spawn};
use jj_types::axis::{dequantise_axis, quantise_axis};

pub use run::{BaselineResult, DifferResult, RunOutput, run};
pub use session::{PhaseTarget, Session};

#[derive(Clone, Debug, Deserialize)]
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
    /// Spawn this many more cars through the start grid (P1-S06), after `cars`.
    #[serde(default)]
    pub grid: Option<usize>,
    /// Seats joining mid-round through the placement service.
    #[serde(default)]
    pub drop_in: Vec<TickSpec>,
    /// Dynamic debris bodies (cuboids, half extents in m) injected at a tick.
    #[serde(default)]
    pub debris: Vec<DebrisSpec>,
    /// Part health set at a tick (R90 "settable", P1-S04b): the damage state without a crash.
    #[serde(default)]
    pub damage: Vec<PartHealthSpec>,
    /// Cars wrecked at a tick, as the stuck-flip rule would (P1-S04c).
    #[serde(default)]
    pub wreck: Vec<RecoverSpec>,
    /// The autopilot takes a car (`on`) or hands it back (P1-S07).
    #[serde(default)]
    pub autopilot: Vec<AutopilotSpec>,
    #[serde(default)]
    pub inputs: Vec<InputSpan>,
    #[serde(default)]
    pub until: Option<Until>,
    /// Ticks at which to record the full state (the end of the run is always recorded).
    #[serde(default)]
    pub observe: Vec<u64>,
    #[serde(default)]
    pub expect: Vec<Expect>,
    /// The same setup re-run with every car's scripted inputs replaced (no input, mashing, holding the first input),
    /// and the metrics that must come out different from the deliberate run's (§7.3a, P1-S03).
    #[serde(default)]
    pub baselines: Option<Baselines>,
}

/// Baseline runs, and what must come out different in each of them.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Baselines {
    #[serde(default = "all_baselines")]
    pub kinds: Vec<BaselineKind>,
    pub differ: Vec<Differ>,
}

fn all_baselines() -> Vec<BaselineKind> {
    vec![
        BaselineKind::NoInput,
        BaselineKind::Mash,
        BaselineKind::Hold,
    ]
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BaselineKind {
    /// No scripted input at all.
    NoInput,
    /// Every car's sticks thrown somewhere new every 50 ms (seeded): DRIVE anywhere, ACTION drifting or boosting at
    /// random.
    Mash,
    /// Every car holds its first scripted input for the whole run.
    Hold,
    /// The same inputs without the ACTION stick: no drift, no boost (§7.3a "faster with boost than without").
    NoAction,
    /// The same inputs with boost held throughout (§7.3a "boost-forever isn't the best line").
    BoostForever,
}

/// A car's metric (at `atTick`, else the end) and the margin it differs from a baseline's by. A baseline differs when
/// at least one listed metric does; a metric only one of the runs has (a stop, a landing) differs by definition.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Differ {
    pub car: u32,
    pub metric: Metric,
    #[serde(default)]
    pub at_tick: Option<u64>,
    pub by: f64,
    /// The deliberate run must come out *higher* by `by`, not just different (a claim like "faster with boost").
    #[serde(default)]
    pub more: bool,
    /// The deliberate run must come out *lower* by `by` (a cost, like "a follower hitting a cone loses a little time").
    #[serde(default)]
    pub less: bool,
    /// And differ by no more than this (a cost that stays "a little").
    #[serde(default)]
    pub at_most: Option<f64>,
    /// The baselines this entry judges (empty: all of them).
    #[serde(default)]
    pub against: Vec<BaselineKind>,
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

#[derive(Clone, Debug, Deserialize)]
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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoverSpec {
    pub tick: u64,
    pub car: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TickSpec {
    pub tick: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutopilotSpec {
    pub tick: u64,
    pub car: u32,
    pub on: bool,
}

/// A part's health set at a tick: `part` is a contract part name (`front`, `door_FL`, `wheel_RR`…).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PartHealthSpec {
    pub tick: u64,
    pub car: u32,
    pub part: String,
    pub health: f32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DebrisSpec {
    pub tick: u64,
    pub pose: PoseSpec,
    pub half: [f32; 3],
}

impl PoseSpec {
    pub fn spawn(self) -> SpawnPose {
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
#[derive(Clone, Debug, Deserialize)]
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
    jj_sim::placement::SPAWN_LIFT_M
}

/// A seat claimed through the seat reducer (Hello + Claim + a tick boundary), optionally driving car `car`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeatSpec {
    pub name: String,
    #[serde(default)]
    pub car: Option<u32>,
}

/// Teleports a car at a tick (a journaled setup command).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaceSpec {
    pub tick: u64,
    pub car: u32,
    pub pose: PoseSpec,
    #[serde(default)]
    pub linvel: [f32; 3],
}

#[derive(Clone, Debug, Deserialize)]
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
    /// ACTION left held: the handbrake drift (P1-S03b).
    #[serde(default)]
    pub drift: bool,
    /// ACTION right held: boost (P1-S03b).
    #[serde(default)]
    pub boost: bool,
    /// The raw DRIVE stick (x right, y up; −1..1) instead of the fields above (P1-S03c). A car with any `stick` span
    /// is driven through jj-input's source machine every tick, as a host pad is, so its gestures (the wheelie) are
    /// detected the real way; between its stick spans it reads neutral.
    #[serde(default)]
    pub stick: Option<[f32; 2]>,
    /// The raw ACTION stick alongside `stick` (x right boosts, left drifts).
    #[serde(default)]
    pub action: Option<[f32; 2]>,
    /// The touch is cancelled for this span (a `pointercancel`: the source reads unavailable, so its sticks are
    /// neutral and every pending detection drops without firing; P1-S08's `utility-intent`).
    #[serde(default)]
    pub cancel: bool,
}

/// Stop early once a car's metric is inside `[min, max]`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Until {
    pub car: u32,
    pub metric: Metric,
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
}

#[derive(Clone, Debug, Deserialize)]
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

#[derive(Clone, Debug, Serialize)]
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

/// The Cruz Missile profile with `--set` overrides applied by tuning field name (`max_engine_force=4000`).
pub fn profile_with(set: &[(String, String)]) -> Result<VehicleProfile, String> {
    profile_from(VehicleProfile::cruz(), set)
}

/// `base` with its tuning fields overridden by name (`max_engine_force=4000`, `surfaces.gravel=0.6`): the TUNED run and
/// `jj sim --sweep`. Geometry comes from the sidecar and isn't settable.
pub fn profile_from(
    base: VehicleProfile,
    set: &[(String, String)],
) -> Result<VehicleProfile, String> {
    let mut v = serde_json::to_value(base).map_err(|e| e.to_string())?;
    for (k, raw) in set {
        let mut at = v.get_mut("tuning").ok_or("the profile has no tuning")?;
        let path: Vec<&str> = k.split('.').collect();
        for (i, part) in path.iter().enumerate() {
            let obj = at
                .as_object_mut()
                .ok_or_else(|| format!("--set {k}: not an object above {part:?}"))?;
            if !obj.contains_key(*part) {
                let keys: Vec<&String> = obj.keys().collect();
                return Err(format!("--set: no tuning field {k:?}; fields: {keys:?}"));
            }
            if i + 1 == path.len() {
                let val: Value = serde_json::from_str(raw).unwrap_or(Value::String(raw.clone()));
                obj.insert((*part).to_owned(), val);
                break;
            }
            at = obj.get_mut(*part).expect("checked above");
        }
    }
    serde_json::from_value(v).map_err(|e| format!("--set: {e}"))
}

pub fn signature_json(car: u32, t: &SignatureTracker) -> Value {
    let mut m = serde_json::Map::new();
    m.insert("car".into(), json!(car));
    for (name, v) in t.signature() {
        m.insert(name.into(), json!(v));
    }
    Value::Object(m)
}

/// Debris footprints on the ground (centre and half extents, m) for snapshots.
pub fn debris(sim: &Sim) -> Vec<Value> {
    sim.debris_footprints()
        .iter()
        .zip(sim.prop_kinds())
        .map(
            |(d, k)| json!({ "x": d.x, "z": d.z, "halfW": d.half_w, "halfL": d.half_l, "kind": k }),
        )
        .collect()
}

/// Observations of a finished run.
#[derive(Debug)]
pub struct Recorded {
    pub checks: Vec<Check>,
    /// One object per car: every outcome-signature metric at the end of the run.
    pub signature: Vec<Value>,
    /// The full state (cars, debris, session) at each `observe` tick and at the end.
    pub observations: Vec<Value>,
    /// One row per tick when tracing.
    pub trace: Vec<Value>,
}

/// A fixture's run around a [`Sim`] the caller owns and steps.
pub struct Harness {
    fx: Fixture,
    route: RouteGeom,
    session: Session,
    trace_on: bool,
    trackers: Vec<SignatureTracker>,
    checks: Vec<Check>,
    observations: Vec<Value>,
    trace: Vec<Value>,
    /// How much of the journal earlier trace rows have reported.
    seen_setup: usize,
    seen_inputs: usize,
    seen_race: usize,
    seen_damage: usize,
    /// The jj-input source machine of each car driven by raw `stick` spans.
    sources: std::collections::BTreeMap<u32, jj_input::SourceState>,
}

/// Spawns a car the way a fixture's `cars` entry does (journaled); returns it and its spawn pose.
fn spawn(sim: &mut Sim, map: &LoadedMap, c: &CarSpec) -> Result<(CarId, SpawnPose), String> {
    let pose = match (c.pose, c.route_point) {
        (Some(p), _) => p.spawn(),
        (None, Some(rp)) => route_spawn(map, rp, c.lateral, c.lift),
        (None, None) => return Err("needs routePoint or pose".into()),
    };
    let id = sim.spawn_car(pose);
    let roll = c.pose.map_or(0.0, |p| p.roll_deg.to_radians());
    if c.linvel.is_some() || roll != 0.0 {
        sim.place_car(id, pose, roll, c.linvel.unwrap_or([0.0; 3]));
    }
    Ok((id, pose))
}

impl Harness {
    /// Sets the fixture up on a fresh `sim`: its cars and grid (journaled), then its seats (through the seat reducer)
    /// and round phase (through the director's own inputs).
    pub fn new(fx: Fixture, map: &LoadedMap, sim: &mut Sim, trace: bool) -> Result<Self, String> {
        let mut spawns = Vec::new();
        for (i, c) in fx.cars.iter().enumerate() {
            spawns.push(spawn(sim, map, c).map_err(|e| format!("cars[{i}] {e}"))?.1);
        }
        if let Some(n) = fx.grid {
            for id in sim.spawn_grid(n) {
                spawns.push(sim.grid_pose(id.0 as usize));
            }
        }
        let mut session = Session::new(&fx.seats)?;
        if let Some(phase) = fx.phase {
            session.jump(phase)?;
        }
        let route = RouteGeom::new(&map.map);
        let trackers = spawns
            .iter()
            .map(|&s| SignatureTracker::new(s, &route))
            .collect();
        let checks = fx
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
        Ok(Self {
            fx,
            route,
            session,
            trace_on: trace,
            trackers,
            checks,
            observations: Vec::new(),
            trace: Vec::new(),
            seen_setup: 0,
            seen_inputs: 0,
            seen_race: 0,
            seen_damage: 0,
            sources: std::collections::BTreeMap::new(),
        })
    }

    pub fn fixture(&self) -> &Fixture {
        &self.fx
    }

    /// Spawns one more car as a `cars` entry would (journaled), tracked from its spawn pose.
    pub fn spawn(&mut self, map: &LoadedMap, sim: &mut Sim, c: &CarSpec) -> Result<CarId, String> {
        let (id, pose) = spawn(sim, map, c)?;
        self.trackers.push(SignatureTracker::new(pose, &self.route));
        Ok(id)
    }

    /// More scripted input spans (a later span for the same car and tick wins, as in the fixture).
    pub fn add_inputs(&mut self, spans: impl IntoIterator<Item = InputSpan>) {
        self.fx.inputs.extend(spans);
    }

    /// Before the sim steps tick `sim.tick()`: the fixture's events at that tick, then every car's scripted input.
    pub fn before_step(&mut self, sim: &mut Sim) {
        let fx = &self.fx;
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
        for d in fx.damage.iter().filter(|d| d.tick == t) {
            if let Some(part) = jj_sim::damage::part_index(&d.part) {
                sim.set_part_health(CarId(d.car), part as u8, d.health);
            }
        }
        for r in fx.wreck.iter().filter(|r| r.tick == t) {
            sim.wreck(CarId(r.car));
        }
        for r in fx.recover.iter().filter(|r| r.tick == t) {
            sim.recover(CarId(r.car));
        }
        for d in fx.debris.iter().filter(|d| d.tick == t) {
            sim.spawn_debris(d.pose.spawn(), d.half);
        }
        for _ in fx.drop_in.iter().filter(|d| d.tick == t) {
            sim.drop_in();
        }
        for a in fx.autopilot.iter().filter(|a| a.tick == t) {
            sim.set_autopilot(CarId(a.car), a.on);
        }
        for car in 0..sim.cars().count() as u32 {
            let span =
                fx.inputs.iter().rev().find(|i| {
                    i.car == car && i.from_tick <= t && i.to_tick.is_none_or(|end| t < end)
                });
            let stick_driven = fx.inputs.iter().any(|i| i.car == car && i.stick.is_some());
            if stick_driven {
                // Through jj-input, as the host does for a pad: the sticks' meaning, and any gesture they complete.
                let q = |v: [f32; 2]| [quantise_axis(v[0]), quantise_axis(v[1])];
                let (drive, action) = span.map_or(([0, 0], [0, 0]), |i| {
                    (
                        q(i.stick.unwrap_or_default()),
                        q(i.action.unwrap_or_default()),
                    )
                });
                let flags = jj_input::SampleFlags {
                    available: !span.is_some_and(|i| i.cancel),
                    drive_touch: drive != [0, 0],
                    action_touch: action != [0, 0],
                    menu_open: false,
                };
                let source = self.sources.entry(car).or_insert_with(|| {
                    jj_input::SourceState::new(jj_types::SourceHandle(car as u16 + 1))
                });
                let fired =
                    source.sample(drive, action, flags, t * 1000 / u64::from(jj_sim::TICK_HZ));
                let s = source.semantics();
                sim.set_input(
                    CarId(car),
                    DriveInput::from_semantics(
                        s.drive.throttle,
                        s.drive.steer,
                        s.drive.brake,
                        s.drift,
                        s.boost,
                    ),
                );
                for a in fired {
                    match a.kind {
                        jj_protocol::cmd::ActionKind::Wheelie { preload_ms } => {
                            sim.wheelie(CarId(car), preload_ms);
                        }
                        // The ACTION stick's up and down sectors (P1-S08), as the host applies them.
                        jj_protocol::cmd::ActionKind::UtilityForward => {
                            sim.utility(CarId(car), jj_sim::UtilityKind::Forward);
                        }
                        jj_protocol::cmd::ActionKind::UtilityRear => {
                            sim.utility(CarId(car), jj_sim::UtilityKind::Rear);
                        }
                    }
                }
                continue;
            }
            let input = span.map_or(DriveInput::default(), |i| DriveInput {
                throttle: quantise_axis(i.throttle),
                steer: quantise_axis(i.steer),
                brake: quantise_axis(i.brake.max(0.0)),
                drift: i.drift,
                boost: i.boost,
            });
            sim.set_input(CarId(car), input);
        }
    }

    /// After a step: the session's tick boundary, then the recorder (`end`: the run's last tick). Returns whether the
    /// fixture's `until` predicate holds.
    pub fn after_step(&mut self, sim: &Sim, end: bool) -> bool {
        self.session.step(sim.tick());
        self.record(sim, end)
    }

    /// What changed the sim since the previous row: the journal's setup commands and input changes, and the race's events
    /// (gates, laps, assist, respawns, the race end; P1-S05) and the damage episodes and part-state changes (P1-S04a), each
    /// with its tick.
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
        // Damage episodes and part-state changes (P1-S04a), each with its tick.
        let damage = sim.damage_events();
        events.extend(
            damage[self.seen_damage..]
                .iter()
                .map(|(at, e)| json!({ "at": at, "damage": e })),
        );
        self.seen_damage = damage.len();
        events
    }

    /// The full state now: cars (`jj_sim::observe`), debris footprints and the fixture's session.
    pub fn observe(&self, sim: &Sim) -> Value {
        json!({ "tick": sim.tick(), "cars": observe_cars(sim, &self.route), "debris": debris(sim),
                "session": self.session.observe() })
    }

    /// Records the state after a tick (`end`: the last one); returns whether the `until` predicate holds.
    pub fn record(&mut self, sim: &Sim, end: bool) -> bool {
        let cars = observe_cars(sim, &self.route);
        // Cars that joined mid-run (grid, drop-in, a controller's seat) get a tracker from where they first appear.
        for o in cars.iter().skip(self.trackers.len()) {
            let p = o.position;
            let spawn = SpawnPose {
                x: p[0],
                y: p[1],
                z: p[2],
                heading: o.heading_deg.to_radians(),
            };
            self.trackers
                .push(SignatureTracker::new(spawn, &self.route));
        }
        for (t, o) in self.trackers.iter_mut().zip(&cars) {
            t.update(o);
        }
        let tick = sim.tick();
        self.check(tick, end);
        if end || self.fx.observe.contains(&tick) {
            self.observations.push(
                json!({ "tick": tick, "cars": cars, "debris": debris(sim), "session": self.session.observe() }),
            );
        }
        if self.trace_on {
            let events = self.events(sim);
            self.trace
                .push(json!({ "tick": tick, "cars": cars, "events": events }));
        }
        self.fx.until.as_ref().is_some_and(|u| self.holds(u))
    }

    /// Whether a car's metric is inside `[min, max]` now (a missing car or metric never holds).
    pub fn holds(&self, u: &Until) -> bool {
        self.metric(u.car, u.metric)
            .is_some_and(|v| u.min.is_none_or(|m| v >= m) && u.max.is_none_or(|m| v <= m))
    }

    /// A car's metric now (state now, or a signature accumulator).
    pub fn metric(&self, car: u32, metric: Metric) -> Option<f64> {
        self.trackers
            .get(car as usize)
            .and_then(|t| t.metric(metric))
    }

    /// `until` stopped the run at this tick: it's the end, so check the end-of-run envelopes and snapshot it.
    pub fn end_here(&mut self, sim: &Sim) {
        let tick = sim.tick();
        self.check(tick, true);
        if !self.fx.observe.contains(&tick) {
            self.observations.push(json!({ "tick": tick, "cars": observe_cars(sim, &self.route),
                                            "debris": debris(sim), "session": self.session.observe() }));
        }
    }

    /// Evaluates every check due by now, the end-of-run ones included: an open-ended run (the browser host's test
    /// surface) has no last tick, so asking for the outcome is its end.
    pub fn check_now(&mut self, sim: &Sim) {
        self.check(sim.tick(), true);
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

    /// The signatures so far, one object per car.
    pub fn signature(&self) -> Vec<Value> {
        self.trackers
            .iter()
            .enumerate()
            .map(|(i, t)| signature_json(i as u32, t))
            .collect()
    }

    pub fn checks(&self) -> &[Check] {
        &self.checks
    }

    pub fn finish(self) -> Recorded {
        Recorded {
            signature: self.signature(),
            checks: self.checks,
            observations: self.observations,
            trace: self.trace,
        }
    }
}
