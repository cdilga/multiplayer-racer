//! Feel Lab scenes (R131, P1-FL09 on): small hand-made courses built by the real generator, so a scene's set pieces are
//! the same definitions generated tracks stamp (P1-FL15b). The data is `assets/lab/scenes.json`: each scene is an oval of
//! the given straights and radius in one biome, carrying the listed set pieces (or none), and the runs that drive it
//! headless: from before the first set piece, from the route's start, or from the road's edge beside a verge (P1-FL12).
//! `jj lab <scene>` writes the map and each run's fixture; the committed copies (maps/lab/, scenarios/lab/) are checked
//! against a fresh build by `tests/lab.rs`.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use jj_map::{Biome, Map};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::setpieces;
use crate::{course, seed::Streams, tuning::GeneratorData};

const SHIPPED: &str = include_str!("../../../assets/lab/scenes.json");

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scenes {
    pub schema: String,
    pub note: String,
    pub scenes: BTreeMap<String, Scene>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scene {
    pub what: String,
    pub biome: Biome,
    pub seed: u64,
    pub straight_m: f64,
    pub radius_m: f64,
    /// The set pieces the scene carries, in the order they're asked for (repeats ask for more).
    pub set_pieces: Vec<String>,
    /// Cuts across the oval's tight bends (P1-FL10, the generator's `forks.cut`). Asked for, the scene carries cuts
    /// and no meander forks, and a run without a set piece starts before the first cut's split.
    #[serde(default)]
    pub cuts: Option<crate::forks::CutData>,
    pub runs: Vec<Run>,
}

/// One headless run of a scene: a car placed `spawn_before_m` before the first set piece's lip (its take-off) at
/// `speed_mps`, on the autopilot or holding `throttle`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Run {
    pub run: String,
    pub what: String,
    /// Before the first set piece's lip; on a scene without one, from the route's start.
    #[serde(default)]
    pub spawn_before_m: f64,
    /// Or: at rest on the road, facing off it toward the first verge that rises like this (P1-FL12).
    #[serde(default)]
    pub verge: Option<Verge>,
    /// The roster vehicle that drives the run (the fixture's `vehicle`); the Cruz without one.
    #[serde(default)]
    pub vehicle: Option<String>,
    /// The fixture's sim seed, when it isn't the scene's (the autopilot's branch choice at a fork draws on it).
    #[serde(default)]
    pub sim_seed: Option<u64>,
    pub speed_mps: f64,
    pub autopilot: bool,
    /// A steady throttle (0..1) for a run without the autopilot.
    #[serde(default)]
    pub throttle: f64,
    pub ticks: u64,
    /// Stop early once car 0's metric is inside the range (`jj-fixture`'s `until`), e.g. at the first wreck.
    #[serde(default)]
    pub until: Option<Value>,
    /// Outcome envelope rows for car 0 (`jj-fixture` metrics).
    pub expect: Vec<Value>,
    /// More of the fixture (P1-FL08): keys that replace the run's own, such as a full grid (`cars`, `grid`), a `race` with
    /// its countdown, stick `inputs` or `autopilot` for every car; its `expect` rows name their own car and follow car 0's.
    #[serde(default)]
    pub fixture: Option<serde_json::Map<String, Value>>,
}

/// A verge to start a run at: within `REACH_M` of the road's edge the ground rises at least `min_rise_m`, and its steepest
/// 2 m step is between `min_deg` and `max_deg`. The run's car starts at rest `INSIDE_M` inside the road's edge, facing
/// square off the road toward it; `rise_m` bounds the height the car ends at over its start (an outcome envelope row,
/// `height`).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Verge {
    pub min_deg: f64,
    pub max_deg: f64,
    pub min_rise_m: f64,
    pub rise_m: [f64; 2],
}

/// How far past the road's edge a verge is looked at (m), and how far inside the edge a verge run starts.
const REACH_M: f64 = 16.0;
const INSIDE_M: f64 = 2.0;

/// A built scene: its map and each run's fixture (`jj sim` JSON), the fixture's `map` naming `map_path`.
pub struct Built {
    pub map: Map,
    pub fixtures: Vec<(String, Value)>,
}

/// The shipped scenes, parsed once.
pub fn shipped() -> &'static Scenes {
    static DATA: OnceLock<Scenes> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(SHIPPED).expect("assets/lab/scenes.json parses"))
}

