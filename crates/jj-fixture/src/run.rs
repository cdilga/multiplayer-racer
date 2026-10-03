//! Running a fixture to its end (or its `until`), replaying its journal, and its baselines (§7.3a): the loop `jj sim`
//! and the feel bank (`crates/jj-sim/tests/feel.rs`) share. I/O-free: the caller loads the map and profile.

use serde::Serialize;

use jj_map::{LoadedMap, Registry};
use jj_sim::observe::Metric;
use jj_sim::rng::Rng;
use jj_sim::{Journal, Sim, VehicleProfile};

use crate::{BaselineKind, Fixture, Harness, InputSpan, Recorded};

/// One run's results.
pub struct RunOutput {
    pub ticks: u64,
    pub stopped_early: bool,
    pub state_hash: [u8; 32],
    /// The hash of replaying the run's journal from its bytes (equal, or the run isn't reproducible).
    pub replay_hash: [u8; 32],
    pub journal: Journal,
    pub recorded: Recorded,
    pub baselines: Vec<BaselineResult>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineResult {
    pub kind: BaselineKind,
    /// The baseline came out different: at least one listed metric differed by its margin.
    pub ok: bool,
    pub differ: Vec<DifferResult>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DifferResult {
    pub car: u32,
    pub metric: Metric,
    pub at_tick: Option<u64>,
    pub deliberate: Option<f64>,
    pub baseline: Option<f64>,
    pub by: f64,
    pub ok: bool,
}

impl RunOutput {
    pub fn replay_matches(&self) -> bool {
        self.state_hash == self.replay_hash
    }

    /// Every envelope held, the replay matched and every baseline differed.
    pub fn ok(&self) -> bool {
        self.recorded.checks.iter().all(|c| c.ok)
            && self.replay_matches()
            && self.baselines.iter().all(|b| b.ok)
    }
}

type Sample = (u32, Metric, Option<u64>);

/// One stepped run: the sim, its recording, whether `until` stopped it, and the requested samples' values.
struct Once {
    sim: Sim,
    recorded: Recorded,
    stopped_early: bool,
    values: Vec<Option<f64>>,
}

/// Steps a fixture to its end or `until`, taking `samples` (car, metric, at tick or the end) on the way.
fn run_once(
    fx: Fixture,
    map: &LoadedMap,
    registry: &Registry,
    profile: &VehicleProfile,
    trace: bool,
    samples: &[Sample],
) -> Result<Once, String> {
    let ticks = fx.ticks;
    let mut sim = Sim::new(map, registry, fx.seed, profile.clone());
    let mut h = Harness::new(fx, map, &mut sim, trace)?;
    let mut values = vec![None; samples.len()];
    let take = |h: &Harness, values: &mut Vec<Option<f64>>, tick: u64, end: bool| {
        for (v, &(car, metric, at)) in values.iter_mut().zip(samples) {
            if at == Some(tick) || (end && at.is_none()) {
                *v = h.metric(car, metric);
            }
        }
    };
    let mut stopped_early = false;
    h.record(&sim, ticks == 0);
    take(&h, &mut values, 0, ticks == 0);
    while sim.tick() < ticks {
        h.before_step(&mut sim);
        sim.step();
        let last = sim.tick() == ticks;
        let until = h.after_step(&sim, last);
        take(&h, &mut values, sim.tick(), last);
        if until && !last {
            stopped_early = true;
            h.end_here(&sim);
            take(&h, &mut values, sim.tick(), true);
            break;
        }
    }
    Ok(Once {
        sim,
        recorded: h.finish(),
        stopped_early,
        values,
    })
}

/// The baseline's inputs in place of the fixture's.
fn baseline_inputs(fx: &Fixture, kind: BaselineKind) -> Vec<InputSpan> {
    let cars: Vec<u32> = {
        let mut c: Vec<u32> = fx.inputs.iter().map(|i| i.car).collect();
        c.sort_unstable();
        c.dedup();
        c
    };
    match kind {
        BaselineKind::NoInput => vec![],
        BaselineKind::NoAction => fx
            .inputs
            .iter()
            .map(|i| InputSpan {
                drift: false,
                boost: false,
                action: None,
                ..i.clone()
            })
            .collect(),
        BaselineKind::BoostForever => {
            // Every span boosts, and a span from tick 0 keeps boost held where the script has gaps, for every car
            // (an autopiloted one too: its ACTION stick passes through).
            let all = (fx.cars.len() + fx.grid.unwrap_or(0) + fx.drop_in.len()) as u32;
            let mut spans: Vec<InputSpan> = (0..all)
                .map(|car| InputSpan {
                    car,
                    from_tick: 0,
                    to_tick: None,
                    throttle: 0.0,
                    steer: 0.0,
                    brake: 0.0,
                    drift: false,
                    boost: true,
                    stick: None,
                    action: None,
                })
                .collect();
            spans.extend(fx.inputs.iter().map(|i| InputSpan {
                boost: true,
                ..i.clone()
            }));
            spans
        }
        BaselineKind::Hold => cars
            .iter()
            .filter_map(|&car| {
                fx.inputs
                    .iter()
                    .filter(|i| i.car == car)
                    .min_by_key(|i| i.from_tick)
                    .map(|i| InputSpan {
                        car,
                        from_tick: 0,
                        to_tick: None,
                        ..i.clone()
                    })
            })
            .collect(),
        BaselineKind::Mash => {
            const EVERY: u64 = 6;
            let mut rng = Rng::stream(fx.seed, "baseline-mash");
            let mut out = Vec::new();
            for t in (0..fx.ticks).step_by(EVERY as usize) {
                for &car in &cars {
                    // DRIVE anywhere; ACTION left (drift) or right (boost) a fifth of the time each.
                    let (throttle, steer, action) =
                        (rng.next_f32(), rng.next_f32(), rng.next_f32());
                    out.push(InputSpan {
                        car,
                        from_tick: t,
                        to_tick: Some(t + EVERY),
                        throttle: throttle * 2.0 - 1.0,
                        steer: steer * 2.0 - 1.0,
                        brake: 0.0,
                        drift: action < 0.2,
                        boost: (0.2..0.4).contains(&action),
                        stick: None,
                        action: None,
                    });
                }
            }
            out
        }
    }
}

/// Runs `fx` (its envelopes, its replay) and then its baselines.
pub fn run(
    fx: &Fixture,
    map: &LoadedMap,
    registry: &Registry,
    profile: &VehicleProfile,
    trace: bool,
) -> Result<RunOutput, String> {
    let samples: Vec<Sample> = fx
        .baselines
        .iter()
        .flat_map(|b| b.differ.iter().map(|d| (d.car, d.metric, d.at_tick)))
        .collect();
    let Once {
        sim,
        recorded,
        stopped_early,
        values: deliberate,
    } = run_once(fx.clone(), map, registry, profile, trace, &samples)?;
    let journal = Journal::from_bytes(&sim.journal().to_bytes()).map_err(|e| e.to_string())?;
    let replayed = Sim::replay(map, registry, profile.clone(), &journal, sim.tick());
    let mut baselines = Vec::new();
    if let Some(b) = &fx.baselines {
        for &kind in &b.kinds {
            let mut variant = fx.clone();
            variant.inputs = baseline_inputs(fx, kind);
            // As long as the deliberate run (which `until` may have cut short), so "the end" is the same tick.
            variant.ticks = sim.tick();
            variant.until = None;
            variant.baselines = None;
            let got = run_once(variant, map, registry, profile, false, &samples)?.values;
            let differ = b
                .differ
                .iter()
                .zip(deliberate.iter().zip(&got))
                .filter(|(d, _)| d.against.is_empty() || d.against.contains(&kind))
                .map(|(d, (&a, &v))| DifferResult {
                    car: d.car,
                    metric: d.metric,
                    at_tick: d.at_tick,
                    deliberate: a,
                    baseline: v,
                    by: d.by,
                    // A metric only one of the runs has (it stopped, it landed) differs by definition; `more` needs the
                    // deliberate run's to be the higher.
                    ok: match (a, v) {
                        (Some(a), Some(v)) if d.more => a - v >= d.by,
                        (Some(a), Some(v)) => (a - v).abs() >= d.by,
                        (Some(_), None) => true,
                        (None, Some(_)) => !d.more,
                        (None, None) => false,
                    },
                })
                .collect::<Vec<DifferResult>>();
            baselines.push(BaselineResult {
                kind,
                ok: differ.iter().any(|d| d.ok),
                differ,
            });
        }
    }
    Ok(RunOutput {
        ticks: sim.tick(),
        stopped_early,
        state_hash: sim.state_hash(),
        replay_hash: replayed.state_hash(),
        journal,
        recorded,
        baselines,
    })
}
