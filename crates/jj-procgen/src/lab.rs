//! Feel Lab scenes (R131, P1-FL09 on): small hand-made courses built by the real generator, so a scene's set pieces are
//! the same definitions generated tracks stamp (P1-FL15b). The data is `assets/lab/scenes.json`: each scene is an oval of
//! the given straights and radius in one biome, carrying the listed set pieces, and the runs that drive it headless.
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
    pub runs: Vec<Run>,
}

/// One headless run of a scene: a car placed `spawn_before_m` before the first set piece's lip (its take-off) at
/// `speed_mps`, on the autopilot or holding `throttle`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Run {
    pub run: String,
    pub what: String,
    pub spawn_before_m: f64,
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
}

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
    let course = course::lab_oval(scene.straight_m, scene.radius_m);
    let (map, report) = crate::generate_course(
        Streams::new(scene.seed),
        course,
        &[scene.biome],
        GeneratorData::shipped(),
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
    let first = map
        .features
        .iter()
        .find(|f| setpieces_of(f))
        .ok_or_else(|| vec![format!("{id}: no set piece on the map")])?;
    let fixtures = scene
        .runs
        .iter()
        .map(|r| {
            let lip = jj_map::setpiece::GapLeap::of(first).map_or(0.0, |d| d.lip_u());
            let ([x, z], [tx, tz]) =
                jj_map::jump::route_along(&map, first, lip - r.spawn_before_m);
            let y = jj_map::jump::ground_height_m(&map.terrain, x, z) + 0.3;
            let heading = 90.0 - libm::atan2(tz, tx).to_degrees();
            let mut fx = json!({
                "scenario": r.run,
                "what": r.what,
                "map": map_path,
                "seed": scene.seed,
                "ticks": r.ticks,
                "cars": [{
                    "pose": { "x": round3(x), "y": round3(y), "z": round3(z), "headingDeg": round3(heading) },
                    "linvel": [round3(r.speed_mps * tx), 0.0, round3(r.speed_mps * tz)],
                }],
                "expect": r.expect.iter().map(|e| {
                    let mut e = e.clone();
                    e["car"] = json!(0);
                    e
                }).collect::<Vec<_>>(),
            });
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
            (r.run.clone(), fx)
        })
        .collect();
    Ok(Built { map, fixtures })
}

fn setpieces_of(f: &jj_map::Feature) -> bool {
    jj_map::setpiece::GapLeap::of(f).is_some()
}

fn round3(v: f64) -> f64 {
    libm::round(v * 1000.0) / 1000.0
}