/// Problems with the scene data (empty when it's sound).
pub fn validate_data(d: &Scenes) -> Vec<String> {
    let mut out = Vec::new();
    if d.schema != "jj.lab-scenes.v1" {
        out.push(format!("schema {:?}", d.schema));
    }
    for (id, s) in &d.scenes {
        if !(s.straight_m > 0.0 && s.radius_m > 0.0) {
            out.push(format!("{id}: straightM and radiusM must be positive"));
        }
        for k in &s.set_pieces {
            if setpieces::kind_of(k).is_none() {
                out.push(format!("{id}: unknown set piece {k:?}"));
            }
        }
        for r in &s.runs {
            if let Some(v) = &r.verge
                && !(v.min_deg < v.max_deg && v.min_rise_m > 0.0 && v.rise_m[0] < v.rise_m[1])
            {
                out.push(format!(
                    "{id} run {}: verge degrees, minRiseM and riseM",
                    r.run
                ));
            }
            if !(r.spawn_before_m >= 0.0
                && r.speed_mps >= 0.0
                && (0.0..=1.0).contains(&r.throttle)
                && r.ticks > 0)
            {
                out.push(format!(
                    "{id} run {}: spawnBeforeM, speedMps and ticks",
                    r.run
                ));
            }
        }
    }
    out
}

/// Builds scene `id` through the generator: the oval, the biome's terrain, exactly the scene's set pieces, features and
/// dressing. Fails if the map doesn't validate or a requested piece wasn't placed (the scene's seed is then wrong).
pub fn build(id: &str, map_path: &str) -> Result<Built, Vec<String>> {
    let scene = shipped()
        .scenes
        .get(id)
        .ok_or_else(|| vec![format!("no lab scene {id:?}")])?;
    let biome_name = serde_json::to_value(scene.biome)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default();
    let mut pieces = setpieces::shipped().clone();
    pieces.biomes = BTreeMap::from([(biome_name, scene.set_pieces.clone())]);
    pieces.min_per_lap = scene.set_pieces.len() as u32;
    pieces.per_km = 0.0;
    // The scene asks for its pieces by name: they're placed whether or not a short lab oval shows them from afar.
    pieces.fill_unseen = true;
    let course = course::lab_oval(scene.straight_m, scene.radius_m);
    let mut data = GeneratorData::shipped().clone();
    if let Some(cut) = scene.cuts {
        data.forks.per_km = 0.0;
        data.forks.cut = cut;
    }
    let (map, report) = crate::generate_course(
        Streams::new(scene.seed),
        course,
        &[scene.biome],
        &data,
        &pieces,
    )
    .map_err(|e| vec![format!("{id}: {e:?}")])?;
    let mut bad = crate::validate::check(&map, &crate::registry());
    bad.extend(setpieces::check(&map));
    let mut want = scene.set_pieces.clone();
    want.sort();
    let mut got: Vec<String> = report.set_pieces.iter().map(|s| s.to_string()).collect();
    got.sort();
    if got != want {
        bad.push(format!("{id}: placed {got:?}, the scene asks for {want:?}"));
    }
    if !bad.is_empty() {
        return Err(bad);
    }
    let first = map.features.iter().find(|f| setpieces_of(f));
    if first.is_none() && !scene.set_pieces.is_empty() {
        return Err(vec![format!("{id}: no set piece on the map")]);
    }
    let cut = map
        .features
        .iter()
        .filter_map(jj_map::fork::Fork::of)
        .find(|d| d.cut);
    if scene.cuts.is_some() && cut.is_none() {
        return Err(vec![format!(
            "{id}: no cut on the map (rejects {:?})",
            report.fork_rejects
        )]);
    }
    let mut fixtures = Vec::new();
    for r in &scene.runs {
        let mut expect: Vec<Value> = r.expect.clone();
        let ([x, z], [tx, tz], y) = if let Some(v) = &r.verge {
            let (at, [nx, nz], y) = verge_spawn(&map, v)
                .ok_or_else(|| vec![format!("{id} run {}: no verge like {v:?}", r.run)])?;
            expect.push(json!({ "metric": "height", "min": round3(y + v.rise_m[0]), "max": round3(y + v.rise_m[1]) }));
            (at, [nx, nz], y + 0.3)
        } else {
            let (at, t) = match (first, cut) {
                (Some(f), _) => {
                    let lip = jj_map::setpiece::GapLeap::of(f).map_or(0.0, |d| d.lip_u());
                    jj_map::jump::route_along(&map, f, lip - r.spawn_before_m)
                }
                (None, Some(d)) => route_before(&map, d.from as usize, r.spawn_before_m),
                (None, None) => route_start(&map),
            };
            let y = jj_map::jump::ground_height_m(&map.terrain, at[0], at[1]) + 0.3;
            (at, t, y)
        };
        let heading = 90.0 - libm::atan2(tz, tx).to_degrees();
        let mut fx = json!({
            "scenario": r.run,
            "what": r.what,
            "map": map_path,
            "seed": r.sim_seed.unwrap_or(scene.seed),
            "ticks": r.ticks,
            "cars": [{
                "pose": { "x": round3(x), "y": round3(y), "z": round3(z), "headingDeg": round3(heading) },
                "linvel": [round3(r.speed_mps * tx), 0.0, round3(r.speed_mps * tz)],
            }],
            "expect": expect.iter().map(|e| {
                let mut e = e.clone();
                e["car"] = json!(0);
                e
            }).collect::<Vec<_>>(),
        });
        if let Some(v) = &r.vehicle {
            fx["vehicle"] = json!(v);
        }
        if r.autopilot {
            fx["autopilot"] = json!([{ "tick": 0, "car": 0, "on": true }]);
        } else if r.throttle > 0.0 {
            fx["inputs"] = json!([{ "car": 0, "fromTick": 0, "throttle": r.throttle }]);
        }
        if let Some(u) = &r.until {
            let mut u = u.clone();
            u["car"] = json!(0);
            fx["until"] = u;
        }
        for (k, v) in r.fixture.iter().flatten() {
            if k == "expect" {
                let rows = fx["expect"].as_array_mut().expect("expect is a list");
                rows.extend(v.as_array().into_iter().flatten().cloned());
            } else {
                fx[k] = v.clone();
            }
        }
        fixtures.push((r.run.clone(), fx));
    }
    Ok(Built { map, fixtures })
}

/// The point `metres` back along the route from point `idx`, and the route's direction there.
fn route_before(map: &Map, idx: usize, metres: f64) -> ([f64; 2], [f64; 2]) {
    let pts = &map.route.points;
    let n = pts.len();
    let p = |i: usize| {
        let q = &pts[i % n];
        [f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0]
    };
    let (mut i, mut left) = (idx % n, metres);
    loop {
        let (a, b) = (p(i + n - 1), p(i));
        let len = libm::hypot(b[0] - a[0], b[1] - a[1]).max(1e-9);
        let t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        if left <= len {
            return ([b[0] - t[0] * left, b[1] - t[1] * left], t);
        }
        left -= len;
        i = (i + n - 1) % n;
    }
}

/// The route's first point and its direction.
fn route_start(map: &Map) -> ([f64; 2], [f64; 2]) {
    let p = |i: usize| {
        let q = &map.route.points[i];
        [f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0]
    };
    let (a, b) = (p(0), p(1));
    let len = libm::hypot(b[0] - a[0], b[1] - a[1]).max(1e-9);
    (a, [(b[0] - a[0]) / len, (b[1] - a[1]) / len])
}

/// The first route point (from the start, left side before right) beside a verge like `v`: the spawn point `INSIDE_M`
/// inside the road's edge, the unit direction square off the road toward the verge, and the road's height there (m).
fn verge_spawn(map: &Map, v: &Verge) -> Option<([f64; 2], [f64; 2], f64)> {
    let pts = &map.route.points;
    let n = pts.len();
    let p = |i: usize| {
        let q = &pts[i % n];
        [f64::from(q.x) / 1000.0, f64::from(q.z) / 1000.0]
    };
    for (i, q) in pts.iter().enumerate() {
        let (a, b) = (p(i), p(i + 1));
        let len = libm::hypot(b[0] - a[0], b[1] - a[1]).max(1e-9);
        let t = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        let half = f64::from(q.width) / 2000.0;
        let road_y = f64::from(q.y) / 1000.0;
        // Left of the direction of travel first (+x is left of +z), then right.
        for side in [1.0, -1.0] {
            let nrm = [t[1] * side, -t[0] * side];
            let h = |d: f64| {
                jj_map::jump::ground_height_m(&map.terrain, a[0] + nrm[0] * d, a[1] + nrm[1] * d)
            };
            // Every metre out from the edge; the slope over each 2 m.
            let samples: Vec<f64> = (0..=REACH_M as usize).map(|k| h(half + k as f64)).collect();
            let rise = samples.iter().fold(f64::NEG_INFINITY, |m, &y| m.max(y)) - road_y;
            let steepest = samples
                .windows(3)
                .map(|w| libm::atan((w[2] - w[0]) / 2.0).to_degrees())
                .fold(f64::NEG_INFINITY, f64::max);
            if rise >= v.min_rise_m && (v.min_deg..=v.max_deg).contains(&steepest) {
                let d = half - INSIDE_M;
                return Some(([a[0] + nrm[0] * d, a[1] + nrm[1] * d], nrm, road_y));
            }
        }
    }
    None
}

fn setpieces_of(f: &jj_map::Feature) -> bool {
    jj_map::setpiece::GapLeap::of(f).is_some()
}

fn round3(v: f64) -> f64 {
    libm::round(v * 1000.0) / 1000.0
}
